// The memory agent's daily calls over the sample personas with the stand-in model: 28 days, determinism, what the
// request holds, forgetting through the existing calls, and the file on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryStore, forgetFactKey, forgetFactType, forgetDerived, restoreDerived } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import { lintWords } from '../src/facts/index.mjs';
import {
  recordDay, dailyRequest, dailyApply, table, reviews, confirm, reject, restore, onForget, onRestore, slotsOfBriefKey, openAgentFile, AGENT_FILE,
  SYSTEM, PROPOSALS_SCHEMA, USABLE, TABLE_MAX_ROWS, TABLE_MAX_WORDS, allowedNumbers, numbersNotIn, ACTIVITIES,
} from '../src/agent/index.mjs';
import { runAgentDemo } from '../scripts/demo.mjs';
import { fakeModel } from '../scripts/fake-model.mjs';
import { makeMemoryIO } from './memory-io.mjs';
import { contract, noContract } from './helpers/contract.mjs';

const USER = `usr_${'b2'.repeat(8)}`;
const NOW = '2026-11-18T00:00:00-08:00';
const DAY = '2026-11-17';
const persona = (who) => JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${who}.json`, import.meta.url), 'utf8'));
function fresh(who = 'half_marathon') {
  const mem = makeMemoryIO();
  const store = new MemoryStore('/mem', USER, { io: mem.io });
  const ctx = { store, io: mem.io, user: USER };
  const snapshot = { ...persona(who), exportDate: NOW };
  const roll = (now = NOW) => { assert.equal(rollDay({ store, snapshot, now }).ok, true); return recordDay(ctx, { snapshot, now }); };
  const round = (now = NOW, outcomes) => { const request = dailyRequest(ctx, { now, outcomes }); return { request, result: dailyApply(ctx, { now, day: request.day, proposals: fakeModel(request) }) }; };
  return { mem, store, ctx, snapshot, roll, round };
}
const missed = (day, hour = '06') => ({ sessionId: `s-${day}-run-${hour}00`, day, activity: 'run', plannedStart: `${day}T${hour}:00:00-08:00`, done: false });

for (const who of ['sedentary', 'moderate', 'half_marathon']) {
  test(`${who}: 28 days with the stand-in model run clean, twice the same, and every table stays usable and within budget`, () => {
    const io = makeMemoryIO();
    const run = runAgentDemo(who, { io: io.io, user: USER });
    for (const d of run.days) {
      assert.equal(d.result.ok, true, JSON.stringify(d.result.error));
      assert.deepEqual(d.result.rejected, [], `${d.day}: ${JSON.stringify(d.result.rejected)}`);
    }
    assert.ok(run.days.some((d) => d.request.evidence.length === 0) && run.days.some((d) => d.result.applied.length > 0));
    assert.deepEqual(run.asked.map((q) => q.slot), ['response.run.early']);
    const t = run.table;
    assert.ok(t.rows.length >= 5 && t.rows.length <= TABLE_MAX_ROWS && t.words <= TABLE_MAX_WORDS);
    for (const row of t.rows) {
      assert.ok(USABLE.includes(row.state));
      assert.deepEqual(lintWords(row.statement), [], row.statement);
    }
    assert.deepEqual(t.rows[0].state, 'confirmed');
    const again = makeMemoryIO();
    assert.deepEqual(runAgentDemo(who, { io: again.io, user: USER }).table, t);
    assert.deepEqual(again.dump('/mem'), io.dump('/mem'));
  });
}

test('the half_marathon table is the one in README.md, and its rows fit the shared contract', { skip: noContract }, () => {
  const t = runAgentDemo('half_marathon').table;
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(t.text), t.text);
  contract.assertValid('memory-table', t, 'memoryTable');
  for (const row of t.rows) contract.assertValid('memory-row', row, row.slot);
  assert.deepEqual(t.rows.find((r) => r.slot === 'routine.run.sun_08').data, { activity: 'run', weekday: 6, hour: 8, minutes: 49, weeksSeen: 3, weeksTotal: 4 });
  for (const a of Object.keys(t.rows.find((r) => r.kind === 'mix').data.byActivity)) assert.ok(ACTIVITIES.includes(a), a);
});

test('the request: one system prompt, the day\'s evidence with slots, the neighbors by exact slot, the schema; then alreadyDone', () => {
  const p = fresh();
  assert.deepEqual(p.roll(), { ok: true, day: DAY, items: 8 });
  const r = dailyRequest(p.ctx, { now: NOW });
  assert.deepEqual([r.ok, r.day, r.alreadyDone, r.system, r.schema, r.neighbors], [true, DAY, false, SYSTEM, PROPOSALS_SCHEMA, []]);
  assert.deepEqual(r.evidence.map((e) => [e.id, e.slots]), [
    ['volume.per_week', ['routine.weekly_volume']], ['load.ratio', ['load.week']],
    ['regularity.slot.Running.Sun.08', ['routine.run.sun_08']], ['regularity.slot.Running.Tue.18', ['routine.run.tue_18']], ['regularity.slot.Running.Thu.06', ['routine.run.thu_06']],
    ['mix.count', ['routine.mix']], ['body.sleep', ['body.sleep']], ['body.resting_hr', ['body.resting_hr']],
  ]);
  for (const e of r.evidence) assert.deepEqual([typeof e.text, typeof e.numbers, typeof e.window, e.supportDays, Object.hasOwn(e.numbers, 'exact')], ['string', 'object', 'string', 1, false]);
  assert.ok(r.user.startsWith(`DAY: ${DAY}\n\nEVIDENCE:\n[`) && r.user.includes('"regularity.slot.Running.Sun.08"') && r.user.endsWith('EXISTING MEMORIES:\n[]'));
  assert.deepEqual(dailyRequest(p.ctx, { now: NOW }), r, 'the same request twice');

  const done = dailyApply(p.ctx, { now: NOW, day: DAY, proposals: fakeModel(r) });
  assert.deepEqual([done.ok, done.alreadyDone, done.applied.map((a) => a.op), done.rejected], [true, false, Array(8).fill('ADD'), []]);
  const second = dailyRequest(p.ctx, { now: NOW });
  assert.equal(second.alreadyDone, true);
  assert.deepEqual(second.neighbors.map((n) => [n.memoryId, n.slot, n.state, n.version, n.updated]).slice(0, 2), [['mem_0001', 'routine.weekly_volume', 'saved', 1, DAY], ['mem_0002', 'load.week', 'saved', 1, DAY]]);
  assert.deepEqual(dailyApply(p.ctx, { now: NOW, day: DAY, proposals: [] }).alreadyDone, true);
  const more = dailyRequest(p.ctx, { now: NOW, outcomes: [missed(DAY)] });
  assert.equal(more.alreadyDone, false, 'an outcome is new evidence for the day');
  assert.deepEqual(more.evidence.slice(-2).map((e) => [e.id, e.numbers.done, e.slots]), [[`outcome.s-${DAY}-run-0600`, false, ['response.run.early']], ['outcomes.run.early', 0, ['response.run.early']]]);
});

test('every number of every statement the stand-in model writes is in the evidence it cites', () => {
  const p = fresh('moderate');
  p.roll();
  const r = dailyRequest(p.ctx, { now: NOW, outcomes: [missed('2026-11-15'), missed('2026-11-16'), missed(DAY)] });
  const answer = fakeModel(r).proposals;
  assert.ok(answer.length >= 6 && answer.some((x) => x.op === 'REVIEW' && x.slot === 'response.run.early'));
  for (const x of answer) assert.deepEqual(numbersNotIn(x.statement, allowedNumbers(r.evidence.filter((e) => x.evidenceIds.includes(e.id)))), [], x.statement);
});

test('errors are { ok: false, error: { code, text } }: no roll yet, bad outcomes, bad time, an unknown memory', { skip: noContract }, () => {
  const p = fresh();
  const errors = [
    [dailyRequest(p.ctx, { now: NOW }), 'no_evidence'], [dailyRequest(p.ctx, { now: NOW, outcomes: [{ ...missed(DAY), activity: 'Running' }] }), 'bad_outcomes'],
    [dailyRequest(p.ctx, { now: 'today' }), 'bad_arguments'], [dailyApply(p.ctx, { now: NOW, day: DAY, proposals: [] }), 'no_evidence'],
    [dailyApply(p.ctx, { now: NOW, day: 'yesterday', proposals: [] }), 'bad_arguments'], [confirm(p.ctx, { now: NOW, memoryId: 'mem_0001' }), 'not_found'],
    [reject(p.ctx, { memoryId: 'mem_0001' }), 'bad_arguments'], [restore(p.ctx, { now: NOW, key: 'body.sleep' }), 'not_found'], [table(p.ctx, { now: 5 }), 'bad_arguments'],
  ];
  for (const [r, code] of errors) {
    assert.equal(r.error.code, code);
    contract.assertValid('error', r, code);
  }
  assert.equal(p.mem.exists(`/mem/${USER}/${AGENT_FILE}`), false, 'a failed call writes nothing');
  assert.equal(dailyRequest(p.ctx, { now: NOW, snapshot: p.snapshot }).evidence.length, 8, 'with a snapshot the day needs no earlier roll');
});

test('reject by key ("Not now"), the question queue, confirm and restore through the daily calls', { skip: noContract }, () => {
  const p = fresh();
  p.roll();
  p.round(NOW, [missed('2026-11-15'), missed('2026-11-16'), missed(DAY)]);
  const queue = reviews(p.ctx);
  assert.deepEqual([queue.ok, queue.rows.map((q) => [q.slot, q.kind, q.question, q.reason.code])], [true, [['response.run.early', 'response', 'Is this right?', 'model_unsure']]]);
  assert.equal(table(p.ctx).rows.some((r) => r.slot === 'response.run.early'), false);
  assert.deepEqual(confirm(p.ctx, { now: NOW, key: 'response.run.early' }), { ok: true, memoryId: queue.rows[0].memoryId, slot: 'response.run.early', state: 'confirmed' });
  assert.deepEqual([reviews(p.ctx).rows, table(p.ctx).rows[0].slot], [[], 'response.run.early']);

  const key = table(p.ctx).rows.find((r) => r.kind === 'usual_slot').key;
  assert.equal(reject(p.ctx, { now: NOW, key }).state, 'rejected');
  assert.equal(table(p.ctx, { now: NOW }).rows.some((r) => r.key === key), false);
  const next = '2026-11-19T00:00:00-08:00';
  recordDay(p.ctx, { snapshot: p.snapshot, now: next });
  const later = p.round(next);
  assert.ok(!later.request.evidence.some((e) => e.slots.includes(key)) && later.result.rejected.length === 0);
  assert.equal(table(p.ctx).rows.some((r) => r.key === key), false, 'the next day does not bring it back');
  assert.equal(restore(p.ctx, { now: next, key }).state, 'saved');
  const t = table(p.ctx);
  assert.ok(t.rows.some((r) => r.key === key));
  contract.assertValid('memory-table', t, 'memoryTable');
});

test('forgetting a day with the snapshot keeps the table: rows whose support survives stay, with numbers computed again without the day', () => {
  const p = fresh();
  p.roll();
  p.round();
  const before = table(p.ctx).rows;
  assert.equal(forgetFactKey(p.store, 'daily', '2026-11-10'), true);
  assert.equal(onForget(p.ctx, { what: 'day', day: '2026-11-10', snapshot: p.snapshot }), true);
  const after = table(p.ctx).rows;
  assert.deepEqual(after.map((r) => r.slot).sort(), before.map((r) => r.slot).sort(), 'no row is lost: every slot still has support');
  const row = (rows, slot) => rows.find((r) => r.slot === slot);
  for (const slot of ['routine.run.sun_08', 'routine.run.thu_06', 'routine.run.tue_18']) assert.deepEqual(row(after, slot), row(before, slot), `${slot}: 3 of the last 4 weeks still holds`);
  assert.deepEqual([row(before, 'routine.weekly_volume').data, row(after, 'routine.weekly_volume').data], [{ workoutsPerWeek: 6.5, minutesPerWeek: 323.13 }, { workoutsPerWeek: 6.25, minutesPerWeek: 309.75 }]);
  assert.equal(row(after, 'routine.weekly_volume').statement, 'Weekly average over 4 weeks: 6.3 workouts and 310 workout minutes.');
  assert.deepEqual(row(after, 'routine.mix').data, { byActivity: { run: 19, strength: 4, yoga: 2 } });
  const file = JSON.parse(p.mem.dump('/mem')[`${USER}/${AGENT_FILE}`]);
  const evidence = Object.fromEntries(file.evidence[DAY].map((e) => [e.id, e]));
  for (const m of file.memories) {
    const v = m.versions[m.versions.length - 1];
    assert.deepEqual(numbersNotIn(v.statement, allowedNumbers(v.evidence.flatMap((r) => r.ids.map((id) => evidence[id])))), [], v.statement);
  }
  assert.ok(!JSON.stringify(file).includes('323.13'), 'no number that contained the day remains');
  const again = p.round();
  assert.deepEqual([again.request.alreadyDone, again.result.rejected, again.result.applied.length], [false, [], 8]);

  assert.equal(forgetFactKey(p.store, 'daily', '2026-11-16'), true);
  assert.equal(onForget(p.ctx, { what: 'day', day: '2026-11-16', snapshot: p.snapshot }), true);
  const slots = table(p.ctx).rows.map((r) => r.slot);
  assert.ok(!slots.includes('load.week') && slots.includes('routine.run.sun_08') && slots.length === 7, 'a row whose fact can no longer be computed goes; the others stay');
});

for (const who of ['sedentary', 'moderate', 'half_marathon']) {
  test(`${who}: forgetting a day with the snapshot keeps the row count and the 200-word budget, with short statements`, () => {
    for (const [day, lost] of [['2026-11-05', []], ['2026-11-14', ['load.week']]]) {
      const p = fresh(who);
      p.roll();
      p.round();
      const before = table(p.ctx);
      assert.equal(forgetFactKey(p.store, 'daily', day), true);
      assert.equal(onForget(p.ctx, { what: 'day', day, snapshot: p.snapshot }), true);
      const after = table(p.ctx);
      assert.deepEqual(after.rows.map((r) => r.slot).sort(), before.rows.map((r) => r.slot).filter((s) => !lost.includes(s)).sort(), day);
      assert.ok(after.words <= TABLE_MAX_WORDS && after.leftOut === 0 && after.words <= before.words + 5, `${day}: ${after.words} words`);
      for (const r of after.rows) {
        assert.ok(r.statement.length <= 160 && !/Counted|Fixed slot|4-week average:/.test(r.statement), r.statement);
        assert.deepEqual(lintWords(r.statement), [], r.statement);
      }
    }
  });
}

test('forgetting a day through the store also deletes it from the agent; rolling again gives new evidence without it', () => {
  const p = fresh();
  p.roll();
  p.round();
  assert.equal(table(p.ctx).rows.length, 8);
  assert.equal(forgetFactKey(p.store, 'daily', '2026-11-10'), true);
  assert.equal(onForget(p.ctx, { what: 'day', date: '2026-11-10' }), true);
  assert.deepEqual([table(p.ctx).rows, reviews(p.ctx).rows], [[], []], 'every memory rested on aggregates that contained the day');
  const file = JSON.parse(p.mem.dump('/mem')[`${USER}/${AGENT_FILE}`]);
  assert.deepEqual([file.memories, file.evidence[DAY], file.events.filter((e) => e.memoryId)], [[], [], []]);
  assert.equal(dailyRequest(p.ctx, { now: '2026-11-11T00:00:00-08:00' }).error.code, 'day_forgotten');
  p.roll();
  const again = p.round();
  assert.equal(again.request.alreadyDone, false);
  assert.ok(again.result.applied.length >= 6 && again.result.applied.every((a) => a.op === 'ADD'));
  assert.match(again.request.evidence.find((e) => e.id === 'volume.per_week').text, /^4-week average: 6\.25 workouts/);
});

test('stopping a fact type deletes its memories; forgetting everything computed switches the agent off until restored', () => {
  const p = fresh();
  p.roll();
  p.round();
  assert.equal(forgetFactType(p.store, 'body'), true);
  assert.equal(onForget(p.ctx, { what: 'type', type: 'body' }), true);
  assert.deepEqual(table(p.ctx).rows.filter((r) => r.group === 'body'), []);
  p.roll();
  assert.ok(!dailyRequest(p.ctx, { now: NOW }).evidence.some((e) => e.id.startsWith('body.')));

  assert.equal(forgetDerived(p.store, 'profile'), true);
  assert.equal(onForget(p.ctx, { what: 'derived', kind: 'profile' }), true);
  assert.deepEqual(table(p.ctx).rows, []);
  assert.equal(p.roll().error.code, 'memory_off');
  assert.equal(dailyRequest(p.ctx, { now: NOW, snapshot: p.snapshot }).error.code, 'memory_off');
  const file = JSON.parse(p.mem.dump('/mem')[`${USER}/${AGENT_FILE}`]);
  assert.deepEqual([file.off, file.memories, file.evidence, file.events], [true, [], {}, []]);
  assert.equal(restoreDerived(p.store, 'profile'), true);
  assert.equal(onRestore(p.ctx, { what: 'derived', kind: 'profile' }), true);
  assert.equal(p.roll().ok, true);
  assert.ok(p.round().result.applied.length >= 5);
});

test('a brief key maps to its slots, and stopping it rejects the agent\'s memory of that line', () => {
  assert.deepEqual(['slot:running:sun:08', 'slot:strength_training:tue:18', 'sleep', 'resting_hr', 'load', 'mix', 'workouts_per_week', 'recent_weeks', 'nothing'].map(slotsOfBriefKey),
    [['routine.run.sun_08'], ['routine.strength.tue_18'], ['body.sleep'], ['body.resting_hr'], ['load.week'], ['routine.mix'], ['routine.weekly_volume'], [], []]);
  const p = fresh();
  p.roll();
  p.round();
  assert.equal(onForget(p.ctx, { what: 'stop', key: 'slot:running:sun:08', now: NOW }), true);
  assert.equal(table(p.ctx).rows.some((r) => r.slot === 'routine.run.sun_08'), false);
  assert.equal(onForget(p.ctx, { what: 'stop', key: 'slot:nothing' }), false);
  assert.equal(onRestore(p.ctx, { what: 'stop', key: 'slot:running:sun:08', now: NOW }), true);
  assert.equal(table(p.ctx).rows.some((r) => r.slot === 'routine.run.sun_08'), true);
});

test('the file: written through a temporary file and read back; a failed write keeps the old file; an invalid file is refused', () => {
  const p = fresh();
  p.roll();
  const path = `/mem/${USER}/${AGENT_FILE}`;
  const before = p.mem.io.readFile(path);
  assert.equal(p.mem.exists(`/mem/${USER}/.${AGENT_FILE}.tmp`), false);
  for (const broken of ['rename', 'fsyncFile', 'writeFile']) {
    const io = { ...p.mem.io, [broken]: () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); } };
    assert.throws(() => dailyApply({ ...p.ctx, io }, { now: NOW, day: DAY, proposals: [] }), /EIO/);
    assert.equal(p.mem.io.readFile(path), before, broken);
  }
  const lying = { ...p.mem.io, readFile: (f) => (f.endsWith('.tmp') ? 'something else' : p.mem.io.readFile(f)) };
  assert.throws(() => dailyApply({ ...p.ctx, io: lying }, { now: NOW, day: DAY, proposals: [] }), /could not be written/);
  assert.equal(dailyApply(p.ctx, { now: NOW, day: DAY, proposals: [] }).ok, true, 'a leftover temporary file does not block the next write');
  const file = openAgentFile({ io: p.mem.io, dir: p.store.dir, user: USER });
  assert.deepEqual(file.load().processed[DAY].length, 64);
  p.mem.io.remove(path);
  p.mem.plant(path, '{"v":1,"user":"usr_someone_else"}');
  assert.throws(() => table(p.ctx), /invalid/);
  assert.throws(() => file.save({ v: 1 }), /invalid/);
});
