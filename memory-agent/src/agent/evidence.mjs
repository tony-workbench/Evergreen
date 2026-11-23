// Evidence: what the model may cite. It is the fact engine's output for the day that ended plus the outcomes the app
// passes in (planned sessions, done or not). Every item is computed by code: { id, text, numbers, window, slots }.
// `slots` are the memory slots the item can support, each with the row kind and the row data built from the fact's
// numbers, so the table's data never comes from the model. Facts play the role transcripts play in the source project.
import { parseTimestamp } from '../contract/index.mjs';
import { rounded } from '../memory/brief.mjs';
import { activityName } from '../facts/constants.mjs';
import { ACTIVITIES, SUPPORT_WINDOW } from './schema.mjs';

const DAY_MS = 86400000;
export const dayNum = (date) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
export const addDays = (date, n) => new Date((dayNum(date) + n) * DAY_MS).toISOString().slice(0, 10);
export const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayNum(s)) && addDays(s, 0) === s;

// The fact engine's activity types in the shared closed list; anything not named is `other`, with the Health name as its label.
const NAMED = {
  Running: 'run', Walking: 'walk', Cycling: 'ride', Swimming: 'swim', Yoga: 'yoga', Elliptical: 'elliptical', Pilates: 'stretch', Flexibility: 'stretch',
  FunctionalStrengthTraining: 'strength', TraditionalStrengthTraining: 'strength', CoreTraining: 'strength',
};
export const activityOf = (type) => NAMED[type] ?? 'other';
// The usual length of a session when the person's own median is not known.
export const DEFAULT_MINUTES = { run: 45, long_run: 90, walk: 30, strength: 40, yoga: 30, ride: 60, swim: 40, stretch: 15, elliptical: 40, other: 30, rest: 30 };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];      // weekday 0 is Monday
const two = (n) => String(n).padStart(2, '0');
const r2 = (x) => Math.round(x * 100) / 100;

export const BANDS = [
  { id: 'early', until: 8, text: 'before 08:00' },
  { id: 'morning', until: 12, text: 'between 08:00 and 12:00' },
  { id: 'afternoon', until: 17, text: 'between 12:00 and 17:00' },
  { id: 'evening', until: 24, text: 'from 17:00' },
];
const bandOf = (hour) => BANDS.find((b) => hour < b.until);

// Drops the engine's exact fractions: the rounded values are what a sentence may say.
function plainNumbers(numbers) {
  const out = {};
  for (const k of Object.keys(numbers ?? {})) if (k !== 'exact') out[k] = numbers[k];
  return out;
}

/** Evidence items from the fact engine's facts of one completed day. `off` is a list of store fact types that are stopped. */
export function factEvidence(facts, off = []) {
  const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
  const medians = byId['mix.median_length']?.numbers.medianMinutesByActivity ?? {};
  const items = [];
  const add = (f, slots) => items.push({ id: f.id, text: f.text, numbers: plainNumbers(f.numbers), window: f.window, slots });
  for (const f of facts) {
    const n = f.numbers;
    if (f.id.startsWith('regularity.slot.')) {
      const activity = activityOf(n.activityType);
      const weekday = WEEKDAYS.indexOf(n.weekday);
      if (weekday < 0) continue;
      // The usual length: the person's median length of that activity, else the activity's default.
      const minutes = typeof medians[n.activityType] === 'number' ? Math.min(240, Math.max(5, Math.round(medians[n.activityType]))) : DEFAULT_MINUTES[activity];
      const label = activityName(n.activityType);
      const who = activity === 'other' ? `other.${label.replace(/[^a-z0-9]+/g, '_')}` : activity;
      add(f, [{ slot: `routine.${who}.${n.weekday.toLowerCase()}_${two(n.hour)}`, kind: 'usual_slot', data: { activity, weekday, hour: n.hour, minutes, weeksSeen: n.weeks, weeksTotal: 4, ...(activity === 'other' ? { label } : {}) } }]);
    } else if (f.id === 'volume.28d' && !off.includes('profile')) {
      const perWeek = { workoutsPerWeek: r2(n.workouts / 4), minutesPerWeek: r2(n.minutes / 4) };
      items.push({
        id: 'volume.per_week', window: '28d', numbers: { from: n.from, to: n.to, ...perWeek },
        text: `4-week average: ${perWeek.workoutsPerWeek} workouts and ${perWeek.minutesPerWeek} workout minutes per week (${n.from} to ${n.to}).`,
        slots: [{ slot: 'routine.weekly_volume', kind: 'weekly_volume', data: perWeek }],
      });
    } else if (f.id === 'load.ratio' && typeof n.ratio === 'number') {
      const minutes7d = n.basis === 'minutes' ? n.load7 : byId['volume.week']?.numbers.minutes;
      if (typeof minutes7d === 'number') add(f, [{ slot: 'load.week', kind: 'load', data: { minutes7d, ratioToUsual: n.ratio } }]);
    } else if (f.id === 'body.sleep') {
      add(f, [{ slot: 'body.sleep', kind: 'sleep', data: { hours7d: n.average7, hours28d: n.average28 } }]);
    } else if (f.id === 'body.resting_hr') {
      add(f, [{ slot: 'body.resting_hr', kind: 'resting_hr', data: { bpm7d: n.average7, bpm28d: n.average28 } }]);
    } else if (f.id === 'mix.count' && n.byActivity) {
      const byActivity = {};
      for (const [type, count] of Object.entries(n.byActivity)) byActivity[activityOf(type)] = (byActivity[activityOf(type)] ?? 0) + count;
      if (Object.keys(byActivity).length > 0) add(f, [{ slot: 'routine.mix', kind: 'mix', data: { byActivity } }]);
    }
  }
  return items;
}

