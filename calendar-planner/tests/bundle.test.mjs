import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { calendarPlan, calendarReplan, calendarIntentSchema } from '../src/phone/entry.mjs';
import { runDemo, SENTENCES, WEEK as DEMO_WEEK } from '../scripts/demo.mjs';
import rules from '../src/planner/approaches/rules.mjs';
import search from '../src/planner/approaches/search.mjs';
import { planWith } from '../src/planner/engine.mjs';
import { violations } from '../src/planner/check.mjs';
import { WEEK, day, need } from './helpers.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = (dir = '../src/') => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? sources(`${dir}${e.name}/`) : e.name.endsWith('.mjs') ? [`${dir}${e.name}`] : []));
// A bare context: no process, no require, no fetch, like JavaScriptCore.
const load = (code) => { const box = vm.createContext({}); vm.runInContext(code, box); return box; };
// esbuild is a devDependency: without `npm install` there is no fresh build.
const bundle = await import('../scripts/build-phone.mjs').then((m) => m.buildPhone(), () => null);
const DIST = new URL('../dist/calendar-phone.js', import.meta.url);

test('the bundle in a bare context gives the same answers as direct calls', (t) => {
  if (!need(t, bundle, 'esbuild (run npm install)')) return;
  const box = load(bundle);
  assert.deepEqual([typeof box.calendarPlan, typeof box.calendarReplan, typeof box.calendarIntentSchema, typeof box.process, typeof box.require], ['function', 'function', 'function', 'undefined', 'undefined']);
  const requests = [...SENTENCES, "skip Thursday's strength", 'not a request at all', 'my race is on Saturday'];
  for (const request of requests) {
    const args = JSON.stringify({ ...DEMO_WEEK, request }), direct = calendarPlan(args);
    assert.equal(box.calendarPlan(args), direct, request);
    const plan = JSON.parse(direct);
    for (const change of [{ type: 'text', text: 'a bit later' }, { type: 'answer', answerId: 'all' }, { type: 'drag', id: plan.proposed[0]?.id ?? 'w1', start: day(4, '10') }]) {
      const again = JSON.stringify({ ...DEMO_WEEK, plan, change });
      assert.equal(box.calendarReplan(again), calendarReplan(again), `${request} / ${change.type}`);
    }
  }
  assert.equal(JSON.parse(box.calendarPlan('{')).error.code, 'BadJSON');
  assert.equal(box.calendarIntentSchema(), calendarIntentSchema());
});

test('the committed bundle is the current build', (t) => {
  if (!need(t, existsSync(DIST), 'dist/calendar-phone.js (run npm run build)') || !need(t, bundle, 'esbuild (run npm install)')) return;
  assert.equal(read('../dist/calendar-phone.js'), bundle);
});

