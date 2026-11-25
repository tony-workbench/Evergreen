import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarIntentSchema } from '../src/phone/entry.mjs';
import { plan, replan, WEEK, day, get } from './helpers.mjs';

const ask = (intent, more = {}) => plan(undefined, { ...more, intent });
const code = (intent, more) => { const r = ask(intent, more); assert.deepEqual([r.ok, Object.keys(r.error)], [false, ['code', 'text']], JSON.stringify(intent)); assert.match(r.error.text, /^\S.*\.$/); return r.error.code; };

// Each sentence and the intent an agent would send for it.
const PAIRS = [
  ['Find me 45 minutes for a walk after 8 tonight', { kind: 'add', activity: 'walk', minutes: 45, day: '2026-11-09', after: '20:00', partOfDay: 'evening' }],
  ['I want to do yoga tomorrow morning', { kind: 'add', activity: 'yoga', day: '2026-11-10', partOfDay: 'morning' }],
  ['find me a run', { kind: 'add', activity: 'run' }],
  ['find me a run on Thursday before 9', { kind: 'add', activity: 'run', day: '2026-11-12', before: '09:00' }],
  ['long run on Saturday', { kind: 'add', activity: 'long_run', day: '2026-11-14' }],
  ['rest day on Friday', { kind: 'add', activity: 'rest', day: '2026-11-13' }],
  ['find me time for the elliptical on Friday', { kind: 'add', activity: 'elliptical', day: '2026-11-13' }],
  ["Move Sunday's long run to the afternoon", { kind: 'move', targetWorkoutId: 'w3', partOfDay: 'afternoon' }],
  ["Move Thursday's strength to Saturday", { kind: 'move', targetWorkoutId: 'w2', day: '2026-11-14' }],
  ["move tomorrow's run to Thursday morning", { kind: 'move', targetWorkoutId: 'w1', day: '2026-11-12', partOfDay: 'morning' }],
  ["reschedule Thursday's strength", { kind: 'move', targetWorkoutId: 'w2' }],
  ["Make Tuesday's run 30 minutes", { kind: 'resize', targetWorkoutId: 'w1', minutes: 30 }],
  ['extend my long run to 2 hours', { kind: 'resize', targetWorkoutId: 'w3', minutes: 120 }],
  ["Skip Thursday's strength", { kind: 'cancel', targetWorkoutId: 'w2' }],
  ['My race is on the 29th', { kind: 'race', raceDate: '2026-11-29' }],
];

test('each kind through `intent` gives exactly what the equivalent sentence gives', () => {
  const memory = { slots: [{ key: 'k', activity: 'run', weekday: 3, hour: 18, minutes: 45 }] };
  const kinds = new Set();
  for (const [request, intent] of PAIRS) for (const more of [{}, { memory }]) {
    const said = plan(request, more), sent = ask(intent, more);
    assert.equal(sent.ok, true, request);
    assert.deepEqual(sent, said, request);
    kinds.add(intent.kind);
  }
  assert.deepEqual([...kinds].sort(), ['add', 'cancel', 'move', 'race', 'resize']);
  // null fields count as left out, and an intent wins over a sentence sent with it.
  assert.deepEqual(ask({ kind: 'cancel', targetWorkoutId: 'w2', day: null, minutes: null }), plan("Skip Thursday's strength"));
  assert.deepEqual(plan('not a request', { intent: PAIRS[2][1] }), plan('find me a run'));
});

test('an intent as a text change gives what the follow-up sentence gives', () => {
  const first = plan('long run Saturday morning');
  const pairs = [
    ['make it an hour', { kind: 'resize', targetWorkoutId: 'new-1', minutes: 60 }],
    ['move it to Sunday afternoon', { kind: 'move', targetWorkoutId: 'new-1', day: '2026-11-15', partOfDay: 'afternoon' }],
    ['skip it', { kind: 'cancel', targetWorkoutId: 'new-1' }],
    ['also add yoga on Friday morning', { kind: 'add', activity: 'yoga', day: '2026-11-13', partOfDay: 'morning' }],
    ["skip Thursday's strength", { kind: 'cancel', targetWorkoutId: 'w2' }],
    ['my race is on the 29th', { kind: 'race', raceDate: '2026-11-29' }],
  ];
  for (const [text, intent] of pairs) assert.deepEqual(replan(first, { type: 'text', intent }), replan(first, { type: 'text', text }), text);
  const r = replan(first, { type: 'text', intent: { kind: 'move', targetWorkoutId: 'ghost', day: '2026-11-15' } });
  assert.deepEqual([r.ok, r.error.code], [false, 'UnknownTarget']);
});

