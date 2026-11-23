// The guarded executor: every guardrail with a proposal that passes and one that fails, by its code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExtras, recordExtras, confidenceOf, reviewQueue, confirmMemory, rejectMemory, stopSlots, REJECT_CODES, GUARD_CODES, CODE_TEXT, MAX_PROPOSALS, allowedNumbers, numbersNotIn, factEvidence } from '../src/agent/index.mjs';
import { seed, apply, SLEEP, SLOT, VOLUME, DAY, DAYS, CTX, sleepFact, slotFact, volumeFact, medianFact, recordFacts, recordOutcomes, outcome } from './helpers/agent-seed.mjs';

const codes = (r) => r.rejected.map((x) => x.code);
const only = (state, proposal, day) => apply(state, [proposal], day);
const tested = new Set();
// A proposal that fails with `code`, next to one that passes on the same state.
function pair(code, makeState, bad, good = SLEEP) {
  tested.add(code);
  test(`${code}: the failing proposal is dropped with that code and writes nothing; the passing one is applied`, () => {
    const failing = makeState();
    const r = only(failing, bad);
    assert.deepEqual([r.ok, codes(r), r.applied], [true, [code], []]);
    assert.equal(r.rejected[0].text, CODE_TEXT[code]);
    assert.equal(r.rejected[0].index, 0);
    assert.deepEqual(failing.memories, makeState().memories);
    const passing = makeState();
    const g = only(passing, good);
    assert.deepEqual([codes(g), g.applied.length], [[], 1]);
  });
}

pair('bad_shape', seed, { ...SLEEP, evidenceIds: 'body.sleep' });
pair('bad_slot', seed, { ...SLEEP, slot: 'Body.Sleep' });
pair('slot_family', seed, { ...SLEEP, slot: 'mood.sleep' });
pair('unknown_evidence', seed, { ...SLEEP, evidenceIds: ['body.sleep', 'body.dreams'] });
pair('slot_not_supported', seed, { ...SLEEP, slot: 'body.resting_hr', kind: 'resting_hr' });
pair('kind_mismatch', seed, { ...SLEEP, kind: 'load' });
pair('number_not_in_evidence', seed, { ...SLEEP, statement: 'Average sleep is 9.4 h a night over 7 days and 8.6 h over 28 days.' });
pair('not_a_fact', seed, { ...SLEEP, statement: 'You should sleep more than 8.8 h a night over 7 days.' });
pair('target_missing', () => { const s = seed(); apply(s, [SLEEP], DAYS[6]); return s; }, { ...SLEEP, op: 'NOOP' }, { ...SLEEP, op: 'NOOP', targetMemoryId: 'mem_0001' });
pair('target_not_neighbor', () => { const s = seed(); apply(s, [SLEEP, SLOT], DAYS[6]); return s; }, { ...SLEEP, op: 'MERGE', targetMemoryId: 'mem_0002' }, { ...SLEEP, op: 'MERGE', targetMemoryId: 'mem_0001' });
pair('target_not_open', () => { const s = seed(); apply(s, [SLEEP], DAYS[6]); s.memories[0].state = 'inactive'; return s; }, { ...SLEEP, op: 'MERGE', targetMemoryId: 'mem_0001' }, SLEEP);
pair('slot_occupied', () => { const s = seed(); apply(s, [SLEEP], DAYS[6]); return s; }, SLEEP, SLOT);
pair('slot_stopped', () => { const s = seed(); stopSlots(s, ['body.sleep'], CTX); return s; }, SLEEP, SLOT);
pair('raw_reading', () => {
  const s = seed();
  s.evidence[DAY].push({ id: 'body.sleep_night', text: 'Sleep on 2026-11-17: 6.20 h.', numbers: { hours: 6.2 }, window: 'day', slots: [{ slot: 'body.sleep', kind: 'sleep', data: {} }] });
  return s;
}, { ...SLEEP, statement: 'The night of 2026-11-17 had 6.2 h of sleep.', evidenceIds: ['body.sleep_night'] }, { ...SLEEP, evidenceIds: ['body.sleep', 'body.sleep_night'] });

