// Trusted constructors. The store accepts only the objects made here; it never accepts free text.
//
// Fact kinds (each is rendered from a template; every field is a number, a date or an allowlisted word,
// and each constructor also checks the numbers against each other):
// --- Preference part (tap, accept, standing, change, history). Provisional: what the user can say or tap is not decided; see docs/PREFERENCE.md
//   tap       Declined 1 run suggested for Wed 07:00 as too early (recommendation rec_00000001)
//   decline   Declined 1 run suggested for Wed 07:00 (recommendation rec_00000001, no reason given)   no reason: counted, never promoted
//   earlier   Earlier: 12 declines as too early | Earlier: 5 declines with no reason given | Earlier: 3 accepts   older feedback folded into a count
//   accept    Accepted 1 run suggested for Wed 07:00 (recommendation rec_00000001)   counted separately; never promoted
//   standing  Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)   count >= 2; the latest min(count, 5) taps by time
//             ... as too early since 2026-11-18T17:00:00.000Z (...)   when a change happened for that reason: counts only taps after that UTC moment
//   change    At the change on 2026-11-18T10:00:00.000Z: 2 declines as too early moved to history; new count starts at 0   one per change
//   history   Recorded 2 declines as too early; changed on 2026-11-18T10:00:00.000Z (reason given: schedule change)   one per change
// --- Derived-facts part (daily, weekly, profile, mix, coverage, thin): independent of the preference part.
//   daily     [daily] 2026-10-01: Running 40 min, Walking 30 min         distinct activities, 1 to 1440 min each, day total <= 1440
//   weekly    [weekly] Week of 2026-09-28: 3 workouts, 120 min           week starts on a Monday; minutes <= 10080
//   profile   4-week average: 3 workouts per week (as of 2026-11-18, valid until 2026-11-19)   count / 4 (quarters only); valid until = the next day
//   mix       Last 4 weeks by type: Running 6, Walking 4 (as of 2026-11-18)
//   coverage  Workouts logged on 5 of the 28 days ending 2026-11-17     window is 7, 28 or 84 days; 0 <= logged <= window; anchored to its end date
//   thin      Days of data: 9 (ending 2026-11-17)                       a neutral count, 0 to 999; anchored to its end date
// --- Engine facts (today, week, load, regularity, body): the sentence is written by the fact engine (src/facts) and checked
//     here against the engine's own templates, so there is one wording. Ids and homes: COMPUTED below. The engine's
//     history.thin, coverage.28d and mix.count are not stored: thin, coverage and mix above say the same with the store's wording.
// Every fact type has exactly one home file (FILE_KINDS[kind].facts): profile holds the per-week average and the mix;
// rolling holds daily, weekly, coverage and thin; preferences hold standing and change; feedback holds taps; history holds history.
// Each sentence carries its own measurement (a count, minutes, an average); dates, ids and times are not measurements.
// Source kinds: tap, standing, change, history, roll.
// File paths are fixed per file kind (FILE_KINDS[kind].path); no caller supplies a path or a file name.
// Ids: recommendation ids are rec_ + 8 to 32 lowercase hex; user ids are usr_ + 8 to 32 lowercase hex.
// Numbers are rendered exactly (up to 2 decimals); a value that needs more is refused. Nothing is rounded.
// Every definition here is deep-frozen. Inputs are copied once before use, so a caller cannot change them mid-way.

import { lintFact, ACTIVITY_LABELS_ALL } from '../facts/lint.mjs';

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

export const REASONS = deepFreeze({
  too_early: 'too early', too_late: 'too late', too_long: 'too long', too_hard: 'too hard', not_today: 'not today',
});
export const WHY = deepFreeze({
  schedule_change: 'schedule change', health_change: 'health change', goal_change: 'goal change', other: 'other',
});
export const ACTIVITIES = deepFreeze(['run', 'walk', 'cycle', 'swim', 'strength', 'yoga', 'hike', 'row', 'elliptical', 'hiit', 'pilates', 'dance']);
export const ROLL_ACTIVITIES = deepFreeze(['Running', 'Walking', 'Cycling', 'Swimming', 'Strength training', 'Yoga', 'Hiking', 'Rowing', 'Elliptical', 'HIIT', 'Pilates', 'Dance', 'Other']);
export const DAYS = deepFreeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
export const DERIVED_KINDS = deepFreeze(['profile', 'rolling']);
/**
 * The closed list of derived fact types that can be forgotten or suppressed (one place; the roll and the fact engine extend it).
 * `home` is the derived file kind that holds the type; `keyed` says what one line of it is keyed by (a date, a week start,
 * an activity, a fixed slot such as `running.sun.08`, a body metric: `sleep` or `resting_hr`) or null when the type is one line per file. Types with no constructor yet (today, week, load,
 * regularity, body) can already be suppressed so the engine can skip them.
 */
