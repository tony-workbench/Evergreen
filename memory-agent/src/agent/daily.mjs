// The memory agent's calls, as the phone entry and the tests use them. `ctx` is { store, io, user }: the MemoryStore of
// the person, the host's io object and the user id. Each call loads agent.json, runs the pure engine and saves the file
// when something changed. The model call itself is the app's: dailyRequest prepares it, dailyApply executes its answer.
//
// One model call a day does extraction and consolidation together: the slots an evidence item can touch are fixed by
// code, so the existing memories are known before the model runs; one call costs the person half as much as two and
// there is no half-finished state between them.
import { computeFacts } from '../facts/index.mjs';
import { parseTimestamp } from '../contract/index.mjs';
import { suppressedTypes, DERIVED_KINDS } from '../store/index.mjs';
import { engineSuppression } from '../memory/roll.mjs';
import { openAgentFile } from './store.mjs';
import {
  recordFacts, recordOutcomes, dailyEvidence, applyDaily, reviewQueue, confirmMemory, rejectMemory, restoreMemory,
  stopSlots, restoreSlots, forgetDay, forgetDayRecomputed, forgetSlots, wipe, recordExtras, retireSlot,
} from './engine.mjs';
import { placeEvidence, PLACE_SLOT } from './place.mjs';
import { memoryTable } from './table.mjs';
import { cleanOutcomes, cleanExtras, addDays, isDay } from './evidence.mjs';
import { SYSTEM, userMessage } from './prompts.mjs';
import { PROPOSALS_SCHEMA, SLOT_RE, GROUPS, groupOf, fail } from './schema.mjs';

/** The day that ended before `now` (the last completed local day), or null. */
export function lastDay(now) {
  const p = parseTimestamp(now);
  return p === null ? null : addDays(p.date, -1);
}
const midnightOf = (now) => `${now.slice(0, 10)}T00:00:00${/(Z|[+-]\d{2}:\d{2})$/.exec(now)[1]}`;

function run(ctx, fn) {
  const file = openAgentFile({ io: ctx.io, dir: ctx.store.dir, user: ctx.user });
  const state = file.load();
  const before = JSON.stringify(state);
  const result = fn(state);
  if (JSON.stringify(state) !== before) file.save(state);
  return result;
}

// The fact store's own stops, as slots. A fixed slot's stored key is `<label>.<day>.<hour>` (running.sun.08).
const LABEL_ACTIVITY = {
  running: 'run', walking: 'walk', cycling: 'ride', swimming: 'swim', yoga: 'yoga', elliptical: 'elliptical', pilates: 'stretch', flexibility: 'stretch',
  strength_training: 'strength', functional_strength_training: 'strength', traditional_strength_training: 'strength', core_training: 'strength',
};
const USUAL = /^routine\.[a-z_]+(\.[a-z0-9_]+)?\.(mon|tue|wed|thu|fri|sat|sun)_\d{2}$/;
const TYPE_SLOTS = {
  body: (s) => s.startsWith('body.'), load: (s) => s.startsWith('load.'), regularity: (s) => USUAL.test(s), mix: (s) => s === 'routine.mix',
  profile: (s) => s === 'routine.weekly_volume', week: (s) => s === 'routine.weekly_volume' || s.startsWith('load.'),
};
function storeKeySlots(type, key) {
  if (type === 'body') return [`body.${key}`];
  if (type !== 'regularity') return [];
  const [label, day, hour] = String(key).split('.');
  return [`routine.${LABEL_ACTIVITY[label] ?? `other.${label}`}.${day}_${hour}`];
}
/** The slots behind a brief key (workouts_per_week, slot:running:sun:08, mix, load, sleep, resting_hr); [] for any other key. */
export function slotsOfBriefKey(key) {
  const fixed = { workouts_per_week: ['routine.weekly_volume'], mix: ['routine.mix'], load: ['load.week'], sleep: ['body.sleep'], resting_hr: ['body.resting_hr'] };
  if (typeof key !== 'string') return [];
  if (Object.hasOwn(fixed, key)) return fixed[key];
  const m = /^slot:([a-z_]+):(mon|tue|wed|thu|fri|sat|sun):(\d{2})$/.exec(key);
  return m ? storeKeySlots('regularity', `${m[1]}.${m[2]}.${m[3]}`) : [];
}
const isOff = (store) => DERIVED_KINDS.some((k) => store.kindSuppressed(k));

