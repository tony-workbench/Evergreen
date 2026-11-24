// Thirty made-up weeks of home training, graded by code, in five comparisons of one lever each against a committed baseline.
//
// Promise (plan 4.2, 5.C and section 6; eval-genius step 1): for any week of days at home, out and at rest, any equipment,
// avoid list and "can't do", rain or none, and any last week, the week the rules build keeps every hard rule; a movement
// steps up only when plan 4.2 says it has earned it; a session holds four or five movements and fits the person's longest
// session timed at the top of every range; each main pattern reaches for 8 to 10 sets a week and never goes past ten; and
// the rules engine plans the same split as the model's context from what the phone sent.
//
// Arms. BEFORE is the engine at BEFORE_COMMIT (c247786, the commit this change set started from). Each LEVER-ONLY arm is
// BEFORE with exactly one lever's patch from scripts/eval-home-weeks.levers/ applied, so each comparison varies one lever.
// AFTER is the engine in src/ now (every lever). `--record-baseline` builds BEFORE and the five lever-only arms from git
// into a temporary folder outside the repo, runs this same grader on each and writes eval-home-weeks.baseline.json; a
// plain run grades AFTER against it. The five patches together reproduce AFTER's weeks on all thirty cases (only the
// article "a/an" in a reason differs, a wording fix no check reads).
//
// Controls, frozen in every arm and comparison: the thirty cases below; the movement library (data/movements.json; the
// record refuses an archived library that differs); the calendar and the clock (Monday 30 November 2026, 08:00, UTC-8);
// the histories, built here from the library and never by the engine under test; and this grader, which measures sessions
// with its own worst-case timer and its own counts, calling the engine only to build weeks, for checkPlan and checkContent's
// rule checks (equipment, avoid list, gate, new movements, weekly floor) and for proposedContent in `picks`.
// Outliers: none are dropped; the run is deterministic and every case counts.
// After the first recording run, and before the baseline was kept, the floor guard got its room rule: three AFTER weeks of
// two 20-minute days could not hold four sets of legs pushing at worst-case time. No bar, lever or case moved.
//
// The five comparisons (lever: outcome; bar; falsifier). Bars were written before any arm ran, from the plan, not from a run.
//   earning   lever: what earns a step (two sessions in a row with every set at the top count, "Too hard" never counts, the
//             slow step takes two slow sessions, the harder movement waits for one heavier backpack step instead of 12 kg,
//             a movement left out is never a way up). Outcome, on three probes per case built from the library's entry
//             movements the person can use: `unearned` = probes after ONE session at the top, or two with the second marked
//             "Too hard", whose next week steps up (slower, heavier or the next movement up); `earned` = probes after TWO
//             sessions in a row at the top whose next week steps up. Bar: unearned 0, earned at least BEFORE's. Falsifier:
//             one unearned step, or fewer earned steps than BEFORE.
//   items     lever: a session holds 4 to 5 movements (MIN_ITEMS 4, other chains of the focus fill it, movements below four
//             go only when one set of each still runs over). Outcome: sessions under four movements, sessions over five.
//             Bar: both 0. Falsifier: one session under four or over five.
//   weekSets  lever: each main pattern reaches for 8 to 10 sets a week and never more than 10 (sets added toward eight while
//             a session has the minutes, a movement or a set taken off above ten). Outcome, over weeks of two sessions or
//             more: pattern-weeks above ten sets, and pattern-weeks below eight. Bar: above ten 0, below eight fewer than
//             BEFORE's. Falsifier: one pattern-week above ten, or as many below eight as BEFORE.
//   timing    lever: a session's time is counted at the top of each range (the longest it can run). Outcome: sessions that
//             run past the person's longest session timed by this grader's worst case (every set at the top of its range,
//             2 s slower per rep when slow, the rests, 30 s to set up each movement). Bar: 0. Falsifier: one session over.
//   queue     lever: the rules engine reads the phone's queue and "done today" as planContext does. Outcome, on one probe
//             per case with a fixed queue (home days cycling upper, lower, full from the second one) and doneToday: days
//             whose kind or focus differ between recommendWeek's home week and planContext's. Bar: 0. Falsifier: one day.
// Guards, held by every arm (a lever-only arm below BEFORE on a guard falsifies that lever: it broke something else), and
// by AFTER on all thirty weeks:
//   plan       checkPlan finds nothing: no session on a rest weekday or a day out, every day at home with a free half hour
//              has one, inside the person's hours and length;
//   days       no session is planned on a day that is not at home;
//   movements  checkContent finds no movement the person lacks the equipment for, has left out or marked "can't do", nor
//              one that comes before its easier step is done;
//   equipment  the same, counted again here from the library's equipment lists;
//   new        at most one movement in a session is new (checkContent);
//   floor      with two sessions or more, every main pattern the person can do gets at least four sets (checkContent),
//              unless no session can take one more set of it at worst-case time, by adding one or by taking one from a
//              pattern above four (so a week is never held to sets that would run its sessions over);
//   rain       rain changes nothing: it reaches the engine only as the short breaks the phone puts on the calendar, and
//              every rainy day at home keeps its strength session, with the same focus and movements;
//   progress   after a week with every entry movement done four times at the top, something steps up; after a week done
//              four times at the bottom, nothing does;
//   picks      scripted answers in place of a model: the rules' own movements in another order pass proposedContent; a
//              movement not in the library, a locked harder movement or six sets of everything fail it with their own code;
//              a plan with a session on a rest day fails checkPlan.
// And a week known to be wrong (a rest-day session, an avoided movement, a session far too long, too many sets of a
// pattern) must fail on each of KNOWN_BAD_CODES.
// Run: node scripts/eval-home-weeks.mjs (exits 1 on a problem), or with --record-baseline to rebuild the baseline.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import library from '../data/movements.json' with { type: 'json' };

