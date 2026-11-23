// checkPlan: every hard rule has a failing example with its code; planContext gives the numbers behind them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendWeek, checkPlan, planContext, planBrief, explainAction, checkWeek } from './support/sample.mjs';
import { ACTIVITIES } from '../src/memory.mjs';

const NOW = '2026-11-20T09:00:00-08:00'; // a Friday
const row = (key, kind, data, state = 'saved') => ({ memoryId: key, key, slot: null, group: 'routine', kind, statement: `About ${key}.`, data, state, confidence: 1, since: null, updated: null });
const slot = (key, weekday, hour, extra = {}, state = 'saved') => row(key, 'usual_slot', { activity: 'run', weekday, hour, minutes: 40, weeksSeen: 3, weeksTotal: 4, ...extra }, state);
const memory = { rows: [slot('k-tue', 1, 18), slot('k-sun', 6, 8), slot('k-thu', 3, 6, {}, 'rejected')] };
const base = { persona: 'jordan', now: NOW, memory };
const session = (day, start, activity, minutes, more = {}) => ({ id: `t-${day}-${activity}`, day, start: `${day}T${start}:00-08:00`, minutes, activity, intensity: 'easy', reason: '', basedOn: [], ...more });
const codes = (plan, context = base) => checkPlan({ plan: { sessions: plan }, context }).violations.map((v) => v.code);
const easyWeek = () => [session('2026-11-21', '08:00', 'run', 30), session('2026-11-23', '12:00', 'yoga', 25), session('2026-11-25', '06:00', 'run', 30)];

test('a small easy week passes', () => {
  const r = checkPlan({ plan: { sessions: easyWeek() }, context: base });
  assert.deepEqual(r, { pass: true, violations: [], hints: [], load: r.load });
  assert.equal(r.load.unit, 'effort-minutes');
});

test('each rule has a failing example with its code', async (t) => {
  const one = (name, code, plan, context = base) => t.test(name, () => {
    const got = codes(plan, context);
    assert.ok(got.includes(code), `${code} not in ${JSON.stringify(got)}`);
  });
  await one('an activity outside the list', 'unknown_activity', [session('2026-11-21', '08:00', 'parkour', 30)]);
  await one('too short', 'bad_duration', [session('2026-11-21', '08:00', 'run', 5)]);
  await one('too long', 'bad_duration', [session('2026-11-21', '08:00', 'walk', 200)]);
  await one('before now', 'outside_window', [session('2026-11-20', '07:00', 'walk', 30)]);
  await one('after the 7 days that start today', 'outside_window', [session('2026-11-27', '07:00', 'walk', 30)]);
  await one('today, less than an hour from now', 'outside_window', [session('2026-11-20', '09:59', 'walk', 30)]);
  await one('today, ending after 22:00', 'outside_window', [session('2026-11-20', '21:31', 'walk', 30)]);
  await one('unreadable', 'invalid_session', [{ day: 'tomorrow', start: 'morning', activity: 'run', minutes: 30 }]);
  await one('day and start disagree', 'invalid_session', [{ ...session('2026-11-21', '08:00', 'run', 30), day: '2026-11-22' }]);
  await one('two sessions overlap', 'overlap', [session('2026-11-21', '08:00', 'run', 60), session('2026-11-21', '08:30', 'yoga', 30)]);
  await one('on top of a calendar event', 'calendar_conflict', [session('2026-11-21', '08:00', 'run', 30)],
    { ...base, calendar: [{ start: '2026-11-21T08:15:00-08:00', end: '2026-11-21T09:00:00-08:00', title: 'Dentist' }] });
  await one('far more than the usual load', 'load_over_cap', [1, 2, 3, 4, 5, 6, 7].map((i) => session(`2026-11-2${i}`, '10:00', 'run', 150, { intensity: 'hard' })));
  const tired = { ...base, history: tiredHistory() };
  await one('hard tomorrow after poor sleep', 'hard_when_tired', [session('2026-11-21', '08:00', 'run', 30, { intensity: 'hard' })], tired);
  const race = { ...base, raceDate: '2026-11-26' };
  await one('a session on race day', 'race_day_session', [session('2026-11-26', '18:00', 'walk', 20)], race);
  await one('no rest before the race', 'no_rest_before_race', [session('2026-11-25', '06:00', 'run', 20)], race);
  await one('a long run in the taper', 'taper_too_long', [session('2026-11-22', '08:00', 'long_run', 89)], race);
  const worn = { ...base, shoes: { boughtOn: '2026-10-22', startMiles: 267 } };
  await one('a long run in worn shoes', 'worn_shoes_long_run', [session('2026-11-22', '08:00', 'long_run', 60)], worn);
  const fresh = { ...worn, newPairArrives: '2026-11-21' };
  await one('a long first run in new shoes', 'break_in_too_long', [session('2026-11-22', '08:00', 'run', 40)], fresh);
  await one('a hard first run in new shoes', 'break_in_not_easy', [session('2026-11-22', '08:00', 'run', 25, { intensity: 'hard' })], fresh);
  await one('hard days side by side', 'back_to_back_hard', [session('2026-11-23', '10:00', 'ride', 30, { intensity: 'hard' }), session('2026-11-24', '18:00', 'run', 30, { intensity: 'hard' })]);
  const sam = { persona: 'sam', now: NOW };
  await one('no rest day', 'too_many_days_in_a_row', [1, 2, 3, 4, 5, 6, 7].map((i) => session(`2026-11-2${i}`, '10:00', 'walk', 20)), sam);
  await one('more sessions than the usual days plus one', 'too_many_sessions', [1, 2, 3, 4, 5].map((i) => session(`2026-11-2${i}`, '10:00', 'walk', 20)), sam);
  await one('more than three sessions with under two weeks of history', 'too_many_sessions', [1, 2, 3, 4].map((i) => session(`2026-11-2${i}`, '10:00', 'walk', 20)), { now: NOW, history: shortHistory() });
  await one('a memory key that is not in the table', 'unknown_memory_key', [session('2026-11-21', '08:00', 'run', 30, { basedOn: ['made-up'] })]);
  await one('a memory key the person stopped', 'stopped_memory_key', [session('2026-11-26', '06:00', 'run', 30, { basedOn: ['k-thu'] })]);
});