test('a session id given with an add comes back on its block and stays through re-plans', () => {
  const r = ask({ kind: 'add', sessionId: 'ses_2026-11-12_run_18', activity: 'run', minutes: 40, day: '2026-11-12', after: '18:00' });
  assert.deepEqual(Object.keys(r.proposed[0]), ['id', 'sessionId', 'activity', 'title', 'start', 'end', 'minutes', 'status', 'reason']);
  assert.deepEqual([r.proposed[0].sessionId, r.proposed[0].start, r.proposed[0].minutes], ['ses_2026-11-12_run_18', day(3, '18'), 40]);
  const moved = replan(r, { type: 'drag', id: 'new-1', start: day(3, '20', '30') });
  assert.deepEqual([moved.proposed[0].sessionId, moved.proposed[0].start], ['ses_2026-11-12_run_18', day(3, '20', '30')]);
  assert.equal(ask({ kind: 'add', sessionId: 's-rest', activity: 'rest', day: '2026-11-13' }).proposed[0].sessionId, 's-rest');
  assert.equal(Object.hasOwn(ask({ kind: 'add', activity: 'run' }).proposed[0], 'sessionId'), false);
});

test('"other" is anything not named: 30 minutes, the given title or "Workout", usual slots and distance as for any activity', () => {
  const plain = ask({ kind: 'add', activity: 'other', day: '2026-11-10', partOfDay: 'morning' });
  assert.deepEqual([plain.kind, plain.proposed[0].activity, plain.proposed[0].title, plain.proposed[0].minutes, plain.proposed[0].start], ['add', 'other', 'Workout', 30, day(1, '06')]);
  const named = ask({ kind: 'add', activity: 'other', title: ' Climbing ', minutes: 60, day: '2026-11-11', after: '18:00' });
  assert.deepEqual([named.proposed[0].title, named.proposed[0].minutes, named.proposed[0].start, named.message], ['Climbing', 60, day(2, '20'), 'Climbing Wednesday, 8 PM to 9 PM.']);
  assert.equal(ask({ kind: 'add', activity: 'yoga', title: 'Hot yoga' }).proposed[0].title, 'Hot yoga');
  const usual = ask({ kind: 'add', activity: 'other', title: 'Climbing' }, { memory: { slots: [{ key: 'k', activity: 'other', weekday: 4, hour: 17, minutes: 60 }], paceMinPerKm: 6 } });
  assert.deepEqual([usual.proposed[0].start, usual.proposed[0].reason], [day(4, '17'), 'Your usual Friday 5 PM time for a workout is free.']);
  assert.equal(ask({ kind: 'add', activity: 'other', distanceKm: 5 }, { memory: { paceMinPerKm: 6 } }).proposed[0].minutes, 30);
  // It keeps its title and activity through a re-plan, and existing ones can be targets.
  const later = replan(named, { type: 'text', intent: { kind: 'resize', targetWorkoutId: 'new-1', minutes: 45 } });
  assert.deepEqual([later.proposed[0].activity, later.proposed[0].title, later.proposed[0].minutes], ['other', 'Climbing', 45]);
  const climb = { workouts: [{ id: 'c1', activity: 'other', start: day(2, '18'), end: day(2, '19'), minutes: 60 }] };
  const moved = ask({ kind: 'move', targetWorkoutId: 'c1', day: '2026-11-12' }, climb);
  assert.deepEqual([get(moved, 'c1').activity, get(moved, 'c1').title, get(moved, 'c1').start], ['other', 'Workout', day(3, '18')]);
});

