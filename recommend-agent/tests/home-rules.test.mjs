// The person's rules and the kind of each day: rest weekdays and days out stay empty, every day at home with time gets
// one session, the week's split follows how many days are at home, and each new checkPlan code fails when it should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planContext, planBrief, checkPlan } from '../src/plan.mjs';
import { recommendWeek } from '../src/workouts.mjs';
import { readRules } from '../src/rules.mjs';
import { readFileSync } from 'node:fs';
import { weekContent, movementOf } from '../src/content.mjs';
import { FOCUS_WORDS } from '../src/homeweek.mjs';

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
    [[DAYS[1], 'upper'], [DAYS[3], 'lower'], [DAYS[4], 'upper']]);
});

test('a day at home that turns into a day out passes its focus on to the next day at home', () => {
  const out = base({ now: at(DAYS[1], '08:00'), queue: { [DAYS[1]]: 'upper', [DAYS[3]]: 'lower', [DAYS[4]]: 'upper' }, dayKinds: { [DAYS[1]]: 'out' } });
  assert.deepEqual(weekOf(out).filter((d) => d.focus && d.day <= DAYS[6]).map((d) => d.focus), ['upper', 'lower']);
});

// What the rules engine (recommendWeek) planned: each day at home's focus, from its own homeWeek and from the reason it gives.
const engineFocus = (ctx) => {
  const week = recommendWeek(ctx);
  const byDay = Object.fromEntries(week.homeWeek.days.filter((d) => d.focus).map((d) => [d.day, d.focus]));
  for (const s of week.sessions) assert.match(s.reason, new RegExp(`${FOCUS_WORDS[byDay[s.day]]} strength session`), s.reason);
  return week.sessions.map((s) => [s.day, byDay[s.day]]);
};
const contextFocus = (ctx) => weekOf(ctx).filter((d) => d.focus && d.day <= DAYS[6]).map((d) => [d.day, d.focus]);
const TUESDAY_QUEUE = { [DAYS[1]]: 'upper', [DAYS[3]]: 'lower', [DAYS[4]]: 'upper' };

test('the rules engine follows the queue as planContext does: Tuesday out moves upper body to Thursday', () => {
  const ctx = base({ now: at(DAYS[1], '08:00'), queue: TUESDAY_QUEUE, dayKinds: { [DAYS[1]]: 'out' } });
  assert.deepEqual(contextFocus(ctx), [[DAYS[3], 'upper'], [DAYS[4], 'lower']]);
  assert.deepEqual(engineFocus(ctx), [[DAYS[3], 'upper'], [DAYS[4], 'lower']]);
});

test('the rules engine and planContext agree with carry and queue given together, and agree again on the next run', () => {
  // Monday's lower body was missed; the queue still holds what Tuesday to Friday were planned to work.
  const first = base({ now: at(DAYS[1], '08:00'), carry: ['lower'], queue: TUESDAY_QUEUE });
  const planned = [[DAYS[1], 'lower'], [DAYS[3], 'upper'], [DAYS[4], 'lower']];
  assert.deepEqual(contextFocus(first), planned);
  assert.deepEqual(engineFocus(first), planned);
  // The app keeps what was planned as the new queue and passes carry on once: the next run plans the same split.
  const again = base({ now: at(DAYS[1], '10:00'), carry: [], queue: Object.fromEntries(planned) });
  assert.deepEqual(contextFocus(again), planned);
  assert.deepEqual(engineFocus(again), planned);
});

test('the rules engine keeps a done session to today, as planContext does', () => {
  const ctx = base({ now: at(DAYS[1], '21:30'), queue: TUESDAY_QUEUE, doneToday: true });
  assert.deepEqual(engineFocus(ctx), [[DAYS[3], 'lower'], [DAYS[4], 'upper']]);
  assert.deepEqual(contextFocus(ctx), engineFocus(ctx));
});

test('a day out pushes its session to the next day at home: Thursday does what Tuesday would have done', () => {
  const rules = { equipment: ['backpack', 'chair', 'table', 'sofa', 'book', 'step'] };
  const contentOf = (ctx) => {
    const days = recommendWeek({ ...ctx, rules }).homeWeek.days.filter((d) => d.focus);
    const week = weekContent({ rules, sessions: days.map((d) => ({ sessionId: d.day, focus: d.focus })) });
    return Object.fromEntries(week.contents.map((c) => [c.sessionId, c.items.map((i) => i.movementId)]));
  };
  const home = contentOf(base({ now: at(DAYS[1], '08:00'), queue: TUESDAY_QUEUE }));
  const out = contentOf(base({ now: at(DAYS[1], '08:00'), queue: TUESDAY_QUEUE, dayKinds: { [DAYS[1]]: 'out' } }));
  assert.equal(out[DAYS[1]], undefined, 'nothing on the day out');
  assert.deepEqual(out[DAYS[3]].filter((id) => movementOf(id).pattern !== 'core'), home[DAYS[1]].filter((id) => movementOf(id).pattern !== 'core'));
  assert.deepEqual(out[DAYS[4]].filter((id) => movementOf(id).pattern !== 'core'), home[DAYS[3]].filter((id) => movementOf(id).pattern !== 'core'));
  assert.ok(out[DAYS[3]].every((id) => ['upper_push', 'upper_pull', 'core'].includes(movementOf(id).pattern)), out[DAYS[3]].join());
});