// Runs on five weekdays twice each, all inside the last 13 days.
function shortHistory() {
  const workouts = [];
  for (let i = 1; i <= 13; i += 1) {
    const d = new Date(Date.UTC(2026, 10, 20 - i));
    if (d.getUTCDay() === 0) continue;
    const day = d.toISOString().slice(0, 10);
    workouts.push({ activityType: 'Running', start: `${day}T07:00:00-08:00`, end: `${day}T07:30:00-08:00`, avgHeartRate: 120 });
  }
  return { workouts, daily: [] };
}

test('the session limit: usual training days plus one, three while history is under 14 days, and the fallback keeps to it', () => {
  assert.equal(planContext({ persona: 'sam', now: NOW }).maxSessions, planContext({ persona: 'sam', now: NOW }).usualDaysPerWeek + 1);
  assert.equal(planContext(base).maxSessions, 7);                                                   // seven usual days plus one, capped at 7
  assert.equal(planContext({ now: NOW }).maxSessions, 3);
  const fresh = { now: NOW, history: shortHistory() };
  assert.deepEqual([planContext(fresh).usualDaysPerWeek, planContext(fresh).maxSessions], [5, 3]);
  const week = recommendWeek(fresh);
  assert.deepEqual(week.sessions.map((s) => s.day), ['2026-11-21', '2026-11-23', '2026-11-24']);   // the earliest three stay
  assert.equal(checkPlan({ plan: { sessions: week.sessions }, context: fresh }).pass, true);
  assert.equal(recommendWeek(fresh, 1).sessions.length, 5);                                          // the Python rules have no such limit
  const over = checkPlan({ plan: { sessions: [1, 2, 3, 4, 5].map((i) => session(`2026-11-2${i}`, '10:00', 'walk', 20)) }, context: fresh });
  const i = over.violations.findIndex((v) => v.code === 'too_many_sessions');
  assert.deepEqual(over.violations[i], { code: 'too_many_sessions', text: 'This week has 5 sessions, and 3 is the most that fits you for now.' });
  assert.deepEqual(over.hints[i], { code: 'too_many_sessions', fix: 'remove 2 sessions' });
  const rest = [1, 2, 3].map((d) => session(`2026-11-2${d}`, '10:00', 'walk', 20)).concat([{ ...session('2026-11-24', '00:00', 'rest', 0) }]);
  assert.equal(checkPlan({ plan: { sessions: rest }, context: fresh }).pass, true);                   // rest is not a session
});

