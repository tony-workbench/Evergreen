// The guardrail for a week someone else proposed (the agent), and the numbers the agent needs to propose one.
// planContext works the numbers out; checkPlan applies every hard rule of the week planner to any plan.
import {
  InputError, parseDT, parseDay, dayOf, hourOf, weekdayOf, dayISO, atDay, addUs, hhmm, clock, isoDT, US_MIN, WEEKDAYS, WEEKDAY_NAMES,
} from './pytime.mjs';
import { pyRound, pySum, pyMedian } from './pynum.mjs';
import { readHistory } from './history.mjs';
import { condition, KM_PER_MILE, DEFAULT_LIFE_KM, REPLACE_AT, WORN_AT } from './condition.mjs';
import { readMemory, readStopped, isStopped, activityOf, labelOf, slotMatches, isRun, ACTIVITIES, INTENSITIES } from './memory.mjs';
import {
  signals, tiredSignals, usualWeek, longDay, intensityOf, sessionLimit, minutesBudget, HIGH_LOAD_RATIO, TODAY_LEAD_MIN, TODAY_END_HOUR, LONG_RUN_MIN,
  DAYS, LOAD_GROWTH, ACWR_MAX, SLEEP_DROP_MIN, RHR_RISE, TAPER_DAYS, WORN_RUN_MAX_MIN, BREAK_IN_MIN, MIN_SESSION, HARD_EFFORT, EASY_EFFORT,
  TAPER_SHARE, TAPER_LONG_SHARE, DAY_BEFORE_RACE, TOMORROW,
} from './workouts.mjs';
import { readRules, readDayKinds, rulesView, kindOf, dayKindsView } from './rules.mjs';
import { homeContextOf, homeWeek, homeWeekView, offOf, stretchesOn, FOCUS_WORDS } from './homeweek.mjs';

export const MIN_MINUTES = 10;
export const MAX_MINUTES = 180;
export const LOAD_SLACK = 1.10;        // a proposed week may sit up to 10% over the limit before it counts
export const DAY_START_HOUR = 6;       // free time is looked for between 06:00 and 21:00
export const DAY_END_HOUR = 21;
export const TAPER_RUN_MAX_MIN = 45;   // the taper limit for a run when the usual minutes are not known
export const EFFORT_OF = { easy: 3, steady: 5, hard: 7 };
const NOUN = { run: 'run', long_run: 'long run', walk: 'walk', strength: 'strength session', yoga: 'yoga', ride: 'ride', elliptical: 'elliptical session', swim: 'swim', stretch: 'stretch', rest: 'rest', other: 'session' };
const TIRED_WORDS = { sleep: 'you have been sleeping less than usual', resting_hr: 'your resting heart rate is higher than usual' };
const RACE_GOAL = /race|marathon|\b\d+ ?k\b|triathlon/i;
const finite = (v) => (Number.isFinite(v) ? v : null);
const MINUTES_PER_HOUR = 60;
const PERCENT = 100;
const WEEK_LENGTH = 7;            // days in a week
const MIN_STREAK = 3;             // with a usual week from history, at least this many training days in a row are allowed
const DEFAULT_STREAK = 6;         // otherwise at most this many before a rest day
const DAILY_PER_WEEK = 6;         // more workouts a week than this (from memory): every day may be a training day
const LAST_HOUR = 23;             // an HH:MM start is at most 23:59
const LAST_MINUTE = 59;
const BREAK_IN_RUNS = 2;          // the first runs in a new pair that stay short and easy
const BOTH_TIRED = 2;             // both readiness signals (sleep and resting heart rate) are raised
const WEEK_ORDER = 1e9;           // a violation of the whole week sorts after every session's
const CLOCK_HOURS = [0, 2];       // where the hours and the minutes sit in "HH:MM"
const CLOCK_MINUTES = [3, 5];
const DATE_LENGTH = 10;           // "YYYY-MM-DD"
const LAST_DAY_OFFSET = 1;     // a span of n days ends n - 1 days after its first

// The longest run of training days in a row in a repeating week.
function longestStreak(weekdays) {
  const on = new Set(weekdays);
  if (on.size >= 7) return 7;
  let best = 0;
  for (let start = 0; start < 7; start += 1) {
    let n = 0;
    while (n < 7 && on.has((start + n) % 7)) n += 1;
    best = Math.max(best, n);
  }
  return best;
}

/** Everything the rules need to know about the person right now, from { now, tz?, memory?, calendar?, stopped?, shoes?, raceDate?, newPairArrives?, history? }. */
export function situation(ctx) {
  if (!ctx || typeof ctx !== 'object') throw new InputError('bad_context');
  const now = nowOf(ctx);
  const mem = readMemory(ctx.memory);
  const calendar = readCalendar(ctx);
  const stopped = readStopped(ctx.stopped, mem);
  const stoppedKeys = stoppedKeysOf(ctx, mem, stopped);
  const s = { now, today: dayOf(now), mem, calendar, stopped, stoppedKeys, memoryKeys: mem.keys.filter((k) => !stoppedKeys.includes(k)), ws: null, week: new Map(), long: null,
    days: DAYS, offOf: () => now.off };
  const slots = mem.slots.filter((x) => !stoppedKeys.includes(x.key));
  if (ctx.history) usualFromHistory(s, ctx.history, slots);
  else usualFromMemory(s, slots);
  s.shoe = null;
  const shoe = shoeOf(ctx, s);
  if (shoe) s.shoe = { ...shoe, longestRunMin: shoe.status === 'replace' ? WORN_RUN_MAX_MIN : null };
  s.newPairArrives = dayOrNull(ctx.newPairArrives ?? ctx.shoes?.newPairArrives);
  s.raceDate = dayOrNull(ctx.raceDate ?? raceGoalDate(mem));
  applyRules(s, ctx);
  return s;
}

const dayOrNull = (v) => (v === undefined || v === null ? null : parseDay(String(v).slice(0, DATE_LENGTH)));
const readCalendar = (ctx) => (ctx.calendar ?? ctx.busy ?? []).map((b) => ({ start: parseDT(b.start), end: parseDT(b.end), title: typeof b.title === 'string' ? b.title : null }));