/** Checks the app's outcomes: [{ sessionId, day, activity, plannedStart, done, actualStart?, actualMinutes? }]. Returns clean copies or null. */
export function cleanOutcomes(outcomes) {
  if (outcomes === undefined || outcomes === null) return [];
  if (!Array.isArray(outcomes)) return null;
  const out = [];
  for (const o of outcomes) {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
    if (typeof o.sessionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(o.sessionId) || !isDay(o.day) || !ACTIVITIES.includes(o.activity)) return null;
    if (parseTimestamp(o.plannedStart) === null || typeof o.done !== 'boolean') return null;
    if (o.actualStart !== undefined && parseTimestamp(o.actualStart) === null) return null;
    if (o.actualMinutes !== undefined && !(typeof o.actualMinutes === 'number' && Number.isFinite(o.actualMinutes) && o.actualMinutes >= 0)) return null;
    const clean = { sessionId: o.sessionId, day: o.day, activity: o.activity, plannedStart: o.plannedStart, done: o.done };
    if (o.actualStart !== undefined) clean.actualStart = o.actualStart;
    if (o.actualMinutes !== undefined) clean.actualMinutes = o.actualMinutes;
    out.push(clean);
  }
  return out;
}

const idPart = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.'-]{0,39}$/;

/** Checks what the app knows about gear and the goal: { gear?: [{ item, name?, startedOn, km }], goal?: [{ what, date }] }. Returns clean copies or null. */
export function cleanExtras(extras) {
  if (extras === undefined || extras === null) return {};
  if (typeof extras !== 'object' || Array.isArray(extras)) return null;
  const out = {};
  const ids = new Set();
  const fresh = (id) => { if (id === '' || ids.has(id)) return false; ids.add(id); return true; };
  if (extras.gear !== undefined) {
    if (!Array.isArray(extras.gear)) return null;
    out.gear = [];
    for (const g of extras.gear) {
      if (g === null || typeof g !== 'object' || typeof g.item !== 'string' || !NAME.test(g.item) || !fresh(`gear.${idPart(g.item)}`) || !isDay(g.startedOn)) return null;
      if (!(typeof g.km === 'number' && Number.isFinite(g.km) && g.km >= 0) || (g.name !== undefined && !(typeof g.name === 'string' && NAME.test(g.name)))) return null;
      out.gear.push({ id: `gear.${idPart(g.item)}`, item: g.item, ...(g.name !== undefined ? { name: g.name } : {}), startedOn: g.startedOn, km: g.km });
    }
  }
  if (extras.goal !== undefined) {
    if (!Array.isArray(extras.goal)) return null;
    out.goal = [];
    for (const g of extras.goal) {
      if (g === null || typeof g !== 'object' || typeof g.what !== 'string' || !NAME.test(g.what) || !fresh(`goal.${idPart(g.what)}`)) return null;
      if (g.date !== undefined && g.date !== null && !isDay(g.date)) return null;
      out.goal.push({ id: `goal.${idPart(g.what)}`, what: g.what, date: g.date ?? null });
    }
  }
  return out;
}

