// Where the person trains: Health records with no workout of a gym-equipment type in the last 8 weeks become the memory
// "You train at home, without gym equipment." (slot routine.training_place, kind training_place), through the evidence,
// the stand-in model and the table; a gym workout retires it, a short history still writes it (the 8 weeks are the
// lookback, plan 5.A.3), no record at all in the 8 weeks never does, and "Not true for me" (memoryReject by the row's key) stops it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import {
  recordDay, dailyRequest, dailyApply, table, reject, restore, demoModel, placeEvidence, statementFor,
  GYM_ACTIVITY_TYPES, PLACE_SLOT, PLACE_STATEMENT, SYSTEM,
} from '../src/agent/index.mjs';
import { isGymWorkout } from '../src/agent/place.mjs';
import { parseTimestamp } from '../src/contract/index.mjs';
import { makeMemoryIO } from './memory-io.mjs';
import { contract, noContract } from './helpers/contract.mjs';

const USER = `usr_${'d4'.repeat(8)}`;
const LAST = '2026-11-17';
const midnight = (day) => `${day}T00:00:00-08:00`;
const plus = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const two = (n) => String(n).padStart(2, '0');
// A workout on `day` starting at `hour`:05 and lasting `minutes`; `indoor` only when given.
const workout = (activityType, day, { hour, minutes, indoor }) => ({ activityType, start: `${day}T${two(hour)}:05:00-08:00`, end: `${day}T${two(hour)}:${two(5 + minutes)}:00-08:00`, durationMin: minutes, ...(indoor === undefined ? {} : { indoor }) });

/** `days` days of history up to `last`: a summary every day, and three home workouts a week (strength, a run, a walk). */
function history(days, extra = [], last = LAST) {
  const dailySummaries = [];
  const workouts = [];
  for (let k = days - 1; k >= 0; k--) {
    const day = plus(last, -k);
    dailySummaries.push({ date: day, restingHeartRate: 56, sleepMinutes: { totalAsleep: 440 } });
    if (k % 7 === 1) workouts.push(workout('TraditionalStrengthTraining', day, { hour: 7, minutes: 30 }));
    if (k % 7 === 3) workouts.push(workout('Running', day, { hour: 18, minutes: 35 }));
    if (k % 7 === 5) workouts.push(workout('Walking', day, { hour: 12, minutes: 40 }));
  }
  return { exportDate: midnight(plus(last, 1)), persona: { key: 'home' }, dailySummaries, workouts: [...workouts, ...extra] };
}

