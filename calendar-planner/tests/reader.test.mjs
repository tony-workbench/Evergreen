import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDay, parseMinutes } from '../src/planner/core.mjs';
import { parseHint, detectActivity, normalizeActivity } from '../src/planner/fitness.mjs';
import { plan, replan, WEEK, day, date, hm, get } from './helpers.mjs';

const NOW = Date.parse('2026-11-09T09:00:00.000Z'); // wall time: Monday 9 November 2026, 09:00
const ymd = (t) => new Date(t).toISOString().slice(0, 10);

// Ported from Plan Calendar's tests/parser-wordings.test.mjs.
test('"end of this week" is never in the past, also on a weekend', () => {
  for (const now of ['2026-11-14T09:00:00.000Z', '2026-11-15T09:00:00.000Z']) assert.equal(ymd(parseDay('by end of this week', Date.parse(now))), '2026-11-20');
  assert.equal(ymd(parseDay('by end of this week', NOW)), '2026-11-13');
});

test('tomorrow, in N days, weekdays and ordinal days give the right day', () => {
  assert.equal(ymd(parseDay('tomorrow', NOW)), '2026-11-10');
  assert.equal(ymd(parseDay('in 3 days', NOW)), '2026-11-12');
  assert.equal(ymd(parseDay('the day after tomorrow', NOW)), '2026-11-11');
  assert.equal(ymd(parseDay('in 3 weeks', NOW)), '2026-11-30');
  assert.equal(ymd(parseDay('on Saturday', NOW)), '2026-11-14');
  assert.equal(ymd(parseDay('monday', NOW)), '2026-11-09');
  assert.equal(ymd(parseDay('next monday', NOW)), '2026-11-16');
  assert.equal(ymd(parseDay('by the 29th', NOW)), '2026-11-29');
  assert.equal(ymd(parseDay('on the 5th', Date.parse('2026-11-20T09:00:00.000Z'))), '2026-12-05');
  assert.equal(ymd(parseDay('by the 5th', Date.parse('2026-12-20T09:00:00.000Z'))), '2027-01-05');
  assert.equal(ymd(parseDay('march 7', NOW)), '2027-03-07');
});

test('lengths: minutes, hours and the spoken forms', () => {
  assert.deepEqual(['45 minutes', 'an hour', 'half an hour', '1.5 hours', 'an hour and a half', '20 min', 'after 6'].map(parseMinutes), [45, 60, 30, 90, 90, 20, null]);
});

test('activities are read from a sentence and from the app\'s own names', () => {
  const said = { 'a long run': 'long_run', 'go for a jog': 'run', 'a walk': 'walk', 'lift weights': 'strength', 'hit the gym': 'strength', 'some yoga': 'yoga', 'a bike ride': 'ride', 'go cycling': 'ride', 'a swim': 'swim', 'stretch after my run': 'stretch', 'a rest day': 'rest', '30 minutes on the elliptical': 'elliptical', 'work out': 'strength', 'call my mom': null };
  for (const [text, want] of Object.entries(said)) assert.equal(detectActivity(text), want, text);
  const named = { Running: 'run', long_run: 'long_run', Walking: 'walk', TraditionalStrengthTraining: 'strength', FunctionalStrengthTraining: 'strength', Yoga: 'yoga', Cycling: 'ride', Swimming: 'swim', run: 'run', rest: 'rest', Elliptical: 'elliptical', elliptical: 'elliptical', other: 'other', Rowing: null, workout: null };
  for (const [name, want] of Object.entries(named)) assert.equal(normalizeActivity(name), want, name);
});