export const DERIVED_FACT_TYPES = deepFreeze({
  daily: { home: 'rolling', keyed: 'date' },
  weekly: { home: 'rolling', keyed: 'date' },
  coverage: { home: 'rolling', keyed: null },
  thin: { home: 'rolling', keyed: null },
  today: { home: 'rolling', keyed: null },
  week: { home: 'rolling', keyed: null },
  profile: { home: 'profile', keyed: null },
  mix: { home: 'profile', keyed: 'activity' },
  load: { home: 'profile', keyed: null },
  regularity: { home: 'profile', keyed: 'slot' },
  body: { home: 'profile', keyed: 'metric' },
});
export const FILE_KINDS = deepFreeze({
  profile: { tier: 'pinned', summary: 'Pinned user facts', title: 'Profile', path: 'about-user/profile.md', facts: ['profile', 'mix', 'load', 'regularity', 'body'] },
  rolling: { tier: 'pinned', summary: 'Rolling workout summaries: daily 28 days, weekly 12 weeks', title: 'Rolling summaries', path: 'health/rolling.md', facts: ['daily', 'weekly', 'coverage', 'thin', 'today', 'week'] },
  preferences: { tier: 'pinned', summary: 'Standing workout preferences', title: 'Workout preferences', path: 'preferences/workouts.md', facts: ['standing', 'change'] },
  feedback: { tier: 'hot', summary: 'What the user said about recommendations', title: 'Recommendation feedback', path: 'feedback/recommendations.md', facts: ['tap', 'decline', 'accept', 'earlier'] },
  history: { tier: 'cold', summary: 'Preference history', title: 'Preference history', path: 'history/preferences.md', facts: ['history'] },
});

/** The store type of each engine fact id that is stored as written by the engine (see the table in the header). */
export const COMPUTED = deepFreeze({
  'volume.today': 'today', 'volume.today_so_far': 'today', 'volume.today_unlogged': 'today',
  'past.today_vs_avg': 'today', 'past.today_vs_highest': 'today', 'past.today_rank': 'today',
  'volume.week': 'week', 'volume.28d': 'week', 'past.week_vs_avg': 'week', 'past.week_rank': 'week',
  'past.week_comparisons_skipped': 'week', 'goal.workouts_per_week': 'week', 'goal.target_progress': 'week',
  'load.ratio': 'load',
  'regularity.days_since_last': 'regularity', 'regularity.longest_gap': 'regularity', 'regularity.per_week': 'regularity',
  'regularity.slot': 'regularity', 'regularity.slots_none': 'regularity', 'mix.median_length': 'regularity', 'mix.start_bands': 'regularity',
  'body.sleep': 'body', 'body.resting_hr': 'body',
});

const TRUST = new WeakSet();
const mint = (o) => { Object.freeze(o); TRUST.add(o); return o; };
export const isFact = (x) => x !== null && typeof x === 'object' && TRUST.has(x) && x.cls === 'fact';
export const isSource = (x) => x !== null && typeof x === 'object' && TRUST.has(x) && x.cls === 'source';