test('a session done today keeps its focus to today and passes nothing on to the days after it', () => {
  const queue = { [DAYS[1]]: 'upper', [DAYS[3]]: 'lower', [DAYS[4]]: 'upper' };
  const late = (doneToday) => weekOf(base({ now: at(DAYS[1], '21:30'), queue, doneToday }))
    .filter((d) => d.focus && d.day <= DAYS[6]).map((d) => [d.day, d.focus]);
  assert.deepEqual(late(true), [[DAYS[3], 'lower'], [DAYS[4], 'upper']]);
  assert.deepEqual(late(false), [[DAYS[3], 'upper'], [DAYS[4], 'lower']]);   // not done: today's focus moves on
  const morning = weekOf(base({ now: at(DAYS[1], '08:00'), queue, doneToday: true }));
  assert.deepEqual(morning.filter((d) => d.focus && d.day <= DAYS[6]).map((d) => d.focus), ['upper', 'lower', 'upper']);
});

test('the week runs from today through Sunday: seven days from Monday, four from Thursday', () => {
  assert.deepEqual(weekOf(base()).map((d) => d.day), DAYS);
  assert.deepEqual(weekOf(base({ now: at(DAYS[3], '08:00') })).map((d) => d.day), DAYS.slice(3));
  const c = planContext(base({ now: at(DAYS[3], '08:00') }));
  assert.deepEqual([c.window.from, c.window.to], [DAYS[3], DAYS[6]]);
  assert.deepEqual(c.days.map((d) => d.day), DAYS.slice(3));
});

test('on Sunday the week runs through next Sunday, with next week in its own split', () => {
  const days = weekOf(base({ now: at(DAYS[6], '20:00') }));
  assert.equal(days.length, 8);
  assert.deepEqual([days[0].day, days[7].day], [DAYS[6], '2026-12-13']);
  assert.deepEqual(days.filter((d) => d.focus).map((d) => [d.day, d.focus]),
    [['2026-12-07', 'lower'], ['2026-12-08', 'upper'], ['2026-12-10', 'lower'], ['2026-12-11', 'upper']]);
  const ctx = base({ now: at(DAYS[6], '20:00') });
  assert.deepEqual(codes(checkPlan({ plan: { sessions: recommendWeek(ctx).sessions }, context: ctx })), []);
});

test('midweek, a session after Sunday is outside the week', () => {
  const ctx = base({ now: at(DAYS[3], '08:00') });
  const week = recommendWeek(ctx).sessions;
  const later = { ...week[0], id: 'next-mon', day: '2026-12-07', start: at('2026-12-07', '13:00') };
  assert.ok(codes(checkPlan({ plan: { sessions: [...week, later] }, context: ctx })).includes('outside_window'));
});

// America/Los_Angeles leaves summer time at 02:00 on Sunday 1 November 2026: -07:00 before, -08:00 after.
const DST = { restWeekdays: [] };
const FALL = { '2026-10-31': '-07:00', '2026-11-01': '-08:00' };
const dst = (over = {}) => base({ now: '2026-10-31T08:00:00-07:00', rules: DST, ...over });

test('across a clock change each day keeps its own hours when the phone gives each day\'s offset', () => {
  const days = weekOf(dst({ dayOffsets: FALL }));
  assert.deepEqual(days.map((d) => d.first), ['2026-10-31T12:00:00-07:00', '2026-11-01T12:00:00-08:00']);
  assert.equal(weekOf(dst())[1].first, '2026-11-01T12:00:00-07:00', 'without it, one offset for the whole week');
  const week = recommendWeek(dst({ dayOffsets: FALL })).sessions;
  assert.equal(week[1].start, '2026-11-01T12:00:00-08:00');
  assert.deepEqual(codes(checkPlan({ plan: { sessions: week }, context: dst({ dayOffsets: FALL }) })), []);
});

test('with each day\'s offset, a session an hour early by the old offset starts outside the rules\' hours', () => {
  const ctx = dst({ dayOffsets: FALL });
  const week = recommendWeek(ctx).sessions;
  const early = { ...week[1], start: '2026-11-01T12:00:00-07:00' };   // 11:00 on the Sunday's own clock
  assert.ok(codes(checkPlan({ plan: { sessions: [week[0], early] }, context: ctx })).includes('outside_rule_hours'));
  assert.ok(!codes(checkPlan({ plan: { sessions: [week[0], early] }, context: dst() })).includes('outside_rule_hours'));
});

test('a day offset that can\'t be read is an input error', () => {
  for (const dayOffsets of [['-08:00'], { '2026-11-01': '-8' }, { '2026-11-01': 'PST' }, { '2026-11-01': '-08:60' }, { '2026-11-01': '+15:00' }, { 'Sunday': '-08:00' }]) {
    assert.throws(() => planContext(dst({ dayOffsets })), (e) => e.code === 'bad_day_offsets', JSON.stringify(dayOffsets));
    assert.throws(() => recommendWeek(dst({ dayOffsets })), (e) => e.code === 'bad_day_offsets', JSON.stringify(dayOffsets));
  }
});

test('every home-days value in the contract is taken as it is', () => {
  const values = JSON.parse(readFileSync(new URL('../../contract/fixtures/swift/home-days.json', import.meta.url), 'utf8'));
  assert.ok(values.length >= 3);
  for (const value of values) assert.ok(planContext(base({ now: at('2026-11-09', '08:00'), ...value })).homeWeek.days.length === 7);
});
