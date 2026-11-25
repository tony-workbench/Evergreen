// Lifecycle, forgetting and the table of the memory agent, on the pure engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewQueue, confirmMemory, rejectMemory, restoreMemory, forgetDay, forgetSlots, wipe, memoryTable, tableWords, dailyEvidence, dayEvidence,
  mayMove, STATES, TABLE_MAX_ROWS, TABLE_MAX_WORDS, EXPIRE_DAYS,
} from '../src/agent/index.mjs';
import { seed, apply, SLEEP, SLOT, VOLUME, DAY, DAYS, CTX, AT, sha256, sleepFact, slotFact, medianFact, recordFacts, recordOutcomes, outcome } from './helpers/agent-seed.mjs';

const states = (s) => Object.fromEntries(s.memories.map((m) => [m.id, m.state]));
const slots = (t) => t.rows.map((r) => r.slot);

test('process once: the same day and evidence are applied once; changed evidence opens the day again', () => {
  const s = seed();
  assert.equal(dailyEvidence(s, DAY, sha256).alreadyDone, false);
  assert.equal(apply(s, [SLEEP]).alreadyDone, false);
  assert.equal(dailyEvidence(s, DAY, sha256).alreadyDone, true);
  const again = apply(s, [SLOT]);
  assert.deepEqual([again.ok, again.alreadyDone, again.applied, s.memories.length], [true, true, [], 1]);
  recordOutcomes(s, [outcome(DAY, false)]);
  assert.equal(dailyEvidence(s, DAY, sha256).alreadyDone, false, 'a new outcome is new evidence');
  assert.equal(apply(s, [SLOT]).applied.length, 1);
  const empty = seed();
  assert.equal(apply(empty, []).ok, true);
  assert.equal(apply(empty, [SLEEP]).alreadyDone, true, 'an empty answer also closes the day');
});
test('an answer that is not a list writes nothing and leaves the day open; an unknown day is an error', () => {
  const s = seed();
  assert.deepEqual(apply(s, 'sorry').error.code, 'bad_proposals');
  assert.equal(dailyEvidence(s, DAY, sha256).alreadyDone, false);
  assert.equal(apply(s, { proposals: [SLEEP] }).applied.length, 1, 'the whole answer object is accepted too');
  assert.equal(apply(s, [], '2026-12-01').error.code, 'no_evidence');
});

test('transitions: only the listed moves exist, and the person alone confirms, rejects and restores', () => {
  for (const from of STATES) for (const to of STATES) if (to === 'confirmed' || to === 'rejected' || from === 'rejected') assert.equal(mayMove(from, to, 'system'), false, `${from}>${to}`);
  assert.ok(mayMove('saved', 'confirmed', 'user') && mayMove('rejected', 'saved', 'user') && !mayMove('rejected', 'confirmed', 'user') && !mayMove('superseded', 'confirmed', 'user'));
});

test('confirm: saved becomes confirmed; a confirmed candidate replaces the memory it questioned and closes the question', () => {
  const s = seed();
  apply(s, [SLEEP], DAYS[5]);
  assert.deepEqual(confirmMemory(s, { key: 'body.sleep' }, CTX), { ok: true, memoryId: 'mem_0001', slot: 'body.sleep', state: 'confirmed' });
  const q = apply(s, [{ ...SLEEP, op: 'REVIEW', statement: 'Average sleep is 8.8 h a night over 7 days.' }], DAYS[6]).review[0];
  assert.deepEqual([q.memoryId, q.targetMemoryId, q.targetStatement, q.reason.code], ['mem_0002', 'mem_0001', SLEEP.statement, 'model_unsure']);
  assert.deepEqual(slots(memoryTable(s, DAY)), ['body.sleep']);
  assert.equal(memoryTable(s, DAY).rows[0].memoryId, 'mem_0001', 'the candidate is not in the table');
  assert.equal(confirmMemory(s, { memoryId: 'mem_0002' }, CTX).state, 'confirmed');
  assert.deepEqual([states(s), reviewQueue(s), memoryTable(s, DAY).rows[0].memoryId], [{ mem_0001: 'superseded', mem_0002: 'confirmed' }, [], 'mem_0002']);
  assert.equal(confirmMemory(s, { memoryId: 'mem_0001' }, CTX).error.code, 'not_allowed');
  assert.equal(confirmMemory(s, { memoryId: 'mem_9999' }, CTX).error.code, 'not_found');
  assert.equal(confirmMemory(s, {}, CTX).error.code, 'bad_arguments');
});