const bad = (what) => { throw new TypeError(`invalid ${what}`); };
const int = (n, lo, hi, what) => (Number.isInteger(n) && n >= lo && n <= hi ? n : bad(what));
const member = (v, list, what) => (typeof v === 'string' && list.includes(v) ? v : bad(what));
const key = (v, table, what) => (typeof v === 'string' && Object.hasOwn(table, v) ? v : bad(what));
const list = (a, lo, hi, what) => (Array.isArray(a) && a.length >= lo && a.length <= hi ? [...a] : bad(what));
export function dateStr(s, what = 'date') {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) bad(what);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? bad(what) : s;
}
/** Whether `key` is a well-formed key for this keyed type (a real date, or an activity from the allowlist). */
export function validKey(typeId, key) {
  const how = Object.hasOwn(DERIVED_FACT_TYPES, typeId) ? DERIVED_FACT_TYPES[typeId].keyed : null;
  if (how === 'date') { try { dateStr(key); return true; } catch { return false; } }
  if (how === 'activity') return typeof key === 'string' && ROLL_ACTIVITIES.includes(key);
  if (how === 'slot') { const m = typeof key === 'string' ? SLOT_KEY.exec(key) : null; return m !== null && SLOT_LABELS.includes(m[1]); }
  if (how === 'metric') return key === 'sleep' || key === 'resting_hr';
  return false;
}
// A fixed slot's key: the activity label with underscores, the weekday and the start hour, lower case: `strength_training.tue.18`.
const SLOT_LABELS = ACTIVITY_LABELS_ALL.map((l) => l.replace(/ /g, '_'));
const SLOT_KEY = /^([a-z_]+)\.(mon|tue|wed|thu|fri|sat|sun)\.([01]\d|2[0-3])$/;
const SLOT_TEXT = /^Fixed slot among recognised activities: ([a-z ]+) on (Sun|Mon|Tue|Wed|Thu|Fri|Sat) between (\d{2}):00 and /;
/** The key one stored line of a slot- or metric-keyed type can be stopped by (`running.sun.08`, `sleep`, `resting_hr`), or null. */
export function stopKeyOf(f) {
  if (f.kind === 'body') return f.key === 'computed:body.sleep' ? 'sleep' : f.key === 'computed:body.resting_hr' ? 'resting_hr' : null;
  if (f.kind !== 'regularity') return null;
  const m = SLOT_TEXT.exec(f.text);
  return m ? `${m[1].replace(/ /g, '_')}.${m[2].toLowerCase()}.${m[3]}` : null;
}
/** A UTC timestamp with milliseconds, exactly as Date#toISOString writes it. */
export function isoMs(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) || Number.isNaN(Date.parse(x)) || new Date(x).toISOString() !== x) bad('time');
  return x;
}
const dayMs = (s) => Date.parse(`${s}T00:00:00Z`);
const addDays = (date, n) => new Date(dayMs(date) + n * 86400000).toISOString().slice(0, 10);
/**
 * The date range an aggregate fact covers, and the forgotten days its computation left out (`excludedDays`; not in the text).
 * The store refuses a new aggregate whose range holds a forgotten day that is not listed as excluded.
 */
const agg = (lo, hi, days, count, room = Infinity) => {
  const ex = days === undefined || days === null ? [] : list(days, 0, 400, 'excludedDays').map((d) => dateStr(d)).sort();
  if (new Set(ex).size !== ex.length || ex.some((d) => d < lo || d > hi)) bad('excludedDays (unique, inside the range)');
  // A stored line says only how many days were left out (never which); a new one is built from the dates themselves.
  const n = days === undefined || days === null ? (count === undefined ? 0 : int(count, 0, 400, 'excluded days')) : ex.length;
  if (days !== undefined && days !== null && count !== undefined && count !== ex.length) bad('excluded days');
  // Never more days left out than the window holds, or than the measurement can have counted (`room`).
  const span = lo < '0001' ? Infinity : Math.round((dayMs(hi) - dayMs(lo)) / 86400000) + 1;
  if (n > Math.min(span, room)) bad('excluded days (more than the window or the measurement allows)');
  return { range: Object.freeze([lo, hi]), excludedDays: Object.freeze(ex), excludedCount: n };
};
/** The tail of every aggregate that left forgotten days out: a count only, never the date. */
const leftOut = (n) => (n === 0 ? '' : ` (${n} forgotten day${n === 1 ? '' : 's'} left out)`);
export function isoTime(x) {
  if (x instanceof Date) return Number.isNaN(x.getTime()) ? bad('time') : x.toISOString();
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x) || Number.isNaN(Date.parse(x))) bad('time');
  return x;
}
export const REC_ID = '^rec_[0-9a-f]{8,32}$';
export const USER_ID = '^usr_[0-9a-f]{8,32}$';
const REC = 'rec_[0-9a-f]{8,32}';
export const recId = (id) => (typeof id === 'string' && new RegExp(REC_ID).test(id) ? id : bad('recommendation id'));
const slotText = (weekday, hour) => `${DAYS[int(weekday, 1, 7, 'weekday') - 1]} ${String(int(hour, 0, 23, 'hour')).padStart(2, '0')}:00`;
const exact = (n, hi, what) => (typeof n === 'number' && n >= 0 && n <= hi && /^\d{1,3}(?:\.\d{1,2})?$/.test(String(n)) ? n : bad(what));