// `now`, moved to the context's own UTC offset when it names one (tz: "+05:30").
function nowOf(ctx) {
  const now = parseDT(ctx.now);
  const tz = typeof ctx.tz === 'string' && /^[+-]\d\d:?\d\d$/.test(ctx.tz) ? parseDT(`2000-01-01T00:00:00${ctx.tz}`).off : null;
  return tz !== null ? { mic: now.mic, off: tz } : now;
}

function stoppedKeysOf(ctx, mem, stopped) {
  const given = Array.isArray(ctx.stoppedKeys) ? ctx.stoppedKeys.filter((k) => typeof k === 'string') : [];
  return [...new Set([...mem.stoppedKeys, ...stopped.map((x) => x.key).filter(Boolean), ...given])];
}

function raceGoalDate(mem) {
  const goal = mem.rows.find((r) => r.kind === 'goal' && r.data && RACE_GOAL.test(String(r.data.what ?? '')) && /^\d{4}-\d\d-\d\d/.test(String(r.data.date ?? '')));
  return goal ? goal.data.date : null;
}

// The usual week and the load numbers from the workout history.
function usualFromHistory(s, history, slots) {
  const [ws, days] = readHistory(history, s.now);
  const sig = signals(ws, days, s.now);
  const week = usualWeek(ws, s.now);
  s.ws = ws;
  s.long = longDay(week);
  for (const [wd, u] of week) s.week.set(wd, usualDay(u, wd, slots));
  Object.assign(s, { unit: 'effort-minutes', load7: sig.load7, loadUsual: sig.loadWeeklyAvg28, loadCap: sig.loadCap > 0 ? sig.loadCap : null, tired: tiredSignals(sig) });
  s.usualDays = s.week.size;
  s.streak = s.week.size ? Math.max(MIN_STREAK, longestStreak([...s.week.keys()])) : DEFAULT_STREAK;
  s.maxSessions = sessionLimit(ws, week, s.now, s.mem);
  s.minutes = minutesBudget(ws, s.now, s.mem, week);
}

function usualDay(u, wd, slots) {
  const act = activityOf(u.activityType);
  const slot = [...slots].reverse().find((x) => x.weekday === wd && slotMatches(x, u.activityType));
  return { activity: act, minutes: u.minutes, hour: slot ? slot.hour : u.hour, effort: u.effort, key: slot ? slot.key : null, label: act === 'other' ? (slot && slot.label) || labelOf(u.activityType) : null };
}

// No workout history to count: memory rows carry the numbers, in minutes.
function usualFromMemory(s, slots) {
  for (const x of slots) s.week.set(x.weekday, { activity: x.activity, minutes: x.minutes, hour: x.hour, effort: null, key: x.key, label: x.label });
  const runs = [...s.week].filter(([, u]) => u.activity === 'run' && u.minutes !== null);
  for (const [wd, u] of runs) if (s.long === null || u.minutes > s.week.get(s.long).minutes) s.long = wd;
  const volume = s.mem.first('weekly_volume')?.data;
  s.tired = tiredFromMemory(s.mem);
  Object.assign(s, loadFromMemory(s.mem, volume));
  const perWeek = finite(volume?.workoutsPerWeek);
  s.usualDays = perWeek !== null ? Math.ceil(perWeek) : s.week.size || null;
  s.streak = perWeek !== null && perWeek > DAILY_PER_WEEK ? WEEK_LENGTH : DEFAULT_STREAK;
  s.maxSessions = sessionLimit([], s.week, s.now, s.mem);
  s.minutes = minutesBudget([], s.now, s.mem, s.week);
}

function tiredFromMemory(mem) {
  const sleep = mem.first('sleep')?.data;
  const rhr = mem.first('resting_hr')?.data;
  const tired = [];
  if (finite(sleep?.hours7d) !== null && finite(sleep?.hours28d) !== null && sleep.hours7d * MINUTES_PER_HOUR < sleep.hours28d * MINUTES_PER_HOUR - SLEEP_DROP_MIN) tired.push('sleep');
  if (finite(rhr?.bpm7d) !== null && finite(rhr?.bpm28d) !== null && rhr.bpm7d > rhr.bpm28d + RHR_RISE) tired.push('resting_hr');
  return tired;
}

function loadFromMemory(mem, volume) {
  const load = mem.first('load')?.data;
  const load7 = finite(load?.minutes7d);
  const usual = load7 !== null && load?.ratioToUsual > 0 ? load7 / load.ratioToUsual : finite(volume?.minutesPerWeek);
  const cap = usual !== null && usual > 0 ? pyRound(Math.min(LOAD_GROWTH * Math.max(load7 ?? 0, usual), ACWR_MAX * usual)) : null;
  return { unit: 'minutes', load7: load7 === null ? null : pyRound(load7), loadUsual: usual === null ? null : pyRound(usual), loadCap: cap };
}

// The running shoes: from the purchase date and the history, or from the miles given or the gear memory row.
function shoeOf(ctx, s) {
  if (ctx.shoes && typeof ctx.shoes === 'object' && s.ws && ctx.shoes.boughtOn) {
    const c = condition(s.ws, { boughtOn: dayOrNull(ctx.shoes.boughtOn), startMiles: Number(ctx.shoes.startMiles ?? 0) }, s.now);
    return { status: c.status, percentLife: c.percentLife, miles: c.miles };
  }
  const gear = s.mem.rows.find((r) => r.kind === 'gear' && r.data && /shoe/i.test(String(r.data.item ?? '')) && Number.isFinite(r.data.km));
  const miles = ctx.shoes && Number.isFinite(Number(ctx.shoes.miles ?? ctx.shoes.startMiles)) ? Number(ctx.shoes.miles ?? ctx.shoes.startMiles) : gear ? gear.data.km / KM_PER_MILE : null;
  if (miles === null) return null;
  const share = (miles * KM_PER_MILE) / DEFAULT_LIFE_KM;
  return { status: share >= REPLACE_AT ? 'replace' : share >= WORN_AT ? 'worn' : 'fresh', percentLife: pyRound(share * PERCENT), miles: pyRound(miles) };
}