test('nothing that goes into the bundle needs Node, the clock, the network or chance', () => {
  const files = sources();
  assert.ok(files.length >= 8);
  for (const f of files) {
    const code = read(f).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /node:|\bprocess\b|\brequire\s*\(|\bfetch\b|XMLHttpRequest|\bIntl\b|Date\.now|new Date\(\)|Math\.random|toLocale|\bimport\s*\(|GEMINI|api[_-]?key/i, f);
    for (const m of code.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^\.{1,2}\//, `${f} imports ${m[1]}`);
  }
});

test('the built bundle holds no Node calls', (t) => {
  if (!need(t, existsSync(DIST), 'dist/calendar-phone.js (run npm run build)')) return;
  assert.doesNotMatch(read('../dist/calendar-phone.js'), /node:|\brequire\s*\(|\bprocess\./);
});

test('the engine does not use the network', () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('network used'); };
  try { runDemo(); } finally { globalThis.fetch = real; }
  assert.equal(calls, 0);
});

test('the example in docs/PHONE.md runs against the bundle', (t) => {
  if (!need(t, bundle, 'esbuild (run npm install)')) return;
  const doc = read('../docs/PHONE.md'), code = doc.match(/```js\n([\s\S]*?)```/)[1];
  const box = load(bundle);
  vm.runInContext(`${code}\nglobalThis.out = { first, moved };\nglobalThis.week = week;`, box);
  const { first, moved } = box.out;
  assert.deepEqual([first.ok, first.kind, first.proposed[0].start, first.proposed[0].reason], [true, 'add', '2026-11-09T18:00:00-08:00', 'First free 30 minutes after 5 PM tonight; your Team sync ends at 6 PM.']);
  assert.deepEqual([moved.ok, moved.proposed[0].start, moved.proposed[0].status, moved.replaces], [true, '2026-11-09T20:00:00-08:00', 'new', first.undoToken]);
  // Every field a result carries is named in the doc.
  const race = JSON.parse(calendarPlan(JSON.stringify({ ...WEEK, request: 'my race is on the 29th' })));
  const asked = JSON.parse(calendarPlan(JSON.stringify({ ...WEEK, request: "Move Thursday's strength to Saturday" })));
  const schema = JSON.parse(calendarIntentSchema()), wrong = JSON.parse(calendarPlan(JSON.stringify({ ...WEEK, intent: { kind: 'add' } })));
  assert.equal(first.proposed[0].reason, JSON.parse(calendarPlan(JSON.stringify({ ...JSON.parse(JSON.stringify(box.week)), request: 'Find me half an hour for a walk after 5 tonight' }))).proposed[0].reason);
  for (const key of [...Object.keys(schema.properties), ...schema.properties.kind.enum, ...Object.keys(wrong.error), 'sessionId', 'paceMinPerKm', 'weekday', 'calendarIntentSchema', ...Object.keys(moved), ...Object.keys(race.proposed.at(-1)), ...Object.keys(asked), ...Object.keys(asked.question), ...Object.keys(asked.question.answers[0])]) assert.ok(doc.includes(key), key);
});

// The three approaches from Plan Calendar.
test('rules and search both give plans that keep the hard rules; hybrid uses the rules draft when it passes', () => {
  for (const solver of [rules, search]) for (const request of ['find me an hour for a run tomorrow', 'my race is on the 29th', "move Sunday's long run to the afternoon", 'my race is on Friday']) {
    const { out, check } = planWith({ ...WEEK, request }, solver);
    assert.ok(out.proposed.length > 0, `${solver.name}: ${request}`);
    assert.deepEqual(violations(check.blocks, check), [], `${solver.name}: ${request}`);
  }
  assert.equal(JSON.parse(calendarPlan(JSON.stringify({ ...WEEK, request: 'my race is on the 29th' }))).state.used, 'rules');
  // Search leaves a little air after an event when it can; rules take the first free slot.
  const tight = { ...WEEK, request: 'find me half an hour for a walk after 5 tonight' };
  assert.equal(planWith(tight, rules).out.proposed[0].start, day(0, '18'));
  assert.equal(planWith(tight, search).out.proposed[0].start, day(0, '19', '30'));
});

test('the hard-rule check names what is wrong', () => {
  const b = (id, h1, h2, more = {}) => ({ id, start: `2026-11-09T${h1}:00:00.000Z`, end: `2026-11-09T${h2}:00:00.000Z`, ...more });
  const codes = (blocks, o) => violations(blocks, o).map((v) => v.code);
  assert.deepEqual(codes([b('a', '09', '10'), b('b', '10', '11')], { events: [b('e', '12', '13')] }), []);
  assert.deepEqual(codes([b('a', '09', '10')], { events: [b('e', '09', '11')] }), ['overlap-event']);
  assert.deepEqual(codes([b('a', '09', '11'), b('b', '10', '12')]), ['overlap-block']);
  assert.deepEqual(codes([b('a', '09', '11'), b('b', '10', '12', { cancelled: true })]), []);
  assert.deepEqual(codes([b('a', '10', '11'), b('b', '08', '09')], { chain: ['a', 'b'] }), ['order']);
  assert.deepEqual(codes([b('a', '10', '11')], { chain: ['a'], deadline: Date.parse('2026-11-09T10:30:00.000Z') }), ['deadline']);
  assert.deepEqual(codes([b('a', '10', '09')]), ['shape']);
});