test('too_many_sessions: usual training days plus one from memory; exactly at the limit passes, one over fails', () => {
  const walks = (n) => Array.from({ length: n }, (_, i) => session(`2026-11-2${i + 1}`, '10:00', 'walk', 10));
  const volume = (perWeek) => ({ now: NOW, memory: { rows: [row('v', 'weekly_volume', { workoutsPerWeek: perWeek, minutesPerWeek: 500 })] } });
  const sessionsCode = (n, ctx) => codes(walks(n), ctx).includes('too_many_sessions');
  // A beginner whose usual is 1 session a week: at most 2.
  assert.equal(planContext(volume(1)).maxSessions, 2);
  assert.deepEqual([sessionsCode(2, volume(1)), sessionsCode(3, volume(1))], [false, true]);
  assert.ok(planBrief({ context: volume(1) }).lines.includes('At most 2 training sessions this week.'));
  assert.deepEqual([planContext(volume(3.5)).maxSessions, sessionsCode(5, volume(3.5)), sessionsCode(6, volume(3.5))], [5, false, true]);
  // Usual slots alone: the days they name, plus one.
  const slots = { now: NOW, memory: { rows: [slot('a', 1, 18), slot('b', 1, 7), slot('c', 4, 18)] } };
  assert.deepEqual([planContext(slots).maxSessions, sessionsCode(3, slots), sessionsCode(4, slots)], [3, false, true]);
  // Memory wins over history: the same beginner with a long history still gets 2.
  const beginner = { ...volume(1), persona: 'jordan' };
  assert.deepEqual([planContext(beginner).maxSessions, sessionsCode(2, beginner), sessionsCode(3, beginner)], [2, false, true]);
  assert.ok(recommendWeek(beginner).sessions.length <= 2);
  // The stated volume decides, whatever weekdays the slot rows sit on: about 1 a week with slots on four weekdays is still 2.
  const spread = { now: NOW, memory: { rows: [row('v', 'weekly_volume', { workoutsPerWeek: 1, minutesPerWeek: 500 }), slot('a', 0, 7), slot('b', 2, 7), slot('c', 4, 7), slot('d', 5, 9)] } };
  assert.deepEqual([planContext(spread).maxSessions, sessionsCode(2, spread), sessionsCode(3, spread)], [2, false, true]);
  assert.ok(planBrief({ context: spread }).lines.includes('At most 2 training sessions this week.'));
  assert.ok(recommendWeek({ ...spread, persona: 'jordan' }).sessions.length <= 2);
  assert.equal(planContext({ now: NOW, memory: { rows: [row('v', 'weekly_volume', { workoutsPerWeek: 0.75, minutesPerWeek: 500 })] } }).maxSessions, 2);
  // 6.5 a week would be 8: capped at the 7 days of the week.
  assert.deepEqual([planContext(volume(6.5)).maxSessions, sessionsCode(7, volume(6.5))], [7, false]);
  assert.ok(planBrief({ context: volume(6.5) }).lines.includes('At most 7 training sessions this week.'));
  assert.equal(planContext(volume(7)).maxSessions, 7);
  // No volume row and slots on two weekdays: 3.
  const two = { now: NOW, memory: { rows: [slot('a', 1, 18), slot('b', 4, 18)] } };
  assert.deepEqual([planContext(two).maxSessions, sessionsCode(3, two), sessionsCode(4, two)], [3, false, true]);
  // Neither a weekly volume nor a usual slot: the default of 3.
  const nothing = { now: NOW, memory: { rows: [row('s', 'sleep', { hours7d: 7, hours28d: 7 })] } };
  assert.deepEqual([planContext(nothing).maxSessions, sessionsCode(3, nothing), sessionsCode(4, nothing)], [3, false, true]);
});