tested.add('duplicate_slot');
test('duplicate_slot: the second proposal for one slot in an answer is dropped', () => {
  const r = apply(seed(), [SLEEP, { ...SLEEP, op: 'REVIEW' }, SLOT]);
  assert.deepEqual([codes(r), r.rejected[0].index, r.applied.map((a) => a.slot)], [['duplicate_slot'], 1, ['body.sleep', 'routine.run.sun_08']]);
});
tested.add('too_many');
test('too_many: proposals beyond the limit are dropped', () => {
  const r = apply(seed(), [SLEEP, ...Array.from({ length: MAX_PROPOSALS }, () => SLOT)]);
  assert.equal(r.rejected[r.rejected.length - 1].code, 'too_many');
  assert.equal(r.rejected[r.rejected.length - 1].index, MAX_PROPOSALS);
});
tested.add('rejected_before');
test('rejected_before: a change the person said no to is not proposed again; a different statement is asked again', () => {
  const s = seed();
  apply(s, [SLEEP], DAYS[5]);
  const changed = { ...SLEEP, op: 'REVIEW', statement: 'Average sleep is 8.8 h a night over 7 days.' };
  const asked = apply(s, [changed], DAYS[6]);
  assert.equal(asked.review[0].targetMemoryId, 'mem_0001');
  assert.equal(rejectMemory(s, { memoryId: asked.review[0].memoryId }, CTX).state, 'rejected');
  assert.equal(s.stopped['body.sleep'], undefined, 'the memory in use stays; only the change is rejected');
  assert.deepEqual(codes(only(s, changed)), ['rejected_before']);
  const other = seed();
  apply(other, [SLEEP], DAYS[5]);
  rejectMemory(other, { memoryId: apply(other, [changed], DAYS[6]).review[0].memoryId }, CTX);
  assert.deepEqual(only(other, { ...changed, statement: 'Average sleep is 8.6 h a night over 28 days.' }).applied.map((a) => a.op), ['REVIEW']);
});

test('every drop code and every guard code has a test here, and a text', () => {
  for (const code of REJECT_CODES) assert.ok(tested.has(code), code);
  for (const code of [...REJECT_CODES, ...GUARD_CODES]) assert.equal(typeof CODE_TEXT[code], 'string', code);
});