test('time hints: parts of the day and clock times without am or pm', () => {
  const h = (text) => { const x = parseHint(text, NOW); return [x.lo, x.hi]; };
  assert.deepEqual(h('tomorrow morning'), [360, 720]);
  assert.deepEqual(h('this afternoon'), [720, 1020]);
  assert.deepEqual(h('tonight'), [1020, 1320]);
  assert.deepEqual(h('at lunch'), [690, 810]);
  assert.deepEqual(h('before work'), [360, 540]);
  assert.deepEqual(h('after 6'), [1080, 1320]);
  assert.deepEqual(h('after 8 tonight'), [1200, 1410]);
  assert.deepEqual(h('before 9'), [360, 540]);
  assert.deepEqual(h('after 7 am'), [420, 1320]);
  assert.deepEqual(h('tomorrow morning after 7'), [420, 720]);
  assert.deepEqual(h('at 7'), [420, 420]);
  assert.deepEqual(h('at 5:30pm'), [1050, 1050]);
  assert.equal(parseHint('for 45 minutes', NOW).any, false);
  assert.equal(parseHint('this weekend', NOW).span, 2);
  assert.equal(ymd(parseHint('this weekend', NOW).day), '2026-11-14');
  assert.equal(ymd(parseHint('this weekend', Date.parse('2026-11-15T09:00:00.000Z')).day), '2026-11-15');
});

test('add: different ways to ask, with lengths said or taken from the activity', () => {
  const cases = [
    ['Find me 45 minutes for a walk after 8 tonight', 'walk', 45, day(0, '20')],
    ['Can you fit a run in before work on Thursday?', 'run', 45, day(3, '06')],
    ['I want to do yoga tomorrow morning', 'yoga', 30, day(1, '06')],
    ['I need to hit the gym on Wednesday afternoon', 'strength', 40, day(2, '13')],
    ['squeeze in a 20 minute stretch at lunch', 'stretch', 20, day(0, '11', '30')],
    ['long run Saturday morning', 'long_run', 90, day(5, '06')],
    ['Schedule an hour ride on Friday after 6', 'ride', 60, day(4, '19', '30')],
    ['45 min swim tomorrow at 7', 'swim', 45, day(1, '07')],
    ['find me time for the elliptical tomorrow morning', 'elliptical', 40, day(1, '06')],
    ['Find time to work out for half an hour', 'strength', 30, day(0, '09')],
  ];
  for (const [request, activity, minutes, start] of cases) {
    const r = plan(request);
    assert.equal(r.kind, 'add', request);
    assert.equal(r.proposed.length, 1, request);
    assert.deepEqual([r.proposed[0].activity, r.proposed[0].minutes, r.proposed[0].start, r.proposed[0].status], [activity, minutes, start, 'new'], request);
    assert.ok(r.proposed[0].reason.length > 10 && /\.$/.test(r.proposed[0].reason), request);
  }
  const rest = plan('I need a rest day on Friday');
  assert.deepEqual([rest.proposed[0].activity, rest.proposed[0].minutes, rest.proposed[0].start, rest.proposed[0].end], ['rest', 0, day(4, '00'), day(5, '00')]);
  assert.equal(plan('Find time to work out for half an hour').proposed[0].title, 'Workout');
  assert.equal(get(plan('skip my workout on Thursday'), 'w2').status, 'cancelled');
});

test('the reason names what is in the way', () => {
  assert.equal(plan('Find me half an hour for a walk after 5 tonight').proposed[0].reason, 'First free 30 minutes after 5 PM tonight; your Team sync ends at 6 PM.');
  assert.equal(plan('a 45 minute walk after 6 tonight').proposed[0].reason, 'First free 45 minutes after 6 PM tonight; kept clear of dinner.');
  assert.equal(plan('45 min swim tomorrow at 7').proposed[0].reason, 'Free at 7 AM tomorrow, as you asked.');
});

test('move: different ways to ask', () => {
  const a = plan("Move Sunday's long run to the afternoon");
  assert.deepEqual([a.kind, a.proposed.length, get(a, 'w3').status, get(a, 'w3').start], ['move', 1, 'moved', day(6, '13')]);
  const b = plan("push tomorrow's run back an hour");
  assert.deepEqual([b.kind, get(b, 'w1').start, get(b, 'w1').end], ['move', day(1, '19'), day(1, '19', '45')]);
  const c = plan('shift my strength session to Friday');
  assert.deepEqual([c.kind, get(c, 'w2').start], ['move', day(4, '07')]);
  const d = plan('reschedule my run for Wednesday morning');
  assert.deepEqual([d.kind, get(d, 'w1').start], ['move', day(2, '06')]);
  const e = plan("Sunday's long run is too early");
  assert.deepEqual([e.kind, get(e, 'w3').start], ['move', day(6, '09')]);
  const f = plan('move my run to 7am');
  assert.deepEqual([f.kind, get(f, 'w1').start], ['move', day(1, '07')]);
  const h = plan("move Thursday's strength a day later");
  assert.deepEqual([get(h, 'w2').start, get(h, 'w2').reason], [day(4, '07'), '1 day later, as you asked.']);
  const i = plan('can we do the long run Saturday instead');
  assert.deepEqual([i.kind, get(i, 'w3').start], ['move', day(5, '07')]);
  const g = plan("bring Thursday's strength forward by 30 minutes");
  assert.deepEqual([g.kind, get(g, 'w2').start], ['move', day(3, '06', '30')]);
});

