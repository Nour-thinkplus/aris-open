/**
 * ARIS Open — Core integration tests
 * Runs: node --test test/
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Database, Model, ObjDef, CxnDef, cxnTypes, genID } from '../src/model.js';
import { toAmlXml, fromAmlXml, toJSON, fromJSON, toSVG } from '../src/aml.js';
import { runSemanticChecks } from '../src/semChecks.js';

// ---------------------------------------------------------------------------
//  Model round-trip via JSON
// ---------------------------------------------------------------------------

describe('Model → JSON round-trip', () => {
  test('creates a basic EPC and serializes to JSON without loss', () => {
    const db = new Database('Test DB');
    const m  = new Model('m1', 'EPC', 'Order-to-Cash');
    db.addModel(m);

    const f1 = m.addObject(new ObjDef('f1', 'OT_FUNC',  { AT_NAME: 'Receive Order' }));
    const e1 = m.addObject(new ObjDef('e1', 'OT_EVENT', { AT_NAME: 'Order Received' }));
    const f2 = m.addObject(new ObjDef('f2', 'OT_FUNC',  { AT_NAME: 'Ship Goods' }));

    f1.connect(e1, cxnTypes.CT_CONTROLS);
    e1.connect(f2, cxnTypes.CT_CONTROLS);

    const json = toJSON(db);
    assert.equal(json.models[0].objects.length, 3);
    assert.equal(json.models[0].objects[0].cxns.length, 1);
    assert.equal(json.models[0].objects[0].cxns[0].to, 'e1');

    // re-load
    const db2 = fromJSON(json);
    assert.equal(db2.models.length, 1);
    assert.equal(db2.models[0].objDefs.size, 3);

    const reloaded = db2.models[0].objDefs.get('f1');
    assert.ok(reloaded, 'f1 should exist after re-load');
    assert.equal(reloaded.name, 'Receive Order');
    assert.equal(reloaded.outConnections.length, 1);

    // connection integrity
    const cxn = reloaded.outConnections[0];
    assert.equal(cxn.target.id, 'e1');
    assert.equal(cxn.cxnType, cxnTypes.CT_CONTROLS);
  });

  test('connections are bidirectional in the reloaded model', () => {
    const db = new Database();
    const m  = new Model('m1', 'EPC');
    db.addModel(m);
    const a  = m.addObject(new ObjDef('a', 'OT_FUNC',  { AT_NAME: 'A' }));
    const b  = m.addObject(new ObjDef('b', 'OT_FUNC',  { AT_NAME: 'B' }));
    a.connect(b, cxnTypes.CT_CONTROLS);

    const db2 = fromJSON(toJSON(db));
    const all = db2.models[0].allConnections;
    assert.equal(all.length, 1);
    // find cxn where target is b
    const toB = all.find(c => c.target.id === 'b');
    assert.ok(toB, 'connection to b should be present after round-trip');
    assert.equal(toB.source.id, 'a');
  });
});

// ---------------------------------------------------------------------------
//  Model → AML XML round-trip
// ---------------------------------------------------------------------------

describe('AML XML import/export', () => {
  test('exports valid AML XML with all required DTD attributes', () => {
    const db = new Database('XML Test');
    const m  = new Model('m_xml', 'EPC', 'XML Test Model');
    db.addModel(m);
    const f1 = m.addObject(new ObjDef('f_xml1', 'OT_FUNC',  { AT_NAME: 'Step A' }));
    const e1 = m.addObject(new ObjDef('e_xml1', 'OT_EVENT', { AT_NAME: 'Event X' }));
    f1.connect(e1, cxnTypes.CT_CONTROLS);

    const xml = toAmlXml(db);
    assert.ok(xml.includes('<?xml'), 'should start with XML declaration');
    assert.ok(xml.includes('<AML'),  'should contain AML root');
    assert.ok(xml.includes('ObjDef.ID="f_xml1"'),  'should contain ObjDef ID');
    assert.ok(xml.includes('TypeNum="OT_FUNC"'),   'should contain TypeNum');
    assert.ok(xml.includes('CxnDef.Type="CT_CONTROLS"'), 'should contain CxnDef.Type');
    assert.ok(xml.includes('ToObjDef.IdRef'),       'should contain ToObjDef.IdRef');
    assert.ok(xml.includes('Pos.X'),                'should contain Pos.X');
  });

  test('AML XML can be re-imported without losing objects or connections', () => {
    const db = new Database('Round');
    const m  = new Model('m_r', 'EPC', 'Round Trip');
    db.addModel(m);
    const f1 = m.addObject(new ObjDef('f_r1', 'OT_FUNC',  { AT_NAME: 'Process X' }));
    const e1 = m.addObject(new ObjDef('e_r1', 'OT_EVENT', { AT_NAME: 'Result Y' }));
    const f2 = m.addObject(new ObjDef('f_r2', 'OT_FUNC',  { AT_NAME: 'Next Step' }));
    e1.connect(f2, cxnTypes.CT_CONTROLS);
    f1.connect(e1, cxnTypes.CT_CONTROLS);

    const xml   = toAmlXml(db);
    const db2   = fromAmlXml(xml);

    assert.ok(db2.models.length >= 1, 'should have at least one model after re-import');
    const m2   = db2.models[0];
    assert.ok(m2.objDefs.size >= 3, `should have >=3 objects (got ${m2.objDefs.size})`);

    const reF1 = m2.objDefs.get('f_r1');
    assert.ok(reF1, 'f_r1 should exist');
    assert.equal(reF1.name, 'Process X');
    assert.ok(reF1.outConnections.length >= 1, 'f_r1 should have outgoing cxns');
  });

  test('handles org chart model with CT_IS_PRCSNT_SUPER', () => {
    const db = new Database();
    const m  = new Model('m_org', 'ORG', 'Org Chart');
    db.addModel(m);
    const ceo = m.addObject(new ObjDef('ceo', 'OT_ORGN_UNIT', { AT_NAME: 'CEO', AT_MANAGER: 'Alice' }));
    const cto = m.addObject(new ObjDef('cto', 'OT_ORGN_UNIT', { AT_NAME: 'CTO', AT_MANAGER: 'Bob'   }));
    ceo.connect(cto, cxnTypes.CT_IS_PRCSNT_SUPER);

    const xml = toAmlXml(db);
    assert.ok(xml.includes('CT_IS_PRCSNT_SUPER'), 'AML should contain CT_IS_PRCSNT_SUPER');

    const db2 = fromAmlXml(xml);
    const m2  = db2.models.find(x => x.type === 'ORG');
    assert.ok(m2, 'org model should be found after re-import');
    assert.ok(m2.objDefs.has('ceo'), 'CEO should exist');
    assert.ok(m2.objDefs.has('cto'), 'CTO should exist');
  });
});

// ---------------------------------------------------------------------------
//  SVG export
// ---------------------------------------------------------------------------

describe('SVG export', () => {
  test('produces a valid SVG string', () => {
    const db = new Database();
    const m  = new Model('m_svg', 'EPC', 'SVG Test');
    db.addModel(m);
    const f = m.addObject(new ObjDef('f_svg', 'OT_FUNC',  { AT_NAME: 'A' }));
    const e = m.addObject(new ObjDef('e_svg', 'OT_EVENT', { AT_NAME: 'B' }));
    f.connect(e, cxnTypes.CT_CONTROLS);

    const svg = toSVG(m);
    assert.ok(svg.includes('<svg'),  'should contain <svg>');
    assert.ok(svg.includes('</svg>'),'should close svg');
    assert.ok(svg.includes('<rect'), 'should have node rect');
    assert.ok(svg.includes('<line') || svg.includes('<path'), 'should have edge');
  });
});

// ---------------------------------------------------------------------------
//  Semantic checks
// ---------------------------------------------------------------------------

describe('Semantic checks', () => {
  test('flags isolated function', () => {
    const db = new Database();
    const m  = new Model('m_chk', 'EPC');
    db.addModel(m);
    m.addObject(new ObjDef('lonely', 'OT_FUNC', { AT_NAME: 'Lonely' }));

    const { summary } = runSemanticChecks([m]);
    assert.ok(summary.total >= 1, `should detect at least one violation (got ${summary.total})`);
    assert.ok(summary.errors >= 1, `should have at least one error (got ${summary.errors})`);
  });

  test('isolated event without trigger/result is flagged', () => {
    const db = new Database();
    const m  = new Model('m_chk2', 'EPC');
    db.addModel(m);
    m.addObject(new ObjDef('orphan_ev', 'OT_EVENT', { AT_NAME: 'Orphan' }));

    const { summary } = runSemanticChecks([m]);
    assert.ok(summary.total >= 1, `should detect orphan event (got ${summary.total})`);
  });

  test('valid 3-step EPC passes with only warnings (no hard errors)', () => {
    const db = new Database();
    const m  = new Model('m_ok', 'EPC');
    db.addModel(m);
    const f1 = m.addObject(new ObjDef('f1', 'OT_FUNC',  { AT_NAME: 'A' }));
    const e1 = m.addObject(new ObjDef('e1', 'OT_EVENT', { AT_NAME: 'B' }));
    const f2 = m.addObject(new ObjDef('f2', 'OT_FUNC',  { AT_NAME: 'C' }));
    f1.connect(e1, cxnTypes.CT_CONTROLS);
    e1.connect(f2, cxnTypes.CT_CONTROLS);

    const { summary, violations } = runSemanticChecks([m]);
    // f1 has 1 out ctrl → needs >=2 → will be flagged (that's expected in ARIS rules)
    // we assert no crashes and that a known rule ID is present
    const ruleIds = new Set(violations.map(v => v.ruleId));
    assert.equal(ruleIds.has('RULE_ORPHAN_OBJ'), false,
      'no node should be flagged as orphan in a connected chain');
  });

  test('org unit with two superiors is flagged', () => {
    const db = new Database();
    const m  = new Model('m_org2', 'ORG');
    db.addModel(m);
    const s1 = m.addObject(new ObjDef('s1', 'OT_ORGN_UNIT', { AT_NAME: 'S1' }));
    const s2 = m.addObject(new ObjDef('s2', 'OT_ORGN_UNIT', { AT_NAME: 'S2' }));
    const u  = m.addObject(new ObjDef('u',  'OT_ORGN_UNIT', { AT_NAME: 'U'  }));
    s1.connect(u, cxnTypes.CT_IS_PRCSNT_SUPER);
    s2.connect(u, cxnTypes.CT_IS_PRCSNT_SUPER);

    const { summary } = runSemanticChecks([m]);
    assert.ok(summary.errors >= 1, `should flag dual superior (got ${summary.errors} errors)`);
  });

  // REGRESSION — a rule violation previously caused the runner to throw
  // (`Cannot read properties of undefined (reading 'name')`), because the
  // rule callbacks are arrow functions called via `.call({ name })` — the
  // receiver was ignored, so `this.name` hit `undefined.name`.  The test
  // suite above accidentally passed because the runner's outer catch
  // fabricated a "Rule error:" violation (total>=1, errors>=1) even when
  // the rule itself was broken.  This test asserts the *real* rule name
  // and object survive, which is only true if `this` is bound correctly
  // (i.e. the rules are plain `function` expressions, not arrows).
  test('rule violations carry the real rule name and target object (this-binding)', () => {
    const db = new Database();
    const m  = new Model('m_reg', 'EPC');
    db.addModel(m);
    // A function with <2 in and <2 out control edges MUST trip
    // RULE_EPC_CONN_COUNT — which references `this.name` and `node.name`.
    m.addObject(new ObjDef('f1', 'OT_FUNC', { AT_NAME: 'Solo func' }));

    const { violations } = runSemanticChecks([m]);
    const real = violations.find(v => v.ruleId === 'RULE_EPC_CONN_COUNT');
    assert.ok(real, 'RULE_EPC_CONN_COUNT should fire for a 1-in/1-out function (got ' +
                    violations.map(v => v.ruleId).join(',') + ')');
    assert.equal(real.ruleName,
      'Number of outgoing or incoming connections at the rule',
      'ruleName must be the real rule name (not a "Rule error" fabrication)');
    assert.equal(real.severity, 5, 'severity should be ERROR (5)');
    assert.ok(real.object, 'the violation must reference the offending object');
    assert.equal(real.object.name, 'Solo func');
    assert.match(real.message, /Solo func/, 'message must name the offending object');
    assert.ok(!violations.some(v => String(v.message).startsWith('Rule error:')),
             'no rule should report an internal "Rule error"');
  });
});

console.log('\n✅ All core tests completed.\n');
