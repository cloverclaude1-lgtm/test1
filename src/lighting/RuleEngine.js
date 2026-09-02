// ---------------------------------------------------------------------------
// RuleEngine — the visual "WHEN ... THEN ..." automation system (brief §16).
//
// Pure evaluation logic only: given a Rule and the current audio/context
// snapshot, decide whether it fires. LightingEngine owns *applying* the
// resulting actions (including timed effects like flashes/fades) so this
// module stays a small, easily testable pure function set with no notion of
// fixtures, time-based decay, or rendering.
// ---------------------------------------------------------------------------

export const CONDITION_TYPES = [
  { id: 'bass', label: 'Bass', hasValue: true },
  { id: 'mid', label: 'Mid', hasValue: true },
  { id: 'treble', label: 'Treble', hasValue: true },
  { id: 'energy', label: 'Energy', hasValue: true },
  { id: 'beat', label: 'Beat detected', hasValue: false },
  { id: 'onset', label: 'Onset detected', hasValue: false },
  { id: 'energyIncreasing', label: 'Energy increasing', hasValue: false },
  { id: 'energyDecreasing', label: 'Energy decreasing', hasValue: false },
  { id: 'silence', label: 'Silence', hasValue: false },
  { id: 'sectionChanged', label: 'Section changed', hasValue: false },
];

export const ACTION_TYPES = [
  { id: 'setBrightness', label: 'Set brightness', params: ['group', 'value'] },
  { id: 'changeColor', label: 'Change color', params: ['group', 'color'] },
  { id: 'flash', label: 'Flash', params: ['group', 'amount', 'durationMs'] },
  { id: 'strobe', label: 'Strobe', params: ['group', 'rate'] },
  { id: 'move', label: 'Move', params: ['group', 'pan', 'tilt'] },
  { id: 'changeScene', label: 'Change scene', params: ['sceneId'] },
  { id: 'fade', label: 'Fade', params: ['group', 'value', 'durationSec'] },
  { id: 'pulse', label: 'Pulse', params: ['group', 'amount', 'rateHz'] },
  { id: 'setGroupEnabled', label: 'Enable/disable group', params: ['group', 'enabled'] },
];

let nextRuleId = 1;
export function createRule({ name, conditions = [], logic = 'AND', actions = [] } = {}) {
  return {
    id: `rule_${Date.now().toString(36)}_${(nextRuleId++).toString(36)}`,
    name: name || 'New Rule',
    enabled: true,
    logic, // 'AND' | 'OR' across conditions
    conditions, // [{ type, op, value, negate }]
    actions, // [{ type, ...params }]
  };
}

function evalCondition(cond, ctx) {
  let result;
  switch (cond.type) {
    case 'bass':
    case 'mid':
    case 'treble':
    case 'energy': {
      const v = ctx.features[cond.type] ?? 0;
      const target = cond.value ?? 0.8;
      result = cond.op === '<' ? v < target : v > target;
      break;
    }
    case 'beat':
      result = ctx.eventsThisFrame.some((e) => e.type === 'KICK');
      break;
    case 'onset':
      result = ctx.eventsThisFrame.some((e) => e.type === 'ONSET');
      break;
    case 'energyIncreasing':
      result = ctx.eventsThisFrame.some((e) => e.type === 'ENERGY_UP');
      break;
    case 'energyDecreasing':
      result = ctx.eventsThisFrame.some((e) => e.type === 'ENERGY_DOWN');
      break;
    case 'silence':
      result = ctx.features.energy < 0.03 || ctx.eventsThisFrame.some((e) => e.type === 'SILENCE');
      break;
    case 'sectionChanged':
      result = ctx.eventsThisFrame.some((e) => e.type === 'SECTION_CHANGE');
      break;
    default:
      result = false;
  }
  return cond.negate ? !result : result;
}

/** Returns true/false for whether a rule's WHEN clause is satisfied this frame. */
export function evaluateRule(rule, ctx) {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  if (rule.logic === 'OR') return rule.conditions.some((c) => evalCondition(c, ctx));
  return rule.conditions.every((c) => evalCondition(c, ctx));
}

export function describeRule(rule) {
  const condText = rule.conditions
    .map((c) => {
      const meta = CONDITION_TYPES.find((t) => t.id === c.type);
      const base = meta?.hasValue ? `${meta.label} ${c.op || '>'} ${Math.round((c.value ?? 0.8) * 100)}%` : meta?.label || c.type;
      return c.negate ? `NOT ${base}` : base;
    })
    .join(` ${rule.logic} `);
  const actionText = rule.actions
    .map((a) => ACTION_TYPES.find((t) => t.id === a.type)?.label || a.type)
    .join(', ');
  return { condText: condText || '(no conditions)', actionText: actionText || '(no actions)' };
}