test('rejected is never revived: the slot takes no ADD, REVIEW or change on any later day until the person restores it', () => {
  const s = seed();
  apply(s, [SLEEP, SLOT], DAYS[4]);
  assert.deepEqual(rejectMemory(s, { key: 'body.sleep' }, CTX), { ok: true, memoryId: 'mem_0001', slot: 'body.sleep', state: 'rejected' });
  assert.deepEqual(slots(memoryTable(s, DAY)), ['routine.run.sun_08']);
  const shown = dailyEvidence(s, DAYS[5], sha256);
  assert.ok(!shown.evidence.some((e) => e.id === 'body.sleep') && !shown.neighbors.some((n) => n.slot === 'body.sleep'), 'the model is not even shown the slot');
  for (const [i, op] of ['ADD', 'REVIEW', 'MERGE'].entries()) {
    const r = apply(s, [{ ...SLEEP, op, statement: 'Average sleep is 8.8 h a night over 7 days.', ...(op === 'MERGE' ? { targetMemoryId: 'mem_0001' } : {}) }], DAYS[5 + i]);
    assert.deepEqual(r.rejected.map((x) => x.code), ['slot_stopped']);
  }
  assert.deepEqual([states(s).mem_0001, s.memories.length, reviewQueue(s).length], ['rejected', 2, 0]);

  assert.deepEqual(restoreMemory(s, { key: 'body.sleep' }, CTX), { ok: true, memoryId: 'mem_0001', slot: 'body.sleep', state: 'saved' });
  assert.deepEqual(slots(memoryTable(s, DAY)).sort(), ['body.sleep', 'routine.run.sun_08']);
  recordFacts(s, '2026-11-18', [sleepFact(), slotFact(), medianFact()]);
  assert.equal(apply(s, [{ ...SLEEP, op: 'NOOP', targetMemoryId: 'mem_0001' }], '2026-11-18').applied.length, 1, 'after restore the slot is written again');
  assert.equal(restoreMemory(s, { key: 'body.sleep' }, CTX).error.code, 'not_found');
});
test('reject: a confirmed memory restores as saved, not confirmed; a key with no memory yet is stopped all the same', () => {
  const s = seed();
  apply(s, [SLEEP], DAYS[6]);
  confirmMemory(s, { memoryId: 'mem_0001' }, CTX);
  rejectMemory(s, { memoryId: 'mem_0001' }, CTX);
  assert.equal(restoreMemory(s, { memoryId: 'mem_0001' }, CTX).state, 'saved');
  assert.deepEqual(rejectMemory(s, { key: 'routine.run.sun_08' }, CTX), { ok: true, memoryId: null, slot: 'routine.run.sun_08', state: 'rejected' });
  assert.deepEqual(apply(s, [SLOT]).rejected.map((x) => x.code), ['slot_stopped']);
  assert.equal(restoreMemory(s, { key: 'routine.run.sun_08' }, CTX).ok, true);
  assert.equal(rejectMemory(s, { key: 'not a slot' }, CTX).error.code, 'bad_arguments');
  assert.equal(rejectMemory(s, { memoryId: 'mem_0404' }, CTX).error.code, 'not_found');
});

test('expiry: a memory without evidence for 35 days becomes inactive and leaves the table; a new ADD may take the slot', () => {
  const s = seed();
  apply(s, [SLEEP]);
  const later = '2026-12-30';
  assert.deepEqual(memoryTable(s, later).rows, [], 'expired for the table even before the sweep runs');
  assert.equal(memoryTable(s, '2026-12-20').rows.length, 1, `still shown within ${EXPIRE_DAYS} days`);
  recordFacts(s, later, [sleepFact()]);
  const r = apply(s, [SLEEP], later);
  assert.deepEqual([states(s), r.applied[0].op], [{ mem_0001: 'inactive', mem_0002: 'saved' }, 'ADD']);
});

