// The memory agent through the phone bundle (a bare JavaScript context, as JavaScriptCore runs it): every new global
// gives exactly what the modules give when called directly, the files are the same, and the results fit the shared contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import { briefText } from '../src/memory/brief.mjs';
import { recordDay, dailyRequest, dailyApply, table, reviews, confirm, reject, restore, demoModel, onForget, SYSTEM } from '../src/agent/index.mjs';
import { makeMemoryIO } from './memory-io.mjs';
import { scanDir } from './helpers/core-scan.mjs';
import { contract, noContract } from './helpers/contract.mjs';

const USER = `usr_${'a7'.repeat(8)}`;
const snapshot = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/half_marathon.json', import.meta.url), 'utf8'));
const NOW = '2026-11-18T00:00:00-08:00';
const DAY = '2026-11-17';
const base = { root: '/mem', user: USER };
const outcomes = ['2026-11-15', '2026-11-16', DAY].map((day) => ({ sessionId: `s-${day}-run-0600`, day, activity: 'run', plannedStart: `${day}T06:00:00-08:00`, done: false }));

let bundle = null;
try { bundle = await (await import('../scripts/build-phone.mjs')).buildPhone(); } catch (e) { if (process.env.EVERGREEN_STRICT === '1') throw e; /* esbuild is a devDependency: without it these tests are skipped */ }
const skip = bundle === null ? 'esbuild is not installed' : false;

function phone() {
  const mem = makeMemoryIO();
  const context = vm.createContext({});
  context.memoryIO = mem.io;
  vm.runInContext(bundle, context);
  return { mem, context, call: (name, args) => JSON.parse(context[name](JSON.stringify({ ...base, ...args }))) };
}
function direct() {
  const mem = makeMemoryIO();
  const store = new MemoryStore('/mem', USER, { io: mem.io });
  return { mem, store, ctx: { store, io: mem.io, user: USER } };
}

test('the bundle sets the agent\'s globals next to the earlier nine', { skip }, () => {
  const { context } = phone();
  for (const name of ['memoryDailyRequest', 'memoryDailyApply', 'memoryDemoModel', 'memoryTable', 'memoryReviewQueue', 'memoryConfirm', 'memoryReject', 'memoryRestore', 'memoryRoll', 'memoryBrief', 'memoryPlannerText']) assert.equal(typeof context[name], 'function', name);
});

// A bundle call that must equal the module's result; returns it.
const sameAs = (p) => (name, args, expected) => { const got = p.call(name, args); assert.deepEqual(got, JSON.parse(JSON.stringify(expected)), name); return got; };

// The day's roll, request, model answer and apply, through the bundle and directly.
function dayThroughBoth(p, d, same) {
  p.call('memoryRoll', { snapshot, now: NOW });
  rollDay({ store: d.store, snapshot, now: NOW });
  recordDay(d.ctx, { snapshot, now: NOW });
  const request = same('memoryDailyRequest', { now: NOW, outcomes }, dailyRequest(d.ctx, { now: NOW, outcomes }));
  assert.deepEqual([request.ok, request.day, request.alreadyDone, request.system, request.evidence.length], [true, DAY, false, SYSTEM, 13]);
  const answer = JSON.parse(p.context.memoryDemoModel(JSON.stringify(request)));
  assert.deepEqual(answer, demoModel(request));
  const applied = same('memoryDailyApply', { now: NOW, day: DAY, proposals: answer }, dailyApply(d.ctx, { now: NOW, day: DAY, proposals: answer }));
  assert.deepEqual([applied.applied.length, applied.rejected, applied.review.length], [10, [], 1]);
}

// The rest of the day's calls through the bundle and directly: the second request and apply, the queue, confirm, reject,
// restore and the table; returns the last table.
function restThroughBoth(d, same) {
  same('memoryDailyRequest', { now: NOW }, dailyRequest(d.ctx, { now: NOW }));
  same('memoryDailyApply', { now: NOW, proposals: [] }, dailyApply(d.ctx, { now: NOW, proposals: [] }));
  const queue = same('memoryReviewQueue', {}, reviews(d.ctx));
  same('memoryConfirm', { now: NOW, memoryId: queue.rows[0].memoryId }, confirm(d.ctx, { now: NOW, memoryId: queue.rows[0].memoryId }));
  same('memoryReject', { now: NOW, key: 'routine.run.sun_08' }, reject(d.ctx, { now: NOW, key: 'routine.run.sun_08' }));
  same('memoryTable', { now: NOW }, table(d.ctx, { now: NOW }));
  same('memoryRestore', { now: NOW, key: 'routine.run.sun_08' }, restore(d.ctx, { now: NOW, key: 'routine.run.sun_08' }));
  same('memoryReject', { now: NOW, memoryId: 'mem_0404' }, reject(d.ctx, { now: NOW, memoryId: 'mem_0404' }));
  return same('memoryTable', {}, table(d.ctx));
}

test('a day through the bundle equals the modules called directly, call by call and file by file', { skip }, () => {
  const p = phone();
  const d = direct();
  const same = sameAs(p);

  dayThroughBoth(p, d, same);
  const t = restThroughBoth(d, same);
  assert.equal(t.rows.length, 10);
  assert.deepEqual(p.mem.dump('/mem'), d.mem.dump('/mem'));
});

