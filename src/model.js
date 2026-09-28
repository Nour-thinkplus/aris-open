/**
 * ARIS Open — Core data model
 * ===========================
 * Faithful port of the ARIS object model as defined by ARIS-Export.dtd
 * (ArisXMLExport / AML).  No external dependencies.
 */

// ---------------------------------------------------------------------------
//  Types (object types, connection types)
// ---------------------------------------------------------------------------

/**
 * ARIS object types used in EPC (Event-driven Process chain).
 * We also support BPMN and Org for cross-model support.
 * @typedef {object} ObjectKind
 * @property {string} kindName   - API name, e.g. "OT_FUNC", "OT_PROCESS"
 * @property {string} label      - human-readable label
 * @property {string} glyph      - Unicode glyph for default rendering
 * @property {string[]}? inCxn  - allowed incoming CxnDef.Type base types
 * @property {string[]}? outCxn - allowed outgoing CxnDef.Type base types
 */

/**
 * ARIS connection base types.  The DTD notes CxnDef.Type can be
 *  "<CxnBaseType>"  or  "<fromObjType>.<CxnBaseType>.<toObjType>".
 * We use the base type.
 */
const CXN_TYPES = Object.freeze({
  CT_IS_PRCSNT_SUPER: 'CT_IS_PRCSNT_SUPER',
  CT_IS_PRCSNT_SUBORD: 'CT_IS_PRCSNT_SUBORD',
  CT_IS_ORGN_UNIT:     'CT_IS_ORGN_UNIT',
  CT_CONTROLS:         'CT_CONTROLS',
  CT_IS_REPLACED_BY:   'CT_IS_REPLACED_BY',
  CT_IS_CONTROLS:      'CT_IS_CONTROLS',
  CT_IS_PERFORMED_BY:  'CT_IS_PERFORMED_BY',
  CT_IS_SUPPORTED_BY:  'CT_IS_SUPPORTED_BY',
  CT_IS_ACCESSIBLE:    'CT_IS_ACCESSIBLE',
});

const OBJ_KINDS = Object.freeze([
  Object.freeze({
    kindName: 'OT_FUNC', label: 'Function', glyph: '⬜',
    inCxn:  [CXN_TYPES.CT_IS_PERFORMED_BY, CXN_TYPES.CT_CONTROLS],
    outCxn: [CXN_TYPES.CT_IS_PERFORMED_BY, CXN_TYPES.CT_CONTROLS],
  }),
  Object.freeze({
    kindName: 'OT_EVENT', label: 'Event', glyph: '🟢',
    inCxn:  [CXN_TYPES.CT_CONTROLS],
    outCxn: [CXN_TYPES.CT_CONTROLS],
  }),
  Object.freeze({
    kindName: 'OT_PROCESS', label: 'Process', glyph: '📋',
    inCxn:  [], outCxn: [],
  }),
  Object.freeze({
    kindName: 'OT_ORGN_UNIT', label: 'Organization Unit', glyph: '🏢',
    inCxn:  [CXN_TYPES.CT_IS_PRCSNT_SUPER],
    outCxn: [CXN_TYPES.CT_IS_PRCSNT_SUPER],
  }),
  Object.freeze({
    kindName: 'OT_APP_SYS', label: 'Application System', glyph: '💻',
    inCxn:  [], outCxn: [],
  }),
  Object.freeze({
    kindName: 'OT_BUSI_RULE', label: 'Business Rule', glyph: '📐',
    inCxn:  [], outCxn: [],
  }),
]);

// ---------------------------------------------------------------------------
//  ID generation
// ---------------------------------------------------------------------------
let _idCounter = 0;
function genID(prefix = 'id') {
  _idCounter++;
  return `${prefix}_${Date.now()}_${_idCounter}`;
}

// ---------------------------------------------------------------------------
//  Core classes — mirror the DTD elements
// ---------------------------------------------------------------------------

/**
 * Mirrors <AttrDef> — AttrDef.Type (e.g. AT_NAME) + AttrValue.
 */
export class AttrDef {
  /**
   * @param {string} type   ARIS API attribute name, e.g. "AT_NAME"
   * @param {string} value  plain-text value
   */
  constructor(type, value = '') {
    this.type  = type;
    this.value = value;
  }
  toJSON()         { return { AttrDef: { Type: this.type, AttrValue: this.value } }; }
  static fromJSON(n){ return new AttrDef(n.AttrDef.Type, n.AttrDef.AttrValue ?? ''); }
}

/**
 * Mirrors <Position> — Pos.X / Pos.Y
 */
export class Position {
  constructor(x, y) { this.x = x; this.y = y; }
  toJSON() { return { Pos: { X: String(this.x), Y: String(this.y) } }; }
  static fromJSON(n) { return new Position(+n.Pos.X, +n.Pos.Y); }
  clone() { return new Position(this.x, this.y); }
}

