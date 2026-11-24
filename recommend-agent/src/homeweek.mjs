// A week of home strength sessions from the person's rules: one session on every day at home, at the first free time in
// the hours the rules allow, with one or two later times the same day to fall back to, and what each day works.
// Code decides all of it; the model may only reorder what goes into a session (content.mjs), never which days train.
import { atDay, dayOf, dayISO, isoDT, parseDay, weekdayOf, InputError, US_MIN, WEEKDAY_NAMES } from './pytime.mjs';
import { kindOf, SLOT_MIN } from './rules.mjs';

export const LEAD_MIN = 60;            // a session today starts at least this long after now (as the usual week)
export const TODAY_END_HOUR = 22;      // and today nothing runs past this hour
export const FALLBACK_GAP_MIN = 90;    // a fallback start is at least this long after the time before it
export const MAX_FALLBACKS = 2;
export const ROUND_MIN = 5;            // starts fall on whole five minutes
export const SPLIT_DAYS = 4;           // from this many days at home, lower and upper body take turns
export const FOCUS = ['full', 'lower', 'upper', 'full_lower', 'full_upper'];
export const FOCUS_WORDS = { full: 'full-body', lower: 'lower-body', upper: 'upper-body', full_lower: 'full-body, more legs', full_upper: 'full-body, more upper body' };

const OFFSET = /^([+-])(\d{2}):(\d{2})$/;
const MAX_OFFSET_MIN = 14 * 60;

/**
 * Reads `dayOffsets` ({ "YYYY-MM-DD": "+HH:MM" | "-HH:MM" }, each day's UTC offset at noon, from the phone) as a Map of day
 * number -> minutes. Throws bad_day_offsets on anything else. A day it doesn't list uses the offset of `now`.
 */
export function readDayOffsets(raw) {
  const out = new Map();
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('bad_day_offsets');
  for (const [iso, text] of Object.entries(raw)) {
    const m = typeof text === 'string' ? OFFSET.exec(text) : null;
    const minutes = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : NaN;
    if (!m || +m[3] > 59 || Math.abs(minutes) > MAX_OFFSET_MIN) throw new InputError('bad_day_offsets');
    try { out.set(parseDay(iso), minutes); } catch { throw new InputError('bad_day_offsets'); }
  }
  return out;
}

/** The UTC offset in minutes of one day of the week: the phone's for that day, else that of `now`. */
export const offOf = (h, day) => h.offsets.get(day) ?? h.off;

/** How many days the week runs from `today`: through this Sunday, or through next Sunday when today is Sunday. */
export const weekLength = (today) => (weekdayOf(today) === 6 ? 8 : 7 - weekdayOf(today));

/**
 * What the week is built from: { now, calendar: [{ start, end }], rules, dayKinds: Map, carry: [focus], queue: Map, doneToday, offsets: Map }.
 * `queue` holds what each day at home left in this Monday-to-Sunday week was last planned to work (day number -> focus),
 * so the split stays as it was planned and a day that drops out passes its focus on to the next day at home.
 * `doneToday` says today's session is already done: today's focus is then never passed on to a later day.
 */
export function homeContext({ now, calendar, rules, dayKinds, carry = [], queue = new Map(), doneToday = false, offsets = new Map() }) {
  return { now, today: dayOf(now), off: now.off, calendar: [...calendar].sort((x, y) => x.start.mic - y.start.mic), rules, given: dayKinds, carry,
    queue: new Map([...queue].filter(([, f]) => FOCUS.includes(f))), doneToday: doneToday === true, offsets };
}

/** Reads `queue` ({ "YYYY-MM-DD": focus }); a day or focus it can't read is left out, since the week works without it. */
export function readQueue(raw) {
  const out = new Map();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [iso, focus] of Object.entries(raw)) {
    try { if (FOCUS.includes(focus)) out.set(parseDay(iso), focus); } catch { /* not a day */ }
  }
  return out;
}

/** The free stretches of a day at home within the rules' hours, at least 30 minutes long, as { a, b } in microseconds. */
export function stretchesOn(h, day) {
  if (kindOf(h.rules, h.given, day) !== 'home') return [];
  const isToday = day === h.today;
  const off = offOf(h, day);
  let from = atDay(day, off, 0, h.rules.window.from).mic;
  if (isToday) from = Math.max(from, h.now.mic + LEAD_MIN * US_MIN);
  let to = atDay(day, off, 0, h.rules.window.to + h.rules.session.max).mic;
  if (isToday) to = Math.min(to, atDay(day, off, TODAY_END_HOUR).mic);
  const out = [];
  const push = (a, b) => { if (b - a >= SLOT_MIN * US_MIN) out.push({ a, b }); };
  for (const busy of h.calendar) {
    if (busy.end.mic <= from || busy.start.mic >= to) continue;
    push(from, Math.min(busy.start.mic, to));
    from = Math.max(from, busy.end.mic);
  }
  if (from < to) push(from, to);
  return out;
}

const roundUp = (mic) => Math.ceil(mic / (ROUND_MIN * US_MIN)) * ROUND_MIN * US_MIN;

// The earliest start at or after `after` where a whole session fits and that is no later than the latest start.
function nextStart(h, day, stretches, after) {
  const length = h.rules.session.max * US_MIN;
  const latest = atDay(day, offOf(h, day), 0, h.rules.window.to).mic;
  let best = null;
  for (const s of stretches) {
    const t = roundUp(Math.max(after, s.a));
    if (t <= latest && t + length <= s.b && (best === null || t < best)) best = t;
  }
  return best;
}