test('too_many_minutes: the usual minutes after a heavy week, 1.1 times them otherwise; at the limit passes, one over fails', () => {
  const ctx = (minutes7d, ratioToUsual, minutesPerWeek = null) => ({ now: NOW, memory: { rows: [row('l', 'load', { minutes7d, ratioToUsual }), row('v', 'weekly_volume', { workoutsPerWeek: 6, minutesPerWeek })] } });
  const plan = (total) => [session('2026-11-21', '10:00', 'walk', total - 40), session('2026-11-23', '10:00', 'walk', 20), session('2026-11-25', '10:00', 'walk', 20)];
  const over = (total, context) => codes(plan(total), context).includes('too_many_minutes');
  // Heavy last 7 days (ratio above 1.1): no more than the usual 155 minutes.
  const heavy = ctx(186, 1.2, 155);
  assert.deepEqual([planContext(heavy).usualMinutes, planContext(heavy).minutesRatio, planContext(heavy).maxMinutes], [155, 1.2, 155]);
  assert.deepEqual([over(155, heavy), over(156, heavy), over(120, heavy)], [false, true, false]);
  assert.ok(planBrief({ context: heavy }).lines.includes('At most 155 minutes of training this week, because the last 7 days were heavier than usual.'));
  // A ratio of exactly 1.1 is not heavy: 1.1 times the usual.
  const normal = ctx(165, 1.1, 150);
  assert.deepEqual([planContext(normal).maxMinutes, over(165, normal), over(166, normal)], [165, false, true]);
  assert.ok(planBrief({ context: normal }).lines.includes('At most 165 minutes of training this week.'));
  // Without a weekly volume, the usual comes from the load row: 180 / 1.2 = 150.
  assert.deepEqual([planContext(ctx(180, 1.2)).maxMinutes, over(150, ctx(180, 1.2)), over(151, ctx(180, 1.2))], [150, false, true]);
  // A beginner whose usual is 30 minutes: 60 fails, and one short session always fits.
  const beginner = ctx(40, 1.33, 30);
  assert.equal(planContext(beginner).maxMinutes, 30);
  assert.ok(codes([session('2026-11-21', '10:00', 'walk', 30), session('2026-11-23', '10:00', 'walk', 30)], beginner).includes('too_many_minutes'));
  assert.ok(!codes([session('2026-11-21', '10:00', 'walk', 30)], beginner).includes('too_many_minutes'));
  assert.equal(planContext(ctx(10, 2, 5)).maxMinutes, 20);
  const v = checkPlan({ plan: { sessions: plan(156) }, context: heavy });
  const i = v.violations.findIndex((x) => x.code === 'too_many_minutes');
  assert.deepEqual([v.violations[i], v.hints[i]], [{ code: 'too_many_minutes', text: 'This week adds up to 156 minutes, and 155 is the most that fits you for now.' }, { code: 'too_many_minutes', fix: 'shorten the week by 1 min in total' }]);
  // From history when memory has no numbers: the last 28 days over 4.
  const h = planContext({ persona: 'jordan', now: NOW });
  assert.deepEqual([h.usualMinutes, h.minutesRatio, h.maxMinutes], [290, 0.8, 337]);                                  // 1.1 x 290 is 319; the usual week's 337 is more
  assert.equal(planContext({ now: NOW }).maxMinutes, null);
});

test('the usual week always passes at normal load, and the same week fails after a heavy 7 days', () => {
  // Usual slots add up to 145 minutes; the 28-day average is 124 a week.
  const slots = [slot('mon', 0, 18, { minutes: 30 }), slot('wed', 2, 18, { minutes: 30 }), slot('fri', 4, 18, { minutes: 45 }), slot('sun', 6, 9, { minutes: 40 })];
  const ctx = (ratio) => ({ now: '2026-11-22T06:00:00-08:00', memory: { rows: [...slots, row('v', 'weekly_volume', { workoutsPerWeek: 3.5, minutesPerWeek: 124 }), row('l', 'load', { minutes7d: 124 * ratio, ratioToUsual: ratio })] } });
  const usualWeek = [['2026-11-22', '09:00', 40], ['2026-11-23', '18:00', 30], ['2026-11-25', '18:00', 30], ['2026-11-27', '18:00', 45]].map(([d, t, m]) => session(d, t, 'run', m));
  const check = (ratio, plan = usualWeek) => checkPlan({ plan: { sessions: plan }, context: ctx(ratio) });
  // Normal load: 1.1 x 124 is 136, but the usual week's own 145 minutes is more, and that is the limit.
  assert.deepEqual([planContext(ctx(1)).maxMinutes, planContext(ctx(1.1)).maxMinutes], [145, 145]);
  assert.deepEqual(check(1).violations, []);
  assert.deepEqual(check(1.1).violations, []);
  const longer = usualWeek.map((s, i) => (i ? s : { ...s, minutes: 41 }));
  assert.deepEqual(check(1, longer).violations.map((v) => v.code), ['too_many_minutes']);                      // one minute over
  assert.ok(planBrief({ context: ctx(1) }).lines.includes('At most 145 minutes of training this week.'));
  // High load: the 28-day average, and the usual week no longer fits.
  assert.equal(planContext(ctx(1.11)).maxMinutes, 124);
  assert.deepEqual(check(1.2).violations, [{ code: 'too_many_minutes', text: 'This week adds up to 145 minutes, and 124 is the most that fits you for now.' }]);
  assert.deepEqual(check(1.2).hints, [{ code: 'too_many_minutes', fix: 'shorten the week by 21 min in total' }]);
  assert.ok(planBrief({ context: ctx(1.2) }).lines.includes('At most 124 minutes of training this week, because the last 7 days were heavier than usual.'));
  // From history alone the usual week is the history's own, and it passes at normal load.
  const jordan = planContext({ persona: 'jordan', now: NOW });
  assert.deepEqual([jordan.minutesRatio, jordan.maxMinutes, jordan.usualWeek.reduce((sum, u) => sum + u.minutes, 0)], [0.8, 337, 337]);
});