export const BASELINE = new URL('./eval-home-weeks.baseline.json', import.meta.url);
export const LEVERS_DIR = new URL('./eval-home-weeks.levers/', import.meta.url);
export const BEFORE_COMMIT = 'c247786';
export const GUARDS = ['plan', 'days', 'movements', 'equipment', 'new', 'floor', 'rain', 'progress', 'picks'];
export const LEVERS = ['earning', 'items', 'weekSets', 'timing', 'queue'];
export const KNOWN_BAD_CODES = ['rest_day_rule', 'session_on_rest_day', 'avoided_movement', 'session_over_time', 'sets_above_ten'];

const MOVEMENT = new Map(library.movements.map((m) => [m.id, m]));
const ALWAYS_THERE = ['floor', 'wall'];
const MAIN_PATTERNS = ['lower_push', 'lower_pull', 'upper_push', 'upper_pull'];
const MONDAY = '2026-11-30';
const DAYS = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
const LAST_WEEK = ['2026-11-23', '2026-11-24', '2026-11-26', '2026-11-27'];
const WEEK_BEFORE = ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20'];
const HOME_WEEKDAYS = [0, 1, 3, 4];
const QUEUE_CYCLE = ['upper', 'lower', 'full'];
const at = (day, time) => `${day}T${time}:00-08:00`;

// The ways a week can differ. Each case takes one of each by its number, so thirty cases cover every value.
const OUTS = [[], [0], [3], [0, 1], [1, 4], [0, 1, 3], [0, 1, 3, 4]];           // days out: 4, 3, 3, 2, 2, 1 and 0 days at home
const EQUIPMENT = [
  ['backpack', 'chair', 'table', 'sofa', 'book', 'step'],
  [],
  ['chair'],
  ['backpack', 'step'],
  ['table', 'sofa'],
];
const AVOID = [[], ['glute_bridge'], ['wall_push_up', 'sit_to_stand'], ['backpack_row', 'dead_bug', 'hip_hinge']];
const MOVEMENTS = [{}, { sit_to_stand: 'cannot' }, { knee_push_up: 'can', table_push_up: 'can' }];
const LAST = ['none', 'done', 'missed'];
const BUSY = [[], [{ start: '12:00', end: '17:30' }], [{ start: '09:00', end: '19:00' }]];
const SESSION = [{ min: 20, max: 25 }, { min: 15, max: 20 }, { min: 25, max: 30 }];
const RAIN = ['none', 'first', 'all'];                                         // which days at home it rains on
const BREAKS = [['14:40', '14:46'], ['15:25', '15:31'], ['18:00', '18:06']];   // a rainy day's short breaks, once on the calendar
const CASE_COUNT = 30;
const RAIN_TURN = 3;                 // the rain pattern moves on every third case
const DATE_LENGTH = 10;              // 'YYYY-MM-DD'
const START_LOAD_KG = 2;             // a backpack movement's load when the library gives none
const SLOW_EXTRA_SECONDS = 2;        // a slow rep's added seconds
const PLAIN_REP_SECONDS = 3;         // a rep of a movement with no tempo
const SETUP_SECONDS = 30;            // setting up each movement
const SECONDS_PER_MINUTE = 60;
const TWO_SESSIONS = 2;              // the week checks need at least two sessions
const MAX_ITEM_SETS = 6;
const FLOOR_SETS = 4;
const MIN_ITEMS = 4;
const MAX_ITEMS = 5;
const WEEK_MAX_SETS = 10;
const WEEK_MIN_SETS = 8;
const PICK_SETS = 3;                 // a scripted bad pick's sets
const OVER_TIME_SETS = 6;            // every item at this many sets runs over time
const TEMPLATE_MINUTES = 20;
const BAD_BRIDGE = { sets: 6, reps: [10, 15], rest: 90 };
const PATCH_SUFFIX = '.patch';
const JSON_INDENT = 2;
const GUARD_WIDTH = 10;
const COUNT_WIDTH = 2;

