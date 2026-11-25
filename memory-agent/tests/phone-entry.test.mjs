// The phone bundle runs in a bare JavaScript context (Node's vm: no require, no process, no timers), the way JavaScriptCore runs it,
// and gives exactly what the modules give when called directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MemoryStore, recordFeedback, forgetRecommendation, forgetFactKey } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import { plannerText } from '../src/memory/planner-text.mjs';
import { briefText } from '../src/memory/brief.mjs';
import { recordDay, onForget } from '../src/agent/index.mjs';
import { makeMemoryIO } from './memory-io.mjs';

const USER = `usr_${'d4'.repeat(8)}`;
const snapshot = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/half_marathon.json', import.meta.url), 'utf8'));
const MIDNIGHT = '2026-11-18T00:00:00-08:00';
const base = { root: '/mem', user: USER };

let bundle = null;
try { bundle = await (await import('../scripts/build-phone.mjs')).buildPhone(); } catch (e) { if (process.env.EVERGREEN_STRICT === '1') throw e; /* esbuild is a devDependency: without it these tests are skipped */ }
const skip = bundle === null ? 'esbuild is not installed' : false;

function phone() {
  const mem = makeMemoryIO();
  const context = vm.createContext({});
  context.memoryIO = mem.io;
  vm.runInContext(bundle, context);
  const call = (name, args) => JSON.parse(context[name](JSON.stringify({ ...base, ...args })));
  return { mem, call, context, store: new MemoryStore('/mem', USER, { io: mem.io }) };
}
const direct = () => {
  const mem = makeMemoryIO();
  const store = new MemoryStore('/mem', USER, { io: mem.io });
  return { mem, store, ctx: { store, io: mem.io, user: USER } };
};

test('the bundle is one script with no imports, and sets the earlier global functions', { skip }, () => {
  assert.ok(!/^\s*(import|export)\s/m.test(bundle));
  const { context } = phone();
  for (const name of ['memoryRoll', 'memoryForget', 'memoryPlannerText', 'memoryRestore', 'memoryState', 'memoryBrief']) assert.equal(typeof context[name], 'function', name);
  // Removed with Amplitude and the tap path the app no longer uses.
  for (const name of ['memoryTap', 'memoryFlush', 'memoryAck']) assert.equal(context[name], undefined, name);
});

const briefOnly = (b) => ({ ok: true, text: b.text, words: b.words, targetMet: b.targetMet });
const screen = (b) => ({ ok: true, lines: b.lines, words: b.words, stopped: b.stopped, facts: b.facts });

test('roll, tap, forget and planner text through the bundle equal the modules called directly', { skip }, () => {
  const p = phone();
  const d = direct();
  const tap = { recId: 'rec_00000001', activity: 'run', weekday: 3, hour: 7, action: 'declined', reason: 'too_early', now: '2026-11-17T12:00:00.000Z' };

  assert.deepEqual(p.call('memoryRoll', { snapshot, now: MIDNIGHT }), rollDay({ store: d.store, snapshot, now: MIDNIGHT }));
  recordDay(d.ctx, { snapshot, now: MIDNIGHT });               // a completed roll also keeps the day's facts as the agent's evidence
  assert.deepEqual(recordFeedback(p.store, tap), recordFeedback(d.store, tap));       // a tap goes through the store; the bundle has no call for it
  assert.deepEqual(p.call('memoryPlannerText', { full: true }), plannerText(d.store));
  assert.deepEqual(p.call('memoryPlannerText', {}), briefOnly(briefText(d.store)));
  assert.deepEqual(p.call('memoryBrief', {}), screen(briefText(d.store)));
  assert.match(p.call('memoryPlannerText', {}).text, /^- Workouts: 6\.5 a week/);
  assert.deepEqual(p.call('memoryForget', { what: 'recommendation', recId: 'rec_00000001' }), { ok: forgetRecommendation(d.store, 'rec_00000001') });
  assert.deepEqual(p.call('memoryForget', { what: 'day', date: '2026-11-10' }), { ok: forgetFactKey(d.store, 'daily', '2026-11-10') });
  onForget(d.ctx, { what: 'day', date: '2026-11-10' });
  assert.deepEqual(p.call('memoryPlannerText', { full: true }), plannerText(d.store));
  assert.deepEqual(p.call('memoryPlannerText', {}), briefOnly(briefText(d.store)));
  assert.deepEqual(p.mem.dump('/mem'), d.mem.dump('/mem'));
  assert.ok(Object.keys(p.mem.dump('/mem')).length >= 2);
});

