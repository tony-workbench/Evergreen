// The daily roll: turns a health snapshot into the derived memory files (rolling and profile), through the store's public API.
//
//   completed   `now` is a local midnight: facts for the day that just ended, with comparisons.
//   in_progress `now` is inside a day: only the raw "so far today" line is replaced; nothing else is touched.
//
// Same snapshot, same `now`, same store state: the same files. Forgotten days and suppressed fact types or keys are read
// from the store and passed to the engine, so they are never written again. Plain ECMAScript (runs in JavaScriptCore).
import { computeFacts, THIN_DAYS_NEEDED, MIN_WORKOUT_MINUTES } from '../facts/index.mjs';
import { parseTimestamp } from '../contract/index.mjs';
import { F, S, COMPUTED, suppressedTypes, stopKeyOf } from '../store/index.mjs';

const DAY_MS = 86400000;
const DAILY_KEPT = 28;
const WEEKLY_KEPT = 12;
const MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const dayNum = (date) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dayIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const addDays = (date, n) => dayIso(dayNum(date) + n);

// The store's activity names for the engine's raw activity types.
const LABELS = { TraditionalStrengthTraining: 'Strength training', FunctionalStrengthTraining: 'Strength training', HighIntensityIntervalTraining: 'HIIT' };
const SAME = ['Running', 'Walking', 'Cycling', 'Swimming', 'Yoga', 'Hiking', 'Rowing', 'Elliptical', 'Pilates', 'Dance'];
const labelOf = (raw) => LABELS[raw] ?? (SAME.includes(raw) ? raw : 'Other');