test('"not that early" moves the block the talk is about', () => {
  assert.equal(plan('not that early').kind, 'none');
  const first = plan('long run Saturday morning');
  const later = replan(first, { type: 'text', text: 'not that early' });
  assert.deepEqual([later.kind, later.proposed.length, later.proposed[0].status, later.proposed[0].start], ['add', 1, 'new', day(5, '09')]);
  const one = plan('not that early', { workouts: [WEEK.workouts[2]] });
  assert.deepEqual([one.kind, get(one, 'w3').start], ['move', day(6, '09')]);
});

test('resize: shorter, longer, to a length and by a length', () => {
  const a = plan("Make Tuesday's run 30 minutes");
  assert.deepEqual([a.kind, get(a, 'w1').status, get(a, 'w1').minutes, get(a, 'w1').start, get(a, 'w1').end], ['resize', 'resized', 30, day(1, '18'), day(1, '18', '30')]);
  assert.equal(get(plan("shorten tomorrow's run by 15 minutes"), 'w1').minutes, 30);
  assert.equal(get(plan('extend my long run to 2 hours'), 'w3').minutes, 120);
  assert.equal(get(plan("add 20 minutes to Thursday's strength"), 'w2').minutes, 60);
  assert.equal(get(plan('make my run 15 minutes longer'), 'w1').minutes, 60);
  assert.equal(get(plan("lengthen Thursday's strength"), 'w2').minutes, 55);
  assert.deepEqual([plan("make Tuesday's run 45 minutes").proposed.length, plan("make Tuesday's run 45 minutes").kind], [0, 'resize']);
});

test('cancel: skip, cancel and "can\'t make"', () => {
  for (const request of ["Skip Thursday's strength", 'cancel my strength session', "I can't make Thursday's strength", 'drop the gym on Thursday']) {
    const r = plan(request);
    assert.deepEqual([r.kind, r.proposed.length, get(r, 'w2')?.status, get(r, 'w2')?.start], ['cancel', 1, 'cancelled', day(3, '07')], request);
  }
  assert.equal(get(plan('skip my run'), 'w1').status, 'cancelled');
  assert.equal(get(plan("I can't run tomorrow"), 'w1').status, 'cancelled');
  assert.equal(get(plan("skip Sunday's run"), 'w3').status, 'cancelled');
});

test('a workout that is not there is not guessed', () => {
  const r = plan("skip Wednesday's run");
  assert.deepEqual([r.kind, r.proposed.length], ['none', 0]);
  assert.match(r.message, /could not find a run on Wednesday/);
  assert.match(plan('move my swim to Friday').message, /could not find a swim/);
  assert.equal(plan('cancel my dentist appointment').kind, 'none');
  assert.match(plan('no run today').message, /could not find a run today/);
  assert.match(plan('move it earlier').message, /not sure which workout/);
});

test('race: a last long run, two easy runs on their own days, then a rest day', () => {
  for (const request of ['My race is on the 29th', 'I have a half marathon on November 29th', 'my 10k is on the 29th, help me taper']) {
    const r = plan(request);
    assert.equal(r.kind, 'race', request);
    assert.deepEqual(r.proposed.map((p) => p.id), ['race-1', 'race-2', 'race-3', 'race-rest'], request);
    assert.deepEqual(r.proposed.map((p) => p.activity), ['long_run', 'run', 'run', 'rest']);
    assert.deepEqual(r.proposed.slice(0, 3).map((p) => p.minutes), [90, 45, 30]);
    const days = r.proposed.map((p) => date(p.start));
    assert.equal(new Set(days).size, 4);
    assert.ok(days[0] >= '2026-11-21' && days[2] < '2026-11-28', days.join());
    assert.deepEqual([days[3], r.proposed[3].minutes, date(r.proposed[3].end)], ['2026-11-28', 0, '2026-11-29']);
  }
  const soon = plan('my race is on Wednesday');
  assert.deepEqual(soon.proposed.map((p) => p.id), ['race-1', 'race-rest']);
  assert.match(soon.message, /Only 1 of 3 runs fit/);
});

