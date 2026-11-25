// The person's own rules and the kind of each day. Rules are what the person said, stored as they said them, never
// guessed: the weekdays they never train, how long a session lasts, the hours a session may start, what they own to train
// with and the movements they avoid. A day is `home`, `out` (they are away, so nothing is planned) or `rest` (a rule).
// Both are optional inputs: without `rules` the planner keeps its usual-week behaviour, so older callers see no change.
import { InputError, parseDay, weekdayOf, dayISO } from './pytime.mjs';

export const REST_WEEKDAYS = [2, 5, 6];   // a common four-day week: train Monday, Tuesday, Thursday and Friday (Monday is 0)
export const SESSION_MIN = 20;            // minutes of one home session
export const SESSION_MAX = 25;
export const WINDOW_FROM = '12:00';       // the earliest start; mornings are off unless the person turns them on
export const WINDOW_TO = '20:30';         // the latest start
export const MORNING_FROM = '06:00';      // the earliest start with mornings on
export const SLOT_MIN = 30;               // a free stretch at least this long is a time to train at home
export const ALWAYS_THERE = ['floor', 'wall'];
export const EQUIPMENT = ['backpack', 'chair', 'table', 'sofa', 'book', 'step', 'floor', 'wall'];
export const DEFAULT_EQUIPMENT = ['backpack', 'chair', 'table', 'sofa', 'book', 'step'];
export const DAY_KINDS = ['home', 'out', 'rest'];
export const MOVEMENT_STATES = ['untried', 'can', 'cannot'];
const MIN_LENGTH = 10;
export const MINUTES_PER_HOUR = 60;
export const LAST_HOUR = 23;              // an HH:MM time is at most 23:59
export const LAST_MINUTE = 59;
export const SUNDAY = 6;                  // weekdays count from Monday, 0
export const WEEK_DAYS = 7;
const CLOCK_DIGITS = 2;                   // HH and MM are two digits each
const MAX_LENGTH = 90;
const ID = /^[a-z0-9_]{1,48}$/;

const bad = () => new InputError('bad_rules');
const whole = (v, fallback) => (v === undefined || v === null ? fallback : v);

/** Minutes after midnight of an `HH:MM` text, or null. */
export function minutesOf(text) {
  const m = typeof text === 'string' ? /^(\d\d):(\d\d)$/.exec(text) : null;
  if (!m || +m[1] > LAST_HOUR || +m[2] > LAST_MINUTE) return null;
  return +m[1] * MINUTES_PER_HOUR + +m[2];
}

const clockText = (minutes) => `${String(Math.floor(minutes / MINUTES_PER_HOUR)).padStart(CLOCK_DIGITS, '0')}:${String(minutes % MINUTES_PER_HOUR).padStart(CLOCK_DIGITS, '0')}`;

function readWeekdays(list) {
  const days = whole(list, REST_WEEKDAYS);
  if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= SUNDAY)) throw bad();
  return [...new Set(days)].sort((a, b) => a - b);
}

function readLength(length) {
  const min = whole(length?.min, SESSION_MIN);
  const max = whole(length?.max, SESSION_MAX);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < MIN_LENGTH || max < min || max > MAX_LENGTH) throw bad();
  return { min, max };
}

function readWindow(window, mornings) {
  const from = minutesOf(whole(window?.from, WINDOW_FROM));
  const to = minutesOf(whole(window?.to, WINDOW_TO));
  if (from === null || to === null || to < from) throw bad();
  return { from: mornings ? Math.min(from, minutesOf(MORNING_FROM)) : from, to };
}

function readIds(list) {
  const ids = whole(list, []);
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string' && ID.test(x))) throw bad();
  return [...new Set(ids)];
}

function readStates(map) {
  const states = whole(map, {});
  if (typeof states !== 'object' || Array.isArray(states)) throw bad();
  for (const [id, state] of Object.entries(states)) if (!ID.test(id) || !MOVEMENT_STATES.includes(state)) throw bad();
  return { ...states };
}

/** The rules as code reads them, or null when the request has none. Throws bad_rules on a value it can't read. */
export function readRules(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  const mornings = raw.mornings === true;
  const owned = readIds(whole(raw.equipment, DEFAULT_EQUIPMENT));
  if (!owned.every((x) => EQUIPMENT.includes(x))) throw bad();
  return {
    restWeekdays: readWeekdays(raw.restWeekdays),
    session: readLength(raw.sessionMinutes),
    window: readWindow(raw.window, mornings),
    mornings,
    equipment: [...new Set([...owned, ...ALWAYS_THERE])].sort(),
    avoid: readIds(raw.avoid),
    movements: readStates(raw.movements),
  };
}

/** The rules again in the shape they came in, for planContext. */
export function rulesView(rules) {
  return {
    restWeekdays: rules.restWeekdays,
    sessionMinutes: rules.session,
    window: { from: clockText(rules.window.from), to: clockText(rules.window.to) },
    mornings: rules.mornings,
    equipment: rules.equipment,
    avoid: rules.avoid,
  };
}

/** `{ "YYYY-MM-DD": "home" | "out" | "rest" }` as a Map of day numbers. Throws bad_day_kinds on anything else. */
export function readDayKinds(raw) {
  const out = new Map();
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('bad_day_kinds');
  for (const [iso, kind] of Object.entries(raw)) {
    if (!DAY_KINDS.includes(kind)) throw new InputError('bad_day_kinds');
    let day;
    try { day = parseDay(iso); } catch { throw new InputError('bad_day_kinds'); }
    out.set(day, kind);
  }
  return out;
}

/**
 * The kind of one day. A rest weekday in the rules always wins, so the app can never plan on it. Then what the phone
 * worked out (an event away from home, "I'm going out today"). Every other day is a day at home.
 */
export function kindOf(rules, given, day) {
  if (rules.restWeekdays.includes(weekdayOf(day))) return 'rest';
  return given.get(day) ?? 'home';
}

/** Each day's kind from `span.firstDay` for `span.days` days, as plain values. */
export const dayKindsView = (rules, given, { firstDay, days }) => Array.from({ length: days }, (_, i) => ({ day: dayISO(firstDay + i), kind: kindOf(rules, given, firstDay + i) }));