test('stopped usual times: the same activity, weekday and hour fails; another hour or another activity passes', () => {
  const stopped = [{ key: 'gone', activity: 'run', weekday: 2, hour: 8 }, { activity: 'other', label: 'HIIT', weekday: 3, hour: 19 }];
  const ctx = { ...base, stopped };
  const at = (day, time, activity, more = {}) => checkPlan({ plan: { sessions: [session(day, time, activity, 30, more)] }, context: ctx });
  // Wednesday the 25th at 8 AM.
  const hit = at('2026-11-25', '08:00', 'run');
  assert.deepEqual(hit.violations, [{ code: 'stopped_slot', text: 'You asked me not to plan Wednesday 8 AM runs.', sessionId: 't-2026-11-25-run' }]);
  assert.deepEqual(hit.hints, [{ code: 'stopped_slot', action: 0, sessionId: 't-2026-11-25-run', fix: 'move to another hour or remove this session' }]);
  assert.deepEqual(at('2026-11-25', '08:45', 'long_run').violations.map((v) => v.code), ['stopped_slot']);   // any start within that hour; a long run is a run
  assert.equal(at('2026-11-25', '09:00', 'run').pass, true);                                                 // same weekday, another hour
  assert.equal(at('2026-11-25', '07:59', 'run').pass, true);
  assert.equal(at('2026-11-25', '08:00', 'yoga').pass, true);                                                // same hour, another activity
  assert.equal(at('2026-11-24', '08:00', 'run').pass, true);                                                 // same hour, another weekday
  assert.equal(at('2026-11-26', '19:00', 'other').violations[0].text, 'You asked me not to plan Thursday 7 PM HIIT.');
  assert.deepEqual(at('2026-11-24', '18:00', 'run', { basedOn: ['gone'] }).violations.map((v) => v.code), ['stopped_memory_key']); // its key cannot be cited either
  assert.equal(checkPlan({ plan: { sessions: [session('2026-11-25', '08:00', 'run', 30)] }, context: base }).pass, true);         // nothing stopped: fine

  const numbers = planContext(ctx);
  assert.deepEqual(numbers.stoppedSlots, [
    { weekday: 3, weekdayName: 'Thu', activity: 'run', hour: 6 },                 // the rejected row still in the table
    { weekday: 2, weekdayName: 'Wed', activity: 'run', hour: 8 }, { weekday: 3, weekdayName: 'Thu', activity: 'other', hour: 19, label: 'HIIT' },
  ]);
  assert.deepEqual(numbers.stoppedKeys, ['k-thu', 'gone']);
  const lines = planBrief({ context: ctx }).lines;
  for (const line of ['Do not plan runs on Thursday at 6 AM.', 'Do not plan runs on Wednesday at 8 AM.', 'Do not plan HIIT on Thursday at 7 PM.']) assert.ok(lines.includes(line), line);
  assert.throws(() => planContext({ ...base, stopped: 'x' }), { code: 'bad_stopped' });
  assert.deepEqual(planContext({ ...base, memory: undefined, stopped: [{ activity: 'jog', weekday: 2, hour: 8 }, { activity: 'run', weekday: 9, hour: 8 }, null] }).stoppedSlots, []);
});