/**
 * With the person's rules, every day at home with time to train gets one session, so the limits that come from the
 * usual week (how many sessions, how many minutes, how many days in a row) never stand in its way. The window is then
 * the home week: today through Sunday, or through next Sunday when today is Sunday, each day at its own UTC offset.
 */
function applyRules(s, ctx) {
  s.rules = readRules(ctx.rules);
  if (!s.rules) return;
  s.dayKinds = readDayKinds(ctx.dayKinds);
  s.home = homeContextOf(ctx, { now: s.now, calendar: s.calendar, rules: s.rules, dayKinds: s.dayKinds });
  s.homeWeek = homeWeek(s.home);
  s.days = s.homeWeek.days.length;
  s.offOf = (day) => offOf(s.home, day);
  const n = s.homeWeek.trainingDays;
  const minutes = n * s.rules.session.max;
  s.maxSessions = Math.max(s.maxSessions, n);
  if (s.minutes.limit !== null) s.minutes = { ...s.minutes, limit: Math.max(s.minutes.limit, minutes) };
  if (s.loadCap !== null) s.loadCap = Math.max(s.loadCap, s.unit === 'minutes' ? minutes : minutes * EFFORT_OF.steady);
  s.streak = Math.max(DAYS, s.days);
}

// The free stretches of one day between 06:00 and 21:00, at least 20 minutes long. Today: from an hour after `now`, until 22:00.
function freeOn(s, dayNum) {
  if (s.rules) return stretchesOn(s.home, dayNum).map((x) => ({ day: dayISO(dayNum), start: isoDT({ mic: x.a, off: s.offOf(dayNum) }), end: isoDT({ mic: x.b, off: s.offOf(dayNum) }) }));
  const today = dayNum === s.today;
  let from = Math.max(atDay(dayNum, s.now.off, DAY_START_HOUR).mic, today ? s.now.mic + TODAY_LEAD_MIN * US_MIN : 0);
  const to = atDay(dayNum, s.now.off, today ? TODAY_END_HOUR : DAY_END_HOUR).mic;
  const out = [];
  const push = (a, b) => { if (b - a >= MIN_SESSION * US_MIN) out.push({ day: dayISO(dayNum), start: isoDT({ mic: a, off: s.now.off }), end: isoDT({ mic: b, off: s.now.off }) }); };
  for (const b of [...s.calendar].sort((x, y) => x.start.mic - y.start.mic)) {
    if (b.end.mic <= from || b.start.mic >= to) continue;
    push(from, Math.min(b.start.mic, to));
    from = Math.max(from, b.end.mic);
  }
  if (from < to) push(from, to);
  return out;
}

const readinessText = (tired) => (tired.length
  ? `Take it easier for now, because ${tired.map((k) => TIRED_WORDS[k]).join(' and ')}.`
  : 'Sleep and resting heart rate look normal.');

/** The numbers the agent reasons from, worked out by code. */
export function planContext(ctx) {
  const s = situation(ctx);
  return {
    now: isoDT(s.now), window: windowView(s),
    usualWeek: usualWeekView(s), ...weekNumbers(s),
    readiness: { status: s.tired.length ? 'ease_off' : 'normal', signals: s.tired, text: readinessText(s.tired) },
    freeSlots: freeSlotsOf(s),
    shoe: s.shoe ? { ...s.shoe, newPairArrives: s.newPairArrives !== null ? dayISO(s.newPairArrives) : null } : null,
    race: raceView(s), newPairArrives: s.newPairArrives !== null ? dayISO(s.newPairArrives) : null,
    stoppedKeys: s.stoppedKeys, memoryKeys: s.memoryKeys,
    stoppedSlots: s.stopped.map((x) => ({ weekday: x.weekday, weekdayName: WEEKDAYS[x.weekday], activity: x.activity, hour: x.hour, ...(x.activity === 'other' ? { label: x.label } : {}) })),
    usuallyHardDays: [...s.week].filter(([, u]) => u.effort !== null && u.effort >= HARD_EFFORT).map(([wd]) => wd).sort((a, b) => a - b),
    activities: ACTIVITIES, intensities: INTENSITIES,
    limits: { minMinutes: MIN_MINUTES, maxMinutes: MAX_MINUTES, shortestSession: MIN_SESSION, wornShoeRunMin: WORN_RUN_MAX_MIN, breakInRunMin: BREAK_IN_MIN },
    ...rulesContext(s),
  };
}

const windowView = (s) => ({ from: dayISO(s.today), to: dayISO(s.today + s.days - 1), earliestStart: isoDT({ mic: s.now.mic + TODAY_LEAD_MIN * US_MIN, off: s.now.off }) });
const weekNumbers = (s) => ({
  usualDaysPerWeek: s.usualDays, maxSessions: s.maxSessions, mostDaysInARow: s.streak, usualMinutes: s.minutes.usual, minutesRatio: s.minutes.ratio, maxMinutes: s.minutes.limit,
  loadUnit: s.unit, loadThisWeek: s.load7, loadUsual: s.loadUsual, loadCap: s.loadCap,
});

function freeSlotsOf(s) {
  const freeSlots = [];
  for (let i = 0; i < s.days; i += 1) freeSlots.push(...freeOn(s, s.today + i));
  return freeSlots;
}

const usualWeekView = (s) => [...s.week].filter(([, u]) => u.activity !== null).sort((a, b) => a[0] - b[0]).map(([wd, u]) => ({
  weekday: wd, weekdayName: WEEKDAYS[wd], activity: u.activity === 'run' && wd === s.long && u.minutes >= LONG_RUN_MIN ? 'long_run' : u.activity, minutes: u.minutes, hour: u.hour,
  intensity: u.effort === null ? (u.activity === 'other' ? 'steady' : null) : intensityOf(u.effort), basedOn: u.key ? [u.key] : [],
  ...(u.activity === 'other' ? { label: u.label ?? null } : {}),
}));

