import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarPlan, calendarReplan } from '../src/phone/entry.mjs';
import { plan, replan, WEEK, day, hm, get, overlaps, after } from './helpers.mjs';

const MEALS = [['07:30', '08:00'], ['12:00', '13:00'], ['18:30', '19:30']];
const REQUESTS = [
  'find me 45 minutes for a walk after 8 tonight', 'find me an hour for a run today', 'I want to do yoga tomorrow morning', 'long run this weekend',
  'can you fit a swim in on Thursday', 'schedule a ride tomorrow afternoon', 'gym on Tuesday evening', 'stretch after work', 'a 2 hour ride on Thursday morning',
  'find me a run tomorrow after 5', "move Sunday's long run to the afternoon", "move tomorrow's run to Thursday", "push Thursday's strength to Tuesday evening",
  "make Tuesday's run 90 minutes", "extend Thursday's strength to 2 hours", 'my race is on the 29th', 'my race is on Saturday', 'walk at lunch on Thursday',
  'run on Thursday at 10', 'yoga on Wednesday at 7pm', 'find me a walk on Monday after 4',
];

test('nothing proposed overlaps a fixed event or another workout, and all of it is on the grid inside the day', () => {
  for (const request of REQUESTS) {
    const r = plan(request);
    assert.equal(r.ok, true, request);
    assert.notEqual(r.kind, 'none', request);
    const week = after(r);
    for (const p of r.proposed.filter((x) => x.status !== 'cancelled' && x.activity !== 'rest')) {
      for (const e of WEEK.events) assert.ok(!overlaps(p, e), `${request}: ${p.id} overlaps ${e.title}`);
      for (const x of week) assert.ok(x.id === p.id || !overlaps(p, x), `${request}: ${p.id} overlaps ${x.id}`);
      assert.ok(Date.parse(p.start) >= Date.parse(WEEK.now), request);
      assert.equal(Date.parse(p.start) % 900000, 0, request);
      assert.ok(hm(p.start) >= '06:00' && hm(p.end) <= '23:30' && hm(p.end) > hm(p.start), `${request}: ${p.start}`);
      assert.match(p.start, /-08:00$/);
      assert.equal(p.minutes, (Date.parse(p.end) - Date.parse(p.start)) / 60000);
    }
  }
});

test('blocks the planner places keep clear of meals unless a clock time or lunch was asked for', () => {
  const clash = (p) => MEALS.some(([a, b]) => hm(p.start) < b && hm(p.end) > a);
  for (const request of REQUESTS.filter((x) => !/ at \d|lunch|make|extend|to Thursday$/.test(x))) for (const p of plan(request).proposed.filter((x) => x.activity !== 'rest')) assert.ok(!clash(p), `${request}: ${p.start}`);
  assert.equal(hm(plan('walk at lunch on Thursday').proposed[0].start), '12:00');
  assert.equal(hm(plan('yoga on Wednesday at 7pm').proposed[0].start), '20:00'); // 19:00 is the evening class
});

test('the default day is 06:00 to 22:00', () => {
  const busy = { events: [{ id: 'all', title: 'Offsite', start: day(0, '09'), end: day(0, '21', '30'), fixed: true }], workouts: [] };
  assert.equal(plan('find me an hour for a run', busy).proposed[0].start, day(1, '06'));
  assert.equal(plan('find me half an hour for a walk', busy).proposed[0].start, day(0, '21', '30'));
});

test('the usual time from memory is used when no time is asked for, and the reason says so', () => {
  const slot = (activity, weekday, hour) => ({ key: `opaque-${activity}-${weekday}`, activity, weekday, hour, minutes: 45 });
  const memory = { slots: [slot('run', 3, 18), slot('run', 6, 6), slot('yoga', 2, 7)] };
  const run = plan('I want to go for a run', { memory });
  assert.equal(run.proposed[0].start, day(3, '18'));
  assert.equal(run.proposed[0].reason, 'Your usual Thursday 6 PM time for a run is free.');
  assert.equal(plan('find me time for yoga this week', { memory }).proposed[0].start, day(2, '07'));
  // A time hint wins over the usual time.
  assert.equal(plan('find me a run tomorrow morning', { memory }).proposed[0].start, day(1, '06'));
  // A named day uses that day's usual time only.
  assert.equal(plan('run on Thursday', { memory }).proposed[0].start, day(3, '18'));
  assert.equal(plan('run on Friday', { memory }).proposed[0].start, day(4, '06'));
  // A usual time that is taken is skipped.
  const taken = { memory: { slots: [slot('run', 1, 18)] } };
  const r = plan('I want to go for a run', taken);
  assert.equal(r.proposed[0].start, day(0, '09'));
  assert.doesNotMatch(r.proposed[0].reason, /usual/);
  // The key is never read, and rows that are not usual slots are left out.
  assert.equal(plan('I want to go for a run', { memory: { slots: [{ key: 'slot:yoga:mon:10', activity: 'run', weekday: 6, hour: 6 }, 'slot:running:tue:07', { activity: 'golf', weekday: 1, hour: 7 }, { activity: 'run', weekday: 9, hour: 7 }, null] } }).proposed[0].start, day(6, '06'));
  assert.equal(plan('long run this weekend', { memory, workouts: [] }).proposed[0].reason, 'Your usual Sunday 6 AM time for a long run is free.');
});