test('an exact start is kept: meals do not move an accepted suggestion or a usual time, only real events and workouts do', () => {
  const tuesday = { kind: 'add', activity: 'run', minutes: 40, day: '2026-11-10', after: '07:00' };
  const slots = { memory: { slots: [{ key: 'k', activity: 'run', weekday: 1, hour: 7, minutes: 40 }] } };
  // A free request still keeps clear of breakfast (07:30 to 08:00).
  const free = ask(tuesday);
  assert.deepEqual([free.proposed[0].start, free.proposed[0].reason], [day(1, '08'), 'First free 40 minutes after 7 AM tomorrow; kept clear of breakfast.']);
  assert.deepEqual(free, plan('find me a 40 minute run tomorrow after 7 am'));
  // The accepted suggestion, the usual time and the flag all land at 07:00.
  for (const [intent, more] of [[{ ...tuesday, sessionId: 's1' }, {}], [{ ...tuesday, sessionId: 's1' }, slots], [tuesday, slots], [{ ...tuesday, exact: true }, {}]]) {
    const r = ask(intent, more);
    assert.deepEqual([r.kind, r.proposed[0].start, r.proposed[0].end, r.proposed[0].reason], ['add', day(1, '07'), day(1, '07', '40'), 'Free at 7 AM tomorrow, as you asked.'], JSON.stringify(intent));
  }
  assert.equal(ask({ kind: 'add', activity: 'yoga', day: '2026-11-10', after: '12:15', exact: true }).proposed[0].start, day(1, '12', '15'));
  // Not exact: another activity's usual time, another weekday, a window, a part of the day, or exact: false with no session.
  assert.equal(ask({ ...tuesday, activity: 'yoga' }, slots).proposed[0].start, day(1, '08'));
  assert.equal(ask({ ...tuesday, day: '2026-11-11' }, slots).proposed[0].start, day(2, '08'));
  assert.equal(ask({ ...tuesday, sessionId: 's1', before: '10:00' }).proposed[0].start, day(1, '08'));
  assert.equal(ask({ ...tuesday, sessionId: 's1', partOfDay: 'morning' }).proposed[0].start, day(1, '08'));
  assert.equal(ask({ ...tuesday, exact: false }).proposed[0].start, day(1, '08'));
  // A real event at 07:00 still pushes it, and the reason says which event.
  const events = [...WEEK.events, { id: 'e9', title: 'Dentist', start: day(1, '07'), end: day(1, '07', '30'), fixed: true }];
  const pushed = ask({ ...tuesday, sessionId: 's1' }, { ...slots, events });
  assert.deepEqual([pushed.proposed[0].start, pushed.proposed[0].sessionId], [day(1, '08'), 's1']);
  assert.match(pushed.message, /Nothing fits at that time, so I picked the next free time\./);
  const direct = ask({ ...tuesday, minutes: 30, sessionId: 's1' }, { events: [...WEEK.events, { id: 'e9', title: 'Dentist', start: day(1, '06', '30'), end: day(1, '08'), fixed: true }] });
  assert.deepEqual([direct.proposed[0].start, direct.proposed[0].reason], [day(1, '08'), 'Next free 30 minutes tomorrow; your Dentist ends at 8 AM.']);
  // Another workout in the way pushes it too.
  const busy = { workouts: [...WEEK.workouts, { id: 'w9', activity: 'yoga', start: day(1, '06', '45'), end: day(1, '07', '15'), minutes: 30 }] };
  const after = ask({ ...tuesday, exact: true }, busy);
  assert.ok(after.proposed[0].start >= day(1, '07', '15'));
  // An exact move.
  assert.equal(get(ask({ kind: 'move', targetWorkoutId: 'w1', day: '2026-11-10', after: '07:15', exact: true }), 'w1').start, day(1, '07', '15'));
});

test('between two times, and a window that is taken falls back with a note', () => {
  const r = ask({ kind: 'add', activity: 'yoga', day: '2026-11-11', after: '16:00', before: '18:00' });
  assert.deepEqual([r.proposed[0].start, r.proposed[0].reason], [day(2, '16'), 'First free 30 minutes between 4 PM and 6 PM on Wednesday.']);
  const full = ask({ kind: 'add', activity: 'strength', day: '2026-11-11', after: '19:00', before: '20:00' });
  assert.equal(full.proposed[0].start, day(2, '20'));
  assert.match(full.message, /Nothing fits at that time/);
});

test('distance becomes minutes with the usual pace, else the usual length', () => {
  const run = { kind: 'add', activity: 'run', distanceKm: 8, day: '2026-11-10', partOfDay: 'morning' };
  const paced = ask(run, { memory: { paceMinPerKm: 6.2 } });
  assert.deepEqual([paced.proposed[0].minutes, paced.proposed[0].start], [50, day(1, '06')]);
  assert.match(paced.message, /8 km at your usual pace is about 50 minutes\./);
  const plain = ask(run);
  assert.equal(plain.proposed[0].minutes, 45);
  assert.match(plain.message, /I do not know your pace for that, so I used the usual 45 minutes\./);
  assert.equal(ask(run, { memory: { paceMinPerKm: 'fast' } }).proposed[0].minutes, 45);
  assert.equal(ask({ ...run, activity: 'long_run', distanceKm: 21.1 }, { memory: { paceMinPerKm: 6 } }).proposed[0].minutes, 125);
  assert.equal(ask({ ...run, distanceKm: 60 }, { memory: { paceMinPerKm: 6 } }).proposed[0].minutes, 240);
  // Minutes win over distance; pace is a running pace, so a ride keeps its usual length.
  assert.equal(ask({ ...run, minutes: 30 }, { memory: { paceMinPerKm: 6 } }).proposed[0].minutes, 30);
  assert.equal(ask({ ...run, activity: 'ride' }, { memory: { paceMinPerKm: 6 } }).proposed[0].minutes, 60);
  const resized = ask({ kind: 'resize', targetWorkoutId: 'w1', distanceKm: 5 }, { memory: { paceMinPerKm: 6 } });
  assert.deepEqual([get(resized, 'w1').minutes, get(resized, 'w1').status], [30, 'resized']);
  assert.equal(code({ kind: 'resize', targetWorkoutId: 'w1', distanceKm: 5 }), 'MissingMinutes');
});