function standingBody(reason0, count0, slots0, since0) {
  const reason = key(reason0, REASONS, 'reason');
  const count = int(count0, 2, 9999, 'count');
  const slots = list(slots0, 1, 5, 'slots').map((s) => ({ weekday: s?.weekday, hour: s?.hour }));
  if (slots.length > Math.min(count, 5)) bad('slots');
  const prefix = count > slots.length ? `latest ${slots.length}: ` : '';
  const since = since0 === undefined || since0 === null ? '' : ` since ${isoMs(since0)}`;
  return `Declined ${count} suggestions as ${REASONS[reason]}${since} (${prefix}${slots.map((s) => slotText(s.weekday, s.hour)).join('; ')})`;
}

// `key` identifies what a fact states; a file may hold only one fact per key (one value per window, date, week, ...).
const fact = (kind, text, fields = {}) => mint({ cls: 'fact', kind, text, key: text, ...fields });

export const F = Object.freeze({
  tap: (a) => {
    const { recId: id, activity, weekday, hour, reason } = a ?? {};
    return fact('tap', `Declined 1 ${member(activity, ACTIVITIES, 'activity')} suggested for ${slotText(weekday, hour)} as ${REASONS[key(reason, REASONS, 'reason')]} (recommendation ${recId(id)})`, { reason, key: `tap:${id}` });
  },
  // A decline with no reason (one tap on the watch): one outcome per recommendation id, never counted towards a standing entry.
  decline: (a) => {
    const { recId: id, activity, weekday, hour } = a ?? {};
    return fact('decline', `Declined 1 ${member(activity, ACTIVITIES, 'activity')} suggested for ${slotText(weekday, hour)} (recommendation ${recId(id)}, no reason given)`, { key: `tap:${id}` });
  },
  // Older feedback folded into one count per action and reason; the recommendation ids are kept in its source.
  earlier: (a) => {
    const { action, reason, count } = a ?? {};
    const n = int(count, 1, 99999999, 'count');
    if (action === 'accepted') return fact('earlier', `Earlier: ${n} accepts`, { key: 'earlier:accept' });
    if (action !== 'declined') bad('action');
    if (reason === undefined || reason === null) return fact('earlier', `Earlier: ${n} declines with no reason given`, { key: 'earlier:decline:none' });
    return fact('earlier', `Earlier: ${n} declines as ${REASONS[key(reason, REASONS, 'reason')]}`, { reason, key: `earlier:decline:${reason}` });
  },
  // An accepted recommendation: one outcome per recommendation id (it shares the tap key), no reason, never counted towards a standing entry.
  accept: (a) => {
    const { recId: id, activity, weekday, hour } = a ?? {};
    return fact('accept', `Accepted 1 ${member(activity, ACTIVITIES, 'activity')} suggested for ${slotText(weekday, hour)} (recommendation ${recId(id)})`, { key: `tap:${id}` });
  },
  standing: (a) => { const { reason, count, slots, since } = a ?? {}; return fact('standing', standingBody(reason, count, slots, since), { reason, key: `standing:${reason}` }); },
  // Anchored to the moment of the change: a later decline does not make this sentence false.
  change: (a) => {
    const { reason, at, count } = a ?? {};
    return fact('change', `At the change on ${isoMs(at)}: ${int(count, 1, 9999, 'count')} declines as ${REASONS[key(reason, REASONS, 'reason')]} moved to history; new count starts at 0`, { reason });
  },
  // States what was recorded and when it changed; it does not claim the preference stayed true until then.
  history: (a) => {
    const { reason, count, at, why } = a ?? {};
    return fact('history', `Recorded ${int(count, 1, 9999, 'count')} declines as ${REASONS[key(reason, REASONS, 'reason')]}; changed on ${isoMs(at)} (reason given: ${WHY[key(why, WHY, 'why')]})`, { reason });
  },
  // An engine sentence for one engine fact id. It states data up to now, so a forgotten day must be named in excludedDays.
  computed: (a) => {
    const { id, text, excludedDays } = a ?? {};
    const tid = typeof id === 'string' && id.startsWith('regularity.slot.') ? 'regularity.slot' : id;
    const type = typeof tid === 'string' && Object.hasOwn(COMPUTED, tid) ? COMPUTED[tid] : bad('fact id');
    if (typeof text !== 'string' || lintFact(text, { id: tid }).length > 0) bad('engine fact text');
    const same = tid.startsWith('volume.today') ? 'volume.today' : tid;        // the three volume.today variants share one slot
    return fact(type, text, { key: `computed:${tid === 'regularity.slot' ? text : same}`, ...agg('0000-01-01', '9999-12-31', excludedDays, undefined) });
  },
  daily: (a) => {
    const { date, items } = a ?? {};
    const rows = list(items, 1, 12, 'items').map((i) => ({ activity: i?.activity, minutes: i?.minutes }));
    for (const r of rows) { member(r.activity, ROLL_ACTIVITIES, 'activity'); int(r.minutes, 1, 1440, 'minutes'); }
    rows.sort((x, y) => (x.activity < y.activity ? -1 : x.activity > y.activity ? 1 : 0));         // canonical: by activity name
    if (new Set(rows.map((r) => r.activity)).size !== rows.length) bad('items');
    if (rows.reduce((n, r) => n + r.minutes, 0) > 1440) bad('minutes in a day');
    return fact('daily', `[daily] ${dateStr(date)}: ${rows.map((r) => `${r.activity} ${r.minutes} min`).join(', ')}`, { key: `daily:${date}` });
  },
  weekly: (a) => {
    const { weekStart, count, minutes, excludedDays, excludedCount } = a ?? {};
    dateStr(weekStart);
    if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) bad('week start (must be a Monday)');
    int(count, 0, 99, 'count'); int(minutes, 0, 10080, 'minutes');
    if ((count === 0) !== (minutes === 0) || minutes < count) bad('week totals');
    const base = `[weekly] Week of ${weekStart}: ${count} workouts, ${minutes} min`;
    const g = agg(weekStart, addDays(weekStart, 6), excludedDays, excludedCount, 7);
    // A left-out day is an unlogged one: the totals fit in the days that remain (none left: no workouts, no minutes).
    if (minutes > 1440 * (7 - g.excludedCount)) bad('week totals (more minutes than the remaining days hold)');
    return fact('weekly', `${base}${leftOut(g.excludedCount)}`, { key: `weekly:${weekStart}`, ...g });
  },
  profile: (a) => {
    const { perWeek: given, workouts, asOf, validUntil, excludedDays, excludedCount } = a ?? {};
    // The average is a whole number of workouts over the 28-day window (4 weeks; a left-out day counts as unlogged): count / 4.
    if (workouts !== undefined && given !== undefined && given !== workouts / 4) bad('per week (does not match the workout count)');
    const perWeek = workouts !== undefined ? int(workouts, 0, 399, 'workouts') / 4 : given;
    exact(perWeek, 99.99, 'per week');
    if (!Number.isInteger(perWeek * 4)) bad('per week (a whole number of workouts over 4 weeks gives quarters)');
    dateStr(asOf); dateStr(validUntil);
    if (dayMs(validUntil) - dayMs(asOf) !== 86400000) bad('valid until (must be the next day)');
    const g = agg(addDays(asOf, -27), asOf, excludedDays, excludedCount);
    return fact('profile', `4-week average: ${perWeek} workouts per week (as of ${asOf}, valid until ${validUntil})${leftOut(g.excludedCount)}`, { key: 'profile', ...g });
  },
  mix: (a) => {
    const { items, asOf, excludedDays, excludedCount } = a ?? {};
    const rows = list(items, 1, 13, 'items').map((i) => ({ activity: i?.activity, count: i?.count }));
    for (const r of rows) { member(r.activity, ROLL_ACTIVITIES, 'activity'); int(r.count, 1, 999, 'count'); }
    if (new Set(rows.map((r) => r.activity)).size !== rows.length) bad('items');
    rows.sort((x, y) => (x.activity < y.activity ? -1 : x.activity > y.activity ? 1 : 0));         // canonical: by activity name
    const g = agg(addDays(dateStr(asOf), -27), asOf, excludedDays, excludedCount);
    return fact('mix', `Last 4 weeks by type: ${rows.map((r) => `${r.activity} ${r.count}`).join(', ')} (as of ${asOf})${leftOut(g.excludedCount)}`, { key: 'mix', asOf, ...g, items: Object.freeze(rows.map((r) => Object.freeze({ ...r }))), activities: Object.freeze(rows.map((r) => r.activity)) });
  },
  coverage: (a) => {
    const { workoutDays, windowDays, endDate, excludedDays, excludedCount } = a ?? {};
    if (![7, 28, 84].includes(windowDays)) bad('window');
    const logged = int(workoutDays, 0, windowDays, 'days');
    // A day left out is not a logged one: logged days plus left-out days cannot exceed the window.
    const g = agg(addDays(dateStr(endDate), -(windowDays - 1)), endDate, excludedDays, excludedCount, windowDays - logged);
    return fact('coverage', `Workouts logged on ${logged} of the ${windowDays} days ending ${endDate}${leftOut(g.excludedCount)}`, { key: `coverage:${windowDays}`, ...g });
  },
  // Days of data covers every day up to its end date, so its range starts at the beginning of time.
  thin: (a) => {
    const { days, endDate, excludedDays, excludedCount } = a ?? {};
    const g = agg('0000-01-01', dateStr(endDate), excludedDays, excludedCount);
    return fact('thin', `Days of data: ${int(days, 0, 999, 'days')} (ending ${endDate})${leftOut(g.excludedCount)}`, { key: 'thin', ...g });
  },
});