const MERGE = { ...SLEEP, op: 'MERGE', targetMemoryId: 'mem_0001', statement: 'Average sleep is 8.8 h a night over 7 days.' };
test('weak_evidence: MERGE and SUPERSEDE with under 3 days of support become a question; with 3 days they are applied', () => {
  for (const op of ['MERGE', 'SUPERSEDE']) {
    const thin = seed(2);
    apply(thin, [SLEEP], DAYS[6]);
    const r = only(thin, { ...MERGE, op });
    assert.deepEqual(r.applied, [{ index: 0, op: 'REVIEW', slot: 'body.sleep', memoryId: 'mem_0002', version: 1, guard: 'weak_evidence' }]);
    assert.equal(thin.memories[0].versions.length, 1, 'the memory in use is untouched');
    assert.deepEqual([r.review[0].reason.code, r.review[0].targetMemoryId, r.review[0].question], ['weak_evidence', 'mem_0001', 'Is this right?']);
    const strong = seed(3);
    apply(strong, [SLEEP], DAYS[6]);
    assert.deepEqual(only(strong, { ...MERGE, op }).applied.map((a) => [a.op, a.guard]), [[op, undefined]]);
  }
});
test('a usual slot always has a length: the person\'s median, else the activity default; an activity that is not named is other with its label', () => {
  const s = seed(8, [slotFact()]);
  assert.deepEqual(codes(only(s, SLOT)), []);
  assert.equal(s.memories[0].versions[0].data.minutes, 45);
  const hike = { ...slotFact(), id: 'regularity.slot.Hiking.Sat.09', numbers: { activityType: 'Hiking', weekday: 'Sat', hour: 9, weeks: 3 }, text: 'Fixed slot among recognised activities: hiking on Sat between 09:00 and 10:00, in 3 of the last 4 weeks.' };
  const mix = { id: 'mix.count', window: '28d', numbers: { byActivity: { Running: 20, Hiking: 3, HighIntensityIntervalTraining: 2 }, total: 25 }, text: 'Counted workouts (10 minutes or more) by activity in the last 28 days: running 20, hiking 3, high intensity interval training 2.' };
  const t = seed(8, [hike, mix]);
  const r = apply(t, [
    { op: 'ADD', slot: 'routine.other.hiking.sat_09', kind: 'usual_slot', statement: 'Hiking on Sat between 09:00 and 10:00 in 3 of the last 4 weeks.', evidenceIds: [hike.id], confidence: 0.8 },
    { op: 'ADD', slot: 'routine.mix', kind: 'mix', statement: 'Workouts by activity over the last 28 days: running 20, hiking 3, high intensity interval training 2.', evidenceIds: ['mix.count'], confidence: 0.8 },
  ]);
  assert.deepEqual(codes(r), []);
  assert.deepEqual(t.memories.map((m) => m.versions[0].data), [{ activity: 'other', weekday: 5, hour: 9, minutes: 30, weeksSeen: 3, weeksTotal: 4, label: 'hiking' }, { byActivity: { run: 20, other: 5 } }]);
});
test('gear and goal come from the app: they are evidence, their rows are written at once, and km must match', () => {
  const s = seed();
  recordExtras(s, cleanExtras({ gear: [{ item: 'shoes', name: 'Pegasus 41', startedOn: '2026-06-01', km: 412.5 }], goal: [{ what: 'half marathon', date: '2027-03-01' }, { what: 'sleep earlier' }] }), DAY);
  const GEAR = { op: 'ADD', slot: 'gear.shoes', kind: 'gear', statement: 'Shoes Pegasus 41 have 413 km since 2026-06-01.', evidenceIds: ['gear.shoes'], confidence: 0.9 };
  assert.deepEqual(codes(only(seed(), GEAR)), ['unknown_evidence']);
  const r = apply(s, [GEAR, { op: 'ADD', slot: 'goal.half_marathon', kind: 'goal', statement: 'The goal is a half marathon on 2027-03-01.', evidenceIds: ['goal.half_marathon'], confidence: 0.9 },
    { op: 'ADD', slot: 'goal.sleep_earlier', kind: 'goal', statement: 'The goal is to sleep earlier.', evidenceIds: ['goal.sleep_earlier'], confidence: 0.9 }]);
  assert.deepEqual([codes(r), r.applied.map((a) => a.op)], [[], ['ADD', 'ADD', 'ADD']]);
  assert.deepEqual(s.memories.map((m) => m.versions[0].data), [{ item: 'shoes', km: 412.5, boughtOn: '2026-06-01' }, { what: 'half marathon', date: '2027-03-01' }, { what: 'sleep earlier', date: null }]);
  const wrong = seed();
  recordExtras(wrong, cleanExtras({ gear: [{ item: 'shoes', startedOn: '2026-06-01', km: 412.5 }] }), DAY);
  assert.deepEqual(codes(only(wrong, { ...GEAR, statement: 'Shoes have 500 km since 2026-06-01.' })), ['number_not_in_evidence']);
  recordFacts(s, '2026-11-18', [sleepFact()]);
  recordExtras(s, cleanExtras({ gear: [{ item: 'shoes', name: 'Pegasus 41', startedOn: '2026-06-01', km: 431 }] }), '2026-11-18');
  const next = apply(s, [{ ...GEAR, op: 'SUPERSEDE', targetMemoryId: 'mem_0001', statement: 'Shoes Pegasus 41 have 431 km since 2026-06-01.' }], '2026-11-18');
  assert.deepEqual([next.applied[0].op, s.memories[0].state, s.memories[3].versions[0].data.km], ['SUPERSEDE', 'superseded', 431]);
  for (const bad of [{ gear: 'shoes' }, { gear: [{ item: 'shoes', startedOn: 'June', km: 1 }] }, { gear: [{ item: 'shoes', startedOn: '2026-06-01', km: -1 }] }, { goal: [{ what: '' }] }, { goal: [{ what: 'a', date: 'soon' }] }, 'x']) assert.equal(cleanExtras(bad), null);
});
test('weak_evidence: a usual slot needs 3 of the last 4 weeks, whatever the number of days', () => {
  const two = seed(8, [slotFact(2), medianFact()]);
  assert.equal(only(two, { ...SLOT, statement: 'Running on Sun between 08:00 and 09:00 in 2 of the last 4 weeks.' }).applied[0].guard, 'weak_evidence');
  const oneDay = seed(1);
  assert.deepEqual(only(oneDay, SLOT).applied.map((a) => [a.op, a.guard]), [['ADD', undefined]]);
});
test('weak_evidence: a new response memory is saved only after 3 days of outcomes; before that the person is asked', () => {
  const RESPONSE = { op: 'ADD', slot: 'response.run.early', kind: 'response', statement: '2 of 2 planned run sessions before 08:00 were not done in the last 28 days.', evidenceIds: ['outcomes.run.early'], confidence: 0.8 };
  const s = seed();
  recordOutcomes(s, [outcome(DAYS[6], false), outcome(DAY, false)]);
  assert.equal(only(s, RESPONSE).applied[0].guard, 'weak_evidence');
  const t = seed();
  recordOutcomes(t, [outcome(DAYS[5], false), outcome(DAYS[6], true), outcome(DAY, false)]);
  const r = only(t, { ...RESPONSE, statement: '2 of 3 planned run sessions before 08:00 were not done in the last 28 days.' });
  assert.deepEqual([r.applied[0].op, t.memories[0].state, t.memories[0].versions[0].data], ['ADD', 'saved', { about: 'run', pattern: 'skipped_early' }]);
});
test('confidence is code\'s: from the weeks seen or the days of support, whatever the model sends', () => {
  assert.deepEqual([confidenceOf('usual_slot', { weeksSeen: 3, weeksTotal: 4 }, 9), confidenceOf('sleep', {}, 1), confidenceOf('sleep', {}, 2), confidenceOf('sleep', {}, 3), confidenceOf('load', {}, 20), confidenceOf('response', {}, 0), confidenceOf('gear', {}, 1)], [0.75, 0.5, 0.75, 1, 1, 0.25, 1]);
  for (const sent of [0, 0.99, 'very', undefined]) {
    const s = seed(2);
    assert.deepEqual(only(s, { ...SLEEP, confidence: sent }).applied.map((a) => [a.op, a.guard]), [['ADD', undefined]]);
    assert.equal(s.memories[0].versions[0].confidence, 0.75, 'two days of support');
    const slot = seed(1);
    only(slot, { ...SLOT, confidence: sent });
    assert.equal(slot.memories[0].versions[0].confidence, 0.75, '3 of 4 weeks');
  }
  const grows = seed(1);
  apply(grows, [SLEEP]);
  recordFacts(grows, '2026-11-18', [sleepFact()]);
  apply(grows, [{ ...SLEEP, op: 'NOOP', targetMemoryId: 'mem_0001' }], '2026-11-18');
  assert.deepEqual([grows.memories[0].versions[0].confidence, grows.memories[0].versions.length], [0.75, 1], 'a NOOP day raises it');
});
test('low_confidence: under 0.5 by the evidence an ADD becomes a question, even when the model says it is sure', () => {
  const s = seed(8, [slotFact(1), medianFact()]);
  const r = only(s, { ...SLOT, statement: 'Running on Sun between 08:00 and 09:00 in 1 of the last 4 weeks.', confidence: 1 });
  assert.deepEqual([r.applied[0].op, r.applied[0].guard, s.memories[0].state, s.memories[0].versions[0].confidence, reviewQueue(s).length], ['REVIEW', 'low_confidence', 'candidate', 0.25, 1]);
  const t = seed();
  recordOutcomes(t, [outcome(DAYS[5], false), outcome(DAYS[6], false)]);
  const quiet = only(t, { op: 'ADD', slot: 'response.run.early', kind: 'response', statement: '2 of 2 planned run sessions before 08:00 were not done in the last 28 days.', evidenceIds: ['outcomes.run.early'], confidence: 1 }, '2026-11-17');
  assert.equal(quiet.applied[0].guard, 'weak_evidence', 'two days of outcomes: 0.75, but a new response needs three');
});
test('older_evidence: a day applied late cannot change a memory that newer evidence already updated', () => {
  const s = seed();
  apply(s, [SLEEP], DAY);
  const late = only(s, { ...MERGE, op: 'SUPERSEDE' }, DAYS[6]);
  assert.deepEqual([late.applied[0].op, late.applied[0].guard], ['REVIEW', 'older_evidence']);
  assert.deepEqual(s.memories.map((m) => m.state), ['saved', 'candidate']);
  const inOrder = seed();
  apply(inOrder, [SLEEP], DAYS[6]);
  assert.equal(only(inOrder, { ...MERGE, op: 'SUPERSEDE' }, DAY).applied[0].op, 'SUPERSEDE');
});