test('forgetting a day really deletes: its evidence, its outcomes and every memory version that rested only on what it touched', () => {
  const s = seed();
  recordOutcomes(s, [outcome(DAYS[0], false), outcome(DAYS[5], false), outcome(DAYS[6], false)]);
  apply(s, [SLEEP], DAYS[1]);                                                                  // version 1: evidence of DAYS[1]
  apply(s, [{ ...SLEEP, op: 'MERGE', targetMemoryId: 'mem_0001', statement: 'Average sleep is 8.8 h a night over 7 days.' }], DAYS[5]);   // version 2: DAYS[5]
  apply(s, [SLOT], DAYS[6]);                                                                   // rests on DAYS[6] only
  assert.equal(forgetDay(s, DAYS[5]), true);
  assert.equal(dayEvidence(s, DAYS[5]), null);
  assert.deepEqual(s.evidence[DAYS[6]], [], 'aggregates computed after the day may contain it: deleted too');
  assert.ok(!JSON.stringify(s).includes(`s-${DAYS[5]}`), 'the outcome of that day is gone');
  assert.deepEqual(s.memories.map((m) => [m.id, m.versions.map((v) => v.n), m.updated]), [['mem_0001', [1], DAYS[1]]], 'version 2 and the slot memory are deleted, version 1 stays');
  assert.ok(!s.events.some((e) => e.memoryId === 'mem_0002'), 'no log line of a deleted memory remains');
  assert.equal(memoryTable(s, DAY).rows[0].statement, SLEEP.statement);
  assert.equal(forgetDay(s, DAYS[1]), true);
  assert.deepEqual([s.memories, s.reviews], [[], []]);
});
test('forgetting a day brings back the memory its deleted successor had replaced', () => {
  const s = seed();
  apply(s, [SLEEP], DAYS[1]);
  apply(s, [{ ...SLEEP, op: 'SUPERSEDE', targetMemoryId: 'mem_0001', statement: 'Average sleep is 8.8 h a night over 7 days.' }], DAYS[6]);
  assert.deepEqual(states(s), { mem_0001: 'superseded', mem_0002: 'saved' });
  forgetDay(s, DAYS[6]);
  assert.deepEqual([states(s), s.memories[0].supersededBy], [{ mem_0001: 'saved' }, null]);
});
test('a stopped fact type deletes its memories and evidence; forgetting everything leaves only the stopped slot keys', () => {
  const s = seed();
  apply(s, [SLEEP, SLOT, VOLUME]);
  forgetSlots(s, (slot) => slot.startsWith('body.'));
  assert.deepEqual([s.memories.map((m) => m.slot), s.evidence[DAY].some((i) => i.id === 'body.sleep')], [['routine.run.sun_08', 'routine.weekly_volume'], false]);
  rejectMemory(s, { key: 'routine.weekly_volume' }, CTX);
  wipe(s);
  assert.deepEqual([s.memories, s.evidence, s.outcomes, s.events, s.processed, s.stopped], [[], {}, {}, [], {}, { 'routine.weekly_volume': { day: DAY, memoryId: null } }]);
});

