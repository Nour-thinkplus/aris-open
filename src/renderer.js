/**
 * ARIS Open — renderer (browser UI)
 * =================================
 * Vanilla-JS canvas editor over the core engine (model.js / aml.js /
 * semChecks.js).  Runs inside Electron (window.aris bridge) or plain browser.
 *
 *  • SVG canvas: select · drag · connect · delete · zoom · pan · fit · auto-layout
 *  • Object palette (Function / Event / Process / Org unit / App sys / Busi. rule)
 *  • Model list, object properties, ARIS semantic checks panel
 *  • Open / Save as  →  AML XML (.aml)  or  ARIS Open JSON (.ajos)
 *  • Export current model as standalone SVG
 */
import {
  Database, Model, ObjDef,
  cxnTypes, objKinds,
} from './model.js';
import {
  toAmlXml, fromAmlXml, toJSON, fromJSON,
  NODE_COLORS,
} from './aml.js';
import { runSemanticChecks, SEV } from './semChecks.js';

// ─────────────────────────────────────────────────────────────────────────
//  Constants & DOM helpers
// ─────────────────────────────────────────────────────────────────────────

const NODE_W = 150, NODE_H = 90;

const KIND_INFO = {};
for (const k of objKinds) KIND_INFO[k.kindName] = k;

const PALETTE_DEFAULT_NAME = {
  OT_FUNC:      'Function',
  OT_EVENT:     'Event',
  OT_PROCESS:   'Process',
  OT_ORGN_UNIT: 'Org unit',
  OT_APP_SYS:   'Application system',
  OT_BUSI_RULE: 'Business rule',
};

const PAL_KEY = {
  OT_FUNC: 'f', OT_EVENT: 'e', OT_PROCESS: 'p',
  OT_ORGN_UNIT: 'o', OT_APP_SYS: 'a', OT_BUSI_RULE: 'b',
};

const CXN_LABEL = {
  CT_CONTROLS:          'controls (process flow)',
  CT_IS_PRCSNT_SUPER:   'is superior',
  CT_IS_PRCSNT_SUBORD:  'is subordinate',
  CT_IS_ORGN_UNIT:      'is org unit of',
  CT_IS_PERFORMED_BY:   'performed by',
  CT_IS_SUPPORTED_BY:   'supported by',
  CT_IS_ACCESSIBLE:     'accessible',
  CT_IS_CONTROLS:       'controls (object ref)',
  CT_IS_REPLACED_BY:    'replaced by',
};

const $ = (id) => document.getElementById(id);

// ─────────────────────────────────────────────────────────────────────────
//  Application state
// ─────────────────────────────────────────────────────────────────────────

const S = {
  db:           null,        // Database
  model:        null,        // active Model
  modelIndex:   0,
  selected:     null,        // node id
  cxnId:        null,        // selected connection id
  mode:         'select',    // 'select' | 'connect' | 'place:<OT_XXX>'
  connectFrom:  null,        // node id pending in connect mode
  zoom:         1,
  pan:          { x: 60, y: 40 },
  dirty:        false,
  fileName:     null,
  fileKind:     null,        // 'aml' | 'json'
  checks:       null,        // last runSemanticChecks() result
  undo:         [],
  redo:         [],
  _drag:        null,
  _n:           0,
};

// ─────────────────────────────────────────────────────────────────────────
//  Small utilities
// ─────────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function curModel() { return S.model; }

function nodeAt(id) { return curModel()?.objDefs.get(id); }

function posOf(n) {
  return {
    x: (+n.attrs.get('_POS_X') || 120),
    y: (+n.attrs.get('_POS_Y') || 120),
  };
}

function newId(kind) {
  S._n += 1;
  return `obj_${kind.toLowerCase()}_${S._n}`;
}

function makeNode(kind, name) {
  const n = new ObjDef(newId(kind), kind, {});
  n.setAttr('AT_NAME', name);
  return n;
}

function setStatus() {
  const f = $('st-file');
  const d = $('st-dirty');
  if (f) f.textContent = S.fileName ? S.fileName : 'unsaved';
  if (d) d.classList.toggle('dirty', S.dirty);
}

function markDirty(v = true) { S.dirty = v; setStatus(); }

function counts() {
  const m = curModel();
  return `${m ? m.objDefs.size : 0} obj · ${m ? m.allConnections.length : 0} conn`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Rendering (SVG build)
// ─────────────────────────────────────────────────────────────────────────

function sceneBounds() {
  const m = curModel();
  if (!m || !m.objDefs.size) return { minX: 0, minY: 0, maxX: 900, maxY: 520 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of m.objDefs.values()) {
    const { x, y } = posOf(n);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + NODE_W); maxY = Math.max(maxY, y + NODE_H);
  }
  return { minX, minY, maxX, maxY };
}