const source = (id, type, ref, at, excerpt, ids) => mint({
  cls: 'source',
  text: `[${id}] type=${type}; ref=${ref}; observed_at=${isoTime(at)}${excerpt ? `; excerpt=${excerpt}` : ''}${ids ? `; ids=${ids.join(',')}` : ''}`,
});
// The recommendation ids a history entry aggregated: a non-empty, sorted, duplicate-free list (so each can be found and forgotten). No cap.
const sortedUnique = (ids) => { const out = [...ids].sort(); return out.every((x, i) => i === 0 || out[i - 1] < x) ? out : bad('ids (unique)'); };   // canonical order: sorted
const idList = (a) => sortedUnique(list(a, 1, 10000000, 'ids').map(recId));
/** The ids a fold holds, each with its observed time to the millisecond: `rec_...@2026-11-01T09:00:00.000Z`, sorted by id. */
const idTimeList = (a) => {
  const rows = list(a, 1, 10000000, 'ids').map((x) => ({ id: recId(x?.id), at: x?.at instanceof Date ? x.at.getTime() : x?.at }));
  sortedUnique(rows.map((r) => r.id));
  return rows.sort((x, y) => (x.id < y.id ? -1 : 1)).map((r) => `${r.id}@${isoTime(new Date(r.at))}`);
};
export const S = Object.freeze({
  tap: (a) => { const { recId: id, reason, at } = a ?? {}; return source(`S${recId(id)}`, 'feedback', `recommendation:${recId(id)}`, at, key(reason, REASONS, 'reason')); },
  accept: (a) => { const { recId: id, at } = a ?? {}; return source(`S${recId(id)}`, 'feedback', `recommendation:${recId(id)}`, at); },
  earlier: (a) => {
    const { code, ids, at } = a ?? {};
    if (code !== 'accept' && code !== 'none' && !Object.hasOwn(REASONS, code)) bad('code');
    return source(`E-${code}`, 'feedback', 'feedback/recommendations.md', at, undefined, idTimeList(ids));
  },
  standing: (a) => { const { reason, at } = a ?? {}; return source(`P-${key(reason, REASONS, 'reason')}`, 'feedback', 'feedback/recommendations.md', at); },
  change: (a) => { const { reason, at } = a ?? {}; return source(`C-${key(reason, REASONS, 'reason')}`, 'chat', `preference_change:${reason}`, at); },
  history: (a) => {
    const { reason, changedAt, why, ids, at } = a ?? {};
    return source(`H-${key(reason, REASONS, 'reason')}`, 'chat', `history:${reason}:${isoMs(changedAt)}:${key(why, WHY, 'why')}`, at, undefined, idList(ids));
  },
  roll: (a) => { const { date, at } = a ?? {}; return source('S-roll', 'health_snapshot', `daily_roll:${dateStr(date)}`, at); },
});

