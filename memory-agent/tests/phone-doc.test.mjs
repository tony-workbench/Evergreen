// The example in docs/PHONE.md runs as written: an in-memory memoryIO, one roll and one planner text call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const doc = fs.readFileSync(new URL('../docs/PHONE.md', import.meta.url), 'utf8');
const example = doc.match(/```js\n([\s\S]*?)```/)[1];
const snapshot = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/moderate.json', import.meta.url), 'utf8'));

let bundle = null;
try { bundle = await (await import('../scripts/build-phone.mjs')).buildPhone(); } catch (e) { if (process.env.EVERGREEN_STRICT === '1') throw e; /* esbuild is a devDependency: without it these tests are skipped */ }

test('the PHONE.md example rolls a day and returns planner text', { skip: bundle === null ? 'esbuild is not installed' : false }, () => {
  const context = vm.createContext({ snapshot, hostSha256: (text) => createHash('sha256').update(text).digest('hex') });
  vm.runInContext(bundle, context);
  vm.runInContext(example, context);
  assert.equal(vm.runInContext('planner.ok', context), true);
  assert.match(vm.runInContext('planner.text', context), /^- Workouts: 4\.5 a week/);
  // The memory agent's day in the same example: request, the stand-in for the model, apply, table.
  const day = JSON.parse(vm.runInContext('JSON.stringify({ request, answer, applied, table })', context));
  assert.deepEqual([day.request.ok, day.request.day, day.request.alreadyDone, day.applied.rejected], [true, '2026-11-17', false, []]);
  assert.ok(day.answer.proposals.length >= 5 && day.applied.applied.length === day.answer.proposals.length);
  assert.equal(day.table.rows.length, day.answer.proposals.length);
  assert.match(day.table.text, /^\| Slot \| What \| Since \| Sure\? \|/);
});

test('PHONE.md names every global with its fields', () => {
  for (const name of ['memoryRoll', 'memoryForget', 'memoryPlannerText', 'memoryRestore', 'memoryState', 'memoryBrief', 'memoryDailyRequest', 'memoryDailyApply', 'memoryTable', 'memoryReviewQueue', 'memoryConfirm', 'memoryReject', 'memoryDemoModel']) assert.ok(doc.includes(name), name);
  for (const field of ['full: true', "what: 'stop'", 'stopped', 'facts', 'alreadyDone', 'system', 'schema', 'evidence', 'supportDays', 'neighbors', 'applied', 'rejected', 'review', 'guard', 'evidenceIds', 'targetMemoryId', 'confidence', 'leftOut', 'reviewId', 'targetStatement', 'sessionId', 'plannedStart', 'extras', 'startedOn', 'brief: true', "what:'day'"]) assert.ok(doc.includes(field), field);
});