function buildScene(m) {
  const nodes = [...m.objDefs.values()];
  const b = sceneBounds();
  const pad = 120;
  const gMinX = b.minX - pad, gMaxX = b.maxX + pad;
  const gMinY = b.minY - pad, gMaxY = b.maxY + pad;

  // unique arrowhead colors from connections
  const usedColors = new Set();
  for (const n of nodes)
    for (const c of n.outConnections)
      if (m.objDefs.has(c.targetId ?? (c.target && c.target.id)))
        usedColors.add(edgeColor(c.cxnType));

  const arrows = {};
  let arrowIdx = 0;
  for (const col of usedColors) {
    const key = 'arr' + (arrowIdx++);
    arrows[col] = `<marker id="${key}" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 Z" fill="${col}"/></marker>`;
  }

  let svg = `<defs>${Object.values(arrows).join('')}</defs><g class="arys-grid">`;

  const step = 50;
  for (let gx = Math.floor(gMinX / step) * step; gx <= gMaxX; gx += step)
    svg += `<line x1="${gx}" y1="${gMinY}" x2="${gx}" y2="${gMaxY}"/>`;
  for (let gy = Math.floor(gMinY / step) * step; gy <= gMaxY; gy += step)
    svg += `<line x1="${gMinX}" y1="${gy}" x2="${gMaxX}" y2="${gy}"/>`;
  svg += '</g>';

  // edges first (under nodes)
  for (const n of nodes) {
    const a = posOf(n);
    for (const c of n.outConnections) {
      const t = m.objDefs.get(c.target.id);
      if (!t) continue;
      const bb = posOf(t);
      svg += edgeSvg(n, t, c, () => {
        const col = edgeColor(c.cxnType);
        const id  = Object.keys(arrows).find(k => arrows[k].includes('fill="' + col + '"'));
        return id ? 'url(#' + id + ')' : '';
      });
    }
  }

  // nodes
  for (const n of nodes) {
    const { x, y } = posOf(n);
    const cfg = NODE_COLORS[n.typeNum] || NODE_COLORS._default;
    const kind = KIND_INFO[n.typeNum];
    const sel = n.id === S.selected ? ' selected' : '';
    const isConnSrc = S.connectFrom === n.id;
    const glyph = kind?.glyph || '◇';
    svg += `<g class="arys-node${sel}" data-id="${n.id}">
      ${isConnSrc ? `<rect x="${x - 5}" y="${y - 5}" width="${NODE_W + 10}" height="${NODE_H + 10}"
        rx="14" fill="none" stroke="#4d8cff" stroke-width="2" stroke-dasharray="6 4"/>` : ''}
      <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10"
        fill="${cfg.fill}" stroke="${cfg.stroke}" stroke-width="${sel || isConnSrc ? 2.5 : 1.5}"/>
      <rect x="${x}" y="${y}" width="${NODE_W}" height="4" rx="2" fill="${cfg.stroke}"/>
      <text x="${x + 14}" y="${y + 36}" class="arys-glyph" font-size="22"
        fill="${cfg.stroke}">${esc(glyph)}</text>
      <text x="${x + 44}" y="${y + 38}" class="arys-label" font-size="13.5" font-weight="600">
        ${esc((n.name || n.id).slice(0, 16))}</text>
      <text x="${x + 14}" y="${y + 62}" class="arys-type" font-size="10.5">
        ${esc(n.typeNum)}</text>
    </g>`;
  }

  // header strip inside scene
  svg += `<text x="${b.minX}" y="${b.minY - 60}" class="arys-head" font-size="13" opacity=".85">
    ${esc(m.name || m.id)} — ${esc(m.type || '')} — ${nodes.length} objects,
    ${m.allConnections.length} connections</text>`;

  return svg;
}

function edgeColor(cxnType) {
  const t = cxnType.split('.')[0];
  return (window && false) || _CXN_COLORS[t] || '#7f8ea3';
}

const _CXN_COLORS = {
  CT_CONTROLS:          '#0f7ac0',
  CT_IS_PRCSNT_SUPER:   '#5b5b5b',
  CT_IS_PRCSNT_SUBORD:  '#8a8a8a',
  CT_IS_ORGN_UNIT:      '#5b5b5b',
  CT_IS_PERFORMED_BY:   '#1f8b45',
  CT_IS_SUPPORTED_BY:   '#7a5fd0',
  CT_IS_ACCESSIBLE:     '#c06a12',
  CT_IS_CONTROLS:       '#0f7ac0',
  CT_IS_REPLACED_BY:    '#b04a4a',
};

function edgeSvg(fromN, toN, c, markerRefFn) {
  const a = posOf(fromN), b = posOf(toN);
  const ax = a.x + NODE_W, ay = a.y + NODE_H / 2;
  const bx = b.x,          by = b.y + NODE_H / 2;
  const color = edgeColor(c.cxnType);
  // direction-aware control points
  const dx = (bx - ax);
  const bend = Math.max(46, Math.min(160, Math.abs(dx) * 0.42));
  const c1x = ax + (dx >= 0 ? bend : -bend);
  const c2x = bx - (dx >= 0 ? bend : -bend);
  const d = `M${ax},${ay} C${c1x},${ay} ${c2x},${by} ${bx},${by}`;
  const sel = c.id === S.cxnId ? ' selected' : '';
  const midx = (ax + bx) / 2, midy = (ay + by) / 2;
  const short = Math.abs(dx) < 90; // nodes stacked — arc label below
  return `<g class="arys-edge${sel}" data-id="${c.id}">
    <path d="${d}" class="arys-edge-hit" fill="none"/>
    <path d="${d}" fill="none" stroke="${color}"
      marker-end="${markerRefFn()}"/>
    <text x="${midx}" y="${short ? midy + 16 : midy - 8}" class="arys-edge-label">
      ${esc(c.cxnType)}${c.inventoried === 'NO' ? '' : ''}</text>
  </g>`;
}

function render() {
  const svg = $('canvas');
  if (!svg) return;
  const m = curModel();
  if (!m) {
    svg.innerHTML = '<text x="30" y="60" class="arys-head">No model selected</text>';
  } else {
    svg.innerHTML = buildScene(m);
  }
  applyView();
  renderObjectList();
  refreshCounts();
}

function applyView() {
  const svg = $('canvas');
  if (!svg) return;
  // we transform the whole svg content via CSS on a wrapper <g>
  // (simpler: use transform attribute on first child after render)
  const inner = svg.querySelector(':scope > g') || svg;
  // Use root transform: apply to <svg> root's child container.
  // Actually we wrap the scene in a <g id="">: find or create:
  // Simplest: use CSS transform on the svg element itself (pan/zoom)
  const zoomEl = svg;
  zoomEl.style.transformOrigin = '0 0';
  zoomEl.style.transform = `translate(${S.pan.x}px,${S.pan.y}px) scale(${S.zoom})`;
  const zl = $('zoom-label');
  if (zl) zl.textContent = Math.round(S.zoom * 100) + '%';
}