test('a race with no date asks for it once, and the reply plans it', () => {
  const ask = plan('I signed up for a marathon');
  assert.deepEqual([ask.kind, ask.question.text, ask.question.answers.length, ask.proposed.length], ['question', 'When is your race?', 0, 0]);
  const r = replan(ask, { type: 'text', text: 'on the 29th' });
  assert.deepEqual([r.kind, r.proposed.length, r.question], ['race', 4, undefined]);
});

test('a sentence that is not a calendar request gives no plan and a short message', () => {
  const texts = ['Had hotpot last night, it was great', 'what is the capital of France?', 'I ran 5k yesterday and felt great', 'I love running in the morning', 'What should I eat before a run?',
    'how far did I run last week?', 'thanks!', '', 'I want to know how many calories I burned', 'my knee hurts after the long run', 'The walk was nice', 'plan my week', 'book a table for dinner at 7', 'find 20 minutes to call my mom tomorrow'];
  for (const request of texts) {
    const r = plan(request);
    assert.deepEqual([r.ok, r.kind, r.proposed.length, r.question], [true, 'none', 0, undefined], request);
    assert.ok(r.message.length > 0 && r.message.length < 140, request);
  }
});

test('what the reader cannot do is said plainly, not guessed', () => {
  for (const request of ['do yoga every morning', 'I want to run 3 times this week', 'push everything back an hour']) assert.match(plan(request).message, /one workout at a time/, request);
  for (const request of ['30 min run then stretch', 'add a run and a swim this week']) assert.deepEqual([plan(request).kind, plan(request).proposed.length], ['none', 0], request);
  assert.match(plan('swap my run and strength').message, /cannot swap/);
  assert.equal(plan('find me 15 minutes to stretch after my run tomorrow').kind, 'add');
});

test('the rules reader never makes up "other": words it does not know are not understood', () => {
  for (const request of ['find me an hour for climbing tomorrow', 'schedule rowing on Friday morning', 'find me time for some other thing on Friday', 'pilates tonight']) assert.deepEqual([plan(request).kind, plan(request).proposed.length], ['none', 0], request);
  // A workout of activity "other" that is already there can still be named as a workout.
  const climb = { workouts: [{ id: 'c1', activity: 'other', title: 'Climbing', start: day(2, '18'), end: day(2, '19'), minutes: 60 }] };
  assert.deepEqual([get(plan('skip my workout on Wednesday', climb), 'c1').status, get(plan('skip my workout on Wednesday', climb), 'c1').activity, get(plan('skip my workout on Wednesday', climb), 'c1').title], ['cancelled', 'other', 'Climbing']);
  assert.equal(get(plan('move it to Thursday', climb), 'c1').start, day(3, '18'));
  assert.equal(plan('yoga on Wednesday at 6pm', climb).proposed[0].start, day(2, '20'));
});

test('every proposed block has the shared shape and an activity from the closed list', () => {
  const LIST = ['run', 'long_run', 'walk', 'strength', 'yoga', 'ride', 'swim', 'stretch', 'elliptical', 'other', 'rest'], KEYS = ['id', 'sessionId', 'activity', 'title', 'start', 'end', 'minutes', 'status', 'reason'];
  for (const request of ['Find time to work out for half an hour', 'my race is on the 29th', "skip Thursday's strength", 'rest day on Friday', "Move Thursday's strength to Saturday", "make Tuesday's run 30 minutes", 'a bike ride on Saturday', 'elliptical on Friday']) {
    for (const p of plan(request).proposed) {
      assert.ok(LIST.includes(p.activity), `${request}: ${p.activity}`);
      for (const k of Object.keys(p)) assert.ok(KEYS.includes(k), `${request}: ${k}`);
      assert.ok(['new', 'moved', 'resized', 'cancelled'].includes(p.status));
    }
  }
});