// `entry` is { snapshot, now, day, trim? }: the export, the moment of the roll, the completed day and whether to trim.
function record(ctx, state, entry) {
  const { snapshot, now, day, trim = true } = entry;
  const sup = suppressedTypes(ctx.store);
  if (sup.days.includes(day)) return false;
  const facts = computeFacts(snapshot, midnightOf(now), { suppressed: engineSuppression(sup), forgottenDays: sup.days, dayMode: 'completed' });
  recordFacts(state, day, facts, sup.types, trim);
  // Where the person trains, from the kinds of workouts over 8 weeks; a gym workout retires the memory that says home.
  const place = placeEvidence(snapshot, { day, nowMs: parseTimestamp(midnightOf(now)).ms, forgottenDays: sup.days });
  state.evidence[day].push(...place.items);
  if (place.gym) retireSlot(state, PLACE_SLOT, { day, at: now });
  const stopped = new Set(sup.keys.flatMap((k) => storeKeySlots(k.type, k.key)));
  const off = (slot) => stopped.has(slot) || sup.types.some((t) => TYPE_SLOTS[t]?.(slot));
  state.evidence[day] = state.evidence[day].map((i) => ({ ...i, slots: i.slots.filter((s) => !off(s.slot)) })).filter((i) => i.slots.length > 0);
  return true;
}

/** After a completed roll: keep the day's facts as evidence. Returns { ok, day, items }. */
export function recordDay(ctx, { snapshot, now }) {
  const day = lastDay(now);
  if (day === null) return fail('bad_arguments');
  return run(ctx, (state) => {
    if (isOff(ctx.store)) { if (!state.off) { wipe(state); state.off = true; } return fail('memory_off'); }
    state.off = false;
    if (!record(ctx, state, { snapshot, now, day })) return fail('day_forgotten');
    return { ok: true, day, items: state.evidence[day].length };
  });
}

/**
 * The request for the one model call of the day that ended before `now`:
 *   { ok, day, alreadyDone, system, user, schema, evidence: [{ id, text, numbers, window, slots, supportDays }], neighbors: [{ memoryId, slot, statement, state, version, updated }] }
 * `outcomes` ([{ sessionId, day, activity, plannedStart, done, actualStart?, actualMinutes? }]) are stored and become evidence.
 * `extras` ({ gear?: [{ item, name?, startedOn, km }], goal?: [{ what, date }] }) is what the app knows; it becomes the evidence `gear.<item>` and `goal.<what>`.
 * `alreadyDone` is true when this day's evidence was already applied; with empty evidence there is nothing to send either.
 * `snapshot` is only needed when the day was not rolled through memoryRoll.
 */
export function dailyRequest(ctx, { now, outcomes, snapshot, extras } = {}) {
  const day = lastDay(now);
  if (day === null) return fail('bad_arguments');
  const clean = cleanOutcomes(outcomes);
  if (clean === null) return fail('bad_outcomes');
  const more = cleanExtras(extras);
  if (more === null) return fail('bad_extras');
  return run(ctx, (state) => {
    if (isOff(ctx.store)) return fail('memory_off');
    const gone = suppressedTypes(ctx.store).days;
    if (gone.includes(day)) return fail('day_forgotten');
    recordOutcomes(state, clean.filter((o) => !gone.includes(o.day)), day);
    recordExtras(state, more, day);
    if (!Object.hasOwn(state.evidence, day) && snapshot !== undefined) record(ctx, state, { snapshot, now, day });
    const r = dailyEvidence(state, day, ctx.io.sha256);
    if (!r.ok) return r;
    return { ok: true, day, alreadyDone: r.alreadyDone, system: SYSTEM, user: userMessage(r), schema: PROPOSALS_SCHEMA, evidence: r.evidence, neighbors: r.neighbors };
  });
}

/** The guarded executor: { ok, day, alreadyDone, applied, rejected, review } (see applyDaily in engine.mjs). `day` defaults to the day before `now`. */
export function dailyApply(ctx, { now, day, proposals } = {}) {
  if (lastDay(now) === null || (day !== undefined && !isDay(day))) return fail('bad_arguments');
  return run(ctx, (state) => applyDaily(state, { day: day ?? lastDay(now), proposals, at: now, sha256: ctx.io.sha256 }));
}