test('a text move never lands on another workout or event, and moves only that workout', () => {
  const r = plan("move tomorrow's run to Thursday morning");
  assert.deepEqual(r.proposed.map((p) => p.id), ['w1']);
  assert.equal(get(r, 'w1').start, day(3, '06'));
  assert.equal(get(plan("move tomorrow's long run to Thursday morning", { workouts: [{ ...WEEK.workouts[2], start: day(1, '18'), end: day(1, '19', '30') }, WEEK.workouts[1]] }), 'w3').start, day(3, '08')); // 90 minutes from 06:00 would run into strength at 07:00, then breakfast
  const same = plan("move Sunday's long run to the morning");
  assert.deepEqual([same.kind, same.proposed.length], ['move', 1]);
});

test('a resize that no longer fits its place moves that workout, and a longer one pushes the next one', () => {
  const tight = { events: [...WEEK.events, { id: 'e9', title: 'Dinner out', start: day(1, '19'), end: day(1, '21'), fixed: true }] };
  const r = plan("make Tuesday's run 90 minutes", tight);
  assert.deepEqual([get(r, 'w1').status, get(r, 'w1').minutes], ['resized', 90]);
  for (const e of tight.events) assert.ok(!overlaps(get(r, 'w1'), e));
  const two = { workouts: [...WEEK.workouts, { id: 'w4', activity: 'Yoga', start: day(1, '19', '30'), end: day(1, '20'), minutes: 30 }] };
  const grown = plan("make Tuesday's run 2 hours", two);
  assert.deepEqual([get(grown, 'w1').start, get(grown, 'w1').end, get(grown, 'w4').status, get(grown, 'w4').start], [day(1, '18'), day(1, '20'), 'moved', day(1, '20')]);
  assert.equal(get(grown, 'w4').reason, 'Moved to make room for Run.');
});

test('the same input gives the same output, and the input is not changed', () => {
  for (const request of REQUESTS) {
    const args = { ...WEEK, request, memory: { slots: [{ key: 'k', activity: 'run', weekday: 3, hour: 18, minutes: 45 }] } }, text = JSON.stringify(args);
    const a = calendarPlan(text), b = calendarPlan(text);
    assert.equal(a, b, request);
    assert.equal(JSON.stringify(args), text);
    const p = JSON.parse(a);
    assert.match(p.undoToken, /^u-[0-9a-f]{8}$/);
    if (p.proposed.length) {
      const change = JSON.stringify({ ...WEEK, plan: p, change: { type: 'text', text: 'a bit later' } });
      assert.equal(calendarReplan(change), calendarReplan(change), request);
    }
  }
  assert.notEqual(plan('yoga tomorrow morning').undoToken, plan('yoga tomorrow evening').undoToken);
});

test('the two functions never throw: bad input comes back as ok false with a code and a sentence', () => {
  const err = (fn, text) => { const r = JSON.parse(fn(text)); assert.deepEqual([r.ok, Object.keys(r), Object.keys(r.error)], [false, ['ok', 'error'], ['code', 'text']]); assert.match(r.error.text, /^[A-Z].*\.$/); return r.error.code; };
  assert.equal(err(calendarPlan, '{nope'), 'BadJSON');
  assert.equal(err(calendarPlan, 'null'), 'BadInput');
  assert.equal(err(calendarPlan, JSON.stringify({ request: 'run', now: 'soon' })), 'BadNow');
  assert.equal(err(calendarPlan, JSON.stringify({ request: 7, now: WEEK.now })), 'BadRequest');
  assert.equal(err(calendarPlan, JSON.stringify({ now: WEEK.now })), 'BadRequest');
  assert.equal(err(calendarPlan, JSON.stringify({ request: 'run', now: WEEK.now, workouts: [{ id: 'x', activity: 'Golf', start: day(1, '06'), minutes: 30 }] })), 'BadActivity');
  assert.equal(err(calendarReplan, JSON.stringify({ now: WEEK.now, change: { type: 'text', text: 'later' } })), 'BadPlan');
  assert.equal(err(calendarReplan, JSON.stringify({ now: WEEK.now, plan: { proposed: [] } })), 'BadChange');
  assert.equal(err(calendarReplan, JSON.stringify({ now: WEEK.now, plan: { proposed: [] }, change: { type: 'shake' } })), 'BadChange');
  assert.equal(err(calendarReplan, JSON.stringify({ now: WEEK.now, plan: { proposed: [] }, change: { type: 'text' } })), 'BadChange');
  // Events and workouts with broken times are left out, not fatal.
  const r = plan('yoga tomorrow morning', { events: [{ id: 'x', start: 'never', end: 'ever' }, null, 4], workouts: [{ id: 'y' }, { id: 'z', activity: 'Running', start: day(1, '06'), minutes: 30 }] });
  assert.deepEqual([r.ok, r.proposed[0].start], [true, day(1, '06', '30')]);
  assert.equal(replan(r, { type: 'drag', id: 'ghost', start: day(1, '09') }).message, 'That item is not part of this plan.');
});