const homeDayIndexes = (outs) => HOME_WEEKDAYS.filter((i) => !outs.includes(i));
const rainDays = (outs, rain) => (rain === 'none' ? [] : homeDayIndexes(outs).slice(0, rain === 'first' ? 1 : HOME_WEEKDAYS.length).map((i) => DAYS[i]));

const pick = (list, n) => list[n % list.length];

const caseRules = (n) => ({ equipment: pick(EQUIPMENT, n), avoid: pick(AVOID, n), movements: pick(MOVEMENTS, n), sessionMinutes: pick(SESSION, n) });

const caseName = (n, { outs, rules, rain }) => `week ${n + 1}: ${HOME_WEEKDAYS.length - outs.length} days at home, ${rules.equipment.length} things to train with, ${rules.avoid.length} left out, last week ${pick(LAST, n)}, rain on ${rain.length}`;

function caseOf(n) {
  const outs = pick(OUTS, n);
  const rules = caseRules(n);
  const busy = pick(BUSY, n);
  const rain = rainDays(outs, RAIN[Math.floor(n / RAIN_TURN) % RAIN.length]);
  return {
    name: caseName(n, { outs, rules, rain }),
    rules,
    dayKinds: Object.fromEntries(outs.map((i) => [DAYS[i], 'out'])),
    calendar: DAYS.flatMap((day) => busy.map((b) => ({ start: at(day, b.start), end: at(day, b.end) }))),
    last: pick(LAST, n),
    rain,
    homeDays: homeDayIndexes(outs).map((i) => DAYS[i]),
  };
}

/** The thirty cases, each { name, rules, dayKinds, calendar, last, rain, homeDays }. */
export function cases() {
  return Array.from({ length: CASE_COUNT }, (_, n) => caseOf(n));
}

// ---- The engine under test ----------------------------------------------------------------------------------------

/** The engine's entry points from a folder holding plan.mjs, workouts.mjs and content.mjs (src/ by default). */
export async function loadEngine(dir = new URL('../src/', import.meta.url)) {
  const load = (file) => import(new URL(file, dir).href);
  const [plan, workouts, content] = await Promise.all([load('plan.mjs'), load('workouts.mjs'), load('content.mjs')]);
  return {
    planContext: plan.planContext, checkPlan: plan.checkPlan, recommendWeek: workouts.recommendWeek,
    weekContent: content.weekContent, checkContent: content.checkContent, proposedContent: content.proposedContent, PATTERN_WORDS: content.PATTERN_WORDS,
  };
}

// ---- Histories, from the library alone ----------------------------------------------------------------------------

const owns = (rules, m) => m.equipment.every((e) => rules.equipment.includes(e) || ALWAYS_THERE.includes(e));
const leftOut = (rules, m) => rules.avoid.includes(m.id) || rules.movements[m.id] === 'cannot';
/** The chains' first movements the person can use: what any engine may plan with no history. */
export const entryMovements = (rules) => library.movements.filter((m) => m.entry && owns(rules, m) && !leftOut(rules, m));

// One session of each entry movement on each day, every set at the top of its range (`top`) or at the bottom, with the
// library's starting backpack load; `marks` ({ tooHard }) go on the last day's entries.
function logOf(rules, days, { top = true, tooHard = false } = {}) {
  return days.flatMap((day, k) => entryMovements(rules).map((m) => {
    const range = m.dose.reps ?? m.dose.seconds;
    const entry = { movementId: m.id, day, sets: Array(m.dose.sets).fill(range[top ? 1 : 0]) };
    if (m.equipment.includes('backpack')) entry.load = m.load ?? START_LOAD_KG;
    if (tooHard && k === days.length - 1) entry.tooHard = true;
    return entry;
  }));
}

function lastWeek(c) {
  if (c.last === 'none') return [];
  return c.last === 'done' ? logOf(c.rules, LAST_WEEK) : logOf(c.rules, WEEK_BEFORE, { top: false });
}

// ---- Making a week ----------------------------------------------------------------------------------------------------

const breaksOn = (days) => days.flatMap((day) => BREAKS.map(([start, end]) => ({ start: at(day, start), end: at(day, end) })));

/**
 * The week `engine` makes for case `c`: { ctx, plan, days, history, contents }, and `dry` (the same week without rain).
 * `over` may set { history, phone }: a history in place of the case's last week, and phone fields (queue, doneToday).
 */
