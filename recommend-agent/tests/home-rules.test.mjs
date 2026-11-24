// The person's rules and the kind of each day: rest weekdays and days out stay empty, every day at home with time gets
// one session, the week's split follows how many days are at home, and each new checkPlan code fails when it should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planContext, planBrief, checkPlan } from '../src/plan.mjs';
import { recommendWeek } from '../src/workouts.mjs';
import { readRules } from '../src/rules.mjs';

const MONDAY = '2026-11-30';
const at = (day, time) => `${day}T${time}:00-08:00`;
const DAYS = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
const base = (over = {}) => ({ now: at(MONDAY, '08:00'), memory: { rows: [] }, history: { workouts: [], daily: [] }, calendar: [], rules: {}, ...over });
const weekOf = (ctx) => planContext(ctx).homeWeek.days;
const codes = (r) => r.violations.map((v) => v.code);

test('without rules the planner keeps the usual week', () => {
  const c = planContext(base({ rules: undefined }));
  assert.equal(c.rules, undefined);
  assert.equal(c.homeWeek, undefined);
});

test('rest weekdays and days out get nothing; every other day is at home and trains', () => {
  const days = weekOf(base({ dayKinds: { [DAYS[3]]: 'out' } }));
  assert.deepEqual(days.map((d) => d.kind), ['home', 'home', 'rest', 'out', 'home', 'rest', 'rest']);
  assert.deepEqual(days.map((d) => d.focus !== null), [true, true, false, false, true, false, false]);
});

test('a rest weekday in the rules wins over a day the phone called home', () => {
  const days = weekOf(base({ dayKinds: { [DAYS[2]]: 'home' } }));
  assert.equal(days[2].kind, 'rest');
});

test('the split follows the days at home: 4 alternate, 3 full, 2 full, 1 full with a note, 0 nothing with a note', () => {
  const split = (outs) => {
    const c = planContext(base({ dayKinds: Object.fromEntries(outs.map((i) => [DAYS[i], 'out'])) }));
    return { focus: c.homeWeek.days.filter((d) => d.focus).map((d) => d.focus), note: c.homeWeek.note };
  };
  assert.deepEqual(split([]).focus, ['lower', 'upper', 'lower', 'upper']);
  assert.deepEqual(split([0]).focus, ['full', 'full_lower', 'full_upper']);       // Thursday and Friday are in a row
  assert.deepEqual(split([3]).focus, ['full_lower', 'full_upper', 'full']);       // Monday and Tuesday are in a row
  assert.deepEqual(split([0, 1]).focus, ['full', 'full']);
  const one = split([0, 1, 3]);
  assert.deepEqual(one.focus, ['full']);
  assert.match(one.note, /only one day at home/);
  const none = split([0, 1, 3, 4]);
  assert.deepEqual(none.focus, []);
  assert.match(none.note, /no day at home/i);
});

test('a missed session moves to the next day at home and the rest follow it', () => {
  const days = weekOf(base({ carry: ['upper'] }));
  assert.deepEqual(days.filter((d) => d.focus).map((d) => d.focus), ['upper', 'lower', 'upper', 'lower']);
});

test('sessions start inside the rules’ hours, with later fallbacks the same day', () => {
  const days = weekOf(base({ calendar: [{ start: at(MONDAY, '12:00'), end: at(MONDAY, '16:40') }] }));
  assert.equal(days[0].first, at(MONDAY, '16:40'));
  assert.deepEqual(days[0].fallbacks, [at(MONDAY, '18:10'), at(MONDAY, '19:40')]);
  assert.equal(days[1].first, at(DAYS[1], '12:00'));
});

test('a day at home with no free half hour inside the hours has no session and is not asked for', () => {
  const ctx = base({ calendar: [{ start: at(MONDAY, '11:00'), end: at(MONDAY, '21:00') }] });
  assert.equal(weekOf(ctx)[0].first, null);
  const week = recommendWeek(ctx);
  assert.ok(!codes(checkPlan({ plan: { sessions: week.sessions }, context: ctx })).includes('home_day_missing'));
});

test('mornings stay off unless the person turns them on', () => {
  const busy = [{ start: at(MONDAY, '12:00'), end: at(MONDAY, '21:00') }];
  assert.equal(weekOf(base({ calendar: busy }))[0].first, null);
  assert.equal(weekOf(base({ calendar: busy, rules: { mornings: true } }))[0].first, at(MONDAY, '09:00'));   // an hour after now
});

test('the rules week passes its own check', () => {
  const ctx = base({ dayKinds: { [DAYS[1]]: 'out' } });
  const week = recommendWeek(ctx);
  assert.equal(week.sessions.length, 3);
  assert.ok(week.sessions.every((s) => s.activity === 'strength' && s.minutes === 25));
  assert.deepEqual(codes(checkPlan({ plan: { sessions: week.sessions }, context: ctx })), []);
});

