// Thirty made-up weeks of home training, each graded by code, against a committed baseline. A week passes a check when:
//   plan       checkPlan finds nothing: no session on a rest weekday or a day out, every day at home with a free half hour
//              has one, inside the person's hours and length;
//   days       no session is planned on a day that is not at home;
//   movements  checkContent finds no movement the person lacks the equipment for, has put on the avoid list or marked
//              "can't do", nor one that comes before its easier step is done;
//   equipment  the same, counted again from the library's equipment lists;
//   length     no session runs past the person's longest session;
//   new        at most one movement in a session is new;
//   sets       with two sessions or more, every main movement pattern gets at least four sets in the week;
//   rain       rain changes nothing: it reaches the engine only as the short breaks the phone puts on the calendar, and
//              with them every rainy day at home still has its strength session, with the same focus and movements;
//   progress   after a week with every session done at the top of the range, something steps up (slower, heavier or the
//              next movement); after a week with every session missed, nothing does.
// The bar is every check passing on all thirty weeks, and a week known to be wrong failing. The baseline file holds the
// pass count of each check; a run below it, or below thirty, fails.
// Run: node scripts/eval-home-weeks.mjs (exits 1 on a failure), or with --write-baseline to record the current counts.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planContext, checkPlan } from '../src/plan.mjs';
import { recommendWeek } from '../src/workouts.mjs';
import { readRules } from '../src/rules.mjs';
import { weekContent, checkContent, movementOf, MAIN_PATTERNS, WEEK_FLOOR_SETS } from '../src/content.mjs';

export const BASELINE = new URL('./eval-home-weeks.baseline.json', import.meta.url);
export const CHECKS = ['plan', 'days', 'movements', 'equipment', 'length', 'new', 'sets', 'rain', 'progress'];
const MONDAY = '2026-11-30';
const DAYS = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
const LAST_WEEK = ['2026-11-23', '2026-11-24', '2026-11-26', '2026-11-27'];
const WEEK_BEFORE = ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20'];
const HOME_WEEKDAYS = [0, 1, 3, 4];
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

const homeDayIndexes = (outs) => HOME_WEEKDAYS.filter((i) => !outs.includes(i));
const rainDays = (outs, rain) => (rain === 'none' ? [] : homeDayIndexes(outs).slice(0, rain === 'first' ? 1 : 4).map((i) => DAYS[i]));

/** The thirty cases, each { name, rules, dayKinds, calendar, last, rain }. */
export function cases() {
  return Array.from({ length: 30 }, (_, n) => {
    const outs = OUTS[n % OUTS.length];
    const rules = {
      equipment: EQUIPMENT[n % EQUIPMENT.length],
      avoid: AVOID[n % AVOID.length],
      movements: MOVEMENTS[n % MOVEMENTS.length],
      sessionMinutes: SESSION[n % SESSION.length],
    };
    const busy = BUSY[n % BUSY.length];
    const rain = rainDays(outs, RAIN[Math.floor(n / 3) % RAIN.length]);
    return {
      name: `week ${n + 1}: ${4 - outs.length} days at home, ${rules.equipment.length} things to train with, ${rules.avoid.length} left out, last week ${LAST[n % LAST.length]}, rain on ${rain.length}`,
      rules,
      dayKinds: Object.fromEntries(outs.map((i) => [DAYS[i], 'out'])),
      calendar: DAYS.flatMap((day) => busy.map((b) => ({ start: at(day, b.start), end: at(day, b.end) }))),
      last: LAST[n % LAST.length],
      rain,
    };
  });
}

// A week of full-body sessions as the person did them: every set at the top of its range, or at the bottom.
function logOf(rules, days, setAt) {
  const before = weekContent({ rules, sessions: days.map((d) => ({ sessionId: d, focus: 'full' })) });
  return before.contents.flatMap((content, k) => content.items.map((i) => {
    const range = i.reps ?? i.seconds;
    return { movementId: i.movementId, day: days[k], sets: Array(i.sets).fill(setAt === 'top' ? range[1] : range[0]), ...(i.load ? { load: i.load } : {}) };
  }));
}