export function makeWeek(engine, c, over = {}) {
  const ctx = { now: at(MONDAY, '08:00'), memory: { rows: [] }, history: { workouts: [], daily: [] }, calendar: [...c.calendar, ...breaksOn(c.rain ?? [])], rules: c.rules, dayKinds: c.dayKinds, ...over.phone };
  const plan = engine.recommendWeek(ctx);
  const days = engine.planContext(ctx).homeWeek.days;
  const history = over.history ?? lastWeek(c);
  const training = days.filter((d) => d.focus);
  const week = training.length ? engine.weekContent({ rules: c.rules, history, sessions: training.map((d) => ({ sessionId: `home-${d.day}`, focus: d.focus })) }) : { contents: [] };
  const made = { ctx, plan, days, history, contents: week.contents };
  if (c.rain?.length) made.dry = makeWeek(engine, { ...c, rain: [] }, over);
  return made;
}

// ---- This grader's own measures -------------------------------------------------------------------------------------

const repSeconds = (m, slow) => (m.tempo ? m.tempo.down + m.tempo.hold + m.tempo.up + (slow ? SLOW_EXTRA_SECONDS : 0) : PLAIN_REP_SECONDS);
const worstSeconds = (i, m) => i.sets * (i.reps ? i.reps[1] * repSeconds(m, i.slow === true) : i.seconds[1]) * m.sides + Math.max(0, i.sets - 1) * i.rest + SETUP_SECONDS;
/** Minutes a session takes at worst: every set at the top of its range, the rests, and 30 seconds to set up each movement. */
export const worstMinutes = (items) => Math.ceil(items.reduce((sum, i) => sum + worstSeconds(i, MOVEMENT.get(i.movementId)), 0) / SECONDS_PER_MINUTE);

const setsOf = (contents) => {
  const out = Object.fromEntries(MAIN_PATTERNS.map((p) => [p, 0]));
  for (const i of contents.flatMap((c) => c.items)) if (MOVEMENT.get(i.movementId)?.pattern in out) out[MOVEMENT.get(i.movementId).pattern] += i.sets;
  return out;
};

/** Items that step up from `history`: slower, heavier than the last load, or the next movement up from one already done. */
export function stepsUp(contents, history) {
  const done = (id) => history.some((h) => h.movementId === id);
  const lastLoad = (id) => history.filter((h) => h.movementId === id && h.load).at(-1)?.load ?? null;
  const next = (i) => !done(i.movementId) && done(MOVEMENT.get(i.movementId).easier);
  return contents.flatMap((c) => c.items).filter((i) => i.slow || (i.load && lastLoad(i.movementId) !== null && i.load > lastLoad(i.movementId)) || next(i));
}

// ---- Grading one week ---------------------------------------------------------------------------------------------------

function gradeDays(made, add) {
  const kinds = new Map(made.days.map((d) => [d.day, d.kind]));
  for (const s of made.plan.sessions) {
    const kind = kinds.get(s.start.slice(0, DATE_LENGTH));
    if (kind !== 'home') add('days', `session_on_${kind ?? 'unknown'}_day`, `A session is planned on ${s.start.slice(0, DATE_LENGTH)}, a day ${kind ?? 'outside the week'}.`);
  }
}

const CONTENT_GUARD = { too_many_new: 'new', sets_below_floor: 'floor' };
const ENGINE_TIMED = ['session_too_long', 'item_count', 'sets_above_target'];   // this grader times and counts these itself

// checkContent's rule checks, per session and for the week; the engine's own timing and counts are left to this grader.
function gradeRules(engine, { c, made }, add) {
  const rule = (v, where) => !ENGINE_TIMED.includes(v.code) && add(CONTENT_GUARD[v.code] ?? 'movements', v.code, `${where}${v.text}`);
  for (const content of made.contents) {
    for (const v of engine.checkContent({ content, rules: c.rules, history: made.history }).violations) rule(v, `${content.sessionId}: `);
  }
  if (made.contents.length < TWO_SESSIONS) return;
  const room = { contents: made.contents, longest: c.rules.sessionMinutes.max };
  const short = (v) => v.code === 'sets_below_floor' && floorExcused(room, patternIn(engine, v.text));
  for (const v of engine.checkContent({ content: { items: [] }, rules: c.rules, week: made.contents }).violations) if (!short(v)) rule(v, '');
}

const patternOf = (i) => MOVEMENT.get(i.movementId).pattern;
const patternIn = (engine, text) => MAIN_PATTERNS.find((p) => text.includes(`sets of ${engine.PATTERN_WORDS[p]};`));
const withSets = (items, changes) => items.map((x) => (changes.has(x) ? { ...x, sets: x.sets + changes.get(x) } : x));

// A main pattern below four sets is let off only when no session can take one more set of it, timed at worst: no movement
// of it has room for one more set (at most six), and no movement of a pattern above four in the same session can give one.
function floorExcused(room, pattern) {
  const fits = (items) => worstMinutes(items) <= room.longest;
  return !room.contents.some((c) => c.items.some((i) => patternOf(i) === pattern && i.sets < MAX_ITEM_SETS && (fits(withSets(c.items, new Map([[i, 1]]))) || swapFits(room, c, i))));
}

