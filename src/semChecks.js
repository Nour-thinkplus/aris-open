/**
 * ARIS Open — Semantic Check Engine
 * Ports core rules from the shipped ARIS profiles (Structure rules,
 * EPC validation, org charts, hierarchy checks, business-rule checks).
 */
import { objKinds, ObjDef } from './model.js';

const KIND = {};
for (const k of objKinds) KIND[k.kindName] = k;

// severity mirrors ARIS (5 = error, 4 = warning, 3 = info)
const SEV = { ERROR: 5, WARNING: 4, INFO: 3 };

/**
 * A single violation.
 */
class Violation {
  constructor(ruleId, ruleName, severity, object, message) {
    this.ruleId    = ruleId;
    this.ruleName  = ruleName;
    this.severity  = severity;
    this.object    = object;
    this.message   = message;
  }
}

/**
 * Evaluate a model.  Returns { violations, summary }.
 * Every rule returns a list of Violation.
 *
 * @param {Object} ctx  { objDefs: Map, allConnections: CxnDef[] }
 */
const RULES = [];

function rule(id, name, fn) {
  RULES.push({ id, name, fn });
}

function inCxnOf(node, cxns)  { return cxns.filter(c => c.target === node); }
function outCxnOf(node, cxns) { return cxns.filter(c => c.source === node); }

// ---------------------------------------------------------------------------
//  Rule: No orphan objects (mandatory semantic check)
// ---------------------------------------------------------------------------
rule(
  'RULE_ORPHAN_OBJ',
  'Objects must not be isolated',
  function (ctx, out) {
    for (const node of ctx.objDefs.values()) {
      if (node.typeNum === 'OT_PROCESS') continue; // process roots may be orphans
      if (inCxnOf(node, ctx.allConnections).length === 0 &&
          outCxnOf(node, ctx.allConnections).length === 0) {
        out.push(new Violation(
          'RULE_ORPHAN_OBJ', this.name, SEV.ERROR,
          node,
          `Object "${node.name || node.id}" has no incoming or outgoing connections.`
        ));
      }
    }
  }
);

// ---------------------------------------------------------------------------
//  Rule: EPC — every node must have exactly one outgoing or incoming control
// ---------------------------------------------------------------------------
rule(
  'RULE_EPC_CONN_COUNT',
  'Number of outgoing or incoming connections at the rule',
  function (ctx, out) {
    for (const node of ctx.objDefs.values()) {
      const k = KIND[node.typeNum];
      if (!k) continue;
      const ins  = inCxnOf(node,  ctx.allConnections);
      const outs = outCxnOf(node, ctx.allConnections);
      const inCtrl  = ins.filter(c => c.cxnType === 'CT_CONTROLS').length;
      const outCtrl = outs.filter(c => c.cxnType === 'CT_CONTROLS').length;
      if (k.inCxn?.includes('CT_CONTROLS') && inCtrl > 0 && outCtrl > 1) {
        // function: should have >=2 in OR >=1 out but not both sides 1
      }
      if (k.kindName === 'OT_FUNC') {
        if (inCtrl < 2 && outCtrl < 2) {
          out.push(new Violation(
            'RULE_EPC_CONN_COUNT', this.name, SEV.ERROR, node,
            `Function "${node.name}" needs >=2 incoming or >=2 outgoing control connections (has ${inCtrl} in / ${outCtrl} out).`
          ));
        }
      }
      if (k.kindName === 'OT_EVENT') {
        if (inCtrl !== 1 && outCtrl !== 1) {
          out.push(new Violation(
            'RULE_EPC_CONN_COUNT', this.name, SEV.ERROR, node,
            `Event "${node.name}" must have exactly one incoming or one outgoing control connection (has ${inCtrl} in / ${outCtrl} out).`
          ));
        }
      }
    }
  }
);

// ---------------------------------------------------------------------------
//  Rule: EPC — no cycles allowed
// ---------------------------------------------------------------------------
rule(
  'RULE_NO_CYCLE',
  'No cycle may exist in the model',
  function (ctx, out) {
    const visited = new Set();
    const stack   = new Set();
    let cyc = null;
    const dfs = (node, path) => {
      visited.add(node.id); stack.add(node.id);
      for (const c of outCxnOf(node, ctx.allConnections)) {
        if (!visited.has(c.target.id)) dfs(c.target, path + [c.target.id]);
        else if (stack.has(c.target.id)) {
          cyc = cyc ?? [...path.slice(path.indexOf(c.target.id)), c.target.id];
        }
      }
      stack.delete(node.id);
    };
    for (const n of ctx.objDefs.values()) if (!visited.has(n.id)) dfs(n, [n.id]);
    if (cyc) {
      const names = cyc.map(id => ctx.objDefs.get(id)?.name ?? id).join(' → ');
      out.push(new Violation(
        'RULE_NO_CYCLE', this.name, SEV.ERROR, null,
        `Cycle detected: ${names}`
      ));
    }
  }
);