function refreshCounts() {
  const c = $('st-count');
  const mdl = $('st-model');
  if (c) c.textContent = counts();
  if (mdl) mdl.textContent = `model: ${S.model?.name || '—'} (${S.model?.type || '—'})`;
  const om = $('obj-count');
  if (om) om.textContent = curModel()?.objDefs.size ?? 0;
  const mm = $('model-meta');
  if (mm) mm.textContent = `${S.db.models.length} model(s) in database · creator: ${S.db.creator}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Object list (left panel)
// ─────────────────────────────────────────────────────────────────────────

function renderObjectList() {
  const ul = $('obj-list');
  if (!ul) return;
  const m = curModel();
  ul.innerHTML = '';
  const nodes = m ? [...m.objDefs.values()] : [];
  if (!nodes.length) {
    ul.innerHTML = '<li class="empty muted">No objects in this model</li>';
    return;
  }
  for (const n of nodes) {
    const cfg = NODE_COLORS[n.typeNum] || NODE_COLORS._default;
    const li = document.createElement('li');
    li.dataset.id = n.id;
    if (n.id === S.selected) li.classList.add('active');
    li.innerHTML = `<span class="sw" style="background:${cfg.fill};border-color:${cfg.stroke}"></span>
      <span class="nm" title="${esc(n.name)}">${esc(n.name || '—')}</span>
      <span class="tt">${esc((n.typeNum || '').replace('OT_', ''))}</span>`;
    li.addEventListener('click', () => selectNode(n.id, { pan: true }));
    ul.appendChild(li);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Selection / properties / checks panels
// ─────────────────────────────────────────────────────────────────────────

function selectNode(id, opts = {}) {
  S.selected = id;
  S.cxnId = null;
  render();
  updateProps();
  if (opts.pan) {
    const n = nodeAt(id);
    if (n) {
      const p = posOf(n);
      panCenter(p.x + NODE_W / 2, p.y + NODE_H / 2);
    }
  }
}

function selectCxn(id) {
  S.cxnId = id;
  S.selected = null;
  render();
  updateProps();
}

function findCxnById(id) {
  const m = curModel();
  if (!m) return null;
  for (const n of m.objDefs.values())
    for (const c of n.outConnections)
      if (c.id === id) return c;
  return null;
}

function cxnEnds(c) {
  const m = curModel();
  let from = null, to = null;
  for (const n of m.objDefs.values()) {
    if (n.outConnections.some(x => x.id === c.id)) { from = n; to = c.target; break; }
  }
  return { from, to };
}

function updateProps() {
  const propsEmpty = $('props-empty'), propsForm = $('props-form');
  const edgeEmpty = $('edge-empty'),  edgeForm = $('edge-form');
  const m = curModel();
  const n = S.selected ? m.objDefs.get(S.selected) : null;

  if (S.cxnId) {
    const c = findCxnById(S.cxnId);
    const { from, to } = cxnEnds(c);
    propsEmpty.style.display = 'none'; propsForm.style.display = 'none';
    edgeEmpty.style.display = 'none';  edgeForm.style.display = 'block';
    const et = $('edge-type');
    // ensure option exists
    if (!(et.options && [...et.options].some(o => o.value === c.cxnType))) {
      const o = document.createElement('option');
      o.value = c.cxnType; o.textContent = c.cxnType; et.appendChild(o);
    }
    et.value = c.cxnType;
    $('edge-endpoints').innerHTML =
      `<b>${esc(from?.name || from?.id || '?')}</b>  →  <b>${esc(to?.name || to?.id || '?')}</b>`;
    return;
  }

  if (n) {
    propsEmpty.style.display = 'none'; propsForm.style.display = 'block';
    edgeEmpty.style.display = 'none'; edgeForm.style.display = 'none';
    S._renaming = false;
    if (document.activeElement?.id === 'prop-name' && document.activeElement.value !== n.name)
      document.activeElement.value = n.name;
    if (document.activeElement?.id === 'prop-descr' && document.activeElement.value !== n.descr)
      document.activeElement.value = n.descr;
    if (document.activeElement?.id === 'prop-x') document.activeElement.value = posOf(n).x;
    if (document.activeElement?.id === 'prop-y') document.activeElement.value = posOf(n).y;

    $('prop-type').value = n.typeNum;
    const ex = $('props-extras');
    ex.innerHTML = '';
    if (n.typeNum === 'OT_ORGN_UNIT') {
      const lab = document.createElement('label');
      lab.innerHTML = `Manager <input id="prop-manager" class="inp" type="text"
        value="${esc(n.getAttr('AT_MANAGER'))}" placeholder="AT_MANAGER"></label>`;
      const inp = lab.querySelector('input');
      ex.appendChild(lab);
      inp.addEventListener('input', (e) => {
        n.setAttr('AT_MANAGER', e.target.value);
        markDirty(true); runChecks();
      });
    }
    return;
  }

  propsEmpty.style.display = 'block'; propsForm.style.display = 'none';
  edgeEmpty.style.display  = 'block'; edgeForm.style.display  = 'none';
}

// ─────────────────────────────────────────────────────────────────────────
//  Semantic checks
// ─────────────────────────────────────────────────────────────────────────

function runChecks() {
  const m = curModel();
  if (!m) { S.checks = null; renderChecks(); return; }
  try {
    S.checks = runSemanticChecks(m);
  } catch (e) {
    S.checks = {
      violations: [{ ruleId: 'ERR', ruleName: 'check runner error', severity: SEV.ERROR,
                     object: null, message: String(e) }],
      summary: { total: 1, errors: 1, warnings: 0, infos: 0 },
    };
  }
  renderChecks();
}

function renderChecks() {
  const badge = $('check-badge');
  if (badge) {
    badge.textContent = S.checks ? S.checks.summary.total : '—';
    badge.className = 'pill';
    if (S.checks) {
      if (S.checks.summary.errors) badge.className = 'pill has-err';
      else if (S.checks.summary.warnings) badge.className = 'pill has-warn';
      else badge.className = 'pill pill-empty';
    } else {
      badge.className = 'pill pill-empty';
    }
  }
  const sum = $('checks-summary'), list = $('checks-list');
  if (!sum || !list) return;
  if (!S.checks) {
    sum.textContent = 'Run semantic rules to validate the model against ARIS profile checks.';
    list.innerHTML = '';
    return;
  }
  const s = S.checks.summary;
  sum.innerHTML =
    `<b>${s.total}</b> finding${s.total !== 1 ? 's' : ''} — ` +
    `<span class="chk-err">● ${s.errors} errors</span> · ` +
    `<span class="chk-warn">● ${s.warnings} warnings</span> · ` +
    `<span class="chk-info">● ${s.infos} info</span>`;

  if (!S.checks.violations.length) {
    list.innerHTML = '<li class="ok"><span class="sev"></span>' +
      '<span class="msg">No violations — the model passes all ARIS checks. ✓</span></li>';
    return;
  }
  list.innerHTML = S.checks.violations.map((v) => {
    const sev = v.severity === SEV.ERROR ? 'err' :
                (v.severity === SEV.WARNING ? 'warn' : 'info');
    const obj = v.object ? `${esc(v.object.name || v.object.id)}` : '';
    return `<li class="sev-${sev}" data-id="${esc(v.object?.id || '')}">
      <span class="sev"></span>
      <span class="msg">${esc(v.message)}<span class="rule">${esc(v.ruleName || '')}</span></span>
      ${obj ? `<span class="obj">${obj}</span>` : ''}
    </li>`;
  }).join('');
  for (const li of list.querySelectorAll('li[data-id]:not([data-id=""])')) {
    li.addEventListener('click', () => selectNode(li.dataset.id, { pan: true }));
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Operations — add / connect / delete / layout
// ─────────────────────────────────────────────────────────────────────────

function addObject(kind, at = null) {
  const m = curModel();
  if (!m) return null;
  pushUndo();
  const count = [...m.objDefs.keys()].filter((k) =>
    m.objDefs.get(k) && m.objDefs.get(k) && (m.objDefs.get(k).typeNum) === kind).length;
  const base = PALETTE_DEFAULT_NAME[kind] || kind;
  const name = `${base} ${count + 1}`;
  const n = makeNode(kind, name);

  // placement: at click point if given, else auto
  if (at) {
    n.attrs.set('_POS_X', String(Math.round(at.x - NODE_W / 2)));
    n.attrs.set('_POS_Y', String(Math.round(at.y - NODE_H / 2)));
  } else {
    const offset = m.objDefs.size % 24;
    n.attrs.set('_POS_X', String(120 + (offset % 5) * (NODE_W + 50)));
    n.attrs.set('_POS_Y', String(120 + Math.floor(offset / 5) * (NODE_H + 50)));
  }

  m.addObject(n);
  markDirty(true);
  S.selected = n.id; S.cxnId = null;
  setMode('select');
  render(); runChecks(); updateProps();
  return n;
}

function deleteSelection() {
  const m = curModel();
  if (!m) return;
  if (S.selected) {
    pushUndo();
    const n = m.objDefs.get(S.selected);
    if (n) {
      // mark dirty BEFORE mutation, but pushUndo captured pre-state
      markDirty(true);
      m.removeObject(n);
      connectModeCleanup();
      S.selected = null; S.cxnId = null;
      render(); runChecks(); updateProps();
    }
    return;
  }
  if (S.cxnId) {
    pushUndo();
    markDirty(true);
    const c = findCxnById(S.cxnId);
    if (c) {
      for (const n of [...m.objDefs.values()]) {
        const i = n.outConnections.indexOf(c);
        if (i >= 0) n.outConnections.splice(i, 1);
      }
    }
    S.cxnId = null;
    render(); runChecks(); updateProps();
  }
}

function connectTwo(fromId, toId) {
  const m = curModel();
  if (!m) return false;
  const from = m.objDefs.get(fromId), to = m.objDefs.get(toId);
  if (!from || !to || from.id === to.id) return false;
  if (from.outConnections.some((c) => c.target.id === toId)) return 'dup';
  pushUndo();
  markDirty(true);
  const type = $('cxn-type')?.value || 'CT_CONTROLS';
  from.connect(to, type);
  S.selected = null; S.cxnId = null;
  setMode('select');
  render(); runChecks(); updateProps();
  return true;
}

function autoLayout() {
  const m = curModel();
  if (!m || !m.objDefs.size) return;
  pushUndo(); markDirty(true);
  // rank nodes by longest path (topological width); cycle-safe fallback
  const indeg = new Map(), outdeg = new Map();
  for (const n of m.objDefs.values()) { indeg.set(n.id, 0); outdeg.set(n.id, 0); }
  for (const c of m.allConnections) {
    outdeg.set(c.source.id, (outdeg.get(c.source.id) || 0) + 1);
    indeg.set(c.target.id, (indeg.get(c.target.id) || 0) + 1);
  }
  const rank = new Map();
  const queue = [...m.objDefs.values()].filter((n) => !indeg.get(n.id));
  // Kahn with rank propagation
  const indegCopy = new Map(indeg);
  while (queue.length) {
    const n = queue.shift();
    const r = rank.get(n.id) || 0;
    rank.set(n.id, r);
    for (const c of n.outConnections) {
      rank.set(c.target.id, Math.max(rank.get(c.target.id) || 0, r + 1));
      indegCopy.set(c.target.id, indegCopy.get(c.target.id) - 1);
      if (indegCopy.get(c.target.id) <= 0) queue.push(c.target);
    }
  }
  // un-ranked (cycles) get the max rank + 1
  let maxR = 1; for (const r of rank.values()) maxR = Math.max(maxR, r);
  for (const n of m.objDefs.values()) if (!rank.has(n.id)) rank.set(n.id, maxR + 1);

  // group by rank, order within rank by name
  const byRank = new Map();
  for (const n of m.objDefs.values()) {
    const r = rank.get(n.id);
    (byRank.get(r) || byRank.set(r, []).get(r)).push(n);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  ranks.forEach((r, x) => {
    const layer = byRank.get(r).sort((a, b) => a.name.localeCompare(b.name));
    layer.forEach((n, y) => {
      n.attrs.set('_POS_X', String(60 + x * (NODE_W + 70)));
      n.attrs.set('_POS_Y', String(50 + y * (NODE_H + 60)));
    });
  });
  render(); runChecks();
  fitToContent();
}

// ─────────────────────────────────────────────────────────────────────────
//  Zoom / pan
// ─────────────────────────────────────────────────────────────────────────

function setZoom(nz, cx, cy) {
  nz = Math.max(0.2, Math.min(4, nz));
  if (cx == null) {
    const r = canvasRect(); cx = r.width / 2; cy = r.height / 2;
  }
  S.pan.x = cx - (cx - S.pan.x) * (nz / S.zoom);
  S.pan.y = cy - (cy - S.pan.y) * (nz / S.zoom);
  S.zoom = nz;
  applyView();
}

function zoomIn()  { setZoom(S.zoom * 1.15); }
function zoomOut() { setZoom(S.zoom / 1.15); }

function fitToContent() {
  const m = curModel();
  if (!m) return;
  const b = sceneBounds();
  const r = canvasRect();
  const w = Math.max(60, b.maxX - b.minX), h = Math.max(60, b.maxY - b.minY);
  S.zoom = Math.max(0.2, Math.min(1.6, Math.min((r.width - 60) / w, (r.height - 60) / h)));
  S.pan.x = (r.width - w * S.zoom) / 2 - b.minX * S.zoom;
  S.pan.y = (r.height - h * S.zoom) / 2 - b.minY * S.zoom;
  applyView();
}

function panCenter(wx, wy) {
  const r = canvasRect();
  S.pan.x = r.width / 2 - wx * S.zoom;
  S.pan.y = r.height / 2 - wy * S.zoom;
  applyView();
}

function canvasRect() {
  const svg = $('canvas');
  if (!svg) return { width: 800, height: 500 };
  return svg.getBoundingClientRect();
}

// ─────────────────────────────────────────────────────────────────────────
//  Mode switching (select / connect / place)
// ─────────────────────────────────────────────────────────────────────────

function setMode(mode, arg) {
  S.mode = mode;
  if (mode !== 'connect') S.connectFrom = null;
  if (arg) S.mode = arg;
  const btn = $('btn-connect');
  if (btn) btn.classList.toggle('on', S.mode === 'connect');
  document.querySelectorAll('.pal').forEach((b) =>
    b.classList.toggle('on', S.mode === 'place:' + b.dataset.add));
  const hint = $('st-hint');
  if (hint) {
    if (S.mode === 'connect')
      hint.textContent = S.connectFrom
        ? 'Connect: now click the TARGET object   (Esc to cancel)'
        : 'Connect: click the SOURCE object   (Esc to cancel)';
    else if (S.mode.startsWith('place:'))
      hint.textContent = 'Placement: click on the canvas where the object should land  (Esc to cancel)';
    else hint.textContent = '';
  }
  const mb = $('st-mode');
  if (mb) mb.textContent = 'mode: ' + (S.mode === 'select' ? 'select' : S.mode.replace('place:', 'add '));
  render();
}

function connectModeCleanup() { if (S.mode === 'connect') S.connectFrom = null; }

// ─────────────────────────────────────────────────────────────────────────
//  Undo / Redo
// ─────────────────────────────────────────────────────────────────────────

function pushUndo() {
  try {
    S.undo.push(JSON.stringify(toJSON(S.db)));
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
  } catch { /* ignore serialize errors */ }
}

function restore(stateJson) {
  const data = JSON.parse(stateJson);
  S.db = fromJSON ? fromJSON(data) : S.db;
  S.model = S.db.models[S.modelIndex] || S.db.models[0] || null;
  if (!S.model && S.db.models.length) S.modelIndex = 0, S.model = S.db.models[0];
  S.selected = null; S.cxnId = null;
  S.mode = 'select'; S.connectFrom = null;
  render(); updateProps(); runChecks(); updateModelSelector(); markDirty(true);
}

function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(toJSON(S.db)));
  restore(S.undo.pop());
}

function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(toJSON(S.db)));
  restore(S.redo.pop());
}

// ─────────────────────────────────────────────────────────────────────────
//  Database management
// ─────────────────────────────────────────────────────────────────────────

function selectModel(i) {
  S.modelIndex = Math.max(0, Math.min(S.db.models.length - 1, i));
  S.model = S.db.models[S.modelIndex];
  S.selected = null; S.cxnId = null;
  setMode('select');
  render(); updateProps(); runChecks(); updateModelSelector();
}

function updateModelSelector() {
  const sel = $('model-select');
  if (!sel) return;
  sel.innerHTML = S.db.models.map((m, i) =>
    `<option value="${i}"${i === S.modelIndex ? ' selected' : ''}
      title="${esc(m.type)}">${esc(m.name || m.id || ('model ' + (i + 1)))}</option>`
  ).join('');
  refreshCounts();
}

function addModel(type, label) {
  pushUndo();
  const m = new Model('model_' + (S.db.models.length + 1), type, label || type);
  S.db.addModel(m);
  selectModel(S.db.models.length - 1);
  markDirty(true);
}

function confirmNew() {
  if (S.dirty && !window.confirm('Discard unsaved changes and start a new database?')) return;
  S.db = new Database('ARIS Open DB');
  S.db.addModel(new Model('model_1', 'EPC', 'Model 1 (EPC)'));
  S.modelIndex = 0; S.model = S.db.models[0];
  S.selected = null; S.cxnId = null; S.counter0 = 0;
  S.fileName = null; S.fileKind = null;
  S.undo = []; S.redo = [];
  setMode('select');
  markDirty(true);
  render(); updateProps(); runChecks(); updateModelSelector();
  $('canvas-hint').style.display = '';
}

// ─────────────────────────────────────────────────────────────────────────
//  File I/O
// ─────────────────────────────────────────────────────────────────────────

const isAmlName = (name) => /\.(aml|xml)$/i.test(name || '');

async function loadFromText(text, name) {
  let db;
  if (isAmlName(name)) db = fromAmlXml(text);
  else try      { db = fromJSON(JSON.parse(text)); }
  catch (e)     { db = fromAmlXml(text); }
  applyDatabase(db, name);
}

function applyDatabase(db, name) {
  S.db = db;
  S.modelIndex = 0;
  S.model = db.models[0] || null;
  S.selected = null; S.cxnId = null;
  S.undo = []; S.redo = [];
  setMode('select');
  S.fileName = name || S.fileName;
  S.fileKind = (name && isAmlName(name)) ? 'aml' : 'json';
  markDirty(false);
  render(); updateProps(); runChecks(); updateModelSelector(); fitToContent();
}

async function openFile() {
  let res;
  if (window.aris?.openFile) {
    res = await window.aris.openFile();
    if (!res) return;
  } else {
    const inp = $('file-input');
    if (!inp) return alert('File input not found');
    inp.value = '';
    const loaded = new Promise((resolve) => {
      const handler = (e) => {
        const f = e.target.files?.[0];
        inp.removeEventListener('change', handler);
        if (!f) return resolve(null);
        const reader = new Promise((r2) => { const rd = new FileReader();
          rd.onload = () => r2(rd.result); rd.onerror = () => r2(null); rd.readAsText(f); });
        reader.then((text) => resolve(text ? { name: f.name, text } : null));
      };
      inp.addEventListener('change', handler);
    });
    const text = await loaded;
    res = text ? { name: text.name, text: text.text } : text;
  }
  if (!res) return;
  try {
    await loadFromText(res.text, res.name);
  } catch (e) {
    alert('Could not read file: ' + e.message);
  }
}

async function saveAs() {
  const name = S.fileName || (S.fileKind === 'json' ? 'diagram.ajos' : 'diagram.aml');
  const isAml = isAmlName(name) || !S.fileName;
  const text = isAml ? toAmlXml(S.db) : JSON.stringify(toJSON(S.db), null, 2);
  if (window.aris?.saveFile) {
    const r = await window.aris.saveFile(text, name);
    if (!r) return; // user canceled
    S.fileName = r.path.replace(/.*[\\/]/, '');
    S.fileKind = isAml ? 'aml' : 'json';
    markDirty(false);
    setStatus();
  } else {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    S.fileName = name;
    S.fileKind = isAml ? 'aml' : 'json';
    markDirty(false); setStatus();
  }
}

function exportText(text, name) {
  if (window.aris?.saveFile) {
    window.aris.saveFile(text, name);
    return;
  }
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ─────────────────────────────────────────────────────────────────────────
//  Example (demo) database
// ─────────────────────────────────────────────────────────────────────────

function loadExample() {
  const db = new Database('ARIS Open — Example');
  const m1 = new Model('model_epc', 'EPC', 'Order to Cash — EPC');
  const m2 = new Model('model_org', 'ORG', 'Organization Chart');
  db.addModel(m1); db.addModel(m2);

  // ── EPC: triggers → parallel work → results ──────────────────
  const ev1 = makeNode('OT_EVENT', 'Order received');
  const f1  = makeNode('OT_FUNC',  'Validate order');
  const f2  = makeNode('OT_FUNC',  'Reserve stock');
  const ev2 = makeNode('OT_EVENT', 'Order confirmed');
  m1.addObject(ev1); m1.addObject(f1); m1.addObject(f2); m1.addObject(ev2);

  ev1.connect(f1, 'CT_CONTROLS');
  ev1.connect(f2, 'CT_CONTROLS');
  f1.connect(ev2, 'CT_CONTROLS');
  f2.connect(ev2, 'CT_CONTROLS');
  place(ev1, 60, 160); place(f1, 320, 60); place(f2, 320, 300); place(ev2, 600, 160);

  // a business rule referenced by one function (no orphan)
  const rule = makeNode('OT_BUSI_RULE', 'Credit limit check');
  rule.setAttr('AT_DESCR', 'Reject if customer credit limit exceeded.');
  m1.addObject(rule);
  // connect rule to f1 (performed by / referenced):
  const refType = 'CT_IS_SUPPORTED_BY';
  f1.connect(rule, refType);
  place(rule, 600, 60);

  // ── Org chart: CEO → Supply Chain → Order Team ─────────────
  const ceo   = makeNode('OT_ORGN_UNIT', 'CEO Office');
  const sc    = makeNode('OT_ORGN_UNIT', 'Supply Chain');
  const order = makeNode('OT_ORGN_UNIT', 'Order Team');
  ceo.setAttr('AT_MANAGER', 'Dr. A. Beispiel');
  sc.setAttr('AT_MANAGER', 'J. Doe');
  order.setAttr('AT_MANAGER', 'M. Schmitz');
  m2.addObject(ceo); m2.addObject(sc); m2.addObject(order);
  ceo.connect(sc,    'CT_IS_PRCSNT_SUPER');
  sc.connect(order,  'CT_IS_PRCSNT_SUPER');
  place(ceo, 120, 120); place(sc, 400, 120); place(order, 680, 120);

  S.db = db;
  S.modelIndex = 0; S.model = m1;
  S.selected = null; S.cxnId = null;
  S.undo = []; S.redo = [];
  S.fileName = null;
  setMode('select'); markDirty(true);
  render(); updateProps(); runChecks(); updateModelSelector();
  fitToContent();
}

function place(n, x, y) {
  n.attrs.set('_POS_X', String(x));
  n.attrs.set('_POS_Y', String(y));
}

// ─────────────────────────────────────────────────────────────────────────
//  Canvas interaction
// ─────────────────────────────────────────────────────────────────────────

function toWorld(clientX, clientY) {
  const r = canvasRect();
  return {
    x: (clientX - r.left - S.pan.x) / S.zoom,
    y: (clientY - r.top  - S.pan.y) / S.zoom,
  };
}

function canvasMouseDown(e) {
  if (e.button !== 0) return;
  const hit = e.target.closest('.arys-node, .arys-edge');

  if (!hit) {
    // start pan
    S._drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: S.pan.x, py: S.pan.y };
    return;
  }

  if (hit.classList.contains('arys-node')) {
    const id = hit.dataset.id;
    // placement mode?
    if (S.mode.startsWith('place:')) {
      const kind = S.mode.slice(6);
      const w = toWorld(e.clientX, e.clientY);
      addObject(kind, w);
      return;
    }
    // connect mode
    if (S.mode === 'connect') {
      if (!S.connectFrom) {
        S.connectFrom = id;
        setModeKeepConn();
        render();
        return;
      }
      if (S.connectFrom !== id) {
        connectTwo(S.connectFrom, id);
      }
      return;
    }
    // select + start drag
    S.selected = id; S.cxnId = null;
    const n = nodeAt(id);
    const p = posOf(n);
    const w = toWorld(e.clientX, e.clientY);
    S._drag = { kind: 'node', id, ox: w.x - p.x, oy: w.y - p.y, moved: false };
    render(); updateProps();
    return;
  }

  if (hit.classList.contains('arys-edge')) {
    // click selects the underlying edge
    selectCxn(hit.dataset.id);
    return;
  }
}

function canvasMouseMove(e) {
  const d = S._drag;
  if (!d) return;
  if (d.kind === 'pan') {
    S.pan.x = d.px + (e.clientX - d.sx);
    S.pan.y = d.py + (e.clientY - d.sy);
    applyView();
  } else if (d.kind === 'node' && (e.buttons & 1)) {
    const n = nodeAt(d.id);
    if (n) {
      const w = toWorld(e.clientX, e.clientY);
      n.attrs.set('_POS_X', String(Math.round(w.x - d.ox)));
      n.attrs.set('_POS_Y', String(Math.round(w.y - d.oy)));
      d.moved = true;
      render();
    }
  }
}

function canvasMouseUp() {
  const d = S._drag;
  if (d?.kind === 'node' && d.moved) markDirty(true);
  S._drag = null;
}

function canvasWheel(e) {
  e.preventDefault();
  const r = canvasRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
  setZoom(S.zoom * factor, mx, my);
}

function canvasDblClick(e) {
  const hit = e.target.closest('.arys-node');
  if (!hit) return;
  const n = nodeAt(hit.dataset.id);
  if (!n) return;
  const val = prompt('Rename object:', n.name || '');
  if (val === null) return;
  n.name = val.trim() || n.id;
  markDirty(true);
  render(); runChecks(); updateProps();
}

function setModeKeepConn() {
  S.mode = 'connect';
  // refresh only visual cues without clobbering connectFrom
  const btn = $('btn-connect'); if (btn) btn.classList.add('on');
  const hint = $('st-hint');
  if (hint) hint.textContent = 'Connect: now click the TARGET object   (Esc to cancel)';
}

// ─────────────────────────────────────────────────────────────────────────
//  Tabs & modal
// ─────────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tabs .tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === name));
  $('pane-props').classList.toggle('active', name === 'props');
  $('pane-checks').classList.toggle('active', name === 'checks');
  if (name === 'checks') { renderChecks(); }
}

async function showAbout() {
  const modal = $('about-modal');
  if (modal) modal.hidden = false;
  const v = $('about-versions');
  if (v && window.aris?.appInfo) {
    try {
      const i = await window.aris.appInfo();
      v.innerHTML =
        `${i.name} v${i.version} · Electron ${i.electron} · Chromium ${i.chrome}<br>` +
        `Node.js ${i.node} · platform ${i.platform}/${i.arch}`;
    } catch { v.textContent = ''; }
  }
}

function hideAbout() { $('about-modal').hidden = true; }

// ─────────────────────────────────────────────────────────────────────────
//  Event wiring
// ─────────────────────────────────────────────────────────────────────────

function wireUI() {
  const on = (id, ev, fn) => { const b = $(id); if (b) b.addEventListener(ev, fn); };

  // toolbar
  on('btn-new',    'click', confirmNew);
  on('btn-open',   'click', openFile);
  on('btn-save',   'click', saveAs);
  on('btn-undo',   'click', undo);
  on('btn-redo',   'click', redo);
  on('btn-connect','click', () => {
    S.connectFrom = null;
    setMode(S.mode === 'connect' ? 'select' : 'connect');
  });
  on('btn-deleteselection','click', deleteSelection);
  on('btn-autolayout','click', autoLayout);
  on('btn-zoom-out','click', zoomOut);
  on('btn-zoom-in', 'click', zoomIn);
  on('btn-zoom-fit','click', fitToContent);
  on('btn-check',  'click', runChecks);
  on('btn-export-aml', 'click', () => exportText(toAmlXml(S.db), (S.fileName || 'export') + (isAmlName(S.fileName||'') ? '' : '.aml')));
  on('btn-export-json','click', () => exportText(JSON.stringify(toJSON(S.db), null, 2), (S.fileName || 'export') + (S.fileName && !isAmlName(S.fileName) ? '' : '.ajos')));
  on('btn-export-svg', 'click', () => {
    let svgText = $('canvas').cloneNode(true).outerHTML;
    // ensure xmlns present
    if (!/xmlns=/.test(svgText)) svgText = svgText.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    exportText(svgText, (S.fileName?.replace(/\.[^.]+$/, '') || 'diagram') + '.svg');
  });
  on('btn-example','click', loadExample);
  on('btn-add-model','click', () => {
    const type = $('new-model-type').value;
    const label = window.prompt('Name for the new model:', type + ' model') || (type + ' model');
    addModel(type, label);
  });
  on('model-select','change', (e) => selectModel(+e.target.value));

  // palette — click = add-at-cursor, or double-click = add at auto spot
  document.querySelectorAll('.pal').forEach((b) => {
    b.addEventListener('click', () => setMode('place:' + b.dataset.add));
    b.addEventListener('dblclick', () => addObject(b.dataset.add));
  });

  // properties form
  on('prop-name', 'change', (e) => {
    const n = S.selected ? nodeAt(S.selected) : null;
    if (!n) return;
    pushUndo();
    n.name = e.target.value.trim() || newId(n.typeNum);
    markDirty(true); render(); runChecks(); updateProps();
  });
  on('prop-descr','change', (e) => {
    const n = S.selected ? nodeAt(S.selected) : null;
    if (!n) return;
    pushUndo();
    n.setAttr('AT_DESCR', e.target.value);
    markDirty(true); runChecks();
  });
  on('prop-x', 'change', (e) => {
    const n = S.selected ? nodeAt(S.selected) : null;
    if (!n) return;
    pushUndo();
    n.attrs.set('_POS_X', String(Math.round(+e.target.value || 0)));
    markDirty(true); render();
  });
  on('prop-y', 'change', (e) => {
    const n = S.selected ? nodeAt(S.selected) : null;
    if (!n) return;
    pushUndo();
    n.attrs.set('_POS_Y', String(Math.round(+e.target.value || 0)));
    markDirty(true); render();
  });

  // edge type select
  const et = $('edge-type');
  if (et) {
    et.innerHTML = Object.keys(CXN_LABEL).map(
      (t) => `<option value="${t}">${esc(t)} — ${esc(CXN_LABEL[t])}</option>`
    ).join('');
    et.addEventListener('change', (e) => {
      const c = S.cxnId ? findCxnById(S.cxnId) : null;
      if (!c) return;
      pushUndo();
      c.cxnType = e.target.value;
      markDirty(true); render(); runChecks();
    });
  }

  // delete from props
  on('prop-delete','click', deleteSelection);
  on('edge-delete','click', deleteSelection);

  // tabs
  on('tab-props','click', () => switchTab('props'));
  on('tab-checks','click', () => switchTab('checks'));

  // about
  on('about-close','click', hideAbout);
  on('about-repo','click', (e) => {
    e.preventDefault();
    const url = 'https://github.com/aris-open/aris-open';
    if (window.open) window.open(url, '_blank');
  });

  // canvas events
  const svg = $('canvas');
  svg.addEventListener('mousedown',  canvasMouseDown);
  window.addEventListener('mousemove', canvasMouseMove);
  window.addEventListener('mouseup',   canvasMouseUp);
  svg.addEventListener('wheel', canvasWheel, { passive: false });
  svg.addEventListener('dblclick', canvasDblClick);
  svg.addEventListener('click', (e) => {
    if (!e.target.closest('.arys-node,.arys-edge') && S._drag?.kind !== 'pan') {
      // blank click — deselect (unless we're mid-pan)
      // distinguish from mousedown-pan: only deselect if mousedown was on blank
    }
  });

  // keyboard
  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement || {}).tagName || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveAs(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); return; }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); confirmNew(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); autoLayout(); return; }

    if (typing) {
      if (e.key === 'Enter') document.activeElement.blur();
      if (e.key === 'Escape') { document.activeElement.blur(); }
      return;
    }

    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      S.selected = null; S.cxnId = null; setMode('select');
      render(); updateProps();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (S.selected || S.cxnId) { e.preventDefault(); deleteSelection(); }
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); switchTab($('pane-checks').classList.contains('active') ? 'props' : 'checks'); return; }
    if (e.key === '0') { e.preventDefault(); fitToContent(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return; }
    if (e.key === '-') { e.preventDefault(); zoomOut(); return; }
    if (k === 'c') { setMode('connect'); S.connectFrom = null; return; }

    // palette single-letter
    for (const [kind, key] of Object.entries(PAL_KEY)) {
      if (k === key) { addObject(kind); e.preventDefault(); return; }
    }
    if (k === 'h') { addObject('OT_ORGN_UNIT'); e.preventDefault(); return; }
  });

  // electron menu bridge
  if (window.aris?.on) {
    window.aris.on('menu:open',  () => openFile());
    window.aris.on('menu:save',  () => saveAs());
    window.aris.on('menu:about', () => showAbout());
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────────────

function boot() {
  const db = new Database('ARIS Open');
  db.addModel(new Model('model_1', 'EPC', 'Model 1 (EPC)'));
  S.db = db; S.model = db.models[0]; S.modelIndex = 0;
  wireUI();
  setMode('select');
  markDirty(true);
  render(); updateProps(); runChecks(); updateModelSelector();
  // load a small example by default
  loadExample();
}

boot();