function swapFits(room, c, i) {
  const sets = setsOf(room.contents);
  const donors = c.items.filter((d) => d !== i && d.sets > 1 && MAIN_PATTERNS.includes(patternOf(d)) && sets[patternOf(d)] > FLOOR_SETS);
  return donors.some((d) => worstMinutes(withSets(c.items, new Map([[i, 1], [d, -1]]))) <= room.longest);
}

function gradeSessions(c, made, add) {
  const longest = c.rules.sessionMinutes.max;
  for (const content of made.contents) {
    const minutes = worstMinutes(content.items);
    if (minutes > longest) add('timing', 'session_over_time', `${content.sessionId} takes up to ${minutes} minutes; at most ${longest}.`);
    if (content.items.length < MIN_ITEMS) add('items', 'under_four', `${content.sessionId} has ${content.items.length} movements.`);
    if (content.items.length > MAX_ITEMS) add('items', 'over_five', `${content.sessionId} has ${content.items.length} movements.`);
  }
  const used = made.contents.flatMap((content) => content.items.map((i) => ({ content, m: MOVEMENT.get(i.movementId) })));
  for (const { content, m } of used.filter((u) => u.m && !owns(c.rules, u.m))) add('equipment', 'equipment_not_owned', `${content.sessionId}: ${m.name}.`);
}

function gradeWeekSets(made, add) {
  if (made.contents.length < TWO_SESSIONS) return;
  const sets = setsOf(made.contents);
  for (const p of MAIN_PATTERNS.filter((x) => sets[x] > WEEK_MAX_SETS)) add('weekSets', 'sets_above_ten', `The week has ${sets[p]} sets of ${p}.`);
  for (const p of MAIN_PATTERNS.filter((x) => sets[x] > 0 && sets[x] < WEEK_MIN_SETS)) add('weekSets', 'sets_below_eight', `The week has ${sets[p]} sets of ${p}.`);
}

const sameMovements = (a, b) => JSON.stringify(a.map((x) => x.items)) === JSON.stringify(b.map((x) => x.items));
const trains = (m) => m.days.filter((d) => d.focus).map((d) => `${d.day}:${d.focus}`).join();

function gradeRain(c, made, add) {
  if (!made.dry) return;
  if (trains(made) !== trains(made.dry)) add('rain', 'rain_changed_days', `Rain changed the days at home that train: ${trains(made)} against ${trains(made.dry)}.`);
  if (!sameMovements(made.contents, made.dry.contents)) add('rain', 'rain_changed_movements', 'Rain changed what a session holds.');
  for (const day of c.rain) if (!made.plan.sessions.some((s) => s.start.startsWith(day))) add('rain', 'rain_day_dropped', `${day} is a rainy day at home with no strength session.`);
}

function gradeProgress(c, made, add) {
  if (c.last === 'none' || !made.contents.length) return;
  const stepped = stepsUp(made.contents, made.history);
  if (c.last === 'done' && !stepped.length) add('progress', 'no_step_after_done_week', 'Every set was at the top last week, and nothing steps up.');
  if (c.last === 'missed' && stepped.length) add('progress', 'step_after_missed_week', `Last week was missed, and ${stepped.map((i) => i.movementId).join(', ')} stepped up.`);
}

// The scripted answers a model might give for one session: the rules' own picks in another order (good), and three bad ones.
const asProposal = (items) => ({ items: items.map((i) => ({ movementId: i.movementId, sets: i.sets })) });
// Each bad answer must fail with its own code, so a check that fails for another reason doesn't hide a missing one.
export const SCRIPTED_BAD = {
  unknown_movement: { code: 'unknown_movement', items: (items) => [{ movementId: 'pull_up', sets: PICK_SETS }, ...asProposal(items.slice(1)).items] },
  locked_movement: { code: 'gated_movement', items: (items) => [{ movementId: 'pike_push_up', sets: PICK_SETS }, ...asProposal(items.slice(1)).items] },
  over_time: { code: 'session_too_long', items: (items) => items.map((i) => ({ movementId: i.movementId, sets: OVER_TIME_SETS })) },
};

// One session's scripted picks through proposedContent: `at` is { c, made, content }.
function gradeSessionPicks(engine, at, add) {
  const { c, made, content } = at;
  const ask = (proposal) => engine.proposedContent({ proposal, sessionId: content.sessionId, focus: content.focus, rules: c.rules, history: made.history, week: made.contents, rulesWeek: made.contents });
  const good = ask(asProposal([...content.items].reverse()));
  if (!good.pass) add('picks', 'good_picks_refused', `${content.sessionId}: ${good.violations.map((v) => v.text).join(' ')}`);
  for (const [name, bad] of Object.entries(SCRIPTED_BAD)) {
    const r = ask({ items: bad.items(content.items) });
    if (r.pass || !r.violations.some((v) => v.code === bad.code)) add('picks', `${name}_passed`, `${content.sessionId}: picks with ${name.replace('_', ' ')} were not refused as ${bad.code}.`);
  }
}