/**
 * Mirrors <Size> — Size.dX / Size.dY
 */
export class Size {
  constructor(dx, dy) { this.dx = dx; this.dy = dy; }
  toJSON() { return { Size: { 'dX': String(this.dx), 'dY': String(this.dy) } }; }
  static fromJSON(n) { return new Size(+n['Size']['dX'], +n['Size']['dY']); }
}

/**
 * Mirrors <Pen> — Color / Style / Width  (Color is 6-digit hex, no '#')
 */
export class Pen {
  constructor({ color = '000000', style = 'SOLID', width = '1' } = {}) {
    this.color = color;
    this.style = style;
    this.width = width;
  }
  toJSON() {
    return { Pen: { Color: this.color, Style: this.style, Width: this.width } };
  }
  static fromJSON(p) {
    return new Pen({ color: p.Color ?? '000000', style: p.Style ?? 'SOLID', width: p.Width ?? '1' });
  }
}

/**
 * Mirrors <Brush> — Color / Style / BrushType
 */
export class Brush {
  constructor({ color = 'FFFFFF', brushType = 'SOLID', style = '' } = {}) {
    this.color     = color;
    this.brushType = brushType;
    this.style     = style;
  }
  toJSON() {
    const o = { Color: this.color, BrushType: this.brushType };
    if (this.style) o.Style = this.style;
    return { Brush: o };
  }
  static fromJSON(b) {
    return new Brush({ color: b.Color, brushType: b.BrushType ?? 'SOLID', style: b.Style ?? '' });
  }
}


/**
 * Mirrors <ObjDef> — an object type instantiation.
 * Corresponds to a node in a model.
 */
export class ObjDef {
  /**
   * @param {string} id        unique ID (ObjDef.ID)
   * @param {string} typeNum   ARIS object type API name (TypeNum)
   * @param {string} guid      ARIS-internal GUID
   * @param {Map<string, string>} attrs  keyed by AttrDef.Type
   */
  constructor(id, typeNum, attrs = {}) {
    this.id      = id;
    this.typeNum = typeNum;
    this.guid    = genID('guid');
    this.attrs   = new Map(Object.entries(attrs));  // type -> value
    this.masterGUID  = null;
    this.symbolGUID  = null;
    this.symbolNum   = '';
    // outgoing connections (list of CxnDef)
    this.outConnections = [];
  }

  /**
   * @param {string} type  'AT_NAME' | 'AT_DESCR' | 'AT_ID' | etc
   * @param {string} value
   */
  setAttr(type, value) {
    this.attrs.set(type, value);
    return this;
  }
  getAttr(type, fallback = '') {
    return this.attrs.has(type) ? this.attrs.get(type) : fallback;
  }

  get name()  { return this.getAttr('AT_NAME'); }
  set name(v) { this.setAttr('AT_NAME', v); }
  get descr() { return this.getAttr('AT_DESCR'); }

  /** Add an outgoing connection (CxnDef). */
  connect(targetObjDef, cxnType) {
    const cxn = new CxnDef(this, targetObjDef, cxnType);
    this.outConnections.push(cxn);
    return cxn;
  }

  disconnect(cxn) {
    this.outConnections = this.outConnections.filter(c => c !== cxn);
  }

  /** Convenience for all incoming connections (any cxn where target === this). */
  static incomingOf(node, allNodes) {
    const result = [];
    for (const n of allNodes) {
      for (const c of n.outConnections) {
        if (c.target === node) result.push(c);
      }
    }
    return result;
  }

  toJSON() {
    return {
      'ObjDef': {
        'ObjDef.ID':       this.id,
        'TypeNum':         this.typeNum,
        'LinkedModels.IdRefs': '',
        'ToCxnDefs.IdRefs':  '',
        'Reorg':           'NODELETE',
      },
      'GUID': this.guid,
      'AttrDef': [...this.attrs.entries()].map(([t, v]) => new AttrDef(t, v).toJSON()),
      'CxnDef': this.outConnections.map(c => c.toJSON()),
    };
  }
}

/**
 * Mirrors <CxnDef>.  A directed edge from source → target.
 * CxnDef.Type can be a plain base type or a fully qualified type.
 */
export class CxnDef {
  /**
   * @param {ObjDef} source
   * @param {ObjDef} target
   * @param {string} cxnType  base or fully-qualified connection type
   */
  constructor(source, target, cxnType = 'CT_IS_PRCSNT_SUPER') {
    this.id        = genID('cxn');
    this.source    = source;
    this.target    = target;
    this.cxnType   = cxnType;
    this.guid      = genID('guid');
    this.attrs     = new Map();
    this.linkedModelIds = [];
    this.inventoried = 'NO';
    this.sourceOrderNum = null;
    this.targetOrderNum = null;
  }

  setAttr(type, value) { this.attrs.set(type, value); return this; }