const latest = (state) => [...Object.keys(state.processed), ...Object.keys(state.evidence)].sort().pop() ?? '0000-01-01';

/** The daily table (table.mjs). Without `now` the table is as of the latest day the agent has seen. */
export function table(ctx, { now } = {}) {
  if (now !== undefined && lastDay(now) === null) return fail('bad_arguments');
  return run(ctx, (state) => memoryTable(state, now === undefined ? latest(state) : lastDay(now)));
}
/** What the person is asked about: { ok, rows: [{ reviewId, memoryId, key, slot, group, kind, statement, data, question, reason, day, targetMemoryId, targetStatement }] }. */
export function reviews(ctx) { return run(ctx, (state) => ({ ok: true, rows: reviewQueue(state) })); }

const person = (fn) => (ctx, a = {}) => {
  if (lastDay(a.now) === null) return fail('bad_arguments');
  return run(ctx, (state) => fn(state, a, { day: lastDay(a.now), at: a.now }));
};
/** confirm, reject and restore take { now, memoryId } or { now, key } and return { ok, memoryId, slot, state }. */
export const confirm = person(confirmMemory);
export const reject = person(rejectMemory);
export const restore = person(restoreMemory);

const stamp = (state, a) => ({ day: lastDay(a.now) ?? latest(state), at: a.now ?? null });
const isSlot = (key) => typeof key === 'string' && SLOT_RE.test(key) && GROUPS.includes(groupOf(key));

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
/** The midnight after the latest day the agent has evidence for, in the snapshot's offset: when memoryForget rolls again. null when unknown. */
export function rollTime(ctx, snapshot) {
  const offset = OFFSET.exec(snapshot?.exportDate ?? '');
  return run(ctx, (state) => {
    const days = Object.keys(state.evidence).sort();
    return offset && days.length > 0 ? `${addDays(days[days.length - 1], 1)}T00:00:00${offset[1]}` : null;
  });
}
// Forget a day. With the snapshot, every later evidence day is computed again without the day and the memories follow the new evidence.
// `forget` is { day, snapshot? }.
function forgetOne(ctx, state, forget) {
  const { day, snapshot } = forget;
  const offset = OFFSET.exec(snapshot?.exportDate ?? '');
  if (!offset) return forgetDay(state, day);
  const days = Object.keys(state.evidence).filter((d) => d > day).sort();
  for (const d of days) {
    const now = `${addDays(d, 1)}T00:00:00${offset[1]}`;
    record(ctx, state, { snapshot: { ...snapshot, exportDate: now }, now, day: d, trim: false });
  }
  return forgetDayRecomputed(state, day, days);
}

/** What the agent does when the person forgets through memoryForget: a day and "everything" are deleted, a stopped line is rejected. true when done. */
export function onForget(ctx, a) {
  return run(ctx, (state) => {
    if (a.what === 'day') return forgetOne(ctx, state, { day: a.date ?? a.day, snapshot: a.snapshot });
    if (a.what === 'key' && a.type === 'daily') return forgetDay(state, a.key);
    if (a.what === 'key') return stopSlots(state, storeKeySlots(a.type, a.key), stamp(state, a)) || true;
    if (a.what === 'type') return TYPE_SLOTS[a.type] ? forgetSlots(state, TYPE_SLOTS[a.type]) : true;
    if (a.what === 'derived') { wipe(state); state.off = true; return true; }
    if (a.what === 'stop') return stopSlots(state, isSlot(a.key) ? [a.key] : slotsOfBriefKey(a.key), stamp(state, a));
    return true;
  });
}
export function onRestore(ctx, a) {
  return run(ctx, (state) => {
    if (a.what === 'derived') { state.off = isOff(ctx.store); return true; }
    if (a.what === 'key') return restoreSlots(state, storeKeySlots(a.type, a.key), stamp(state, a)) || true;
    if (a.what === 'stop') return restoreSlots(state, isSlot(a.key) ? [a.key] : slotsOfBriefKey(a.key), stamp(state, a));
    return true;
  });
}