function gradePicks(engine, { c, made }, add) {
  for (const content of made.contents) gradeSessionPicks(engine, { c, made, content }, add);
  const rest = made.days.find((d) => d.kind === 'rest');
  const template = made.plan.sessions[0] ?? { id: 'ses-rest', activity: 'strength', minutes: TEMPLATE_MINUTES, intensity: 'steady', reason: 'A strength session.', basedOn: [] };
  const onRest = { ...template, id: 'ses-on-rest', day: rest.day, start: `${rest.day}T13:00:00-08:00` };
  const codes = engine.checkPlan({ plan: { sessions: [...made.plan.sessions, onRest] }, context: made.ctx }).violations.map((v) => v.code);
  if (!codes.includes('rest_day_rule')) add('picks', 'rest_day_plan_passed', `A plan with a session on ${rest.day}, a rest day, passed checkPlan.`);
}

/** Every finding on one week, as { check, code, text }: a guard's or a comparison's (items, weekSets, timing). */
export function grade(engine, c, made) {
  const fails = [];
  const add = (check, code, text) => fails.push({ check, code, text });
  for (const v of engine.checkPlan({ plan: { sessions: made.plan.sessions }, context: made.ctx }).violations) add('plan', v.code, v.text);
  gradeDays(made, add);
  gradeRules(engine, { c, made }, add);
  gradeSessions(c, made, add);
  gradeWeekSets(made, add);
  gradeRain(c, made, add);
  gradeProgress(c, made, add);
  gradePicks(engine, { c, made }, add);
  return fails;
}

// ---- The probes of the earning and queue comparisons ----------------------------------------------------------------

const PROBES = { once: { days: ['2026-11-27'] }, tooHard: { days: ['2026-11-26', '2026-11-27'], tooHard: true }, twice: { days: ['2026-11-26', '2026-11-27'] } };

/** Per probe kind, the cases whose next week steps up, of those with a session and an entry movement to log. */
function earning(engine, list) {
  const out = { unearned: 0, earned: 0, probes: { once: 0, tooHard: 0, twice: 0 } };
  const runs = list.filter((x) => x.homeDays.length && entryMovements(x.rules).length).flatMap((c) => Object.keys(PROBES).map((kind) => ({ c, kind })));
  for (const { c, kind } of runs) {
    const history = logOf(c.rules, PROBES[kind].days, { tooHard: PROBES[kind].tooHard === true });
    out.probes[kind] += 1;
    if (stepsUp(makeWeek(engine, { ...c, rain: [] }, { history }).contents, history).length) out[kind === 'twice' ? 'earned' : 'unearned'] += 1;
  }
  return out;
}

/** The phone fields of the queue probe: home days from the second on queue upper, lower, full in turn; today is done. */
export const queueOf = (c) => ({ queue: Object.fromEntries(c.homeDays.slice(1).map((day, k) => [day, QUEUE_CYCLE[k % QUEUE_CYCLE.length]])), doneToday: true });

/** Days whose kind or focus differ between recommendWeek's home week and planContext's, with the queue probe. */
function queueAgreement(engine, list) {
  let disagree = 0;
  for (const c of list) {
    const ctx = { now: at(MONDAY, '08:00'), memory: { rows: [] }, history: { workouts: [], daily: [] }, calendar: c.calendar, rules: c.rules, dayKinds: c.dayKinds, ...queueOf(c) };
    const rules = engine.recommendWeek(ctx).homeWeek.days.map((d) => `${d.day}:${d.kind}:${d.focus}`);
    const model = engine.planContext(ctx).homeWeek.days.map((d) => `${d.day}:${d.kind}:${d.focus}`);
    disagree += model.filter((d, k) => d !== rules[k]).length + Math.abs(model.length - rules.length);
  }
  return { disagree, probes: list.length };
}

// ---- One run of the grader on one engine --------------------------------------------------------------------------------

/** A week known to be wrong: a session on a rest day, an avoided movement, a session far too long, too many sets. */
export function knownBadWeek(engine) {
  const c = { ...cases()[0], rules: { ...cases()[0].rules, avoid: ['glute_bridge'] } };
  const made = structuredClone(makeWeek(engine, cases()[0]));
  const rest = made.days.find((d) => d.kind === 'rest');
  made.plan.sessions.push({ ...made.plan.sessions[0], id: 'extra', day: rest.day, start: `${rest.day}T13:00:00-08:00`, end: `${rest.day}T13:25:00-08:00` });
  made.contents[0].items.push({ movementId: 'glute_bridge', sets: BAD_BRIDGE.sets, reps: [...BAD_BRIDGE.reps], rest: BAD_BRIDGE.rest, isNew: false });
  made.contents[1].items.push({ movementId: 'glute_bridge', sets: BAD_BRIDGE.sets, reps: [...BAD_BRIDGE.reps], rest: BAD_BRIDGE.rest, isNew: false });
  return { c, made };
}