function raceView(s) {
  if (s.raceDate === null) return null;
  const daysAway = s.raceDate - s.today;
  return { date: dayISO(s.raceDate), daysAway, taper: daysAway > 0 && daysAway <= TAPER_DAYS + DAYS, restDay: dayISO(s.raceDate - DAY_BEFORE_RACE) };
}

const rulesContext = (s) => (s.rules ? {
  rules: rulesView(s.rules),
  days: dayKindsView(s.rules, s.dayKinds, { firstDay: s.today, days: s.days }),
  homeWeek: homeWeekView(s.home, s.homeWeek),
} : {});

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const dayWords = (iso) => `${WEEKDAY_NAMES[weekdayOf(parseDay(iso))]} the ${ordinal(Number(iso.slice(8, 10)))}`;
const timeWords = (iso) => clock(Number(iso.slice(11, 13)), Number(iso.slice(14, 16)));
const PLURAL = { run: 'runs', long_run: 'long runs', walk: 'walks', strength: 'strength sessions', yoga: 'yoga', ride: 'rides', elliptical: 'elliptical sessions', swim: 'swims', stretch: 'stretching', rest: 'rest' };
const nameOf = (u) => (u.activity === 'other' ? u.label || 'another activity' : NOUN[u.activity]);

/**
 * The constraints of this week as plain lines for the model that proposes it, so it does no arithmetic and meets every rule
 * checkPlan applies before it is told off by one. Each line is one sentence a person could read: no keys, no field names.
 */
export function planBrief(args) {
  const c = planContext(args?.context ?? args);
  const lines = [];
  windowLines(c, lines);
  usualLines(c, lines);
  limitLines(c, lines);
  lines.push(readinessLine(c.readiness.signals));
  raceLines(c, lines);
  shoeLines(c, lines);
  if (c.rules) rulesBrief(c, lines);
  dayLines(c, lines);
  lines.push('Say a session comes from a habit only when that habit is in the memory you were given.');
  for (const x of c.stoppedSlots) lines.push(`Do not plan ${x.activity === 'other' ? x.label || 'sessions' : PLURAL[x.activity]} on ${WEEKDAY_NAMES[x.weekday]} at ${clock(x.hour)}.`);
  if (c.stoppedKeys.length) lines.push('Do not bring back any habit that was stopped.');
  return { lines };
}

function windowLines(c, lines) {
  lines.push(`Plan from today, ${dayWords(c.window.from)}, through ${dayWords(c.window.to)}; today nothing starts before ${timeWords(c.window.earliestStart)} or ends after ${clock(TODAY_END_HOUR)}.`);
  lines.push('Use only activities the app knows, and give each session a day, a start time and a length.');
  lines.push(`Every session lasts between ${MIN_MINUTES} and ${MAX_MINUTES} minutes, and no two sessions overlap.`);
}

// The usual week, one line per activity, hour, length and effort, with the days it falls on.
function usualLines(c, lines) {
  const groups = new Map();
  for (const u of c.usualWeek) {
    const id = `${nameOf(u)}|${u.hour}|${u.minutes}|${u.intensity}`;
    if (!groups.has(id)) groups.set(id, { u, days: [] });
    groups.get(id).days.push(u.weekdayName);
  }
  for (const { u, days } of groups.values()) {
    lines.push(`Usual: ${nameOf(u)} ${days.join(', ')} at ${clock(u.hour)}${u.minutes ? `, ${u.minutes} minutes` : ''}${u.intensity ? `, ${u.intensity}` : ''}.`);
  }
  if (!groups.size) lines.push('No usual week is known yet, so keep this one light.');
}

function limitLines(c, lines) {
  lines.push(`${c.usualDaysPerWeek ? `Usually ${c.usualDaysPerWeek} training ${c.usualDaysPerWeek === 1 ? 'day' : 'days'} a week; at` : 'At'} most ${c.mostDaysInARow} training days in a row before a rest day.`);
  if (c.loadCap !== null) {
    lines.push(c.loadUnit === 'minutes'
      ? `The whole week can hold about ${c.loadCap} minutes of training.`
      : `The whole week can hold about ${Math.floor(c.loadCap / EFFORT_OF.steady)} minutes at a steady effort; hard minutes count for more, easy ones for less.`);
  }
  lines.push(`At most ${c.maxSessions} training ${c.maxSessions === 1 ? 'session' : 'sessions'} this week.`);
  if (c.maxMinutes !== null) lines.push(`At most ${c.maxMinutes} minutes of training this week${c.minutesRatio !== null && c.minutesRatio > HIGH_LOAD_RATIO ? ', because the last 7 days were heavier than usual' : ''}.`);
  const hard = c.usuallyHardDays.map((wd) => WEEKDAY_NAMES[wd]);
  lines.push(`Hard days go back to back only on days that are both usually hard${hard.length ? ` (usually hard: ${hard.join(', ')})` : ''}.`);
}

function readinessLine(tired) {
  if (!tired.length) return 'Sleep and resting heart rate look normal.';
  const cause = tired.length === BOTH_TIRED ? 'Sleep has been short and resting heart rate is up' : tired[0] === 'sleep' ? 'Sleep has been short lately' : 'Resting heart rate is up';
  return `${cause}: nothing hard today or tomorrow.`;
}

function raceLines(c, lines) {
  if (!(c.race && c.race.daysAway >= 0)) return;
  const last = parseDay(c.window.to);
  const raceDay = parseDay(c.race.date);
  if (raceDay - DAY_BEFORE_RACE <= last) lines.push(`Race ${dayWords(c.race.date)}: nothing else that day${c.race.daysAway >= DAY_BEFORE_RACE ? `, and rest on ${dayWords(c.race.restDay)}` : ''}.`);
  if (c.race.daysAway > DAY_BEFORE_RACE && raceDay - parseDay(c.window.from) <= TAPER_DAYS + DAYS - LAST_DAY_OFFSET) {
    lines.push(`With the race ${c.race.daysAway} days away, runs in the ${TAPER_DAYS} days before it stay at about four fifths of their usual length, the longest run at three fifths.`);
  }
}