test('the table never shows a candidate, rejected, superseded, inactive or expired memory, and its rows have exactly the agreed fields', () => {
  const s = seed();
  apply(s, [SLEEP, SLOT, VOLUME], DAYS[5]);
  apply(s, [{ ...SLEEP, op: 'SUPERSEDE', targetMemoryId: 'mem_0001', statement: 'Average sleep is 8.8 h a night over 7 days.' }, { ...VOLUME, op: 'REVIEW', statement: 'Weekly average over 4 weeks: 6.5 workouts.' }], DAYS[6]);
  rejectMemory(s, { key: 'routine.run.sun_08' }, CTX);
  assert.deepEqual(states(s), { mem_0001: 'superseded', mem_0002: 'rejected', mem_0003: 'saved', mem_0004: 'saved', mem_0005: 'candidate' });
  const t = memoryTable(s, DAY);
  assert.deepEqual(t.rows.map((r) => r.memoryId), ['mem_0003', 'mem_0004']);
  assert.deepEqual(Object.keys(t.rows[0]), ['memoryId', 'key', 'slot', 'group', 'kind', 'statement', 'data', 'state', 'confidence', 'since', 'updated']);
  assert.deepEqual(t.rows[0], { memoryId: 'mem_0003', key: 'routine.weekly_volume', slot: 'routine.weekly_volume', group: 'routine', kind: 'weekly_volume', statement: VOLUME.statement, data: { workoutsPerWeek: 6.5, minutesPerWeek: 323.13 }, state: 'saved', confidence: 1, since: DAYS[5], updated: DAYS[5] });
  assert.equal(t.text, [
    '| Slot | What | Since | Sure? |', '| --- | --- | --- | --- |',
    `| routine.weekly_volume | ${VOLUME.statement} | ${DAYS[5]} | likely |`,
    `| body.sleep | Average sleep is 8.8 h a night over 7 days. | ${DAYS[6]} | likely |`,
  ].join('\n'));
  assert.equal(t.words, tableWords(t.text));
  s.off = true;
  assert.deepEqual(memoryTable(s, DAY).rows, []);
});
test('table ranking and budget: confirmed first, then group, days of evidence and slot; at most 25 rows and 200 words', () => {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const facts = hours.flatMap((h) => ['Sat', 'Sun'].map((d) => ({ ...slotFact(), id: `regularity.slot.Running.${d}.${String(h).padStart(2, '0')}`, numbers: { activityType: 'Running', weekday: d, hour: h, weeks: 3 }, text: `Fixed slot: running on ${d} at hour ${h}, in 3 of the last 4 weeks.` })));
  const s = seed(8, [sleepFact(), medianFact(), ...facts]);
  const many = facts.map((f) => ({ op: 'ADD', slot: `routine.run.${f.numbers.weekday.toLowerCase()}_${String(f.numbers.hour).padStart(2, '0')}`, kind: 'usual_slot', statement: `Running on ${f.numbers.weekday} at hour ${f.numbers.hour} in 3 of the last 4 weeks.`, evidenceIds: [f.id], confidence: 0.8 }));
  assert.equal(apply(s, many.slice(0, 29), DAYS[6]).applied.length, 29);
  apply(s, [SLEEP, { ...many[5], op: 'NOOP', targetMemoryId: 'mem_0006' }]);
  confirmMemory(s, { key: 'routine.run.sun_00' }, CTX);
  const t = memoryTable(s, DAY);
  assert.ok(t.rows.length <= TABLE_MAX_ROWS && t.words <= TABLE_MAX_WORDS && t.words > TABLE_MAX_WORDS - 20);
  assert.equal(t.leftOut, 30 - t.rows.length);
  assert.equal(t.text.split('\n').length, t.rows.length + 2);
  assert.deepEqual(t.rows.slice(0, 4).map((r) => [r.slot, r.state]), [['routine.run.sun_00', 'confirmed'], ['routine.run.sun_02', 'saved'], ['routine.run.sat_00', 'saved'], ['routine.run.sat_01', 'saved']]);
  const short = seed();
  apply(short, [SLEEP, SLOT, VOLUME]);
  assert.deepEqual(slots(memoryTable(short, DAY)), ['routine.weekly_volume', 'routine.run.sun_08', 'body.sleep']);
  assert.deepEqual(memoryTable(seed(), DAY), { ok: true, day: DAY, rows: [], text: '', words: 0, leftOut: 0 });
});
test('at is only a label: the same proposals at another time give the same memories', () => {
  const a = seed();
  const b = seed();
  apply(a, [SLEEP, SLOT]);
  apply(b, [SLEEP, SLOT]);
  assert.deepEqual(a, b);
  assert.ok(a.events.every((e) => e.at === AT));
});