const count = (fails, check, code) => fails.filter((f) => f.check === check && (!code || f.code === code)).length;

/**
 * Runs the grader on `engine`: { total, guards: { guard: weeks passing }, outcomes: { lever: numbers }, failures, knownBad }.
 * `failures` lists each week's guard findings; comparison findings are counted in `outcomes`.
 */
export function evaluate(engine, list = cases()) {
  const guards = Object.fromEntries(GUARDS.map((g) => [g, list.length]));
  const outcomes = { items: { underFour: 0, overFive: 0, sessions: 0 }, weekSets: { aboveTen: 0, belowEight: 0 }, timing: { overTime: 0, sessions: 0 } };
  const failures = [];
  for (const c of list) {
    const made = makeWeek(engine, c);
    const fails = grade(engine, c, made);
    tally(outcomes, { fails, made });
    for (const g of new Set(fails.filter((f) => GUARDS.includes(f.check)).map((f) => f.check))) guards[g] -= 1;
    if (fails.some((f) => GUARDS.includes(f.check))) failures.push({ name: c.name, fails: fails.filter((f) => GUARDS.includes(f.check)) });
  }
  const bad = knownBadWeek(engine);
  const knownBad = [...new Set(grade(engine, bad.c, bad.made).map((f) => f.code))];
  return { total: list.length, guards, outcomes: { earning: earning(engine, list), ...outcomes, queue: queueAgreement(engine, list) }, failures, knownBad };
}

function tally(outcomes, { fails, made }) {
  outcomes.items.sessions += made.contents.length;
  outcomes.timing.sessions += made.contents.length;
  outcomes.items.underFour += count(fails, 'items', 'under_four');
  outcomes.items.overFive += count(fails, 'items', 'over_five');
  outcomes.weekSets.aboveTen += count(fails, 'weekSets', 'sets_above_ten');
  outcomes.weekSets.belowEight += count(fails, 'weekSets', 'sets_below_eight');
  outcomes.timing.overTime += count(fails, 'timing', 'session_over_time');
}

// ---- Bars and verdicts --------------------------------------------------------------------------------------------------

/** Each comparison's bar, as the problems an arm's outcome has against BEFORE's. Empty: the bar holds. */
export const BARS = {
  earning: (o, before) => [
    ...(o.unearned > 0 ? [`${o.unearned} probes stepped up without two sessions in a row that count; the bar is 0`] : []),
    ...(o.earned < before.earned ? [`${o.earned} probes stepped up after two sessions in a row, fewer than BEFORE's ${before.earned}`] : []),
  ],
  items: (o) => (o.underFour + o.overFive > 0 ? [`${o.underFour} sessions under four movements and ${o.overFive} over five; the bar is 0`] : []),
  weekSets: (o, before) => [
    ...(o.aboveTen > 0 ? [`${o.aboveTen} pattern-weeks above ten sets; the bar is 0`] : []),
    ...(o.belowEight >= before.belowEight ? [`${o.belowEight} pattern-weeks below eight sets, not fewer than BEFORE's ${before.belowEight}`] : []),
  ],
  timing: (o) => (o.overTime > 0 ? [`${o.overTime} sessions run past the longest session at worst; the bar is 0`] : []),
  queue: (o) => (o.disagree > 0 ? [`${o.disagree} days differ between the rules engine and planContext; the bar is 0`] : []),
};

const guardDrops = (arm, before) => GUARDS.filter((g) => arm.guards[g] < before.guards[g]).map((g) => `guard ${g}: ${arm.guards[g]} of ${arm.total}, below BEFORE's ${before.guards[g]}`);

/** What falsifies one lever-only arm: its comparison's bar missed against BEFORE, or a guard below BEFORE's. */
export const leverProblems = (lever, arm, before) => [...BARS[lever](arm.outcomes[lever], before.outcomes[lever]), ...guardDrops(arm, before)];

/** What stops the run on AFTER: a guard below every week, a comparison's bar missed, or the known-bad week passing. */
export function verdict(result, baseline) {
  const problems = GUARDS.filter((g) => result.guards[g] < result.total).map((g) => `guard ${g}: ${result.guards[g]} of ${result.total}; the bar is every week`);
  for (const lever of LEVERS) problems.push(...BARS[lever](result.outcomes[lever], baseline.before.outcomes[lever]).map((p) => `${lever}: ${p}`));
  const missed = KNOWN_BAD_CODES.filter((code) => !result.knownBad.includes(code));
  if (missed.length) problems.push(`the known-bad week was not caught on ${missed.join(', ')}`);
  return problems;
}