test('SUPERSEDE: the old memory is superseded and linked both ways; the successor of a confirmed memory is saved, not confirmed', () => {
  const s = seed();
  apply(s, [SLEEP], DAYS[6]);
  assert.equal(confirmMemory(s, { memoryId: 'mem_0001' }, CTX).state, 'confirmed');
  const r = only(s, { ...MERGE, op: 'SUPERSEDE' });
  assert.deepEqual(r.applied, [{ index: 0, op: 'SUPERSEDE', slot: 'body.sleep', memoryId: 'mem_0002', version: 1 }]);
  const [old, next] = s.memories;
  assert.deepEqual([old.state, old.supersededBy, next.state, next.supersedes, next.since], ['superseded', 'mem_0002', 'saved', 'mem_0001', DAY]);
});
test('MERGE: the same memory gets a new version, keeps its state and its since; NOOP only adds the day as evidence', () => {
  const s = seed();
  apply(s, [SLEEP], DAYS[5]);
  confirmMemory(s, { memoryId: 'mem_0001' }, CTX);
  assert.deepEqual(apply(s, [{ ...SLEEP, op: 'NOOP', targetMemoryId: 'mem_0001' }], DAYS[6]).applied[0], { index: 0, op: 'NOOP', slot: 'body.sleep', memoryId: 'mem_0001', version: 1 });
  assert.deepEqual(only(s, MERGE).applied[0], { index: 0, op: 'MERGE', slot: 'body.sleep', memoryId: 'mem_0001', version: 2 });
  const m = s.memories[0];
  assert.deepEqual([m.state, m.since, m.updated, m.versions.length, m.versions[0].evidence.map((e) => e.day)], ['confirmed', DAYS[5], DAY, 2, [DAYS[5], DAYS[6]]]);
});