// Last week's log: every session done with every set at the top ("done"), or none done after a week at the bottom of each
// range the week before ("missed").
function lastWeek(c) {
  if (c.last === 'none') return [];
  return c.last === 'done' ? logOf(c.rules, LAST_WEEK, 'top') : logOf(c.rules, WEEK_BEFORE, 'bottom');
}

const breaksOn = (days) => days.flatMap((day) => BREAKS.map(([start, end]) => ({ start: at(day, start), end: at(day, end) })));

/** The week the planner and the content builder make for one case; with rain, also the same week without it. */
export function makeWeek(c) {
  const ctx = { now: at(MONDAY, '08:00'), memory: { rows: [] }, history: { workouts: [], daily: [] }, calendar: [...c.calendar, ...breaksOn(c.rain ?? [])], rules: c.rules, dayKinds: c.dayKinds };
  const plan = recommendWeek(ctx);
  const days = planContext(ctx).homeWeek.days;
  const history = lastWeek(c);
  const training = days.filter((d) => d.focus);
  const week = training.length ? weekContent({ rules: c.rules, history, sessions: training.map((d) => ({ sessionId: `home-${d.day}`, focus: d.focus })) }) : { contents: [] };
  const made = { ctx, plan, days, history, contents: week.contents };
  if (c.rain?.length) made.dry = makeWeek({ ...c, rain: [] });
  return made;
}

const sameMovements = (a, b) => JSON.stringify(a.map((x) => x.items)) === JSON.stringify(b.map((x) => x.items));

function gradeRain(c, made, add) {
  if (!made.dry) return;
  const trains = (m) => m.days.filter((d) => d.focus).map((d) => `${d.day}:${d.focus}`).join();
  if (trains(made) !== trains(made.dry)) add('rain', 'rain_changed_days', `Rain changed the days at home that train: ${trains(made)} against ${trains(made.dry)}.`);
  if (!sameMovements(made.contents, made.dry.contents)) add('rain', 'rain_changed_movements', 'Rain changed what a session holds.');
  for (const day of c.rain) if (!made.plan.sessions.some((s) => s.start.startsWith(day))) add('rain', 'rain_day_dropped', `${day} is a rainy day at home with no strength session.`);
}

// After every set at the top: an item is slower, heavier or a movement not done before. After a missed week: none is.
function gradeProgress(c, made, add) {
  if (c.last === 'none' || !made.contents.length) return;
  const lastLoad = (id) => made.history.filter((h) => h.movementId === id && h.load).at(-1)?.load ?? null;
  const stepped = made.contents.flatMap((x) => x.items).filter((i) => i.slow || (i.load && lastLoad(i.movementId) !== null && i.load > lastLoad(i.movementId))
    || !made.history.some((h) => h.movementId === i.movementId) && !movementOf(i.movementId).entry);
  if (c.last === 'done' && !stepped.length) add('progress', 'no_step_after_done_week', 'Every set was at the top last week, and nothing steps up.');
  if (c.last === 'missed' && stepped.length) add('progress', 'step_after_missed_week', `Last week was missed, and ${stepped.map((i) => i.movementId).join(', ')} stepped up.`);
}

function gradeContent(c, made, add) {
  const rules = readRules(c.rules);
  for (const content of made.contents) {
    for (const v of checkContent({ content, rules: c.rules, history: made.history, minutes: rules.session.max }).violations) {
      add(v.code === 'session_too_long' ? 'length' : v.code === 'too_many_new' ? 'new' : 'movements', v.code, `${content.sessionId}: ${v.text}`);
    }
    if (content.minutes > rules.session.max) add('length', 'session_too_long', `${content.sessionId} takes ${content.minutes} minutes.`);
    for (const i of content.items) {
      const m = movementOf(i.movementId);
      if (m && m.equipment.some((e) => !rules.equipment.includes(e))) add('equipment', 'equipment_not_owned', `${content.sessionId}: ${m.name}.`);
    }
  }
  if (made.contents.length < 2) return;
  for (const v of checkContent({ content: { items: [] }, rules: c.rules, week: made.contents }).violations) if (v.code === 'sets_below_floor') add('sets', v.code, v.text);
}