// ---- reading: a stored line is accepted only if a constructor, given the fields parsed from it, renders it again exactly ----
const WORDS = Object.values(REASONS).join('|');
const WHYW = Object.values(WHY).join('|');
const DAY = DAYS.join('|');
const SLOT = `(?:${DAY}) \\d\\d:00`;
const SLOTS = `${SLOT}(?:; ${SLOT})*`;
const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const ACT = ROLL_ACTIVITIES.join('|');
const reasonKey = (w) => Object.keys(REASONS).find((k) => REASONS[k] === w);
const whyKey = (w) => Object.keys(WHY).find((k) => WHY[k] === w);
const slotsOf = (str) => str.split('; ').map((s) => ({ weekday: DAYS.indexOf(s.slice(0, 3)) + 1, hour: Number(s.slice(4, 6)) }));
const STAND = `Declined (\\d{1,4}) suggestions as (${WORDS})(?: since (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z))? \\((?:latest \\d: )?(${SLOTS})\\)`;
const LEFT = '(?: \\((\\d{1,3}) forgotten days? left out\\))?$';
const PARSERS = [
  [new RegExp(`^Declined 1 (${ACTIVITIES.join('|')}) suggested for (${DAY}) (\\d\\d):00 as (${WORDS}) \\(recommendation (${REC})\\)$`),
    (m) => F.tap({ recId: m[5], activity: m[1], weekday: DAYS.indexOf(m[2]) + 1, hour: Number(m[3]), reason: reasonKey(m[4]) })],
  [new RegExp(`^Declined 1 (${ACTIVITIES.join('|')}) suggested for (${DAY}) (\\d\\d):00 \\(recommendation (${REC}), no reason given\\)$`),
    (m) => F.decline({ recId: m[4], activity: m[1], weekday: DAYS.indexOf(m[2]) + 1, hour: Number(m[3]) })],
  [new RegExp(`^Earlier: (\\d{1,8}) (accepts|declines with no reason given|declines as (${WORDS}))$`),
    (m) => F.earlier(m[2] === 'accepts' ? { action: 'accepted', count: Number(m[1]) } : { action: 'declined', count: Number(m[1]), reason: m[3] ? reasonKey(m[3]) : undefined })],
  [new RegExp(`^Accepted 1 (${ACTIVITIES.join('|')}) suggested for (${DAY}) (\\d\\d):00 \\(recommendation (${REC})\\)$`),
    (m) => F.accept({ recId: m[4], activity: m[1], weekday: DAYS.indexOf(m[2]) + 1, hour: Number(m[3]) })],
  [new RegExp(`^${STAND}$`), (m) => F.standing({ reason: reasonKey(m[2]), count: Number(m[1]), since: m[3], slots: slotsOf(m[4]) })],
  [new RegExp(`^At the change on (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z): (\\d{1,4}) declines as (${WORDS}) moved to history; new count starts at 0$`),
    (m) => F.change({ at: m[1], count: Number(m[2]), reason: reasonKey(m[3]) })],
  [new RegExp(`^Recorded (\\d{1,4}) declines as (${WORDS}); changed on (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z) \\(reason given: (${WHYW})\\)$`),
    (m) => F.history({ reason: reasonKey(m[2]), count: Number(m[1]), at: m[3], why: whyKey(m[4]) })],
  [new RegExp(`^\\[daily\\] ${DATE}: ((?:${ACT}) \\d{1,4} min(?:, (?:${ACT}) \\d{1,4} min)*)$`),
    (m) => F.daily({ date: m[1], items: m[2].split(', ').map((x) => { const r = /^(.+) (\d+) min$/.exec(x); return { activity: r[1], minutes: Number(r[2]) }; }) })],
  [new RegExp(`^\\[weekly\\] Week of ${DATE}: (\\d{1,3}) workouts, (\\d{1,5}) min${LEFT}`),
    (m) => F.weekly({ weekStart: m[1], count: Number(m[2]), minutes: Number(m[3]), excludedCount: Number(m[4] ?? 0) })],
  [new RegExp(`^4-week average: (\\d{1,3}(?:\\.\\d{1,2})?) workouts per week \\(as of ${DATE}, valid until ${DATE}\\)${LEFT}`),
    (m) => F.profile({ perWeek: Number(m[1]), asOf: m[2], validUntil: m[3], excludedCount: Number(m[4] ?? 0) })],
  [new RegExp(`^Last 4 weeks by type: ((?:${ACT}) \\d{1,3}(?:, (?:${ACT}) \\d{1,3})*) \\(as of ${DATE}\\)${LEFT}`),
    (m) => F.mix({ asOf: m[2], excludedCount: Number(m[3] ?? 0), items: m[1].split(', ').map((x) => { const r = /^(.+) (\d+)$/.exec(x); return { activity: r[1], count: Number(r[2]) }; }) })],
  [new RegExp(`^Workouts logged on (\\d{1,2}) of the (\\d{1,3}) days ending ${DATE}${LEFT}`), (m) => F.coverage({ workoutDays: Number(m[1]), windowDays: Number(m[2]), endDate: m[3], excludedCount: Number(m[4] ?? 0) })],
  [new RegExp(`^Days of data: (\\d{1,3}) \\(ending ${DATE}\\)${LEFT}`), (m) => F.thin({ days: Number(m[1]), endDate: m[2], excludedCount: Number(m[3] ?? 0) })],
];