function fresh() {
  const mem = makeMemoryIO();
  const store = new MemoryStore('/mem', USER, { io: mem.io });
  const ctx = { store, io: mem.io, user: USER };
  // One day through the calls the app makes: roll, request, the stand-in model, apply. Returns the table after it.
  const day = (snapshot, now = snapshot.exportDate) => {
    assert.equal(rollDay({ store, snapshot, now }).ok, true);
    assert.equal(recordDay(ctx, { snapshot, now }).ok, true);
    const request = dailyRequest(ctx, { now });
    assert.equal(request.ok, true, JSON.stringify(request));
    const result = dailyApply(ctx, { now, day: request.day, proposals: demoModel(request) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.rejected, [], JSON.stringify(result.rejected));
    return { request, result, table: table(ctx, { now }) };
  };
  return { ctx, day };
}
const placeRow = (t) => t.rows.find((r) => r.kind === 'training_place');

test('8 weeks of home workouts, none of a gym type, give the row "You train at home, without gym equipment."', () => {
  const { day } = fresh();
  const { request, table: t } = day(history(60));
  const item = request.evidence.find((e) => e.id === 'place.home');
  assert.ok(item, 'the day has the place.home evidence');
  assert.deepEqual(item.slots, [PLACE_SLOT]);
  const row = placeRow(t);
  assert.ok(row, JSON.stringify(t.rows.map((r) => r.slot)));
  assert.deepEqual(
    { key: row.key, slot: row.slot, group: row.group, statement: row.statement, data: row.data, state: row.state },
    { key: 'routine.training_place', slot: 'routine.training_place', group: 'routine', statement: PLACE_STATEMENT, data: { place: 'home', gymWorkouts: 0, weeks: 8 }, state: 'saved' },
  );
  assert.equal(PLACE_STATEMENT, 'You train at home, without gym equipment.');
  assert.ok(t.text.includes(`| routine.training_place | ${PLACE_STATEMENT} |`));
  // The next day the same memory is corroborated, not written again.
  const next = day(history(61, [], plus(LAST, 1)));
  assert.equal(placeRow(next.table).memoryId, row.memoryId);
  assert.ok(next.result.applied.some((a) => a.slot === PLACE_SLOT && a.op === 'NOOP'));
});

test('the row fits the shared contract\'s memory-row schema', { skip: noContract }, () => {
  const { day } = fresh();
  const t = day(history(60)).table;
  contract.assertValid('memory-table', t, 'memoryTable');
  contract.assertValid('memory-row', placeRow(t), 'training_place');
});

test('a gym-type workout in the last 8 weeks gives no row, and one that appears later retires it', () => {
  for (const type of GYM_ACTIVITY_TYPES) {
    const { day } = fresh();
    const t = day(history(60, [workout(type, plus(LAST, -20), { hour: 9, minutes: 30, indoor: true })])).table;
    assert.equal(placeRow(t), undefined, type);
  }
  const { ctx, day } = fresh();
  const first = placeRow(day(history(60)).table);
  assert.ok(first);
  // The next day has an elliptical session: the memory is retired (inactive) at once, and the table leaves it out.
  const after = day(history(61, [workout('Elliptical', plus(LAST, 1), { hour: 9, minutes: 30 })], plus(LAST, 1)));
  assert.equal(after.request.evidence.some((e) => e.id === 'place.home'), false);
  assert.equal(placeRow(after.table), undefined);
  const agent = JSON.parse(ctx.io.readFile(`${ctx.store.dir}/agent.json`));
  const m = agent.memories.find((x) => x.id === first.memoryId);
  assert.equal(m.state, 'inactive');
  assert.ok(agent.events.some((e) => e.op === 'RETIRE' && e.memoryId === first.memoryId));
  // A gym workout older than 8 weeks no longer counts.
  const { day: day2 } = fresh();
  assert.ok(placeRow(day2(history(70, [workout('StairClimbing', plus(LAST, -60), { hour: 9, minutes: 30 })])).table));
});

test('8 weeks is how far back it looks, not how much history it needs: two weeks with no gym workout give the row', () => {
  const { day } = fresh();
  const short = day(history(14));
  const item = short.request.evidence.find((e) => e.id === 'place.home');
  assert.ok(item, 'two weeks of records are enough');
  assert.equal(item.numbers.weeks, 8);
  assert.ok(placeRow(short.table));
  // Records with no workout at all in the window: no gym workout either, so the row stands (the plan's one condition).
  const quiet = history(70);
  quiet.workouts = quiet.workouts.filter((w) => w.start < `${plus(LAST, -60)}T`);
  const now = parseTimestamp(midnight(plus(LAST, 1))).ms;
  assert.equal(placeEvidence(quiet, { day: LAST, nowMs: now }).items[0].numbers.workouts, 0);
});

test('no Health record at all in the last 8 weeks says nothing about where the person trains', () => {
  const now = parseTimestamp(midnight(plus(LAST, 1))).ms;
  assert.deepEqual(placeEvidence({ dailySummaries: [], workouts: [] }, { day: LAST, nowMs: now }), { items: [], gym: false });
  const old = history(30, [], plus(LAST, -70));
  assert.deepEqual(placeEvidence(old, { day: LAST, nowMs: now }), { items: [], gym: false }, 'records older than the window do not count');
});

test('which workouts need gym equipment: machines always, rowing unless outdoors, cycling and climbing only indoors', () => {
  for (const type of ['Elliptical', 'StairClimbing']) for (const indoor of [undefined, true, false]) assert.equal(isGymWorkout(type, indoor), true, `${type} ${indoor}`);
  assert.deepEqual([undefined, true, false].map((indoor) => isGymWorkout('Rowing', indoor)), [true, true, false]);
  for (const type of ['Cycling', 'Climbing']) assert.deepEqual([undefined, true, false].map((indoor) => isGymWorkout(type, indoor)), [false, true, false], type);
  for (const type of ['TraditionalStrengthTraining', 'FunctionalStrengthTraining', 'Running', 'Walking', 'Swimming', 'Yoga', 'HighIntensityIntervalTraining']) {
    assert.equal(isGymWorkout(type, true), false, type);
  }
  const now = parseTimestamp(midnight(plus(LAST, 1))).ms;
  assert.equal(placeEvidence(history(60, [workout('Cycling', plus(LAST, -3), { hour: 9, minutes: 40, indoor: false })]), { day: LAST, nowMs: now }).items.length, 1, 'a ride outdoors');
  assert.equal(placeEvidence(history(60, [workout('Cycling', plus(LAST, -3), { hour: 9, minutes: 40, indoor: true })]), { day: LAST, nowMs: now }).gym, true, 'a stationary bike');
  assert.equal(placeEvidence(history(60, [workout('Rowing', plus(LAST, -3), { hour: 9, minutes: 40 })]), { day: LAST, nowMs: now }).gym, true, 'a rowing machine');
});

test('the evidence: strength training counts as home, short and unfinished workouts and forgotten days are left out', () => {
  const now = parseTimestamp(midnight(plus(LAST, 1))).ms;
  const home = placeEvidence(history(60), { day: LAST, nowMs: now });
  assert.equal(home.items.length, 1);
  assert.deepEqual(home.items[0].numbers, { from: plus(LAST, -55), to: LAST, workouts: 24, gymWorkouts: 0, weeks: 8 });
  assert.equal(statementFor(home.items[0]), PLACE_STATEMENT);
  assert.ok(!GYM_ACTIVITY_TYPES.includes('TraditionalStrengthTraining') && !GYM_ACTIVITY_TYPES.includes('FunctionalStrengthTraining'));
  // A 5-minute elliptical session is not a counted workout; a forgotten day takes its gym workout with it.
  assert.equal(placeEvidence(history(60, [workout('Elliptical', LAST, { hour: 9, minutes: 5 })]), { day: LAST, nowMs: now }).gym, false);
  const gymDay = plus(LAST, -3);
  const withGym = history(60, [workout('Elliptical', gymDay, { hour: 9, minutes: 30 })]);
  assert.equal(placeEvidence(withGym, { day: LAST, nowMs: now }).gym, true);
  assert.equal(placeEvidence(withGym, { day: LAST, nowMs: now, forgottenDays: [gymDay] }).items.length, 1);
  // A workout after the day that ended is not read.
  assert.equal(placeEvidence(history(60, [workout('Elliptical', plus(LAST, 1), { hour: 9, minutes: 30 })]), { day: LAST, nowMs: now }).gym, false);
});

test('"Not true for me" rejects the row by its key, later days do not bring it back, and restore does', () => {
  const { ctx, day } = fresh();
  const row = placeRow(day(history(60)).table);
  const now = midnight(plus(LAST, 1));
  const r = reject(ctx, { now, key: row.key });
  assert.deepEqual([r.ok, r.slot, r.state], [true, PLACE_SLOT, 'rejected']);
  assert.equal(placeRow(table(ctx, { now })), undefined);
  // The slot is stopped: the next day's evidence is not even shown for it.
  const next = day(history(61, [], plus(LAST, 1)));
  assert.equal(next.request.evidence.some((e) => e.id === 'place.home'), false);
  assert.equal(placeRow(next.table), undefined);
  assert.equal(restore(ctx, { now: midnight(plus(LAST, 2)), key: row.key }).ok, true);
  assert.equal(placeRow(table(ctx, { now: midnight(plus(LAST, 2)) })).memoryId, row.memoryId);
});

test('the model may only use the fixed sentence for where the person trains', () => {
  const { ctx } = fresh();
  const snapshot = history(60);
  const now = snapshot.exportDate;
  rollDay({ store: ctx.store, snapshot, now });
  recordDay(ctx, { snapshot, now });
  const request = dailyRequest(ctx, { now });
  const other = { op: 'ADD', slot: PLACE_SLOT, kind: 'training_place', statement: 'Trains at home with no gym equipment in 8 weeks.', evidenceIds: ['place.home'] };
  const result = dailyApply(ctx, { now, day: request.day, proposals: [other] });
  assert.deepEqual(result.rejected.map((x) => x.code), ['not_a_fact']);
  assert.ok(SYSTEM.includes(`exactly "${PLACE_STATEMENT}"`));
});