/** Every reason the week fails, as { check, code, text }; an empty list is a pass. */
export function grade(c, made) {
  const fails = [];
  const add = (check, code, text) => fails.push({ check, code, text });
  for (const v of checkPlan({ plan: { sessions: made.plan.sessions }, context: made.ctx }).violations) add('plan', v.code, v.text);
  const kinds = new Map(made.days.map((d) => [d.day, d.kind]));
  for (const s of made.plan.sessions) {
    const kind = kinds.get(s.start.slice(0, 10));
    if (kind !== 'home') add('days', `session_on_${kind ?? 'unknown'}_day`, `A session is planned on ${s.start.slice(0, 10)}, a day ${kind ?? 'outside the week'}.`);
  }
  gradeContent(c, made, add);
  gradeRain(c, made, add);
  gradeProgress(c, made, add);
  return fails;
}

/** A week known to be wrong: a session on a rest day, an avoided movement and a session far too long. It must fail. */
export function knownBadWeek() {
  const c = { ...cases()[0], rules: { ...cases()[0].rules, avoid: ['glute_bridge'] } };
  const made = structuredClone(makeWeek(cases()[0]));
  const rest = made.days.find((d) => d.kind === 'rest');
  made.plan.sessions.push({ ...made.plan.sessions[0], id: 'extra', day: rest.day, start: `${rest.day}T13:00:00-08:00`, end: `${rest.day}T13:25:00-08:00` });
  made.contents[0].items.push({ movementId: 'glute_bridge', sets: 6, reps: [10, 15], rest: 90, isNew: false });
  return { c, made };
}

/** Runs every case: { passed, total, failures: [{ name, fails }], checks: { check: weeks passing }, knownBad: [code] }. */
export function evaluate(list = cases()) {
  const failures = [];
  const checks = Object.fromEntries(CHECKS.map((k) => [k, list.length]));
  for (const c of list) {
    const fails = grade(c, makeWeek(c));
    for (const k of new Set(fails.map((f) => f.check))) checks[k] -= 1;
    if (fails.length) failures.push({ name: c.name, fails });
  }
  const bad = knownBadWeek();
  return { passed: list.length - failures.length, total: list.length, failures, checks, knownBad: [...new Set(grade(bad.c, bad.made).map((f) => f.code))] };
}

/** What stops the run: a check below the baseline or below every week, or the known-bad week passing. */
export function verdict(result, baseline) {
  const problems = [];
  for (const k of CHECKS) {
    if (result.checks[k] < (baseline.checks[k] ?? result.total)) problems.push(`${k}: ${result.checks[k]} of ${result.total}, below the baseline of ${baseline.checks[k]}`);
    else if (result.checks[k] < result.total) problems.push(`${k}: ${result.checks[k]} of ${result.total}; the bar is every week`);
  }
  const missed = (baseline.knownBad ?? []).filter((code) => !result.knownBad.includes(code));
  if (!result.knownBad.length || missed.length) problems.push(`the known-bad week was not caught${missed.length ? ` on ${missed.join(', ')}` : ''}`);
  return problems;
}

export { MAIN_PATTERNS, WEEK_FLOOR_SETS };

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = evaluate();
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(BASELINE, `${JSON.stringify({ total: result.total, checks: result.checks, knownBad: result.knownBad }, null, 2)}\n`);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  for (const f of result.failures) console.log(`FAIL ${f.name}\n  ${f.fails.map((x) => `${x.check} ${x.code}: ${x.text}`).join('\n  ')}`);
  for (const k of CHECKS) console.log(`${k.padEnd(10)} ${result.checks[k]} of ${result.total} (baseline ${baseline.checks[k]})`);
  console.log(`The known-bad week fails on ${result.knownBad.join(', ') || 'nothing'}.`);
  const problems = verdict(result, baseline);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  console.log(`${result.passed} of ${result.total} weeks pass.`);
  process.exitCode = problems.length ? 1 : 0;
}
