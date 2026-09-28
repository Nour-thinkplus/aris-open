/**
 * ARIS Open — internal zero-dependency XML engine
 * =================================================
 * A small, correct XML reader/writer implementing the fast-xml-parser API
 * surface that ARIS Open needs:
 *   - XMLParser.parse(xmlText)            → plain JS object
 *   - XMLBuilder.build(obj)               → formatted XML string
 * supports: @-attributes, #text, CDATA, comments, PIs, repeated tags→arrays,
 * suppressEmptyNode / format / indentBy / newlineAfterEndTag.
 *
 * Zero npm runtime deps → the model, AML engine and UI all run in Node
 * (tests) and in the browser (Electron renderer) with no bundler.
 *
 * MIT — Copyright (c) ARIS Open Contributors
 */

// ---------------------------------------------------------------------------
//  Escaping
// ---------------------------------------------------------------------------

function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function unesc(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
//  Tokenizer
// ---------------------------------------------------------------------------

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i);
      tokens.push({ type: 'pi', text: src.slice(i, (end < 0 ? src.length : end + 2)) });
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      tokens.push({ type: 'comment', text: src.slice(i, (end < 0 ? src.length : end + 3)) });
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i);
      tokens.push({ type: 'cdata', text: src.slice(i + 9, (end < 0 ? src.length : end)) });
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[i] === '<' && (src.startsWith('</', i) || !src.startsWith('<!'))) {
      const end = src.indexOf('>', i);
      if (end < 0) throw new Error('Unterminated tag at offset ' + i);
      tokens.push({ type: 'tag', text: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    let j = i;
    let next = src.indexOf('<', i);
    j = next < 0 ? src.length : next;
    tokens.push({ type: 'text', text: src.slice(i, j) });
    i = j;
  }
  return tokens;
}

// Parse one tag body (text between < and >) → { end?, tagName, selfClose, attrs }
function parseTag(text) {
  text = text.trim();
  let selfClose = false;
  if (text.endsWith('/')) { selfClose = true; text = text.slice(0, -1).trimEnd(); }
  if (text.charAt(0) === '/') return { end: true, tagName: text.slice(1).trim() };

  // 1) tag name (up to whitespace or terminator)
  let k = 0;
  let name = '';
  while (k < text.length && !/\s/.test(text[k]) && text[k] !== '/' && text[k] !== '>') name += text[k++];
  const tagName = name;

  // 2) attributes
  const attrs = {};
  let lastK = -1;
  while (k < text.length) {
    while (k < text.length && /\s/.test(text[k])) k++;
    if (k >= text.length) break;
    if (text[k] === '/') { selfClose = true; k++; break; }
    let an = '';
    while (k < text.length && text[k] !== '=' && !/\s/.test(text[k]) && text[k] !== '/') an += text[k++];
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === '=') {
      k++;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === '"' || text[k] === "'") {
        const q = text[k++];
        let v = '';
        while (k < text.length && text[k] !== q) v += text[k++];
        if (k < text.length) k++;
        attrs[an] = unesc(v);
      } else {
        let v = '';
        while (k < text.length && !/\s/.test(text[k]) && text[k] !== '/') v += text[k++];
        attrs[an] = unesc(v);
      }
    } else if (an) {
      attrs[an] = true;
    }
    if (an === '' && k === lastK) k++;
    lastK = k;
  }
  return { end: false, tagName, selfClose, attrs };
}

function attach(parent, tagName, node) {
  const ex = parent[tagName];
  if (ex === undefined || ex === null) parent[tagName] = node;
  else if (Array.isArray(ex)) ex.push(node);
  else parent[tagName] = [ex, node];
}

// ---------------------------------------------------------------------------
//  XMLParser
// ---------------------------------------------------------------------------

export class XMLParser {
  constructor(opts = {}) {
    this.opts = Object.assign({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      trimValues: false,
    }, opts);
  }