test('every way an intent can be wrong has its own code and a sentence to relay', () => {
  const add = { kind: 'add', activity: 'run' }, move = { kind: 'move', targetWorkoutId: 'w1' };
  const cases = [
    ['BadIntent', 'run tomorrow'], ['BadIntent', []], ['BadIntent', 7],
    ['BadKind', {}], ['BadKind', { kind: 'swap' }], ['BadKind', { kind: 3 }],
    ['UnknownField', { ...add, pace: 'easy' }],
    ['BadActivity', { kind: 'add', activity: 'golf' }], ['BadActivity', { kind: 'add', activity: 'long run' }], ['BadActivity', { kind: 'add', activity: 'Running' }],
    ['MissingActivity', { kind: 'add', minutes: 30 }],
    ['BadMinutes', { ...add, minutes: 0 }], ['BadMinutes', { ...add, minutes: 241 }], ['BadMinutes', { ...add, minutes: 30.5 }], ['BadMinutes', { ...add, minutes: '30' }],
    ['BadDistance', { ...add, distanceKm: 0 }], ['BadDistance', { ...add, distanceKm: 500 }], ['BadDistance', { ...add, distanceKm: 'far' }],
    ['BadTitle', { ...add, title: '' }], ['BadTitle', { ...add, title: 'x'.repeat(61) }], ['BadTitle', { ...add, title: 5 }],
    ['BadExact', { ...add, after: '07:00', exact: 'yes' }], ['MissingTime', { ...add, exact: true }], ['MissingTime', { ...add, exact: true, partOfDay: 'morning' }],
    ['BadSessionId', { ...add, sessionId: '' }], ['BadSessionId', { ...add, sessionId: 12 }],
    ['BadDay', { ...add, day: 'tomorrow' }], ['BadDay', { ...add, day: '2026-02-30' }], ['BadDay', { ...add, day: '2026-13-01' }],
    ['PastDay', { ...add, day: '2026-11-08' }],
    ['BadTime', { ...add, after: '25:00' }], ['BadTime', { ...add, after: '6pm' }], ['BadTime', { ...add, before: '9:00' }], ['BadTime', { ...add, before: '12:60' }],
    ['BadTimeRange', { ...add, after: '18:00', before: '17:00' }], ['BadTimeRange', { ...add, after: '18:00', before: '18:30' }],
    ['BadTimeRange', { ...add, partOfDay: 'morning', after: '18:00' }], ['BadTimeRange', { ...add, partOfDay: 'evening', before: '09:00' }],
    ['BadPartOfDay', { ...add, partOfDay: 'night' }],
    ['MissingTarget', { kind: 'move', day: '2026-11-12' }], ['MissingTarget', { kind: 'cancel' }], ['MissingTarget', { kind: 'resize', minutes: 30 }],
    ['BadTarget', { kind: 'cancel', targetWorkoutId: 7 }],
    ['UnknownTarget', { kind: 'cancel', targetWorkoutId: 'w9' }], ['UnknownTarget', { ...move, targetWorkoutId: 'e1' }], ['UnknownTarget', { kind: 'resize', targetWorkoutId: 'new-1', minutes: 30 }],
    ['MissingMinutes', { kind: 'resize', targetWorkoutId: 'w1' }],
    ['MissingRaceDate', { kind: 'race' }],
    ['BadRaceDate', { kind: 'race', raceDate: 'the 29th' }], ['BadRaceDate', { kind: 'race', raceDate: '2026-11-31' }],
    ['PastRaceDate', { kind: 'race', raceDate: '2026-11-09' }], ['PastRaceDate', { kind: 'race', raceDate: '2025-11-29' }],
  ];
  for (const [want, intent] of cases) assert.equal(code(intent), want, JSON.stringify(intent));
  assert.equal(new Set(cases.map(([c]) => c)).size, 23);
  assert.equal(ask({ kind: 'cancel', targetWorkoutId: 'w9' }).error.text, 'There is no workout with the id "w9" in the plan.');
  // A rest day can be cancelled but not resized, and a workout already cancelled in the proposal is not a target.
  const rest = { workouts: [...WEEK.workouts, { id: 'r1', activity: 'rest', start: day(4, '00'), end: day(5, '00'), minutes: 0 }] };
  assert.equal(code({ kind: 'resize', targetWorkoutId: 'r1', minutes: 30 }, rest), 'BadTarget');
  assert.equal(get(ask({ kind: 'cancel', targetWorkoutId: 'r1' }, rest), 'r1').status, 'cancelled');
  const gone = ask({ kind: 'cancel', targetWorkoutId: 'w2' });
  assert.equal(replan(gone, { type: 'text', intent: { kind: 'move', targetWorkoutId: 'w2', day: '2026-11-13' } }).error.code, 'UnknownTarget');
});