function shoeLines(c, lines) {
  const arrives = c.newPairArrives;
  if (c.shoe && c.shoe.status === 'replace') lines.push(`The running shoes are nearly worn out: no run longer than ${WORN_RUN_MAX_MIN} minutes${arrives ? ` until the new pair arrives on ${dayWords(arrives)}` : ''}.`);
  if (arrives) lines.push(`The first two runs after the new pair arrives on ${dayWords(arrives)} are easy and at most ${BREAK_IN_MIN} minutes.`);
}

// Each day of the window: what is free, or that nothing is planned on a rest day or a day out.
function dayLines(c, lines) {
  const byDay = new Map();
  for (const f of c.freeSlots) {
    if (!byDay.has(f.day)) byDay.set(f.day, []);
    byDay.get(f.day).push(`${timeWords(f.start)} to ${timeWords(f.end)}`);
  }
  for (let d = parseDay(c.window.from); d <= parseDay(c.window.to); d += 1) lines.push(dayLine(c, byDay, d));
}

function dayLine(c, byDay, d) {
  const free = byDay.get(dayISO(d));
  const kind = c.days?.find((x) => x.day === dayISO(d))?.kind;
  if (kind === 'rest' || kind === 'out') return `${dayWords(dayISO(d))} is ${kind === 'rest' ? 'a rest day by the person\'s rules' : 'a day out'}: plan nothing.`;
  return free ? `Free on ${dayWords(dayISO(d))}: ${free.join(', ')}.` : `Nothing is free on ${dayWords(dayISO(d))}.`;
}

const listWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const ruleClock = (text) => clock(Number(text.slice(...CLOCK_HOURS)), Number(text.slice(...CLOCK_MINUTES)));

// The person's rules as sentences. Only home, out and rest reach the model: never where an event is or what it is called.
function rulesBrief(c, lines) {
  const r = c.rules;
  const never = r.restWeekdays.map((wd) => WEEKDAY_NAMES[wd]);
  lines.push(`The person's own rules: never plan on ${never.length ? `${listWords(never)}, or on ` : ''}a day they are out.`);
  lines.push(`Every day at home with time to train has exactly one strength session of ${r.sessionMinutes.min} to ${r.sessionMinutes.max} minutes, starting between ${ruleClock(r.window.from)} and ${ruleClock(r.window.to)}.`);
  for (const d of c.homeWeek.days) {
    if (d.focus) lines.push(`${dayWords(d.day)} is at home: a ${FOCUS_WORDS[d.focus]} strength session, first free at ${timeWords(d.first)}.`);
  }
  if (c.homeWeek.note) lines.push(c.homeWeek.note);
}

// One proposed session { id?, day, start, minutes, activity, intensity?, basedOn? } (start: ISO with offset, or HH:MM on `day`),
// or a calendar action { after: { start, end, activityType } }, as { index, start, end, day, minutes, activity, effort } or { index, error }.
function readSession(a, index, s) {
  if (!a || typeof a !== 'object') return { index, error: 'invalid_session' };
  try {
    return sessionOf(a, index, s) ?? { index, error: 'invalid_session' };
  } catch (e) {
    if (e instanceof InputError) return { index, error: 'invalid_session' };
    throw e;
  }
}

// The session read as readSession describes it, or null when it is not a session.
function sessionOf(a, index, s) {
  const basedOn = Array.isArray(a.basedOn) ? a.basedOn.filter((k) => typeof k === 'string') : [];
  const read = a.after && typeof a.after === 'object' ? readCalendarAction(a.after) : readOwnSession(a, s);
  if (read === null || !Number.isFinite(read.minutes) || read.minutes < 0) return null;
  const { minutes, activity, raw } = read;
  const start = { mic: read.start.mic, off: s.offOf?.(dayOf({ mic: read.start.mic, off: s.now.off })) ?? s.now.off };
  const intensity = a.intensity === 'moderate' ? 'steady' : a.intensity ?? null;
  if (intensity !== null && !INTENSITIES.includes(intensity)) return null;
  const day = dayOf(start);
  const effort = effortOf(s, { day, intensity, activity });
  return { index, id: typeof a.id === 'string' ? a.id : null, start, end: addUs(start, minutes * US_MIN), day, minutes, activity, raw, effort, basedOn };
}

function readCalendarAction(after) {
  const start = parseDT(after.start);
  return { start, minutes: (parseDT(after.end).mic - start.mic) / US_MIN, raw: after.activityType, activity: activityOf(after.activityType) };
}

// { day, start, minutes, activity }: start is ISO with an offset, or HH:MM on `day`. Null when the HH:MM or the day is wrong.
function readOwnSession(a, s) {
  const raw = a.activity;
  const activity = ACTIVITIES.includes(raw) ? raw : null;
  const minutes = Number(a.minutes);
  const t = typeof a.start === 'string' ? /^(\d{1,2}):(\d\d)$/.exec(a.start.trim()) : null;
  if (t && (+t[1] > LAST_HOUR || +t[2] > LAST_MINUTE)) return null;
  const start = t ? atDay(parseDay(a.day), s.offOf?.(parseDay(a.day)) ?? s.now.off, +t[1], +t[2]) : parseDT(a.start);
  if (!t && a.day !== undefined && a.day !== null && parseDay(a.day) !== dayOf(start)) return null;
  return { start, minutes, raw, activity };
}

// The effort of a session: its usual effort when the intensity matches the usual one, else the intensity's own.
function effortOf(s, { day, intensity, activity }) {
  const usual = s.week.get(weekdayOf(day));
  const usualEffort = usual && usual.effort !== null ? usual.effort : null;
  if (intensity === null) return activity === 'other' ? EFFORT_OF.steady : usualEffort ?? EFFORT_OF.steady; // `other` without an intensity is steady
  return usualEffort !== null && intensityOf(usualEffort) === intensity ? usualEffort : EFFORT_OF[intensity];
}

const dayName = (day) => WEEKDAY_NAMES[weekdayOf(day)];
const what = (x) => `${dayName(x.day)}'s ${NOUN[x.activity] ?? 'session'}`;
const listOf = (args) => args?.plan?.sessions ?? args?.plan?.actions ?? args?.sessions ?? args?.actions;