  parse(xmlText) {
    const tokens = tokenize(String(xmlText ?? ''));
    const O = this.opts;
    const root = {};
    const stack = [root];                  // stack[stack.length-1] = current node

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      if (tok.type === 'pi' || tok.type === 'comment') continue;

      if (tok.type === 'text' || tok.type === 'cdata') {
        const cur = stack[stack.length - 1];
        const raw = O.trimValues ? tok.text.trim() : tok.text;
        const v = tok.type === 'cdata' ? raw : unesc(raw);   // CDATA is literal
        if (v === '') continue;
        if (cur['#text'] !== undefined && typeof cur['#text'] === 'string') {
          cur['#text'] += v;
        } else if (cur['#text'] === undefined) {
          cur['#text'] = v;
        }
        continue;
      }

      const tag = parseTag(tok.text);

      if (tag.end) {
        if (stack.length > 1) stack.pop();
        continue;
      }

      const node = {};
      if (!O.ignoreAttributes) {
        for (const [an, av] of Object.entries(tag.attrs)) {
          node[O.attributeNamePrefix + an] = av;
        }
      }
      // Attach immediately to the current node (which is the tag's parent);
      // repeated same-named siblings are promoted to an array.
      attach(stack[stack.length - 1], tag.tagName, node);
      if (!tag.selfClose) stack.push(node);
    }

    if (stack.length > 1) {
      console.warn('ARIS-XML: document ended with unclosed tags (',
        stack.length - 1, 'open). Top-level result may be nested.');
    }
    return root;
  }
}

// ---------------------------------------------------------------------------
//  XMLBuilder
// ---------------------------------------------------------------------------

export class XMLBuilder {
  constructor(opts = {}) {
    this.opts = Object.assign({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      suppressEmptyNode: false,
      format: false,
      indentBy: '  ',
      newlineAfterEndTag: false,
    }, opts);
  }

  build(node) {
    const parts = [];
    for (const [k, v] of Object.entries(node ?? {})) {
      const s = this.el(k, v, 0);
      if (s) parts.push(s);
    }
    return parts.join('\n');
  }

  el(tagName, value, depth) {
    const O = this.opts;
    const IND = O.indentBy.repeat(depth);
    const IND1 = O.indentBy.repeat(depth + 1);
    const nl = O.format ? '\n' : '';
    const AP = O.attributeNamePrefix;

    if (value === undefined || value === null) {
      if (O.suppressEmptyNode) return '';
      return IND + '<' + tagName + '/>' + (O.newlineAfterEndTag ? nl : '');
    }

    if (typeof value !== 'object') {
      if (O.suppressEmptyNode && (value === '' || value === false || value === true)) {
        return value === true ? IND + '<' + tagName + '/>' + (O.newlineAfterEndTag ? nl : '') : '';
      }
      const txt = value === '' ? '' : escText(value);
      return IND + '<' + tagName + '>' + txt + '</' + tagName + '>' +
        (O.newlineAfterEndTag ? nl : '');
    }

    if (Array.isArray(value)) {
      let out = '';
      for (const item of value) {
        const s = this.el(tagName, item, depth);
        if (s) out += nl + s;
      }
      return out;
    }

    // object → attributes + text + child elements
    let attrs = '';
    let text = '';
    let children = '';
    for (const [k, v] of Object.entries(value)) {
      if (k === '#text') { if (v !== undefined && v !== '') text = v; continue; }
      if (k.startsWith(AP)) {
        const name = k.slice(AP.length);
        if (v === undefined || v === null || v === false) continue;
        attrs += ' ' + name + '="' + escAttr(v) + '"';
        continue;
      }
      const c = this.el(k, v, depth + 1);
      if (c) children += nl + c;
    }

    if (text !== '' && children === '') {
      return IND + '<' + tagName + attrs + '>' + escText(text) + '</' + tagName + '>' +
        (O.newlineAfterEndTag ? nl : '');
    }
    if (children === '' && text === '') {
      if (O.suppressEmptyNode && attrs === '') return '';
      return IND + '<' + tagName + attrs + '/>' + (O.newlineAfterEndTag ? nl : '');
    }
    return IND + '<' + tagName + attrs + '>' + children + (O.format ? nl : '') +
      IND + '</' + tagName + '>' + (O.newlineAfterEndTag ? nl : '');
  }
}