// A small checker for the part of JSON Schema the intent schema uses, written apart from the engine's own check.
const KEYWORDS = ['type', 'description', 'additionalProperties', 'required', 'properties', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum'];
function accepts(schema, value) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.required.some((k) => !(k in value))) return false;
    return Object.entries(value).every(([k, v]) => (k in schema.properties ? accepts(schema.properties[k], v) : schema.additionalProperties !== false));
  }
  if (schema.type === 'string' && typeof value !== 'string') return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (schema.type === 'integer' && !Number.isInteger(value)) return false;
  if (schema.type === 'number' && typeof value !== 'number') return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  if ('minLength' in schema && value.length < schema.minLength) return false;
  if ('maxLength' in schema && value.length > schema.maxLength) return false;
  if ('minimum' in schema && value < schema.minimum) return false;
  if ('maximum' in schema && value > schema.maximum) return false;
  return !('exclusiveMinimum' in schema && value <= schema.exclusiveMinimum);
}

test('calendarIntentSchema is a JSON Schema a model can be given, and it accepts the examples', () => {
  const text = calendarIntentSchema(), schema = JSON.parse(text);
  assert.equal(text, calendarIntentSchema());
  assert.deepEqual([schema.type, schema.additionalProperties, schema.required], ['object', false, ['kind']]);
  assert.deepEqual(Object.keys(schema.properties), ['kind', 'activity', 'title', 'minutes', 'sessionId', 'targetWorkoutId', 'day', 'after', 'exact', 'before', 'partOfDay', 'raceDate', 'distanceKm']);
  assert.deepEqual(schema.properties.kind.enum, ['add', 'move', 'resize', 'cancel', 'race']);
  assert.deepEqual(schema.properties.activity.enum, ['long_run', 'run', 'walk', 'strength', 'yoga', 'ride', 'swim', 'stretch', 'elliptical', 'other', 'rest']);
  for (const node of [schema, ...Object.values(schema.properties)]) {
    for (const k of Object.keys(node)) assert.ok(KEYWORDS.includes(k), k);
    assert.ok(['object', 'string', 'integer', 'number', 'boolean'].includes(node.type));
    assert.ok(typeof node.description === 'string' && node.description.length > 10);
    if (node.pattern) assert.doesNotThrow(() => new RegExp(node.pattern));
    if (node.enum) assert.ok(node.enum.length > 0 && node.enum.every((v) => typeof v === 'string'));
  }
  const examples = [...PAIRS.map(([, intent]) => intent), { kind: 'add', sessionId: 's1', activity: 'run', distanceKm: 8.5, day: '2026-11-10', after: '06:00', before: '09:00' }, { kind: 'add', activity: 'other', title: 'Climbing', minutes: 60 }, { kind: 'add', activity: 'other' }, { kind: 'add', activity: 'run', day: '2026-11-10', after: '07:00', exact: true }];
  for (const intent of examples) {
    assert.ok(accepts(schema, intent), JSON.stringify(intent));
    assert.equal(ask(intent, { memory: { paceMinPerKm: 6 } }).ok, true, JSON.stringify(intent));
  }
  // What the schema turns away, the engine turns away too.
  for (const intent of [{}, { kind: 'swap' }, { kind: 'add', activity: 'golf' }, { kind: 'add', activity: 'run', minutes: 2 }, { kind: 'add', activity: 'run', after: '6pm' }, { kind: 'add', activity: 'run', mood: 'good' }, { kind: 'race', raceDate: '29 Nov' }, { kind: 'add', activity: 'run', distanceKm: 0 }]) {
    assert.equal(accepts(schema, intent), false, JSON.stringify(intent));
    assert.equal(ask(intent).ok, false, JSON.stringify(intent));
  }
});