test('state lists what can be forgotten, and restore undoes a stopped type and forgotten files', { skip }, () => {
  const { call } = phone();
  call('memoryRoll', { snapshot, now: MIDNIGHT });
  const before = call('memoryState', {});
  assert.equal(before.ok, true);
  assert.ok(before.days.includes('2026-11-17') && before.types.includes('body'));
  assert.deepEqual([before.stoppedTypes, before.forgottenDays, before.forgottenKinds], [[], [], []]);
  const withBody = call('memoryPlannerText', {}).text;
  assert.match(withBody, /Resting heart rate/);

  assert.deepEqual(call('memoryForget', { what: 'type', type: 'body' }), { ok: true });
  assert.deepEqual(call('memoryForget', { what: 'day', date: '2026-11-10' }), { ok: true });
  call('memoryRoll', { snapshot, now: MIDNIGHT });
  assert.doesNotMatch(call('memoryPlannerText', {}).text, /Resting heart rate/);
  const stopped = call('memoryState', {});
  assert.deepEqual([stopped.stoppedTypes, stopped.forgottenDays], [['body'], ['2026-11-10']]);
  assert.ok(!stopped.days.includes('2026-11-10'));

  assert.deepEqual(call('memoryRestore', { what: 'type', type: 'body' }), { ok: true });
  call('memoryRoll', { snapshot, now: MIDNIGHT });
  assert.match(call('memoryPlannerText', {}).text, /Resting heart rate/);

  for (const kind of ['profile', 'rolling']) assert.deepEqual(call('memoryForget', { what: 'derived', kind }), { ok: true });
  call('memoryRoll', { snapshot, now: MIDNIGHT });
  assert.deepEqual(call('memoryState', {}).forgottenKinds, ['profile', 'rolling']);
  assert.doesNotMatch(call('memoryPlannerText', { full: true }).text, /On 2026-11-17/);
  assert.equal(call('memoryPlannerText', {}).text, '');
  for (const kind of ['profile', 'rolling']) assert.deepEqual(call('memoryRestore', { what: 'derived', kind }), { ok: true });
  call('memoryRoll', { snapshot, now: MIDNIGHT });
  assert.match(call('memoryPlannerText', { full: true }).text, /On 2026-11-17/);
  assert.equal(call('memoryRestore', { what: 'everything' }).error.code, 'unknown_what');
});

const ERROR = (r) => [r.ok, Object.keys(r), Object.keys(r.error), typeof r.error.text, /^[A-Za-z][A-Za-z0-9_]*$/.test(r.error.code), /^[A-Z].*\.$/.test(r.error.text)];
const isError = (r, code) => { assert.deepEqual(ERROR(r), [false, ['ok', 'error'], ['code', 'text'], 'string', true, true], JSON.stringify(r)); assert.equal(r.error.code, code); };
test('failures come back as { ok: false, error: { code, text } }, with nothing else, and never throw', { skip }, () => {
  const { call, context, mem } = phone();
  isError(call('memoryRoll', { snapshot: {}, now: MIDNIGHT }), 'roll_failed');
  isError(call('memoryForget', { what: 'everything' }), 'unknown_what');
  isError(call('memoryForget', { what: 'day', date: 'someday' }), 'not_done');
  isError(call('memoryRestore', { what: 'type', type: 'nothing' }), 'not_done');
  isError(JSON.parse(context.memoryRoll('not json')), 'bad_arguments');
  for (const name of ['memoryState', 'memoryBrief', 'memoryPlannerText', 'memoryForget']) isError(JSON.parse(context[name](JSON.stringify({ root: '/mem', user: 'sam' }))), 'bad_user');
  mem.plant(`/mem/${USER}/forgotten.json`, 'not a list');
  for (const name of ['memoryState', 'memoryBrief', 'memoryPlannerText']) isError(call(name, {}), 'memory_unavailable');
  context.memoryIO = undefined;
  isError(JSON.parse(context.memoryPlannerText(JSON.stringify(base))), 'failed');
});

test('stop one brief line by its key through the bundle: gone from text, lines and facts, listed as stopped, back after restore', { skip }, () => {
  const { call } = phone();
  call('memoryRoll', { snapshot, now: MIDNIGHT });
  const key = 'slot:running:sun:08';
  const before = call('memoryBrief', {});
  assert.ok(before.lines.some((l) => l.key === key));
  assert.deepEqual(before.stopped, []);
  assert.deepEqual(call('memoryForget', { what: 'stop', key }), { ok: true });
  for (let i = 0; i < 2; i++) {
    const b = call('memoryBrief', {});
    assert.ok(!b.lines.some((l) => l.key === key) && b.lines.filter((l) => l.id === 'usual_time').length === 2);
    assert.ok(!b.facts.some((f) => /on Sun between 08:00/.test(f.text)) && b.facts.some((f) => /on Tue between 18:00/.test(f.text)));
    assert.deepEqual(b.stopped, [{ key, label: 'Running, Sunday 8 AM' }]);
    assert.doesNotMatch(call('memoryPlannerText', {}).text, /Sun 8 AM/);
    assert.doesNotMatch(call('memoryPlannerText', { full: true }).text, /on Sun between 08:00/);
    call('memoryRoll', { snapshot, now: MIDNIGHT });            // the same data computes the slot again: it stays stopped
  }
  assert.deepEqual(call('memoryRestore', { what: 'stop', key }), { ok: true });
  call('memoryRoll', { snapshot, now: MIDNIGHT });
  assert.deepEqual(call('memoryBrief', {}), before);
  assert.equal(call('memoryForget', { what: 'stop', key: 'slot:nothing' }).error.code, 'not_done');
});