/** Every hard rule as a check on any plan: { pass, violations: [{ code, text, sessionId? }], hints: [{ code, action?, sessionId?, fix }] }; hints[i] is the fix for violations[i]. */
export function checkPlan(args) {
  const s = situation(args?.context);
  const list = listOf(args);
  if (!Array.isArray(list)) throw new InputError('bad_plan');
  const found = [];
  const add = (code, x, [text, fix]) => found.push({ code, text, fix, action: x ? x.index : null, sessionId: x && x.id ? x.id : null });
  const items = readItems(s, list, add);
  checkTimes(s, items, add);
  checkOverlaps(items, add);
  const planned = checkLoad(s, items, add);
  checkTired(s, items, add);
  checkRace(s, items, add);
  checkShoes(s, items, add);
  checkCounts(s, items, add);
  checkStreak(s, items, add);
  checkHardDays(s, items, add);
  if (s.rules) checkRules(s, items, add);
  return verdict(s, found, planned);
}

// The sessions of a plan that book something, in time order; what cannot be read is a violation.
function readItems(s, list, add) {
  const items = [];
  list.forEach((a, index) => {
    if (a && a.kind === 'note' && !a.after) return; // a note (race day) books nothing
    const x = readSession(a, index, s);
    if (x.error) add(x.error, { index, id: typeof a?.id === 'string' ? a.id : null }, ['This session could not be read: it needs a day, a start time, an activity and minutes.', 'send day (YYYY-MM-DD), start (ISO 8601 with offset), activity, minutes']);
    else if (x.activity === null) add('unknown_activity', x, [`"${String(x.raw)}" is not an activity this app knows.`, `use one of: ${ACTIVITIES.join(', ')}`]);
    else if (x.activity !== 'rest') items.push(x);
  });
  return items.sort((a, b) => a.start.mic - b.start.mic || a.index - b.index);
}

// Each session on its own: its length, the window, the calendar, stopped usual times and the memory keys it cites.
function checkTimes(s, items, add) {
  // The window: 7 local days starting today (with rules, the home week); today only from an hour after now, and done by 22:00.
  const w = { end: atDay(s.today + s.days, s.offOf(s.today + s.days)).mic, earliest: s.now.mic + TODAY_LEAD_MIN * US_MIN, todayEnd: atDay(s.today, s.now.off, TODAY_END_HOUR).mic };
  for (const x of items) {
    checkDuration(x, add);
    checkWindow({ s, w, x }, add);
    checkBusy(s, x, add);
    checkStopped(s, x, add);
    checkKeys(s, x, add);
  }
}

function checkDuration(x, add) {
  if (x.minutes < MIN_MINUTES) add('bad_duration', x, [`${what(x)} is shorter than ${MIN_MINUTES} minutes.`, `lengthen to ≥${MIN_MINUTES} min`]);
  else if (x.minutes > MAX_MINUTES) add('bad_duration', x, [`${what(x)} is longer than ${MAX_MINUTES} minutes.`, `shorten to ≤${MAX_MINUTES} min`]);
}

function checkWindow({ s, w, x }, add) {
  if (x.start.mic < s.now.mic) add('outside_window', x, [`${what(x)} is in the past.`, `move to ${hhmm({ mic: w.earliest, off: s.now.off })} or later`]);
  else if (x.start.mic >= w.end) add('outside_window', x, [`${what(x)} is outside the ${s.days} days that start today.`, `move to ${dayISO(s.today + s.days - 1)} or earlier`]);
  else if (x.start.mic < w.earliest) add('outside_window', x, [`${what(x)} starts too soon to get ready for.`, `move to ${hhmm({ mic: w.earliest, off: s.now.off })} or later`]);
  else if (x.day === s.today && x.end.mic > w.todayEnd) add('outside_window', x, [`${what(x)} would end too late tonight.`, `end by ${TODAY_END_HOUR}:00 or move to tomorrow`]);
}

function checkBusy(s, x, add) {
  const busy = s.calendar.find((b) => b.start.mic < x.end.mic && x.start.mic < b.end.mic);
  if (busy) add('calendar_conflict', x, [`${what(x)} overlaps ${busy.title ? `"${busy.title}"` : 'something'} on your calendar.`, `move after ${hhmm({ mic: busy.end.mic, off: s.now.off })}`]);
}

function checkStopped(s, x, add) {
  if (!isStopped(s.stopped, x.activity, weekdayOf(x.day), hourOf(x.start))) return;
  const hit = s.stopped.find((y) => y.activity === (x.activity === 'long_run' ? 'run' : x.activity) && y.weekday === weekdayOf(x.day) && y.hour === hourOf(x.start));
  add('stopped_slot', x, [`You asked me not to plan ${dayName(x.day)} ${clock(hit.hour)} ${hit.activity === 'other' ? hit.label || 'sessions' : PLURAL[hit.activity]}.`, 'move to another hour or remove this session']);
}

function checkKeys(s, x, add) {
  for (const key of x.basedOn) {
    if (s.stoppedKeys.includes(key)) add('stopped_memory_key', x, [`${what(x)} leans on a habit you asked to stop.`, 'remove this session']);
    else if (!s.memoryKeys.includes(key)) add('unknown_memory_key', x, [`${what(x)} cites a memory that is not there.`, 'remove that key from basedOn']);
  }
}

function checkOverlaps(items, add) {
  items.forEach((x, i) => {
    const next = items[i + 1];
    if (next && next.start.mic < x.end.mic) add('overlap', next, [`${what(next)} starts before ${what(x)} ends.`, `move after ${hhmm(x.end)}`]);
  });
}