// ---- Recording the baseline from BEFORE and the lever-only arms ------------------------------------------------------------

const REPO = fileURLToPath(new URL('../../', import.meta.url));

// BEFORE_COMMIT's recommend-agent src/ and data/ in a new folder outside the repo, with one lever's patch applied if named.
function armFolder(lever) {
  const dir = mkdtempSync(join(tmpdir(), `eval-home-${lever ?? 'before'}-`));
  const tar = join(dir, 'engine.tar');
  execFileSync('git', ['-C', REPO, 'archive', '--format=tar', '-o', tar, `${BEFORE_COMMIT}:recommend-agent`, 'src', 'data']);
  execFileSync('tar', ['-xf', tar, '-C', dir]);
  if (lever) execFileSync('git', ['apply', '-p1', fileURLToPath(new URL(`${lever}.patch`, LEVERS_DIR))], { cwd: dir });
  const archived = readFileSync(join(dir, 'data', 'movements.json'), 'utf8');
  if (JSON.stringify(JSON.parse(archived)) !== JSON.stringify(library)) throw new Error(`The library at ${BEFORE_COMMIT} differs from data/movements.json: the control moved.`);
  return dir;
}

/** Grades BEFORE (no lever) or one lever-only arm, built from git in a temporary folder: { total, guards, outcomes }. */
export async function runArm(lever) {
  const dir = armFolder(lever);
  try {
    const r = await evaluate(await loadEngine(pathToFileURL(join(dir, 'src/'))));
    return { total: r.total, guards: r.guards, outcomes: r.outcomes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Builds BEFORE and each lever-only arm from git, grades each, and writes the baseline. Returns the lever problems. */
export async function recordBaseline() {
  const patches = readdirSync(LEVERS_DIR).filter((f) => f.endsWith(PATCH_SUFFIX)).map((f) => f.slice(0, -PATCH_SUFFIX.length)).sort();
  if (JSON.stringify(patches) !== JSON.stringify([...LEVERS].sort())) throw new Error(`The lever patches (${patches.join(', ')}) are not the levers (${LEVERS.join(', ')}).`);
  const before = await runArm(null);
  const levers = {};
  for (const lever of LEVERS) levers[lever] = await runArm(lever);
  writeFileSync(BASELINE, `${JSON.stringify({ source: { commit: BEFORE_COMMIT, path: 'recommend-agent/src', levers: 'scripts/eval-home-weeks.levers/<lever>.patch' }, before, levers }, null, JSON_INDENT)}\n`);
  return Object.fromEntries(LEVERS.map((l) => [l, leverProblems(l, levers[l], before)]));
}

// ---- The report ---------------------------------------------------------------------------------------------------------

const show = (o) => Object.entries(o).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');

function report(result, baseline) {
  for (const f of result.failures) console.log(`FAIL ${f.name}\n  ${f.fails.map((x) => `${x.check} ${x.code}: ${x.text}`).join('\n  ')}`);
  console.log('guard      AFTER  BEFORE');
  for (const g of GUARDS) console.log(`${g.padEnd(GUARD_WIDTH)} ${String(result.guards[g]).padStart(COUNT_WIDTH)}/${result.total}  ${baseline.before.guards[g]}/${baseline.before.total}`);
  for (const lever of LEVERS) {
    console.log(`\n${lever}\n  BEFORE       ${show(baseline.before.outcomes[lever])}\n  lever only   ${show(baseline.levers[lever].outcomes[lever])}`);
    console.log(`  AFTER        ${show(result.outcomes[lever])}`);
    const missed = leverProblems(lever, baseline.levers[lever], baseline.before);
    console.log(`  bar, lever only: ${missed.length ? `MISSED: ${missed.join('; ')}` : 'holds'}`);
  }
  console.log(`\nThe known-bad week fails on ${result.knownBad.join(', ') || 'nothing'}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const recorded = process.argv.includes('--record-baseline') ? await recordBaseline() : null;
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const result = evaluate(await loadEngine());
  report(result, baseline);
  const problems = [...verdict(result, baseline), ...Object.entries(recorded ?? {}).flatMap(([l, ps]) => ps.map((p) => `lever ${l}: ${p}`))];
  for (const p of problems) console.log(`PROBLEM ${p}`);
  console.log(`${result.total - result.failures.length} of ${result.total} weeks hold every guard; ${LEVERS.length - LEVERS.filter((l) => BARS[l](result.outcomes[l], baseline.before.outcomes[l]).length).length} of ${LEVERS.length} bars hold on AFTER.`);
  process.exitCode = problems.length ? 1 : 0;
}
