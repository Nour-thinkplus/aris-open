/**
 * ARIS Open — AML (ARIS Markup Language / AML = "ARIS Markup Language") import & export
 * ======================================================================================================================
 * Produces XML that is structurally valid against ARIS-Export.dtd (schema extracted
 * from SAP ARIS 10.2026.4.0).  Also provides JSON and SVG export.
 *
 * ARIS-XML (AML) element tree — verified against the DTD:
 *
 *   AML
 *   ├── Header-Info
 *   ├── Language+
 *   ├── Prefix*
 *   ├── Database?
 *   ├── Group*
 *   │   └── (ObjDef* | Model*)   ← DTD: <!ELEMENT Group (ObjDef*, Model*)>
 *   ├── Delete*
 *   └── User*, UserGroup*, FontStyleSheet*, FFTextDef*, OLEDef*
 *
 *   ObjDef  (GUID?, MasterGUID?, SymbolGUID?, AttrDef*, CxnDef*, ExtCxnDef*, Link*)
 *           ObjDef.ID#REQUIRED  TypeNum#REQUIRED  LinkedModels.IdRefs  ToCxnDefs.IdRefs
 *
 *   CxnDef  (GUID?, AttrDef*, ExtCxnDef*, Link*)
 *           CxnDef.ID#REQUIRED  CxnDef.Type#REQUIRED  ToObjDef.IdRef#REQUIRED
 *           LinkedModels.IdRefs  Inventoried  SourceOrderNum  TargetOrderNum
 *
 *   Model   (Lane*, ObjOcc*, FFTextOcc*, GfxObj*, Union*, Link*)
 *           Model.ID#REQUIRED  Model.Type#REQUIRED  AttrHandling  CxnMode  GridUse  GridSize
 *           Scale  PrintScale  BackColor  CurveRadius  ArcRadius
 *
 *   ObjOcc  (Pen?, Brush?, Position*, Size*, AttrOcc*, LabelOcc*)
 *           ObjOcc.ID#REQUIRED  ObjDef.IdRef#REQUIRED  SymbolNum#REQUIRED
 *
 *   CxnOcc  (Pen?, Brush?, Position*, AttrOcc*)
 *           CxnOcc.ID#REQUIRED  CxnDef.IdRef#REQUIRED  ToObjOcc.IdRef#REQUIRED
 *
 *   Position   Pos.X#REQUIRED  Pos.Y#REQUIRED
 *   Size       Size.dX#REQUIRED  Size.dY#REQUIRED
 *   Pen        Color#REQUIRED  Style#REQUIRED  Width#REQUIRED
 *   Brush      Color#REQUIRED  Style  Hatch  Color2  BrushType
 *   AttrDef    (AttrValue*)   AttrDef.Type#REQUIRED
 */

import { XMLParser, XMLBuilder } from './xml.js';
import { Database, Model, ObjDef, CxnDef, objKinds } from './model.js';

// ---------------------------------------------------------------------------
//  Constants — ARIS type codes
// ---------------------------------------------------------------------------

const CXN = Object.freeze({
  CT_CONTROLS:        'CT_CONTROLS',
  CT_IS_PRCSNT_SUPER: 'CT_IS_PRCSNT_SUPER',
  CT_IS_PRCSNT_SUBORD:'CT_IS_PRCSNT_SUBORD',
  CT_IS_ORGN_UNIT:    'CT_IS_ORGN_UNIT',
  CT_IS_PERFORMED_BY: 'CT_IS_PERFORMED_BY',
  CT_CONTROLS2:       'CT_CONTROLS',   // convenience alias
});