test('through the bundle, the table, the question queue and the errors fit the shared contract', { skip: skip || noContract }, () => {
  const { call } = phone();
  const err = call('memoryDailyRequest', { now: NOW });
  assert.equal(err.error.code, 'no_evidence');
  for (const e of [err, call('memoryTable', { now: 'x' }), call('memoryConfirm', { now: NOW, key: 'body.sleep' }), call('memoryDailyApply', { now: NOW, proposals: 'none' }), call('memoryRestore', { now: NOW, key: 'body.sleep' })]) contract.assertValid('error', e, 'an error');
  call('memoryRoll', { snapshot, now: NOW });
  const request = call('memoryDailyRequest', { now: NOW, outcomes });
  for (const o of outcomes) contract.assertValid('outcome', o, 'an outcome');
  call('memoryDailyApply', { now: NOW, day: request.day, proposals: call('memoryDemoModel', request) });
  const t = call('memoryTable', {});
  contract.assertValid('memory-table', t, 'memoryTable');
  for (const row of t.rows) contract.assertValid('memory-row', row, row.slot);
  const queue = call('memoryReviewQueue', {});
  assert.equal(queue.rows.length, 1);
  const { reviewId, question, reason, day, targetMemoryId, targetStatement, ...row } = queue.rows[0];
  contract.assertValid('memory-row', { ...row, state: 'candidate', confidence: 0.6, since: day, updated: day }, 'a question, as a row');
  assert.deepEqual([typeof reviewId, question, reason.code, targetMemoryId, targetStatement], ['string', 'Is this right?', 'model_unsure', null, null]);
});

test('stop and restore by key through memoryForget and memoryRestore reach the agent\'s memory; the planner text can be the table', { skip }, () => {
  const { call } = phone();
  call('memoryRoll', { snapshot, now: NOW });
  const brief = call('memoryPlannerText', {});
  assert.match(brief.text, /^- Workouts: 6\.5 a week/, 'no table yet: the brief');
  call('memoryDailyApply', { now: NOW, proposals: call('memoryDemoModel', call('memoryDailyRequest', { now: NOW })) });
  const t = call('memoryTable', {});
  assert.deepEqual(call('memoryPlannerText', {}), { ok: true, text: t.text, words: t.words, source: 'table' }, 'once the table has a row it is the planner text');
  assert.deepEqual(call('memoryPlannerText', { brief: true }), brief, 'brief: true keeps the old form');

  for (const key of ['slot:running:sun:08', 'load.week']) {              // a brief key, and a table row's key
    assert.deepEqual(call('memoryForget', { what: 'stop', key, now: NOW }), { ok: true }, key);
  }
  const without = call('memoryTable', {}).rows.map((r) => r.slot);
  assert.ok(!without.includes('routine.run.sun_08') && !without.includes('load.week') && without.includes('routine.run.tue_18'));
  call('memoryRoll', { snapshot, now: NOW });
  const again = call('memoryDailyRequest', { now: NOW });
  assert.ok(!again.evidence.some((e) => e.slots.includes('routine.run.sun_08') || e.slots.includes('load.week')));
  for (const key of ['slot:running:sun:08', 'load.week']) assert.deepEqual(call('memoryRestore', { what: 'stop', key, now: NOW }), { ok: true }, key);
  assert.deepEqual(call('memoryTable', {}).rows.map((r) => r.slot).sort(), t.rows.map((r) => r.slot).sort());

  assert.deepEqual(call('memoryForget', { what: 'day', day: '2026-11-10', snapshot }), { ok: true });
  const kept = call('memoryTable', {});
  assert.deepEqual(kept.rows.map((r) => r.slot).sort(), t.rows.map((r) => r.slot).sort(), 'with the snapshot the table is not left empty');
  assert.deepEqual(kept.rows.find((r) => r.slot === 'routine.weekly_volume').data, { workoutsPerWeek: 6.25, minutesPerWeek: 309.75 });
  assert.ok(!call('memoryState', {}).days.includes('2026-11-10') && call('memoryState', {}).days.includes('2026-11-17'), 'the facts were rolled again without the day');
  assert.match(call('memoryPlannerText', { brief: true }).text, /^- Workouts: 6\.3 a week/);
  assert.deepEqual(call('memoryForget', { what: 'day', date: '2026-11-12' }), { ok: true });
  assert.deepEqual(call('memoryTable', {}).rows, [], 'without the snapshot every aggregate that may contain the day goes');
});

test('without memoryIO, and with arguments that are not JSON, the agent\'s globals answer with an error and never throw', { skip }, () => {
  const { context } = phone();
  for (const name of ['memoryDailyRequest', 'memoryDailyApply', 'memoryTable', 'memoryReviewQueue', 'memoryConfirm', 'memoryReject', 'memoryDemoModel']) {
    const r = JSON.parse(context[name]('not json'));
    assert.deepEqual([r.ok, r.error.code, typeof r.error.text], [false, 'bad_arguments', 'string'], name);
  }
  assert.equal(JSON.parse(context.memoryRestore('not json')).error.code, 'bad_arguments');
  assert.equal(JSON.parse(context.memoryTable(JSON.stringify({ root: '/mem', user: 'usr_sam' }))).error.code, 'bad_user', 'a name is not an opaque id');
  context.memoryIO = undefined;
  assert.equal(JSON.parse(context.memoryTable(JSON.stringify(base))).error.code, 'failed');
});

test('the agent\'s code names no model and no provider, and the stand-in model is plain rules', () => {
  const dir = new URL('../src/agent/', import.meta.url);
  for (const name of [...fs.readdirSync(dir).map((f) => new URL(f, dir)), new URL('../scripts/fake-model.mjs', import.meta.url), new URL('../scripts/demo.mjs', import.meta.url)]) {
    assert.doesNotMatch(fs.readFileSync(name, 'utf8'), /claude|gpt|gemini|sonnet|opus|haiku|llama|openai|anthropic|mistral|https?:/i, String(name));
  }
  assert.deepEqual(scanDir(fileURLToPath(dir)), []);
  assert.deepEqual(demoModel(null), { proposals: [] });
});