// Weekly load against the person's usual: at most 110% of the larger of last week and the 4-week average, and 1.3 times that average.
// A week whose sessions are all at the shortest length (20 minutes) is never asked to shrink further. Returns the planned load.
function checkLoad(s, items, add) {
  const planned = pySum(items.map((x) => (s.unit === 'minutes' ? x.minutes : x.effort * x.minutes)));
  if (s.loadCap !== null && planned > s.loadCap * LOAD_SLACK && items.some((x) => x.minutes > MIN_SESSION)) {
    const perMinute = s.unit === 'minutes' ? 1 : planned / Math.max(1, pySum(items.map((x) => x.minutes)));
    add('load_over_cap', null, ['This week adds up to more than your body is used to.', `shorten the week by ${Math.ceil((planned - s.loadCap) / perMinute)} min in total`]);
  }
  return planned;
}

// Readiness: after poor sleep or a raised resting heart rate, nothing hard today or tomorrow.
function checkTired(s, items, add) {
  if (!s.tired.length) return;
  for (const x of items) {
    if (x.day <= s.today + TOMORROW && x.effort >= HARD_EFFORT) add('hard_when_tired', x, [`${what(x)} is a hard one, and ${s.tired.map((k) => TIRED_WORDS[k]).join(' and ')}.`, 'make it easy']);
  }
}

// Race: nothing on race day or the day before, and shorter runs in the 10 days before.
function checkRace(s, items, add) {
  if (s.raceDate === null) return;
  for (const x of items) {
    const toRace = s.raceDate - x.day;
    if (toRace === 0) add('race_day_session', x, ['Race day is for the race alone.', 'remove this session']);
    else if (toRace === DAY_BEFORE_RACE) add('no_rest_before_race', x, ['The day before your race is a rest day.', 'remove this session']);
    else if (toRace > 0 && toRace <= TAPER_DAYS && isRun(x.activity)) checkTaper(s, x, add);
  }
}

function checkTaper(s, x, add) {
  const runMinutes = [...s.week.values()].filter((u) => u.activity === 'run' && u.minutes !== null).map((u) => u.minutes);
  const wd = weekdayOf(x.day);
  const usual = s.week.get(wd);
  const base = usual && usual.activity === 'run' && usual.minutes !== null ? usual.minutes * (wd === s.long ? TAPER_LONG_SHARE : TAPER_SHARE)
    : runMinutes.length ? pyMedian(runMinutes) * TAPER_SHARE : null;
  const limit = base === null ? TAPER_RUN_MAX_MIN : Math.max(MIN_SESSION, pyRound(base));
  if (x.minutes > limit) add('taper_too_long', x, [`${what(x)} is too long this close to your race.`, `shorten to ≤${limit} min`]);
}

// Shoes: no long runs in a worn-out pair, and two short easy runs to break a new pair in.
function checkShoes(s, items, add) {
  let brokenIn = 0;
  for (const x of items.filter((y) => isRun(y.activity))) {
    const arrived = s.newPairArrives !== null && x.day > s.newPairArrives;
    if (s.shoe && s.shoe.status === 'replace' && !arrived && x.minutes > WORN_RUN_MAX_MIN) {
      add('worn_shoes_long_run', x, [`${what(x)} is too long for shoes this worn.`, `shorten to ≤${WORN_RUN_MAX_MIN} min or switch to ride`]);
    } else if (arrived && brokenIn < BREAK_IN_RUNS) {
      checkBreakIn(x, add);
      brokenIn += 1;
    }
  }
}

function checkBreakIn(x, add) {
  if (x.minutes > BREAK_IN_MIN) add('break_in_too_long', x, [`${what(x)} is too long for a first run in new shoes.`, `shorten to ≤${BREAK_IN_MIN} min`]);
  if (x.effort > EASY_EFFORT) add('break_in_not_easy', x, [`${what(x)} should be easy while your new shoes break in.`, 'make it easy']);
}

// Sessions: at most the usual training days plus one, or 3 while there is less than two weeks of history.
// Minutes: no more than the usual week after a heavy 7 days, and no more than 1.1 times it otherwise.
function checkCounts(s, items, add) {
  if (items.length > s.maxSessions) {
    const extra = items.length - s.maxSessions;
    add('too_many_sessions', null, [`This week has ${items.length} sessions, and ${s.maxSessions} is the most that fits you for now.`, `remove ${extra} ${extra === 1 ? 'session' : 'sessions'}`]);
  }
  const totalMinutes = items.reduce((sum, x) => sum + x.minutes, 0);
  if (s.minutes.limit !== null && totalMinutes > s.minutes.limit) {
    add('too_many_minutes', null, [`This week adds up to ${pyRound(totalMinutes)} minutes, and ${s.minutes.limit} is the most that fits you for now.`, `shorten the week by ${Math.ceil(totalMinutes - s.minutes.limit)} min in total`]);
  }
}

// Rest: no more days in a row than the usual week has.
function checkStreak(s, items, add) {
  const days = [...new Set(items.map((x) => x.day))].sort((a, b) => a - b);
  let run = 0;
  days.forEach((d, i) => {
    run = i && d === days[i - 1] + 1 ? run + 1 : 1;
    if (run === s.streak + 1) add('too_many_days_in_a_row', items.find((it) => it.day === d), [`${dayName(d)} would be day ${run} in a row without a rest.`, 'remove this session or move it after a rest day']);
  });
}

// Hard days side by side only where the usual week has them.
function checkHardDays(s, items, add) {
  const hardDays = new Map();
  for (const x of items) if (x.effort >= HARD_EFFORT && !hardDays.has(x.day)) hardDays.set(x.day, x);
  const usuallyHard = (d) => { const u = s.week.get(weekdayOf(d)); return Boolean(u && u.effort !== null && u.effort >= HARD_EFFORT); };
  for (const [d, x] of hardDays) {
    if (hardDays.has(d - 1) && !(usuallyHard(d) && usuallyHard(d - 1))) add('back_to_back_hard', x, [`${what(x)} is hard and so is the day before.`, 'make it easy or move it a day later']);
  }
}

function verdict(s, found, planned) {
  found.sort((a, b) => (a.action ?? WEEK_ORDER) - (b.action ?? WEEK_ORDER));
  const where = (v) => ({ ...(v.action === null ? {} : { action: v.action }), ...(v.sessionId ? { sessionId: v.sessionId } : {}) });
  return {
    pass: found.length === 0,
    violations: found.map((v) => ({ code: v.code, text: v.text, ...(v.sessionId ? { sessionId: v.sessionId } : {}) })),
    hints: found.map((v) => ({ code: v.code, ...where(v), fix: v.fix })),
    load: { unit: s.unit, planned: pyRound(planned), cap: s.loadCap },
  };
}