/** Counted workouts per local day: ended by `now`, 10 minutes or more, one per activity and instant, forgotten days ignored. */
function countedByDay(snapshot, nowMs, lastDay, forgotten) {
  const gone = new Set(forgotten);
  const days = new Map();
  const seen = new Set();
  for (const w of snapshot.workouts ?? []) {
    const start = parseTimestamp(w.start);
    const end = parseTimestamp(w.end);
    if (!start || !end || end.ms > nowMs || start.date > lastDay || gone.has(start.date)) continue;
    const id = `${w.activityType}|${start.ms}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!(w.durationMin >= MIN_WORKOUT_MINUTES)) continue;
    const day = days.get(start.date) ?? new Map();
    const label = labelOf(w.activityType);
    day.set(label, { minutes: (day.get(label)?.minutes ?? 0) + w.durationMin, count: (day.get(label)?.count ?? 0) + 1 });
    days.set(start.date, day);
  }
  return days;
}

/** Days with any record (a summary or a workout), for the weeks that have data at all. */
function loggedDays(snapshot, lastDay, forgotten) {
  const out = new Set();
  for (const s of snapshot.dailySummaries ?? []) if (s.date <= lastDay) out.add(s.date);
  for (const w of snapshot.workouts ?? []) { const p = parseTimestamp(w.start); if (p && p.date <= lastDay) out.add(p.date); }
  for (const d of forgotten) out.delete(d);
  return out;
}

// What the store forgot or stopped summarising, in the engine's words: store types become the engine ids stored under them.
export function engineSuppression(sup) {
  const types = new Set();
  for (const t of sup.types) {
    for (const id of Object.keys(COMPUTED)) if (COMPUTED[id] === t) types.add(id);
    if (t === 'mix') types.add('mix');
  }
  return { types: [...types].sort(), keys: [] };
}

// Engine facts that are computed but not stored: they are long and repeat what another line says (the 28-day totals are
// the profile average and the coverage line; the rest are detail), and the planner text has a word budget (docs/MEMORY-LOGIC.md).
export const NOT_STORED = ['volume.28d', 'mix.median_length', 'mix.start_bands', 'regularity.per_week', 'regularity.longest_gap', 'regularity.slots_none', 'past.today_rank'];
const storeType = (id) => (id.startsWith('regularity.slot.') ? 'regularity' : COMPUTED[id]);
const stored = (f, types) => !NOT_STORED.includes(f.id) && types.includes(storeType(f.id));

const bySlot = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function dailyLines(days, lastDay, skip) {
  const out = [];
  for (let n = dayNum(lastDay) - (DAILY_KEPT - 1); n <= dayNum(lastDay); n++) {
    const date = dayIso(n);
    const day = days.get(date);
    if (!day || skip.day(date)) continue;
    const items = [...day].map(([activity, v]) => ({ activity, minutes: Math.max(1, Math.round(v.minutes)) }));
    out.push(F.daily({ date, items }));
  }
  return out;
}

function weeklyLines(days, logged, lastDay, skip, within, forgotten) {
  const out = [];
  let monday = addDays(lastDay, -((new Date(`${lastDay}T00:00:00Z`).getUTCDay() + 6) % 7));
  if (addDays(monday, 6) > lastDay) monday = addDays(monday, -7);                   // only complete weeks
  for (let i = 0; i < WEEKLY_KEPT; i++, monday = addDays(monday, -7)) {
    const dates = Array.from({ length: 7 }, (_, k) => addDays(monday, k));
    // A week with an unlogged day is unknown, not a smaller total: only fully logged weeks (forgotten days count as left out) get a line.
    if (!dates.every((d) => logged.has(d) || forgotten.includes(d)) || skip.week(monday)) continue;
    const cells = dates.flatMap((d) => [...(days.get(d) ?? new Map()).values()]);
    out.push(F.weekly({ weekStart: monday, count: cells.reduce((n, c) => n + c.count, 0), minutes: Math.round(cells.reduce((n, c) => n + c.minutes, 0)), excludedDays: within(monday, addDays(monday, 6)) }));
  }
  return out;
}

function mixLine(days, lastDay, skip) {
  const lo = addDays(lastDay, -27);
  const counts = new Map();
  for (let n = dayNum(lo); n <= dayNum(lastDay); n++) {
    for (const [activity, v] of days.get(dayIso(n)) ?? []) counts.set(activity, (counts.get(activity) ?? 0) + v.count);
  }
  const items = [...counts].filter(([activity]) => !skip.mix(activity)).map(([activity, count]) => ({ activity, count }));
  return { items, workouts: [...counts.values()].reduce((a, b) => a + b, 0), lo };
}

/**
 * Roll one day into the store. Returns { ok: true, mode, day, wrote: [files] } or { ok: false, error, wrote }.
 * options: store (a MemoryStore), snapshot, now (ISO with the local offset), mode ('auto' | 'completed' | 'in_progress').
 */
export function rollDay({ store, snapshot, now, mode = 'auto' } = {}) {
  const wrote = [];
  try {
    const midnight = MIDNIGHT.test(now);
    const dayMode = mode === 'auto' ? (midnight ? 'completed' : 'in_progress') : mode;
    const sup = suppressedTypes(store);
    const forgotten = sup.days;
    const facts = computeFacts(snapshot, now, { suppressed: engineSuppression(sup), forgottenDays: forgotten, dayMode });
    const nowIso = new Date(parseTimestamp(now).ms).toISOString();
    const lastDay = dayMode === 'completed' ? addDays(now.slice(0, 10), -1) : now.slice(0, 10);
    const within = (lo, hi) => forgotten.filter((d) => d >= lo && d <= hi);
    const computed = (f) => F.computed({ id: f.id, text: f.text, excludedDays: forgotten });
    // One stopped line (a fixed slot, sleep, resting heart rate) is computed but never written again until it is restored.
    const running = (f) => { const k = stopKeyOf(f); return k === null || !sup.keys.some((x) => x.type === f.kind && x.key === k); };
    const skip = {
      kind: (k) => sup.types.includes(k),
      day: (d) => forgotten.includes(d),
      week: (d) => sup.keys.some((k) => k.type === 'weekly' && k.key === d),
      mix: (a) => sup.keys.some((k) => k.type === 'mix' && k.key === a),
    };
    const put = (kind, list, sources) => {
      if (store.kindSuppressed(kind)) return true;                                    // that whole file was forgotten
      if (!store.replaceFacts(kind, list, sources)) throw new Error(store.lastError ?? `could not write ${kind}`);
      wrote.push(kind);
      return true;
    };

    if (dayMode === 'in_progress') {
      // Only the raw count so far today: the engine writes no comparison, rank or percentage for an unfinished day.
      const today = facts.filter((f) => stored(f, ['today'])).map(computed);
      if (today.length === 0) return { ok: true, mode: dayMode, day: lastDay, wrote };
      const doc = store.read('rolling');
      put('rolling', [...(doc?.facts ?? []).filter((f) => f.kind !== 'today'), ...today], doc?.sources ?? [S.roll({ date: lastDay, at: nowIso })]);
      return { ok: true, mode: dayMode, day: lastDay, wrote };
    }

    const sources = [S.roll({ date: lastDay, at: nowIso })];
    if (facts.length > 0 && facts[0].id === 'history.thin') {
      // Under 14 days of data: the number of days, nothing to compare.
      const days = facts[0].numbers.daysOfData;
      put('rolling', skip.kind('thin') ? [] : [F.thin({ days, endDate: lastDay, excludedDays: within('0000-01-01', lastDay) })], sources);
      put('profile', [], sources);
      return { ok: true, mode: dayMode, day: lastDay, thin: days < THIN_DAYS_NEEDED, wrote };
    }

    const days = countedByDay(snapshot, parseTimestamp(now).ms, lastDay, forgotten);
    const logged = loggedDays(snapshot, lastDay, forgotten);
    const volume28 = facts.find((f) => f.id === 'volume.28d');
    const mix = mixLine(days, lastDay, skip);

    // rolling: lines from earlier rolls stay unless newer ones replace them, then the 28 latest daily and 12 latest weekly remain.
    const fresh = [
      ...(skip.kind('daily') ? [] : dailyLines(days, lastDay, skip)),
      ...(skip.kind('weekly') ? [] : weeklyLines(days, logged, lastDay, skip, within, forgotten)),
    ];
    const have = new Set(fresh.map((f) => f.key));
    const kept = (store.read('rolling')?.facts ?? []).filter((f) => (f.kind === 'daily' || f.kind === 'weekly') && !have.has(f.key)
      && !(f.kind === 'daily' ? skip.day(f.key.slice(6)) : skip.week(f.key.slice(7))));
    const history = [...fresh, ...kept];
    const latest = (kind, n) => history.filter((f) => f.kind === kind).sort(bySlot).slice(-n);
    const rolling = [
      ...latest('daily', DAILY_KEPT), ...latest('weekly', WEEKLY_KEPT),
      ...facts.filter((f) => stored(f, ['today', 'week'])).map(computed),
      // Days with at least one counted workout (a day with only a daily summary is not one).
      ...(volume28 && !skip.kind('coverage') ? [F.coverage({ workoutDays: [...days.keys()].filter((d) => d >= addDays(lastDay, -27) && d <= lastDay).length, windowDays: 28, endDate: lastDay, excludedDays: within(addDays(lastDay, -27), lastDay) })] : []),
    ];
    put('rolling', rolling, sources);

    const profile = [
      ...facts.filter((f) => stored(f, ['load', 'regularity', 'body'])).map(computed).filter(running),
      ...(skip.kind('profile') ? [] : [F.profile({ workouts: mix.workouts, asOf: lastDay, validUntil: addDays(lastDay, 1), excludedDays: within(mix.lo, lastDay) })]),
      ...(skip.kind('mix') || mix.items.length === 0 ? [] : [F.mix({ items: mix.items, asOf: lastDay, excludedDays: within(mix.lo, lastDay) })]),
    ];
    put('profile', profile, sources);
    return { ok: true, mode: dayMode, day: lastDay, thin: false, wrote };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), wrote };
  }
}