const MODEL_TYPES = {
  EPC:    'EPC',
  BPMN:   'BPMN',
  ORG:    'ORG',
  HIER:   'ORG',
  SYS:    'SYS',
  PROC:   'PROC',
  EVENT:  'EVENT',
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

let _exportOccCounter = 0;
let _exportCxnOccCounter = 0;

// ---------------------------------------------------------------------------
//  EXPORT: Database → AML XML string
// ---------------------------------------------------------------------------

/**
 * Serialize the full Database (all models) to ARIS AML XML.
 * @param {Database} db
 * @returns {string}
 */
export function toAmlXml(db) {
  const now = new Date();

  /**
   * Assign grid positions to objects that don't have them yet.
   * Stored in node.attrs under _POS_X / _POS_Y.
   */
  function layout(model) {
    let col = 0, row = 0;
    for (const node of model.objDefs.values()) {
      if (!node.attrs.has('_POS_X')) {
        node.attrs.set('_POS_X', String(50 + col * 150));
        node.attrs.set('_POS_Y', String(50 + row * 110));
      }
      col++;
      if (col >= 6) { col = 0; row++; }
    }
  }

  // ---- build per-model XML objects ----
  // Both fast-xml-parser and our internal engine wrap array elements under the
  // parent key — so each item is a flat object with @-attrs and child elements
  // (no self-nested wrapper).
  // is a flat object with @-attrs and child elements (no self-nested wrapper).
  const modelsXml = [];
  for (const model of db.models) {
    layout(model);
    const objOccs = [], cxnOccs = [];
    const occIdMap  = new Map();
    let occCounter = 0, cxnOccCounter = 0;

    for (const [key, node] of model.objDefs.entries()) {
      const occId = `occ${occCounter++}`;
      occIdMap.set(key, occId);
      objOccs.push({
        '@ObjOcc.ID':    occId,
        '@ObjDef.IdRef': key,
        '@SymbolNum':    node.typeNum,
        'Position': { '@Pos.X': node.attrs.get('_POS_X') || '50',
                        '@Pos.Y': node.attrs.get('_POS_Y') || '50' },
        'Size':     { '@Size.dX': '120', '@Size.dY': '80' },
      });
    }

    for (const [key, node] of model.objDefs.entries()) {
      for (const cxn of node.outConnections) {
        const fromOcc = occIdMap.get(key);
        const toOcc   = occIdMap.get(cxn.target.id);
        if (fromOcc && toOcc) {
          cxnOccs.push({
            '@CxnOcc.ID':       `cxnocc${cxnOccCounter++}`,
            '@CxnDef.IdRef':    cxn.id,
            '@ToObjOcc.IdRef':  toOcc,
          });
        }
      }
    }

    const modelEntry = {
      '@Model.ID':    model.id,
      '@Model.Type':  model.type,
      '@GridUse':     model.gridUse   || 'YES',
      '@GridSize':    model.gridSize  || '10',
      '@BackColor':   model.backColor|| 'FFFFFF',
      '@CurveRadius': '2',
      '@ArcRadius':   '2',
    };
    if (objOccs.length) modelEntry['ObjOcc'] = objOccs;
    if (cxnOccs.length) modelEntry['CxnOcc'] = cxnOccs;
    modelsXml.push(modelEntry);
  }

  // ---- ObjDefs (object definitions — stored under the root Group) ----
  const objDefXml = [];
  const allNodes = [];
  for (const m of db.models) {
    for (const node of m.objDefs.values()) allNodes.push(node);
  }
  const seen = new Set();
  for (const node of allNodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    objDefXml.push(buildObjDefXml(node));
  }

  const root = {
    'AML': {
      '@version': '10.2026.4.0',
      'Header-Info': {
        '@CreateTime':    now.toLocaleTimeString(),
        '@CreateDate':    now.toLocaleDateString(),
        '@DatabaseName':  db.name || 'ARIS Open DB',
        '@UserName':      db.creator || 'ARIS Open',
        '@ArisExeVersion': '100',
      },
      'Language': { '@LanguageName': 'English' },
      'Prefix':  { '@Default': 'YES', '#text':   'ARIS' },
      'Database': {},
      'Group': {
        '@Group.ID': 'root',
        '@TypeNum':  'OT_GROUP',
        ...(objDefXml.length ? { 'ObjDef': objDefXml } : {}),
      },
      ...(modelsXml.length ? { 'Model': modelsXml } : {}),
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    cdataPropName: false,
    suppressEmptyNode: true,
    format: true,
    indentBy: '  ',
    newlineAfterEndTag: true,
  });

  const xml = builder.build(root);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/**
 * Build the XML object for a single ObjDef (with its AttrDefs and CxnDefs).
 * The element itself is produced by the parent's 'ObjDef' key — we only
 * return the attribute + child content here.
 */
function buildObjDefXml(node) {
  const out = {
    '@ObjDef.ID':  node.id,
    '@TypeNum':    node.typeNum,
    '@Reorg':      'NODELETE',
  };

  // AttrDefs (in DTD order: before CxnDef)
  if (node.attrs.size > 0) {
    const attrs = [];
    for (const [type, value] of node.attrs) {
      if (type.startsWith('_')) continue;  // internal — skip _POS_X/_POS_Y
      attrs.push({ '@AttrDef.Type': type, '#text': String(value) });
    }
    if (attrs.length) out['AttrDef'] = attrs;
  }

  // CxnDefs
  if (node.outConnections.length > 0) {
    out['CxnDef'] = node.outConnections.map(buildCxnDefXml);
  }

  return out;
}

function buildCxnDefXml(cxn) {
  const out = {
    '@CxnDef.ID':      cxn.id,
    '@CxnDef.Type':    cxn.cxnType,
    '@ToObjDef.IdRef': cxn.target?.id || '',
    '@Inventoried':    cxn.inventoried || 'NO',
  };
  if (cxn.attrs?.size > 0) {
    const attrs = [];
    for (const [type, value] of cxn.attrs) {
      attrs.push({ '@AttrDef.Type': type, '#text': String(value) });
    }
    if (attrs.length) out['AttrDef'] = attrs;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  IMPORT: AML XML string → Database
// ---------------------------------------------------------------------------

/**
 * Parse an ARIS AML XML document back into a Database.
 * @param {string} xmlText
 * @returns {Database}
 */
export function fromAmlXml(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    trimValues: true,
  });
  const j = parser.parse(xmlText, { ignoreHealthWarning: true });
  const aml = j.AML;
  if (!aml) {
    throw new Error('AML: missing <AML> root element');
  }

  const db = new Database();

  // -- header / meta --
  if (aml['Header-Info']) {
    const hi = aml['Header-Info'];
    db.name     = hi['@DatabaseName'] || 'ARIS Imported';
    db.creator  = hi['@UserName']     || 'imported';
  }

  // -- languages --
  if (aml['Language']) {
    const langs = Array.isArray(aml['Language']) ? aml['Language'] : [aml['Language']];
    db.languages = langs.map(l => l['@LanguageName'] || 'English').filter(Boolean);
  }

  // -- prefix --
  if (aml['Prefix']) {
    const pfx = Array.isArray(aml['Prefix']) ? aml['Prefix'][0] : aml['Prefix'];
    db.prefix = pfx['#text'] || (typeof pfx === 'string' ? pfx : '');
  }

  // -- read all ObjDefs (may be in Group, or directly under AML) --
  const objDefs = collectAll(aml, 'ObjDef');
  const nodeMap = new Map();   // id → data
  const cxnList = [];          // flat list of connection data

  for (const od of objDefs) {
    const id  = od['@ObjDef.ID'];
    const typ = od['@TypeNum'];
    if (!id || !typ) continue;

    // read AttrDef children
    const attrs = {};
    if (od['AttrDef']) {
      const ads = Array.isArray(od['AttrDef']) ? od['AttrDef'] : [od['AttrDef']];
      for (const ad of ads) {
        const at = ad['@AttrDef.Type'];
        const av = ad['#text'] ?? String(ad);
        if (at && typeof av === 'string' && at !== 'AT_GUID') attrs[at] = av;
      }
    }

    // read nested CxnDef children (these are the outbound connections)
    if (od['CxnDef']) {
      const cds = Array.isArray(od['CxnDef']) ? od['CxnDef'] : [od['CxnDef']];
      for (const cd of cds) {
        const cxnType   = cd['@CxnDef.Type'];
        const toId      = cd['@ToObjDef.IdRef'];
        if (cxnType && toId) {
          cxnList.push({ from: id, type: cxnType, to: toId });
        }
      }
    }

    nodeMap.set(id, { typeNum: typ, attrs });
  }

  // -- create ObjDef instances --
  const created = new Map();
  for (const [id, data] of nodeMap) {
    const node = new ObjDef(id, data.typeNum, data.attrs);
    created.set(id, node);
  }

  // -- apply connections --
  for (const cx of cxnList) {
    const src = created.get(cx.from);
    const tgt = created.get(cx.to);
    if (src && tgt) {
      src.connect(tgt, cx.type);
    }
  }

  // -- read Models and ObjOccs --
  const models = collectAll(aml, 'Model');
  for (const md of models) {
    const mid   = md['@Model.ID']   || `model_${db.models.length}`;
    const mtyp  = md['@Model.Type'] || 'EPC';
    const m     = new Model(mid, mtyp);

    if (md['@GridUse'])   m.gridUse   = md['@GridUse'];
    if (md['@GridSize'])  m.gridSize  = md['@GridSize'];
    if (md['@BackColor']) m.backColor = md['@BackColor'];

    // read ObjOccs in this model — only add objects referenced here
    const occs = md['ObjOcc'] ? (Array.isArray(md['ObjOcc']) ? md['ObjOcc'] : [md['ObjOcc']]) : [];
    const referenced = new Set();
    const positions = new Map();
    for (const occ of occs) {
      const odRef = occ['@ObjDef.IdRef'];
      if (odRef) referenced.add(odRef);
      // position
      if (occ['Position'] && odRef) {
        positions.set(odRef, {
          x: +occ['Position']['@Pos.X'] || 50,
          y: +occ['Position']['@Pos.Y'] || 50,
        });
      }
    }

    // if the model references specific objects, only add those;
    // otherwise (no ObjOcc listed) add all loaded objects
    if (referenced.size > 0) {
      for (const id of referenced) {
        const node = created.get(id);
        if (node) {
          m.addObject(node);
          if (positions.has(id)) {
            node.attrs.set('_POS_X', String(positions.get(id).x));
            node.attrs.set('_POS_Y', String(positions.get(id).y));
          }
        }
      }
    } else {
      for (const node of created.values()) m.addObject(node);
    }

    db.addModel(m);
  }

  // If no Model element was present, create a default model
  if (db.models.length === 0 && created.size > 0) {
    const m = new Model('model_1', 'EPC');
    for (const node of created.values()) m.addObject(node);
    db.addModel(m);
  }

  return db;
}

/**
 * Recursively collect all entries with a given tagName from a parsed XML object.
 * Handles both singular (object) and plural (array) forms.
 */
function collectAll(obj, tag) {
  if (!obj) return [];
  if (Array.isArray(obj)) {
    const out = [];
    for (const item of obj) out.push(...collectAll(item, tag));
    return out;
  }
  if (typeof obj !== 'object') return [];
  const out = [];
  if (obj[tag] !== undefined) {
    const vals = Array.isArray(obj[tag]) ? obj[tag] : [obj[tag]];
    out.push(...vals);
  }
  for (const key of Object.keys(obj)) {
    if (key === tag) continue;
    const val = obj[key];
    if (val && typeof val === 'object') {
      out.push(...collectAll(val, tag));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  JSON (lossless round-trip)
// ---------------------------------------------------------------------------

/**
 * Export Database to a JSON-serializable plain object.
 */
export function toJSON(db) {
  return {
    name:         db.name,
    creator:      db.creator,
    arisVersion:  db.arisVersion,
    languages:    db.languages,
    prefix:       db.prefix,
    models: db.models.map(m => ({
      id:   m.id,
      type: m.type,
      name: m.name,
      gridUse:   m.gridUse,
      gridSize:  m.gridSize,
      backColor: m.backColor,
      objects: [...m.objDefs.values()].map(o => ({
        id:      o.id,
        typeNum: o.typeNum,
        attrs:   Object.fromEntries(o.attrs),
        cxns:    o.outConnections.map(c => ({ type: c.cxnType, to: c.target.id })),
        posX:    +o.attrs.get('_POS_X') || 50,
        posY:    +o.attrs.get('_POS_Y') || 50,
      })),
    })),
  };
}

/**
 * Import from the JSON produced by toJSON.
 */
export function fromJSON(data) {
  const db = new Database(data.name || 'ARIS Loaded');
  db.creator = data.creator || 'loaded';
  if (data.prefix)    db.prefix    = data.prefix;
  if (data.languages) db.languages = data.languages;

  for (const mdata of data.models || []) {
    const m = new Model(mdata.id || `m${db.models.length}`,
                         mdata.type || 'EPC',
                         mdata.name || '');
    if (mdata.gridUse)   m.gridUse   = mdata.gridUse;
    if (mdata.gridSize)  m.gridSize  = mdata.gridSize;
    if (mdata.backColor) m.backColor = mdata.backColor;

    const created = new Map();
    for (const odata of mdata.objects || []) {
      const node = new ObjDef(odata.id, odata.typeNum, odata.attrs || {});
      if (odata.posX) node.attrs.set('_POS_X', String(odata.posX));
      if (odata.posY) node.attrs.set('_POS_Y', String(odata.posY));
      created.set(odata.id, node);
      m.addObject(node);
    }
    for (const odata of mdata.objects || []) {
      const node = m.objDefs.get(odata.id);
      for (const cxdata of odata.cxns || []) {
        const target = created.get(cxdata.to);
        if (target && node && node !== target) node.connect(target, cxdata.type);
      }
    }

    db.addModel(m);
  }
  return db;
}

// ---------------------------------------------------------------------------
//  SVG export
// ---------------------------------------------------------------------------

const NODE_COLORS = {
  OT_FUNC:      { fill: '#EBF3FF', stroke: '#3377CC', label: 'Function' },
  OT_EVENT:     { fill: '#E8F8E8', stroke: '#228B44', label: 'Event' },
  OT_PROCESS:   { fill: '#FFFAE1', stroke: '#CC8800', label: 'Process' },
  OT_ORGN_UNIT: { fill: '#F0E1FF', stroke: '#6644AA', label: 'Org Unit' },
  OT_APP_SYS:   { fill: '#E1F0FF', stroke: '#2266CC', label: 'App System' },
  OT_BUSI_RULE: { fill: '#FFE1E1', stroke: '#CC4444', label: 'Business Rule' },
  OT_GROUP:     { fill: '#F0F0F0', stroke: '#666666', label: 'Group' },
  _default:     { fill: '#F5F5F5', stroke: '#888888', label: 'Object' },
};

const CXN_COLORS = {
  CT_CONTROLS:        '#0066AA',
  CT_IS_PRCSNT_SUPER: '#555555',
  CT_IS_PERFORMED_BY: '#228B44',
  _default:           '#666666',
};

/**
 * Render a Model as a standalone SVG string.
 * Node positions come from _POS_X / _POS_Y attrs (assigned by layout).
 */
export function toSVG(model) {
  const nodes = [...model.objDefs.values()];
  if (!nodes.length) return _emptySvg();

  // --- compute positions ---
  let col = 0, row = 0;
  const posMap = new Map();
  for (const node of nodes) {
    const x = parseInt(node.attrs.get('_POS_X'), 10) || (50 + col * 150);
    const y = parseInt(node.attrs.get('_POS_Y'), 10) || (50 + row * 110);
    posMap.set(node.id, { x, y, cx: x + 60, cy: y + 38 });
    col++; if (col >= 6) { col = 0; row++; }
  }

  const W = Math.max(1000, ...[...posMap.values()].map(p => p.x + 200));
  const H = Math.max(600,  ...[...posMap.values()].map(p => p.y + 140));

  let edgesSvg = '';
  let markers  = '';
  let nodesSvg = '';

  // --- edges ---
  for (const node of nodes) {
    const a = posMap.get(node.id);
    for (const cxn of node.outConnections) {
      const b = posMap.get(cxn.target.id);
      if (!a || !b) continue;
      const color = CXN_COLORS[cxn.cxnType] || CXN_COLORS._default;
      const mid   = { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 };
      const markerId = `arr_${node.id}_${cxn.id}`;
      markers += `<marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5"
           markerWidth="7" markerHeight="7" orient="auto-start-reverse">
           <path d="M0,0L10,5L0,10z" fill="${color}"/>
         </marker>`;
      // straight line with arrow at end
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const ex  = b.cx - (dx/len)*60;   // stop at edge of target box
      const ey  = b.cy - (dy/len)*38;
      edgesSvg += `<line x1="${a.cx}" y1="${a.cy}" x2="${ex}" y2="${ey}"
           stroke="${color}" stroke-width="2" marker-end="url(#${markerId})"/>`;
      // label
      if (cxn.cxnType) {
        edgesSvg += `<text x="${mid.x}" y="${mid.y - 8}" text-anchor="middle"
             font-size="9" fill="${color}" font-family="monospace">${cxn.cxnType}</text>`;
      }
    }
  }

  // --- nodes ---
  for (const node of nodes) {
    const p = posMap.get(node.id);
    const cfg = NODE_COLORS[node.typeNum] || NODE_COLORS._default;
    const label = (node.name || node.id).length > 20
      ? node.name?.slice(0, 17) + '…' : (node.name || node.id);
    nodesSvg += `
<g data-node="${node.id}">
  <rect x="${p.x}" y="${p.y}" width="120" height="76" rx="10"
    fill="${cfg.fill}" stroke="${cfg.stroke}" stroke-width="2"/>
  <rect x="${p.x}" y="${p.y}" width="120" height="4" fill="${cfg.stroke}"/>
  <text x="${p.x + 60}" y="${p.y + 34}" text-anchor="middle"
    font-size="13" font-weight="600" fill="#222"
    font-family="system-ui, -apple-system, sans-serif">${label}</text>
  <text x="${p.x + 60}" y="${p.y + 54}" text-anchor="middle"
    font-size="10" fill="#666" font-family="monospace">${node.typeNum}</text>
  <text x="${p.x + 60}" y="${p.y + 68}" text-anchor="middle"
    font-size="9" fill="#888" font-family="system-ui, sans-serif">${cfg.label}</text>
</g>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
     width="${W}" height="${H}" font-family="system-ui, -apple-system, sans-serif">
  <defs>${markers}</defs>
  <rect width="100%" height="100%" fill="#F8FAFD"/>
  <!-- edges -->
  <g id="edges">${edgesSvg}</g>
  <!-- nodes -->
  <g id="nodes">${nodesSvg}</g>
  <!-- header -->
  <text x="12" y="20" font-size="11" fill="#AAA">
    ARIS Open — ${model.type || 'EPC'} — ${nodes.length} objects
  </text>
</svg>`;
}

function _emptySvg() {
  return `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
  <rect width="100%" height="100%" fill="#F8FAFD"/>
  <text x="300" y="200" text-anchor="middle" font-size="14" fill="#AAA">No objects in this model</text>
</svg>`;
}

export { CXN, MODEL_TYPES, NODE_COLORS, CXN_COLORS };