test('the row data is built by code from the evidence, never taken from the model', () => {
  const s = seed();
  apply(s, [SLEEP, SLOT, VOLUME]);
  assert.deepEqual(s.memories.map((m) => m.versions[0].data), [
    { hours7d: 8.75, hours28d: 8.55 },
    { activity: 'run', weekday: 6, hour: 8, minutes: 49, weeksSeen: 3, weeksTotal: 4 },
    { workoutsPerWeek: 6.5, minutesPerWeek: 323.13 },
  ]);
});

test('numbers must match the evidence: as written or rounded to 0, 1 or 2 decimals, dates whole, "6 PM" as hour 18', () => {
  const items = factEvidence([sleepFact(8.754, 8.55), { ...slotFact(), numbers: { ...slotFact().numbers, hour: 18 } }, volumeFact(), medianFact()]);
  const allowed = allowedNumbers(items);
  const missing = (s) => numbersNotIn(s, allowed);
  assert.deepEqual(missing('Sleep averaged 8.75 h, 8.8 h or 9 h over 7 days against 8.6 h over 28 days.'), []);
  assert.deepEqual(missing('Sleep averaged 8.7 h over 7 days.'), ['8.7']);
  assert.deepEqual(missing('Running at 6 PM in 3 of the last 4 weeks.'), []);
  assert.deepEqual(missing('Running at 7 PM in 3 of the last 4 weeks.'), ['7 PM']);
  assert.deepEqual(missing('From 2026-10-21 to 2026-11-17 there were 6.5 workouts a week.'), []);
  assert.deepEqual(missing('From 2026-10-22 there were 6.5 workouts a week.'), ['2026-10-22']);
  assert.ok(!allowed.numbers.has('1') && !allowed.numbers.has('0.33'), 'the exact fractions are not evidence');
  const s = seed();
  assert.deepEqual(codes(only(s, { ...SLEEP, numbers: { hours7d: 8.8, hours28d: 7 } })), []);
  assert.deepEqual(codes(only(seed(), { ...SLEEP, numbers: { hours7d: 9.9 } })), ['number_not_in_evidence']);
});