/** The first time a day at home can train and up to two later times, each at least 90 minutes after the one before. */
export function startsOn(h, day) {
  const stretches = stretchesOn(h, day);
  const first = nextStart(h, day, stretches, -Infinity);
  if (first === null) return { first: null, fallbacks: [] };
  const fallbacks = [];
  let previous = first;
  while (fallbacks.length < MAX_FALLBACKS) {
    const t = nextStart(h, day, stretches, previous + FALLBACK_GAP_MIN * US_MIN);
    if (t === null) break;
    fallbacks.push(t);
    previous = t;
  }
  return { first, fallbacks };
}

// Full body on fewer than four days; on three, two days in a row lean legs first and then upper body first.
function splitOf(days) {
  if (days.length >= SPLIT_DAYS) return days.map((_, i) => (i % 2 === 0 ? 'lower' : 'upper'));
  const focus = days.map(() => 'full');
  if (days.length !== 3) return focus;
  for (let i = 0; i + 1 < days.length; i += 1) {
    if (days[i + 1] === days[i] + 1 && focus[i] === 'full' && focus[i + 1] === 'full') {
      focus[i] = 'full_lower';
      focus[i + 1] = 'full_upper';
      i += 1;
    }
  }
  return focus;
}

// A session missed earlier moves to the next day at home and the rest follow it, so each part still gets its turn.
function withCarry(days, focus, carry) {
  const missed = carry.filter((f) => FOCUS.includes(f));
  if (!missed.length) return focus;
  if (['lower', 'upper'].includes(missed[0]) && days.length >= 2) {
    const other = missed[0] === 'lower' ? 'upper' : 'lower';
    return days.map((_, i) => (i % 2 === 0 ? missed[0] : other));
  }
  return [...missed, ...focus].slice(0, days.length);
}

// Each day at home left this week takes what was planned for it, or what an earlier day that dropped out was planned to
// work; a missed session (carry) goes first. A day with nothing planned yet takes the split of the days left. Today, once
// done, keeps what it was planned to work and passes nothing on.
function thisWeekFocus(h, rows, sunday) {
  const fresh = withCarry(rows.map((r) => r.day), splitOf(rows.map((r) => r.day)), h.carry);
  if (!h.queue.size) { rows.forEach((r, i) => { r.focus = fresh[i]; }); return; }
  const waiting = h.carry.filter((f) => FOCUS.includes(f));
  let row = 0;
  for (let day = h.today; day <= sunday && row < rows.length; day += 1) {
    const doneDay = h.doneToday && day === h.today;
    if (h.queue.has(day) && !doneDay) waiting.push(h.queue.get(day));
    if (rows[row].day !== day) continue;
    rows[row].focus = (doneDay ? h.queue.get(day) : waiting.shift()) ?? fresh[row];
    row += 1;
  }
}

// The days of next week seen from here take their place in that whole week's split, so the split doesn't change as more
// of the week comes into view: a day past the last one in view is taken as at home unless the rules rest it or the phone said out.
function nextWeekFocus(h, rows, monday, last) {
  if (!rows.length) return;
  const days = Array.from({ length: 7 }, (_, i) => monday + i)
    .filter((d) => (d <= last ? rows.some((r) => r.day === d) : kindOf(h.rules, h.given, d) === 'home'));
  const focus = splitOf(days);
  for (const r of rows) r.focus = focus[days.indexOf(r.day)];
}

/**
 * Every day from today through Sunday (through next Sunday when today is Sunday, so the Sunday-evening build covers the
 * whole next week): its kind, and for a day at home with time to train, what it works and when.
 * -> { days: [{ day, kind, focus, first, fallbacks }], homeDays, note }, with day numbers and times in microseconds.
 */
export function homeWeek(h, days = weekLength(h.today)) {
  const rows = [];
  for (let i = 0; i < days; i += 1) {
    const day = h.today + i;
    const kind = kindOf(h.rules, h.given, day);
    rows.push({ day, kind, focus: null, ...(kind === 'home' ? startsOn(h, day) : { first: null, fallbacks: [] }) });
  }
  const sunday = h.today + 6 - weekdayOf(h.today);
  const training = rows.filter((r) => r.first !== null);
  const thisWeek = training.filter((r) => r.day <= sunday);
  thisWeekFocus(h, thisWeek, sunday);
  nextWeekFocus(h, training.filter((r) => r.day > sunday), sunday + 1, h.today + days - 1);
  const homeDays = rows.filter((r) => r.kind === 'home').length;
  let note = null;
  if (training.length === 0) note = 'There is no day at home with time to train this week, so nothing is planned.';
  else if (training.length === 1) note = 'This week has only one day at home with time to train, so it works the whole body once.';
  return { days: rows, homeDays, trainingDays: training.length, note };
}

/** The same week as plain values for planContext and the app. */
export function homeWeekView(h, week) {
  return {
    days: week.days.map((r) => ({
      day: dayISO(r.day), weekday: WEEKDAY_NAMES[weekdayOf(r.day)], kind: r.kind, focus: r.focus,
      first: r.first === null ? null : isoDT({ mic: r.first, off: offOf(h, r.day) }), fallbacks: r.fallbacks.map((mic) => isoDT({ mic, off: offOf(h, r.day) })),
    })),
    homeDays: week.homeDays, trainingDays: week.trainingDays, note: week.note,
  };
}
