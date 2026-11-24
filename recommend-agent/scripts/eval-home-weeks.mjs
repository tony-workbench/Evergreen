// Thirty made-up weeks of home training, each graded by code. A week passes when:
//   - no session falls on a rest weekday or a day out, and every day at home with a free half hour has one (checkPlan);
//   - no session holds a movement the person lacks the equipment for, has put on the avoid list or marked "can't do",
//     nor one that comes before its easier step is done (checkContent);
//   - no session runs past the person's longest session, and at most one movement in it is new;
//   - with two sessions or more, every main movement pattern gets at least four sets in the week.
// The bar is all thirty passing. Run: node scripts/eval-home-weeks.mjs (exits 1 when any case fails).
import { pathToFileURL } from 'node:url';
import { planContext, checkPlan } from '../src/plan.mjs';
import { recommendWeek } from '../src/workouts.mjs';
import { readRules } from '../src/rules.mjs';
import { weekContent, checkContent, movementOf, MAIN_PATTERNS, WEEK_FLOOR_SETS } from '../src/content.mjs';

const MONDAY = '2026-11-30';
const DAYS = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
const LAST_WEEK = ['2026-11-23', '2026-11-24', '2026-11-26', '2026-11-27'];
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

/** The thirty cases, each { name, rules, dayKinds, calendar, last }. */
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
    return {
      name: `week ${n + 1}: ${4 - outs.length} days at home, ${rules.equipment.length} things to train with, last week ${LAST[n % LAST.length]}`,
      rules,
      dayKinds: Object.fromEntries(outs.map((i) => [DAYS[i], 'out'])),
      calendar: DAYS.flatMap((day) => busy.map((b) => ({ start: at(day, b.start), end: at(day, b.end) }))),
      last: LAST[n % LAST.length],
    };
  });
}

// Last week's log: every set at the top of the range ("done"), or one session and the rest skipped ("missed").
function lastWeek(c) {
  if (c.last === 'none') return { history: [], lastPain: undefined };
  const days = c.last === 'done' ? LAST_WEEK : LAST_WEEK.slice(0, 1);
  const before = weekContent({ rules: c.rules, sessions: days.map((d) => ({ sessionId: d, focus: 'full' })) });
  const history = before.contents.flatMap((content, k) => content.items.map((i) => {
    const top = (i.reps ?? i.seconds)[1];
    return { movementId: i.movementId, day: days[k], sets: Array(i.sets).fill(c.last === 'done' ? top : (i.reps ?? i.seconds)[0]), ...(i.load ? { load: i.load } : {}) };
  }));
  return { history, lastPain: c.last === 'missed' ? 4 : undefined };
}

/** The week the planner and the content builder make for one case. */
export function makeWeek(c) {
  const ctx = { now: at(MONDAY, '08:00'), memory: { rows: [] }, history: { workouts: [], daily: [] }, calendar: c.calendar, rules: c.rules, dayKinds: c.dayKinds };
  const plan = recommendWeek(ctx);
  const days = planContext(ctx).homeWeek.days;
  const { history, lastPain } = lastWeek(c);
  const training = days.filter((d) => d.focus);
  const week = training.length ? weekContent({ rules: c.rules, history, lastPain, sessions: training.map((d) => ({ sessionId: `home-${d.day}`, focus: d.focus })) }) : { contents: [] };
  return { ctx, plan, days, history, contents: week.contents };
}

/** Every reason the week fails, as { code, text }; an empty list is a pass. */
export function grade(c, made) {
  const fails = [];
  const add = (code, text) => fails.push({ code, text });
  const rules = readRules(c.rules);
  for (const v of checkPlan({ plan: { sessions: made.plan.sessions }, context: made.ctx }).violations) add(v.code, v.text);
  const kinds = new Map(made.days.map((d) => [d.day, d.kind]));
  for (const s of made.plan.sessions) {
    const kind = kinds.get(s.start.slice(0, 10));
    if (kind !== 'home') add('session_on_' + (kind ?? 'unknown') + '_day', `A session is planned on ${s.start.slice(0, 10)}, a day ${kind ?? 'outside the week'}.`);
  }
  for (const content of made.contents) {
    for (const v of checkContent({ content, rules: c.rules, history: made.history, minutes: rules.session.max }).violations) add(v.code, `${content.sessionId}: ${v.text}`);
    if (content.minutes > rules.session.max) add('session_too_long', `${content.sessionId} takes ${content.minutes} minutes.`);
    for (const i of content.items) {
      const m = movementOf(i.movementId);
      if (m && m.equipment.some((e) => !rules.equipment.includes(e) && !['floor', 'wall'].includes(e))) add('equipment_not_owned', `${content.sessionId}: ${m.name}.`);
    }
  }
  if (made.contents.length >= 2) {
    for (const v of checkContent({ content: { items: [] }, rules: c.rules, week: made.contents }).violations) {
      if (v.code === 'sets_below_floor') add(v.code, v.text);
    }
  }
  return fails;
}

/** Runs every case: { passed, total, failures: [{ name, fails }] }. */
export function evaluate(list = cases()) {
  const failures = [];
  for (const c of list) {
    const fails = grade(c, makeWeek(c));
    if (fails.length) failures.push({ name: c.name, fails });
  }
  return { passed: list.length - failures.length, total: list.length, failures };
}

export { MAIN_PATTERNS, WEEK_FLOOR_SETS };

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = evaluate();
  for (const f of result.failures) console.log(`FAIL ${f.name}\n  ${f.fails.map((x) => `${x.code}: ${x.text}`).join('\n  ')}`);
  console.log(`${result.passed} of ${result.total} weeks pass.`);
  process.exitCode = result.passed === result.total ? 0 : 1;
}