test('recommendWeek never proposes a stopped usual time', () => {
  // Jordan's usual Wednesday is a run at 6 AM and the usual Thursday a run at 6 AM.
  const days = (stopped) => recommendWeek({ persona: 'jordan', now: NOW, stopped }).sessions.map((s) => `${s.day} ${s.start.slice(11, 13)} ${s.activity}`);
  const all = days([]);
  assert.ok(all.includes('2026-11-25 06 run') && all.includes('2026-11-26 06 run'));
  assert.deepEqual(days([{ activity: 'run', weekday: 2, hour: 6 }]), all.filter((d) => d !== '2026-11-25 06 run'));
  assert.deepEqual(days([{ activity: 'run', weekday: 2, hour: 7 }]), all);                                    // another hour: still planned
  assert.deepEqual(days([{ activity: 'yoga', weekday: 2, hour: 6 }]), all);                                   // another activity: still planned
  // A calendar move that would land on a stopped hour drops the session too.
  const moved = recommendWeek({ persona: 'jordan', now: NOW, busy: [{ start: '2026-11-25T05:30:00-08:00', end: '2026-11-25T09:10:00-08:00' }], stopped: [{ activity: 'run', weekday: 2, hour: 9 }] });
  assert.ok(!moved.sessions.some((s) => s.day === '2026-11-25'));
  // A rejected row still in the table counts the same way.
  const rejected = { rows: [slot('w', 2, 6, {}, 'rejected')] };
  assert.ok(!recommendWeek({ persona: 'jordan', now: NOW, memory: rejected }).sessions.some((s) => s.day === '2026-11-25'));
  for (const stopped of [[{ activity: 'run', weekday: 2, hour: 6 }], [{ activity: 'run', weekday: 6, hour: 8 }, { activity: 'yoga', weekday: 0, hour: 12 }]]) {
    const ctx = { persona: 'jordan', now: NOW, stopped };
    assert.deepEqual(checkPlan({ plan: { sessions: recommendWeek(ctx).sessions }, context: ctx }).violations, []);
  }
});

test('recommendWeek keeps to both limits', () => {
  const total = (w) => w.sessions.reduce((sum, s) => sum + s.minutes, 0);
  const memory = (minutesPerWeek, ratio, perWeek) => ({ rows: [row('l', 'load', { minutes7d: minutesPerWeek * ratio, ratioToUsual: ratio }), row('v', 'weekly_volume', { workoutsPerWeek: perWeek, minutesPerWeek })] });
  for (const [minutes, ratio, perWeek] of [[155, 1.2, 4], [150, 1, 6], [30, 1.3, 1], [60, 1, 2], [20, 1, 1], [400, 1, 7]]) {
    const ctx = { persona: 'jordan', now: NOW, memory: memory(minutes, ratio, perWeek) };
    const week = recommendWeek(ctx);
    const numbers = planContext(ctx);
    assert.ok(week.sessions.length >= 1 && week.sessions.length <= numbers.maxSessions, `${minutes}: ${week.sessions.length} sessions`);
    assert.ok(total(week) <= numbers.maxMinutes, `${minutes}: ${total(week)} minutes`);
    assert.deepEqual(checkPlan({ plan: { sessions: week.sessions }, context: ctx }).violations, []);
  }
  assert.equal(total(recommendWeek({ persona: 'jordan', now: NOW, memory: memory(155, 1.2, 6) })), 155);   // trimmed down to the limit, no further
});

function tiredHistory() {
  const daily = [];
  for (let i = 1; i <= 28; i += 1) {
    const d = new Date(Date.UTC(2026, 10, 20 - i)).toISOString().slice(0, 10);
    daily.push({ date: d, sleepMin: i <= 7 ? 380 : 470, restingHeartRate: 50 });
  }
  return { workouts: [], daily };
}

test('a violation names the session, reads as a sentence and carries a fix', () => {
  const plan = [session('2026-11-21', '08:00', 'run', 30), session('2026-11-22', '08:00', 'long_run', 60)];
  const r = checkPlan({ plan: { sessions: plan }, context: { ...base, shoes: { boughtOn: '2026-10-22', startMiles: 267 } } });
  assert.equal(r.pass, false);
  const i = r.violations.findIndex((x) => x.code === 'worn_shoes_long_run');
  assert.deepEqual(r.violations[i], { code: 'worn_shoes_long_run', text: "Sunday's long run is too long for shoes this worn.", sessionId: 't-2026-11-22-long_run' });
  assert.deepEqual(r.hints[i], { code: 'worn_shoes_long_run', action: 1, sessionId: 't-2026-11-22-long_run', fix: 'shorten to ≤45 min or switch to ride' });
  assert.equal(r.hints.length, r.violations.length);
  const whole = checkPlan({ plan: { sessions: [1, 2, 3, 4, 5, 6, 7].map((d) => session(`2026-11-2${d}`, '10:00', 'run', 150, { intensity: 'hard' })) }, context: base });
  const j = whole.violations.findIndex((x) => x.code === 'load_over_cap');
  assert.deepEqual(Object.keys(whole.violations[j]), ['code', 'text']);
  assert.match(whole.hints[j].fix, /^shorten the week by \d+ min in total$/);
});