  toJSON() {
    return {
      'CxnDef': {
        'CxnDef.ID':             this.id,
        'CxnDef.Type':           this.cxnType,
        'ToObjDef.IdRef':        this.target.id,
        'LinkedModels.IdRefs':   this.linkedModelIds.join(' '),
        'Inventoried':           this.inventoried,
      },
      'GUID': this.guid,
      'AttrDef': [...this.attrs.entries()].map(([t, v]) => new AttrDef(t, v).toJSON()),
      'ExtCxnDef': [],
      'Link': [],
    };
  }
}

/**
 * Mirrors <Model> — a model (diagram) containing object occurrences.
 */
export class Model {
  /**
   * @param {string} id
   * @param {string} type  model type code (e.g. 'EPC', 'BPMN', 'ORG', 'EPC327')
   * @param {string} name
   */
  constructor(id, type, name = '') {
    this.id          = id;
    this.type        = type;
    this.name        = name;
    this.gridUse     = 'YES';
    this.gridSize    = '10';
    this.scale       = '1';
    this.printScale  = '1';
    this.backColor   = 'FFFFFF';
    this.curveRadius = '2';
    this.arcRadius   = '2';
    this.creator     = 'ARIS Open';
    this.creationTs  = new Date().toISOString();
    this.lastModifier = 'ARIS Open';
    this.lastModTs   = this.creationTs;
    // nodes: list of ObjDef instances
    this.objDefs = new Map();   // id -> ObjDef
    // graphic objects
    this.gfxObjs = [];
    this.lanes   = [];
  }

  addObject(objDef) {
    this.objDefs.set(objDef.id, objDef);
    return objDef;
  }

  removeObject(objDef) {
    this.objDefs.delete(objDef.id);
    // remove incident connections
    for (const [id, node] of [...this.objDefs]) {
      node.outConnections = node.outConnections.filter(c => c.source !== objDef && c.target !== objDef);
    }
    this.objDefs.delete(objDef.id);
  }

  get allConnections() {
    const out = [];
    for (const node of this.objDefs.values()) {
      for (const c of node.outConnections) out.push(c);
    }
    return out;
  }

  toJSON() {
    return {
      'Model': {
        'Model.ID':     this.id,
        'Model.Type':   this.type,
        'AttrHandling': 'OVERLAP',
        'CxnMode':      'ANGULAR',
        'GridUse':      this.gridUse,
        'GridSize':     this.gridSize,
        'Scale':        this.scale,
        'PrintScale':   this.printScale,
        'BackColor':    this.backColor,
        'CurveRadius':  this.curveRadius,
        'ArcRadius':    this.arcRadius,
        'LastUpdated':  this.lastModTs,
        'Creator':      this.creator,
        'CreationTimeStamp': this.creationTs,
        'LastModifier': this.lastModifier,
        'LastModificationTimeStamp': this.lastModTs,
      },
      'GUID': genID('mguid'),
      'ObjDef': [...this.objDefs.values()].map(n => n.toJSON()),
      'Lane': this.lanes,
      'GfxObj': this.gfxObjs,
      'Union': [],
    };
  }
}

// ---------------------------------------------------------------------------
//  Database — top-level container (mirrors <AML>)
// ---------------------------------------------------------------------------

export class Database {
  constructor(name = 'ARIS Open DB') {
    this.name      = name;
    this.createTs  = new Date().toISOString();
    this.creator   = 'ARIS Open';
    this.arisVersion = '10.2026.4.0.320024801';
    this.languages = ['English'];
    this.prefix    = 'ARIS';
    this.models    = [];   // Model[]
    this.users     = [];
    this.userGroups = [];
  }

  addModel(model) { this.models.push(model); return model; }

  /** All objects across all models */
  get allObjDefs() {
    const all = [];
    for (const m of this.models) for (const n of m.objDefs.values()) all.push(n);
    return all;
  }

  /** All connections across all models */
  get allCxnDefs() {
    const all = [];
    for (const m of this.models) for (const c of m.allConnections) all.push(c);
    return all;
  }

  toJSON() {
    return {
      'AML': {
        'Header-Info': {
          'CreateTime':    new Date().toLocaleTimeString(),
          'CreateDate':    new Date().toLocaleDateString(),
          'DatabaseName':  this.name,
          'UserName':      this.creator,
          'ArisExeVersion': '100',
        },
        'Language': [
          { 'LanguageName': 'English' }
        ],
        'Prefix': [{ 'Default': 'YES', 'text': this.prefix }],
        'Database': [],
        'Group': {
          'Group': {
            'Group.ID': 'group_1',
            'Model': this.models.map(m => m.toJSON()),
          }
        },
      }
    };
  }
}

export const cxnTypes  = CXN_TYPES;
export const objKinds  = OBJ_KINDS;
export { genID };