/** Evidence items from the stored extras known by `day`: `gear.<item>` and `goal.<what>`. The slot has the same name as the id. */
export function extraEvidence(extras, day) {
  const items = [];
  for (const id of Object.keys(extras).sort()) {
    const e = extras[id];
    if (e.day > day) continue;
    if (id.startsWith('gear.')) {
      items.push({
        id, window: 'total', numbers: { km: e.km, startedOn: e.startedOn },
        text: `Gear ${e.item}${e.name ? ` (${e.name})` : ''}: ${e.km} km since ${e.startedOn}.`,
        slots: [{ slot: id, kind: 'gear', data: { item: e.item, km: e.km, boughtOn: e.startedOn } }],
      });
    } else {
      items.push({
        id, window: 'total', numbers: { date: e.date },
        text: e.date ? `Goal: ${e.what} on ${e.date}.` : `Goal: ${e.what}, no date set.`,
        slots: [{ slot: id, kind: 'goal', data: { what: e.what, date: e.date } }],
      });
    }
  }
  return items;
}

const responseSlot = (activity, band) => ({ slot: `response.${activity}.${band.id}`, kind: 'response', data: { about: activity, pattern: `skipped_${band.id}` } });

/** Evidence items from stored outcomes: one per outcome reported on `day`, and one count per activity and time band over the last 28 days. */
export function outcomeEvidence(outcomes, day) {
  const list = Object.values(outcomes).sort((a, b) => (a.plannedStart + a.sessionId < b.plannedStart + b.sessionId ? -1 : 1));
  const items = [];
  const groups = new Map();
  for (const o of list) {
    if (o.day > day || o.day <= addDays(day, -SUPPORT_WINDOW)) continue;
    const at = parseTimestamp(o.plannedStart);
    const band = bandOf(at.hour);
    if (o.reported === day) {
      const numbers = { day: o.day, hour: at.hour, done: o.done };
      if (o.actualMinutes !== undefined) numbers.actualMinutes = o.actualMinutes;
      items.push({
        id: `outcome.${o.sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`, window: 'day', numbers,
        text: `Planned ${o.activity} session on ${o.day} at ${o.plannedStart.slice(11, 16)}: ${o.done ? 'done' : 'not done'}.`,
        slots: [responseSlot(o.activity, band)],
      });
    }
    const key = `${o.activity}.${band.id}`;
    const g = groups.get(key) ?? { activity: o.activity, band, planned: 0, done: 0 };
    g.planned += 1;
    g.done += o.done ? 1 : 0;
    groups.set(key, g);
  }
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key);
    items.push({
      id: `outcomes.${key}`, window: '28d', numbers: { planned: g.planned, done: g.done, notDone: g.planned - g.done },
      text: `Planned ${g.activity} sessions starting ${g.band.text} in the last 28 days: ${g.planned}, of which ${g.done} done and ${g.planned - g.done} not done.`,
      slots: [responseSlot(g.activity, g.band)],
    });
  }
  return items;
}

const NUM = /^\d+(?:\.\d+)?$/;
const DATE = /\d{4}-\d{2}-\d{2}/g;
const canon = (s) => String(Number(s));

/** Every number and date the cited evidence lets a statement say: the values as written and rounded the way the brief rounds (0, 1 or 2 decimals). */
export function allowedNumbers(items) {
  const numbers = new Set();
  const dates = new Set();
  const value = (v) => {
    const s = String(v);
    if (!NUM.test(s)) return;
    numbers.add(canon(s));
    for (const places of [0, 1, 2]) numbers.add(canon(rounded(s, places)));
  };
  const text = (s) => {
    for (const d of s.match(DATE) ?? []) dates.add(d);
    for (const m of s.replace(DATE, ' ').match(/\d+(?:\.\d+)?/g) ?? []) value(m);
  };
  const walk = (v) => {
    if (typeof v === 'number') { if (Number.isFinite(v) && v >= 0) value(v); } else if (typeof v === 'string') text(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const item of items) { text(item.text); text(item.window); walk(item.numbers); }
  return { numbers, dates };
}

/** The numbers and dates of a statement that are not in `allowed`. "6 PM" is read as hour 18. */
export function numbersNotIn(statement, allowed) {
  const missing = [];
  for (const d of statement.match(DATE) ?? []) if (!allowed.dates.has(d)) missing.push(d);
  let rest = statement.replace(DATE, ' ');
  rest = rest.replace(/\b(\d{1,2}) ?(AM|PM)\b/g, (all, h, half) => {
    const hour = (Number(h) % 12) + (half === 'PM' ? 12 : 0);
    if (!allowed.numbers.has(String(hour))) missing.push(all);
    return ' ';
  });
  for (const m of rest.match(/\d+(?:\.\d+)?/g) ?? []) if (!allowed.numbers.has(canon(m))) missing.push(m);
  return missing;
}