test('the window is 7 local days starting today, from an hour after now', () => {
  assert.deepEqual(codes([session('2026-11-20', '10:00', 'walk', 30), session('2026-11-20', '21:30', 'yoga', 30), session('2026-11-26', '23:00', 'walk', 30)]), []);
  const hints = checkPlan({ plan: { sessions: [session('2026-11-20', '09:30', 'walk', 30), session('2026-11-20', '08:00', 'yoga', 30)] }, context: base });
  assert.deepEqual(hints.violations.map((v) => v.text), ["Friday's walk starts too soon to get ready for.", "Friday's yoga is in the past."]);
  assert.deepEqual(hints.hints.map((h) => h.fix), ['move to 10:00 or later', 'move to 10:00 or later']);
});

test('a key in the table passes, and rest books nothing', () => {
  const plan = [session('2026-11-24', '18:00', 'run', 30, { basedOn: ['k-tue'] }), { ...session('2026-11-25', '00:00', 'rest', 0), intensity: 'easy' }];
  assert.deepEqual(codes(plan), []);
});

test('a plan written as HH:MM on a day is read in the offset of now', () => {
  const plan = [{ day: '2026-11-21', start: '08:00', activity: 'run', minutes: 30, intensity: 'easy' }];
  assert.deepEqual(codes(plan), []);
  assert.deepEqual(codes(plan, { ...base, calendar: [{ start: '2026-11-21T16:10:00Z', end: '2026-11-21T17:00:00Z' }] }), ['calendar_conflict']);
});

test('the same input gives the same answer', () => {
  const args = { plan: { sessions: [session('2026-11-21', '08:00', 'run', 500, { basedOn: ['x'] })] }, context: { ...base, raceDate: '2026-11-22' } };
  const before = JSON.stringify(args);
  assert.equal(JSON.stringify(checkPlan(args)), JSON.stringify(checkPlan(JSON.parse(before))));
  assert.equal(JSON.stringify(args), before);
  assert.equal(JSON.stringify(planContext(base)), JSON.stringify(planContext(JSON.parse(JSON.stringify(base)))));
});

test('planContext: the numbers from history, slots and stopped keys from the table', () => {
  const c = planContext({ ...base, calendar: [{ start: '2026-11-21T07:00:00-08:00', end: '2026-11-21T09:00:00-08:00' }], shoes: { boughtOn: '2026-10-22', startMiles: 267 }, raceDate: '2026-11-29' });
  const week = recommendWeek({ persona: 'jordan', now: NOW });
  assert.equal(c.loadUnit, 'effort-minutes');
  assert.equal(c.loadThisWeek, week.signals.load7);
  assert.equal(c.loadCap, week.signals.loadCap);
  assert.equal(c.readiness.status, 'normal');
  assert.deepEqual(c.usualWeek.find((u) => u.weekday === 1), { weekday: 1, weekdayName: 'Tue', activity: 'run', minutes: 53, hour: 18, intensity: 'hard', basedOn: ['k-tue'] });
  assert.deepEqual(c.usualWeek.find((u) => u.weekday === 3).basedOn, []); // the Thursday row was rejected
  assert.equal(c.usualWeek.find((u) => u.weekday === 6).activity, 'long_run');
  assert.deepEqual(c.stoppedKeys, ['k-thu']);
  assert.deepEqual(c.memoryKeys, ['k-tue', 'k-sun']);
  assert.deepEqual(c.shoe, { status: 'replace', percentLife: 94, miles: 380, longestRunMin: 45, newPairArrives: null });
  assert.deepEqual(c.race, { date: '2026-11-29', daysAway: 9, taper: true, restDay: '2026-11-28' });
  assert.deepEqual(c.freeSlots.filter((f) => f.day === '2026-11-21'), [
    { day: '2026-11-21', start: '2026-11-21T06:00:00-08:00', end: '2026-11-21T07:00:00-08:00' },
    { day: '2026-11-21', start: '2026-11-21T09:00:00-08:00', end: '2026-11-21T21:00:00-08:00' },
  ]);
  assert.deepEqual(c.freeSlots[0], { day: '2026-11-20', start: '2026-11-20T10:00:00-08:00', end: '2026-11-20T22:00:00-08:00' }); // today: an hour from now, until 22:00
  assert.deepEqual(c.window, { from: '2026-11-20', to: '2026-11-26', earliestStart: '2026-11-20T10:00:00-08:00' });
  assert.deepEqual([...new Set(c.freeSlots.map((f) => f.day))].length, 7);
  assert.deepEqual(c.activities, ACTIVITIES);
});