const computedFrom = (text) => {
  const id = Object.keys(COMPUTED).find((i) => lintFact(text, { id: i }).length === 0);
  return id === undefined ? null : F.computed({ id, text });
};

/** The fact object for a stored line, or null when no constructor would produce exactly this line. */
export function reconstructFact(text) {
  if (typeof text !== 'string') return null;
  for (const [re, build] of PARSERS) {
    const m = re.exec(text);
    if (!m) continue;
    try { const f = build(m); return f.text === text ? f : null; } catch { return null; }
  }
  try { return computedFrom(text); } catch { return null; }
}

const ISO = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)';
const SRC_RE = new RegExp(`^\\[(S-roll|S${REC}|[PCH]-(?:${Object.keys(REASONS).join('|')})|E-(?:accept|none|${Object.keys(REASONS).join('|')}))\\] type=([a-z_]+); ref=(\\S+); observed_at=${ISO}(?:; excerpt=(${Object.keys(REASONS).join('|')}))?(?:; ids=((?:${REC}@\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)(?:,${REC}@\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)*|${REC}(?:,${REC})*))?$`);
export function reconstructSource(text) {
  if (typeof text !== 'string') return null;
  const m = SRC_RE.exec(text);
  if (!m) return null;
  const [, id, , ref, at, excerpt, ids] = m;
  try {
    let s;
    if (id === 'S-roll') s = S.roll({ date: ref.replace('daily_roll:', ''), at });
    else if (id.startsWith('Srec_')) s = excerpt === undefined ? S.accept({ recId: id.slice(1), at }) : S.tap({ recId: id.slice(1), reason: excerpt, at });
    else if (id[0] === 'E') s = S.earlier({ code: id.slice(2), ids: ids?.split(',').map((x) => ({ id: x.split('@')[0], at: Date.parse(x.split('@')[1]) })), at });
    else if (id[0] === 'P') s = S.standing({ reason: id.slice(2), at });
    else if (id[0] === 'C') s = S.change({ reason: id.slice(2), at });
    else {
      const h = /^history:([a-z_]+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):([a-z_]+)$/.exec(ref);
      s = S.history({ reason: id.slice(2), changedAt: h[2], why: h[3], ids: ids?.split(','), at });
    }
    return s.text === text ? s : null;
  } catch { return null; }
}