// The person's rules: nothing on a rest day or a day out, home sessions within their hours and length, and no day at
// home with time to train left without one.
function checkRules(s, items, add) {
  for (const x of items) checkRuleDay(s, x, add);
  for (const d of s.homeWeek.days) {
    if (d.first === null || items.some((x) => x.day === d.day && x.activity === 'strength')) continue;
    add('home_day_missing', null, [`${dayName(d.day)} is a day at home, and every day at home has a workout.`,
      `add a ${s.rules.session.max}-minute strength session on ${dayISO(d.day)} at ${hhmm({ mic: d.first, off: s.offOf(d.day) })}`]);
  }
}

function checkRuleDay(s, x, add) {
  const kind = kindOf(s.rules, s.dayKinds, x.day);
  if (kind === 'rest') add('rest_day_rule', x, [`${dayName(x.day)} is a day you never train.`, 'remove this session']);
  else if (kind === 'out') add('out_day_rule', x, [`You are out on ${dayName(x.day)}, so nothing is planned that day.`, 'remove this session']);
  else if (x.activity === 'strength') checkHomeSession(s, x, add);
}

function checkHomeSession(s, x, add) {
  const r = s.rules;
  const minute = (x.start.mic - atDay(x.day, s.offOf(x.day)).mic) / US_MIN;
  if (minute < r.window.from || minute > r.window.to) add('outside_rule_hours', x, [`${what(x)} starts outside the hours you allow.`, `start between ${ruleTime(r.window.from)} and ${ruleTime(r.window.to)}`]);
  if (x.minutes < r.session.min || x.minutes > r.session.max) add('session_length_rule', x, [`${what(x)} is not ${r.session.min} to ${r.session.max} minutes long.`, `make it ${r.session.max} min`]);
}

const ruleTime = (minutes) => clock(Math.floor(minutes / MINUTES_PER_HOUR), minutes % MINUTES_PER_HOUR);

/** Why one session is in the week, in plain words, with the memory rows it rests on. */
export function explainAction(args) {
  const action = args?.action ?? args?.session;
  if (!action || typeof action !== 'object') throw new InputError('bad_action');
  const mem = readMemory(args.memory);
  const basedOn = Array.isArray(action.basedOn) ? action.basedOn.filter((k) => typeof k === 'string') : [];
  const reasons = Array.isArray(action.reasons) ? action.reasons.map((r) => r?.text).filter((t) => typeof t === 'string' && t) : [];
  const parts = reasons.length ? [...new Set(reasons)] : [typeof action.reason === 'string' && action.reason ? action.reason : 'This session is part of your usual week.'];
  const memory = basedOn.map((key) => {
    if (mem.stoppedKeys.includes(key)) return { key, found: false, text: 'You asked to stop this habit, so it will not be suggested again.' };
    const slot = mem.slots.find((x) => x.key === key);
    const row = mem.rows.find((r) => r.key === key);
    if (slot) {
      const seen = Number.isInteger(slot.weeksSeen) && Number.isInteger(slot.weeksTotal) ? `, seen in ${slot.weeksSeen} of the last ${slot.weeksTotal} weeks` : '';
      const habit = slot.activity === 'other' ? slot.label ?? 'a session' : `a ${NOUN[slot.activity]}`;
      return { key, found: true, text: `It comes from a habit in your memory: ${habit} on ${WEEKDAY_NAMES[slot.weekday]}s around ${clock(slot.hour)}${seen}.` };
    }
    if (row) return { key, found: true, text: typeof row.statement === 'string' && row.statement ? `It comes from your memory: ${row.statement}` : 'It comes from your memory.' };
    return { key, found: false, text: 'The habit it came from is no longer in your memory.' };
  });
  return { text: [...parts, ...memory.map((x) => x.text)].join(' '), basedOn, memory };
}

/** Calendar conflicts and overlaps of a week: [{ code, action, id, start, end, text, fix }]. */
export function checkWeek(args) {
  const list = listOf(args);
  if (!Array.isArray(list)) throw new InputError('bad_plan');
  const first = list.find((a) => a && typeof (a.after?.start ?? a.start) === 'string' && (a.after?.start ?? a.start).length > 5);
  const now = parseDT(args.now ?? first?.after?.start ?? first?.start ?? '1970-01-01T00:00:00Z');
  const s = { now, week: new Map() };
  const calendar = (args.calendar ?? args.busy ?? []).map((b) => ({ start: parseDT(b.start), end: parseDT(b.end), title: typeof b.title === 'string' ? b.title : null }));
  const items = [];
  list.forEach((a, index) => {
    if (a && a.kind === 'note' && !a.after) return;
    const x = readSession(a, index, s);
    if (!x.error && x.activity !== 'rest') items.push(x);
  });
  items.sort((a, b) => a.start.mic - b.start.mic || a.index - b.index);
  const conflicts = [];
  const at = (mic) => isoDT({ mic, off: now.off });
  items.forEach((x, i) => {
    for (const b of calendar) {
      if (b.start.mic < x.end.mic && x.start.mic < b.end.mic) {
        conflicts.push({ code: 'calendar_conflict', action: x.index, id: x.id, title: b.title, start: at(b.start.mic), end: at(b.end.mic),
          text: `${what(x)} overlaps ${b.title ? `"${b.title}"` : 'something'} on your calendar.`, fix: `move after ${hhmm({ mic: b.end.mic, off: now.off })}` });
      }
    }
    const next = items[i + 1];
    if (next && next.start.mic < x.end.mic) {
      conflicts.push({ code: 'overlap', action: next.index, id: next.id, title: null, start: at(x.start.mic), end: at(x.end.mic),
        text: `${what(next)} starts before ${what(x)} ends.`, fix: `move after ${hhmm(x.end)}` });
    }
  });
  return { conflicts };
}