test('planContext and checkPlan from memory rows alone, in minutes', () => {
  const rows = [
    slot('a', 1, 18), slot('b', 6, 8, { minutes: 90 }),
    row('l', 'load', { minutes7d: 300, ratioToUsual: 1.2 }), row('s', 'sleep', { hours7d: 6.0, hours28d: 7.0 }),
    row('h', 'resting_hr', { bpm7d: 55, bpm28d: 50 }), row('v', 'weekly_volume', { workoutsPerWeek: 4.5, minutesPerWeek: 250 }),
    row('g', 'gear', { item: 'running shoes', km: 600, boughtOn: '2026-06-01' }), row('r', 'goal', { what: 'half marathon race', date: '2026-11-29' }),
  ];
  const ctx = { now: NOW, memory: { rows } };
  const c = planContext(ctx);
  assert.equal(c.loadUnit, 'minutes');
  assert.equal(c.loadThisWeek, 300);
  assert.equal(c.loadUsual, 250);
  assert.equal(c.loadCap, 325); // min(1.1 x 300, 1.3 x 250)
  assert.deepEqual(c.readiness.signals, ['sleep', 'resting_hr']);
  assert.equal(c.usualDaysPerWeek, 5);
  assert.equal(c.shoe.status, 'replace');
  assert.equal(c.race.date, '2026-11-29');
  assert.deepEqual(c.usualWeek.map((u) => [u.weekday, u.activity, u.minutes, u.basedOn[0]]), [[1, 'run', 40, 'a'], [6, 'long_run', 90, 'b']]);
  const plan = [session('2026-11-21', '08:00', 'run', 60, { intensity: 'hard' }), session('2026-11-22', '08:00', 'long_run', 90)];
  const got = codes(plan, ctx);
  for (const code of ['hard_when_tired', 'worn_shoes_long_run', 'taper_too_long']) assert.ok(got.includes(code), code);
  assert.ok(codes([1, 2, 3, 4, 5, 6].map((i) => session(`2026-11-2${i}`, '10:00', 'walk', 70)), { now: NOW, memory: { rows: rows.slice(0, 6) } }).includes('load_over_cap'));
});

test('explainAction gives the reasons and the memory rows behind a session', () => {
  const week = recommendWeek({ ...base });
  const tue = week.sessions.find((s) => s.basedOn.includes('k-tue'));
  const r = explainAction({ action: { ...tue, reasons: week.reasons[tue.id] }, memory });
  assert.deepEqual(r.basedOn, ['k-tue']);
  assert.equal(r.memory[0].found, true);
  assert.match(r.text, /^Your usual Tuesday 6 PM run\./);
  assert.match(r.text, /a run on Tuesdays around 6 PM, seen in 3 of the last 4 weeks\.$/);
  assert.match(explainAction({ action: { reason: 'A run.', basedOn: ['k-thu'] }, memory }).text, /You asked to stop this habit/);
  assert.match(explainAction({ action: { reason: 'A run.', basedOn: ['gone'] }, memory }).text, /no longer in your memory/);
  assert.equal(explainAction({ action: { basedOn: ['x'] }, memory: { rows: [row('x', 'sleep', { hours7d: 7, hours28d: 7 })] } }).memory[0].text, 'It comes from your memory: About x.');
});

test('checkWeek lists calendar conflicts and overlaps', () => {
  const sessions = [session('2026-11-21', '08:00', 'run', 60), session('2026-11-21', '08:30', 'yoga', 30), session('2026-11-22', '08:00', 'walk', 30)];
  const r = checkWeek({ sessions, calendar: [{ start: '2026-11-22T08:10:00-08:00', end: '2026-11-22T09:00:00-08:00', title: 'Brunch' }] });
  assert.deepEqual(r.conflicts.map((c) => [c.code, c.action, c.id, c.fix]), [
    ['overlap', 1, 't-2026-11-21-yoga', 'move after 09:00'], ['calendar_conflict', 2, 't-2026-11-22-walk', 'move after 09:00'],
  ]);
  assert.equal(r.conflicts[1].text, 'Sunday\'s walk overlaps "Brunch" on your calendar.');
  assert.deepEqual(checkWeek({ actions: recommendWeek(base).actions, calendar: [] }).conflicts, []);
});
