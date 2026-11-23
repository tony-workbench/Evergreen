// Memory as the app hands it over: { rows: [{ memoryId, key, slot, group, kind, statement, data, state, confidence, since, updated }] }.
// A row's key is opaque: it is never built or parsed here, only copied into basedOn. What a rule needs is in row.data, by kind.
import { InputError } from './pytime.mjs';

export const ACTIVITIES = ['run', 'long_run', 'walk', 'strength', 'yoga', 'ride', 'elliptical', 'swim', 'stretch', 'rest', 'other'];
export const INTENSITIES = ['easy', 'steady', 'hard'];
const ACTIVE = ['saved', 'confirmed'];
const STOPPED = ['rejected', 'stopped'];

// Apple Health workout types -> the shared activity list.
const FROM_HEALTH = {
  Running: 'run', Walking: 'walk', Cycling: 'ride', Elliptical: 'elliptical', Yoga: 'yoga', Swimming: 'swim',
  FunctionalStrengthTraining: 'strength', TraditionalStrengthTraining: 'strength', CoreTraining: 'strength',
  Pilates: 'stretch', Flexibility: 'stretch', Cooldown: 'stretch', MindAndBody: 'stretch',
};
const own = (o, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);

const LABELS = { HighIntensityIntervalTraining: 'HIIT', Hiking: 'hike', Rowing: 'rowing', CrossTraining: 'cross-training' };
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The shared activity for an Apple Health workout type; anything the list does not name is `other`. */
export const activityOf = (healthType) => (typeof healthType === 'string' && healthType ? own(FROM_HEALTH, healthType) ?? 'other' : null);
/** A plain name for an Apple Health workout type the list does not name: 'HIIT', 'rowing', 'kickboxing'. */
export const labelOf = (healthType) => own(LABELS, healthType) ?? String(healthType).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
/** long_run is a run for every rule that asks "is this a run?". */
export const baseActivity = (activity) => (activity === 'long_run' ? 'run' : activity);
export const isRun = (activity) => baseActivity(activity) === 'run';

/** Reads the rows: the ones in use (saved or confirmed), the keys the person stopped, and the usual slots. */
export function readMemory(memory) {
  if (memory === undefined || memory === null) return { given: false, rows: [], keys: [], stoppedKeys: [], slots: [], stoppedSlots: [], first: () => null };
  if (typeof memory !== 'object' || !Array.isArray(memory.rows)) throw new InputError('bad_memory');
  const valid = memory.rows.filter((r) => r && typeof r === 'object' && typeof r.key === 'string' && r.key);
  const rows = valid.filter((r) => r.state === undefined || r.state === null || ACTIVE.includes(r.state));
  const stoppedKeys = [...new Set(valid.filter((r) => STOPPED.includes(r.state)).map((r) => r.key))];
  const keys = [...new Set(rows.map((r) => r.key))].filter((k) => !stoppedKeys.includes(k));
  const slots = [];
  const stoppedSlots = [];
  for (const r of valid) {
    const d = r.kind === 'usual_slot' && r.data && typeof r.data === 'object' ? r.data : null;
    const stopped = stoppedKeys.includes(r.key);
    if (!d || (!stopped && !(rows.includes(r) && keys.includes(r.key))) || !ACTIVITIES.includes(d.activity) || !Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) continue;
    if (!Number.isInteger(d.hour) || d.hour < 0 || d.hour > 23) continue;
    (stopped ? stoppedSlots : slots).push({
      key: r.key, weekday: d.weekday, activity: baseActivity(d.activity), hour: d.hour, minutes: Number.isFinite(d.minutes) && d.minutes > 0 ? d.minutes : null,
      label: d.activity === 'other' && typeof d.label === 'string' && d.label.trim() ? d.label.trim() : null,
      weeksSeen: d.weeksSeen ?? null, weeksTotal: d.weeksTotal ?? null, statement: typeof r.statement === 'string' ? r.statement : '',
    });
  }
  const first = (kind) => rows.find((r) => r.kind === kind && keys.includes(r.key) && r.data && typeof r.data === 'object') ?? null;
  return { given: true, rows: rows.filter((r) => keys.includes(r.key)), keys, stoppedKeys, slots, stoppedSlots, first };
}

/** Whether a slot is about this Apple Health workout type; an `other` slot with a label must name the same thing. */
export function slotMatches(slot, healthType) {
  const activity = activityOf(healthType);
  if (activity === null || slot.activity !== activity) return false;
  return activity !== 'other' || slot.label === null || [norm(healthType), norm(labelOf(healthType))].includes(norm(slot.label));
}

/** The usual slot for a weekday (Mon=0) and an Apple Health workout type; a later row wins. */
export function slotFor(mem, weekday, healthType) {
  let hit = null;
  for (const s of mem.slots) if (s.weekday === weekday && slotMatches(s, healthType)) hit = s;
  return hit;
}

/**
 * The usual times the person asked not to be planned again, from `stopped: [{ key?, activity, weekday, hour, label? }]`
 * (the data of the rejected usual-slot rows, which are no longer in the table) and from rejected rows still in it.
 */
export function readStopped(list, mem) {
  if (list !== undefined && list !== null && !Array.isArray(list)) throw new InputError('bad_stopped');
  const out = [];
  const add = (x) => { if (!out.some((y) => y.activity === x.activity && y.weekday === x.weekday && y.hour === x.hour)) out.push(x); };
  for (const x of mem.stoppedSlots) add({ key: x.key, activity: x.activity, weekday: x.weekday, hour: x.hour, label: x.label });
  for (const x of list ?? []) {
    if (!x || typeof x !== 'object' || !ACTIVITIES.includes(x.activity) || !Number.isInteger(x.weekday) || x.weekday < 0 || x.weekday > 6) continue;
    if (!Number.isInteger(x.hour) || x.hour < 0 || x.hour > 23) continue;
    add({ key: typeof x.key === 'string' && x.key ? x.key : null, activity: baseActivity(x.activity), weekday: x.weekday, hour: x.hour, label: x.activity === 'other' && typeof x.label === 'string' && x.label.trim() ? x.label.trim() : null });
  }
  return out;
}

/** Whether a session of this activity on this weekday (Mon=0), starting in this hour, is one of the stopped usual times. */
export const isStopped = (stopped, activity, weekday, hour) =>
  stopped.some((x) => x.activity === baseActivity(activity) && x.weekday === weekday && x.hour === hour);