test('rest_day_rule: a session on a rest weekday fails; on a day at home it passes', () => {
  const ctx = base();
  const week = recommendWeek(ctx).sessions;
  const moved = { ...week[0], id: 'wed', day: DAYS[2], start: at(DAYS[2], '13:00') };
  assert.ok(codes(checkPlan({ plan: { sessions: [...week, moved] }, context: ctx })).includes('rest_day_rule'));
  assert.ok(!codes(checkPlan({ plan: { sessions: week }, context: ctx })).includes('rest_day_rule'));
});

test('out_day_rule: a session on a day out fails', () => {
  const ctx = base({ dayKinds: { [DAYS[3]]: 'out' } });
  const week = recommendWeek(ctx).sessions;
  const moved = { ...week[0], id: 'thu', day: DAYS[3], start: at(DAYS[3], '13:00') };
  assert.ok(codes(checkPlan({ plan: { sessions: [...week, moved] }, context: ctx })).includes('out_day_rule'));
  assert.ok(!codes(checkPlan({ plan: { sessions: week }, context: ctx })).includes('out_day_rule'));
});

test('home_day_missing: leaving out a day at home fails', () => {
  const ctx = base();
  const week = recommendWeek(ctx).sessions;
  const r = checkPlan({ plan: { sessions: week.slice(1) }, context: ctx });
  assert.deepEqual(codes(r), ['home_day_missing']);
});

test('outside_rule_hours and session_length_rule: a morning session and a long one fail', () => {
  const ctx = base();
  const week = recommendWeek(ctx).sessions;
  const early = { ...week[1], start: at(DAYS[1], '09:00') };
  const long = { ...week[1], minutes: 45 };
  assert.ok(codes(checkPlan({ plan: { sessions: [week[0], early, ...week.slice(2)] }, context: ctx })).includes('outside_rule_hours'));
  assert.ok(codes(checkPlan({ plan: { sessions: [week[0], long, ...week.slice(2)] }, context: ctx })).includes('session_length_rule'));
});

test('the brief says the rules and the kind of each day, and nothing about where events are', () => {
  const ctx = base({ dayKinds: { [DAYS[0]]: 'out' }, calendar: [{ start: at(DAYS[1], '12:00'), end: at(DAYS[1], '13:00'), title: 'Somewhere private' }] });
  const text = planBrief({ context: ctx }).lines.join('\n');
  assert.match(text, /never plan on Wednesday, Saturday or Sunday/);
  assert.match(text, /Monday the 30th is a day out: plan nothing/);
  assert.doesNotMatch(text, /Somewhere private/);
});

test('rules that cannot be read are an input error, not a guess', () => {
  for (const bad of [{ restWeekdays: [7] }, { sessionMinutes: { min: 30, max: 20 } }, { window: { from: '21:00', to: '12:00' } }, { equipment: ['barbell'] }, { movements: { squat: 'maybe' } }]) {
    assert.throws(() => readRules(bad), (e) => e.code === 'bad_rules');
  }
  assert.throws(() => planContext(base({ dayKinds: { [MONDAY]: 'away' } })), (e) => e.code === 'bad_day_kinds');
});

test('the split stays as planned later in the week: Tuesday is still upper body after Monday', () => {
  const tuesday = base({ now: at(DAYS[1], '08:00'), queue: { [DAYS[1]]: 'upper', [DAYS[3]]: 'lower', [DAYS[4]]: 'upper' } });
  assert.deepEqual(weekOf(tuesday).filter((d) => d.focus).map((d) => [d.day, d.focus]),
    [[DAYS[1], 'upper'], [DAYS[3], 'lower'], [DAYS[4], 'upper'], ['2026-12-07', 'lower']]);
});

test('a day at home that turns into a day out passes its focus on to the next day at home', () => {
  const out = base({ now: at(DAYS[1], '08:00'), queue: { [DAYS[1]]: 'upper', [DAYS[3]]: 'lower', [DAYS[4]]: 'upper' }, dayKinds: { [DAYS[1]]: 'out' } });
  assert.deepEqual(weekOf(out).filter((d) => d.focus && d.day <= DAYS[6]).map((d) => d.focus), ['upper', 'lower']);
});

test('next week seen from midweek takes its place in that whole week’s split', () => {
  const thursday = base({ now: at(DAYS[3], '08:00') });
  const monday = weekOf(thursday).find((d) => d.day === '2026-12-07');
  assert.equal(monday.focus, 'lower');
});
