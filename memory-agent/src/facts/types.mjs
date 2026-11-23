// The closed list of fact types this engine can emit, and the rules for suppressing them.
// Each entry: id, group, keyed (null, or what the emitted ids are keyed by), variantOf (an id whose suppression also removes this one),
// dependsOn (ids whose values this fact restates or leans on: suppressing any of them suppresses this fact too, transitively).
// Facts of the feedback group belong to another seat and are not listed here.
import { ACTIVITY_ALLOWLIST } from './constants.mjs';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const FACT_TYPES = [
  { id: 'history.thin', group: 'history', keyed: null },
  { id: 'coverage.28d', dependsOn: ['load.ratio', 'volume.28d'], group: 'coverage', keyed: null },
  { id: 'volume.today', group: 'volume', keyed: null },
  { id: 'volume.today_so_far', group: 'volume', keyed: null, variantOf: 'volume.today' },
  { id: 'volume.today_unlogged', group: 'volume', keyed: null, variantOf: 'volume.today' },
  { id: 'volume.week', group: 'volume', keyed: null },
  { id: 'volume.28d', group: 'volume', keyed: null },
  { id: 'past.today_vs_avg', dependsOn: ['volume.today'], group: 'past', keyed: null },
  { id: 'past.today_vs_highest', dependsOn: ['volume.today'], group: 'past', keyed: null },
  { id: 'past.today_rank', dependsOn: ['volume.today'], group: 'past', keyed: null },
  { id: 'past.week_vs_avg', dependsOn: ['volume.week'], group: 'past', keyed: null },
  { id: 'past.week_rank', dependsOn: ['volume.week'], group: 'past', keyed: null },
  { id: 'past.week_comparisons_skipped', dependsOn: ['volume.week'], group: 'past', keyed: null },
  { id: 'load.ratio', dependsOn: ['volume.week', 'volume.28d'], group: 'load', keyed: null },
  { id: 'regularity.days_since_last', dependsOn: ['volume.28d'], group: 'regularity', keyed: null },
  { id: 'regularity.longest_gap', group: 'regularity', keyed: null },
  { id: 'regularity.per_week', dependsOn: ['volume.week', 'volume.28d'], group: 'regularity', keyed: null },
  // Emitted ids are regularity.slot.<activityType>.<weekday>.<HH>; the key is "<activityType>.<weekday>.<HH>", for example "Running.Mon.07".
  { id: 'regularity.slot', group: 'regularity', keyed: { by: 'activityType.weekday.hour', example: 'Running.Mon.07' } },
  { id: 'regularity.slots_none', group: 'regularity', keyed: null, variantOf: 'regularity.slot' },
  { id: 'mix.count', dependsOn: ['volume.28d'], group: 'mix', keyed: null },
  { id: 'mix.median_length', dependsOn: ['volume.28d', 'mix.count'], group: 'mix', keyed: null },
  { id: 'mix.start_bands', dependsOn: ['volume.28d', 'mix.count'], group: 'mix', keyed: null },
  { id: 'body.sleep', group: 'body', keyed: null },
  { id: 'body.resting_hr', group: 'body', keyed: null },
  { id: 'goal.workouts_per_week', dependsOn: ['volume.week'], group: 'goal', keyed: null },
  { id: 'goal.target_progress', dependsOn: ['volume.week'], group: 'goal', keyed: null },
];

export const FACT_TYPE_IDS = FACT_TYPES.map((t) => t.id);
export const FACT_TYPE_GROUPS = [...new Set(FACT_TYPES.map((t) => t.group))];
export const SUPPRESSED_ERROR = 'suppressed lists an unknown fact type or key';

// The type id of an emitted fact id (slot facts carry their key in the id).
export const typeOf = (factId) => (factId.startsWith('regularity.slot.') ? 'regularity.slot' : factId);

const matches = (type, id) => id === type || id.startsWith(`${type}.`);
const DEPENDS_ON = Object.fromEntries(FACT_TYPES.filter((t) => t.dependsOn).map((t) => [t.id, t.dependsOn]));
const VARIANT_OF = Object.fromEntries(FACT_TYPES.filter((t) => t.variantOf).map((t) => [t.id, t.variantOf]));
// Every id and every dot-prefix of an id is a valid type ("body", "body.sleep", "regularity.slot").
const VALID_TYPES = new Set(FACT_TYPE_IDS.flatMap((id) => id.split('.').map((_, i, a) => a.slice(0, i + 1).join('.'))));
const SLOT_KEY = new RegExp(`^(${ACTIVITY_ALLOWLIST.filter((a) => a !== 'Other').join('|')})\\.(${WEEKDAYS.join('|')})\\.([01]\\d|2[0-3])$`);
const KEY_CHECKS = { 'regularity.slot': (key) => SLOT_KEY.test(key) };

// Validates a suppressed list and returns a function id -> boolean. Throws Error(SUPPRESSED_ERROR) on anything unknown.
export function suppressionFilter(suppressed) {
  if (suppressed === undefined || suppressed === null) return () => false;
  const fail = () => {
    throw new Error(SUPPRESSED_ERROR);
  };
  if (typeof suppressed !== 'object' || Array.isArray(suppressed)) fail();
  for (const k of Object.keys(suppressed)) if (k !== 'types' && k !== 'keys') fail();
  const types = suppressed.types ?? [];
  const keys = suppressed.keys ?? [];
  if (!Array.isArray(types) || !Array.isArray(keys)) fail();
  for (const t of types) if (typeof t !== 'string' || !VALID_TYPES.has(t)) fail();
  for (const k of keys) {
    if (!k || typeof k !== 'object' || Array.isArray(k) || typeof k.type !== 'string' || typeof k.key !== 'string') fail();
    for (const f of Object.keys(k)) if (f !== 'type' && f !== 'key') fail();
    const check = KEY_CHECKS[k.type];
    if (!check || !check(k.key)) fail();
  }
  const keyIds = new Set(keys.map((k) => `${k.type}.${k.key}`));
  const direct = (id) => keyIds.has(id) || types.some((t) => matches(t, id) || (VARIANT_OF[id] !== undefined && matches(t, VARIANT_OF[id])));
  // A fact is also suppressed when a fact it depends on is (the dependency graph has no cycles; a test checks).
  const suppressedId = (id) => direct(id) || (DEPENDS_ON[typeOf(id)] || []).some(suppressedId);
  return suppressedId;
}