// ---------------------------------------------------------------------------
//  Rule: EPC — order at the rule must be observed (event→function→event)
// ---------------------------------------------------------------------------
rule(
  'RULE_EPC_ORDER',
  'Order at the rule must be observed',
  function (ctx, out) {
    for (const node of ctx.objDefs.values()) {
      if (node.typeNum !== 'OT_FUNC') continue;
      const inEvents  = inCxnOf(node, ctx.allConnections)
        .filter(c => c.target.typeNum === 'OT_EVENT').length;
      const outEvents = outCxnOf(node, ctx.allConnections)
        .filter(c => c.source.typeNum === 'OT_EVENT').length;
      // If an event triggers the function, outgoing should lead to event (or other func)
      // If function leads to event, incoming should come from event or other func
      const hasEventIn  = inEvents  > 0;
      const hasEventOut = outEvents > 0;
      if (hasEventIn && !hasEventOut) {
        // acceptable — function triggered by event, output leads to non-event
      }
      if (!hasEventIn && !hasEventOut) {
        out.push(new Violation(
          'RULE_EPC_ORDER', this.name, SEV.WARNING, node,
          `Function "${node.name}" has no event on either side — consider adding trigger/result events.`
        ));
      }
    }
  }
);

// ---------------------------------------------------------------------------
//  Rule: Org chart — each org unit should have at most one superior
// ---------------------------------------------------------------------------
rule(
  'RULE_ORG_SINGLE_SUPERIOR',
  'Organization unit has at most one superior',
  function (ctx, out) {
    for (const node of ctx.objDefs.values()) {
      if (node.typeNum !== 'OT_ORGN_UNIT') continue;
      const supers = inCxnOf(node, ctx.allConnections)
        .filter(c => c.cxnType === 'CT_IS_PRCSNT_SUPER');
      if (supers.length > 1) {
        out.push(new Violation(
          'RULE_ORG_SINGLE_SUPERIOR', this.name, SEV.ERROR, node,
          `Organization unit "${node.name}" has ${supers.length} superiors (expected at most 1).`
        ));
      }
    }
  }
);

// ---------------------------------------------------------------------------
//  Rule: Org chart — organization manager is assigned
// ---------------------------------------------------------------------------
rule(
  'RULE_ORG_MANAGER',
  'Organization manager is assigned',
  function (ctx, out) {
    for (const node of ctx.objDefs.values()) {
      if (node.typeNum !== 'OT_ORGN_UNIT') continue;
      const manager = node.getAttr('AT_MANAGER');
      if (!manager) {
        out.push(new Violation(
          'RULE_ORG_MANAGER', this.name, SEV.WARNING, node,
          `Organization unit "${node.name}" has no manager assigned.`
        ));
      }
    }
  }
);

// ---------------------------------------------------------------------------
//  Rule: Business rule — has both incoming and outgoing references
// ---------------------------------------------------------------------------
rule(
  'RULE_BUSIREF_CONN',
  'Number of outgoing or incoming connections at the rule',
  function (ctx, out) {
    for (const node of ctx.objDefs.values()) {
      if (node.typeNum !== 'OT_BUSI_RULE') continue;
      const ins  = inCxnOf(node,  ctx.allConnections).length;
      const outs = outCxnOf(node, ctx.allConnections).length;
      if (ins < 1 && outs < 1) {
        out.push(new Violation(
          'RULE_BUSIREF_CONN', this.name, SEV.WARNING, node,
          `Business rule "${node.name}" is not referenced by any object.`
        ));
      }
    }
  }
);

// ---------------------------------------------------------------------------
//  Run all rules on a model (or set of models)
// ---------------------------------------------------------------------------

export function runSemanticChecks(models) {
  const violations = [];
  for (const m of (Array.isArray(models) ? models : [models])) {
    const ctx = {
      objDefs: m.objDefs,
      allConnections: m.allConnections,
    };
    for (const { id, name, fn } of RULES) {
      try { fn.call({ name }, ctx, violations); } catch (e) {
        violations.push(new Violation(id, name, SEV.ERROR, null, `Rule error: ${e.message}`));
      }
    }
  }
  const summary = {
    total: violations.length,
    errors:   violations.filter(v => v.severity === SEV.ERROR).length,
    warnings: violations.filter(v => v.severity === SEV.WARNING).length,
    infos:    violations.filter(v => v.severity === SEV.INFO).length,
  };
  return { violations, summary };
}

export { RULES as semanticRules, SEV, Violation, inCxnOf, outCxnOf };