export const classifyFact = (text) => reconstructFact(text)?.kind ?? null;
export const classifySource = (text) => (reconstructSource(text) ? 'source' : null);

export function parseDecline(text) {
  const m = new RegExp(`^Declined 1 (${ACTIVITIES.join('|')}) suggested for (${DAY}) (\\d\\d):00 \\(recommendation (${REC}), no reason given\\)$`).exec(text);
  return m ? { activity: m[1], weekday: DAYS.indexOf(m[2]) + 1, hour: Number(m[3]), recId: m[4] } : null;
}
export function parseAccept(text) {
  const m = new RegExp(`^Accepted 1 (${ACTIVITIES.join('|')}) suggested for (${DAY}) (\\d\\d):00 \\(recommendation (${REC})\\)$`).exec(text);
  return m ? { activity: m[1], weekday: DAYS.indexOf(m[2]) + 1, hour: Number(m[3]), recId: m[4] } : null;
}
export function parseStanding(text) {
  const m = new RegExp(`^${STAND}$`).exec(text);
  return m ? { reason: reasonKey(m[2]), count: Number(m[1]), since: m[3] ?? null, slots: slotsOf(m[4]) } : null;
}
export function parseTap(text) {
  const m = new RegExp(`^Declined 1 (${ACTIVITIES.join('|')}) suggested for (${DAY}) (\\d\\d):00 as (${WORDS}) \\((?:recommendation )(${REC})\\)$`).exec(text);
  return m ? { activity: m[1], weekday: DAYS.indexOf(m[2]) + 1, hour: Number(m[3]), reason: reasonKey(m[4]), recId: m[5] } : null;
}
