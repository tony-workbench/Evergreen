// The examples in docs/MEMORY-LOGIC.md come from the code: each quoted line must be what the roll and the planner text produce.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryStore } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import { plannerText } from '../src/memory/planner-text.mjs';
import { briefText } from '../src/memory/brief.mjs';
import { makeMemoryIO } from './memory-io.mjs';

const DOC = fs.readFileSync(new URL('../docs/MEMORY-LOGIC.md', import.meta.url), 'utf8');
const snapshot = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/moderate.json', import.meta.url), 'utf8'));
const fresh = () => new MemoryStore('/mem', `usr_${'e5'.repeat(8)}`, { io: makeMemoryIO().io });
const midnight = '2026-11-18T00:00:00-08:00';
const noon = '2026-11-17T12:00:00-08:00';

test('the daily-roll examples in docs/MEMORY-LOGIC.md are what the code writes', () => {
  const store = fresh();
  assert.equal(rollDay({ store, snapshot: { ...snapshot, exportDate: midnight }, now: midnight }).ok, true);
  const rolled = plannerText(store).text;
  const quoted = [...DOC.matchAll(/^Example \((midnight|noon)\): `(.+)`$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(quoted.map((q) => q[0]), ['midnight', 'noon']);
  assert.ok(rolled.split('\n').includes(`- ${quoted[0][1]}`), quoted[0][1]);
  const day = fresh();
  assert.equal(rollDay({ store: day, snapshot: { ...snapshot, exportDate: noon }, now: noon }).ok, true);
  assert.ok(day.view('rolling').split('\n').includes(`- ${quoted[1][1]}`), quoted[1][1]);
});

test('the brief examples in docs/MEMORY-LOGIC.md and README.md are what the code gives', () => {
  const roll = (who) => {
    const store = fresh();
    const data = JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${who}.json`, import.meta.url), 'utf8'));
    assert.equal(rollDay({ store, snapshot: { ...data, exportDate: midnight }, now: midnight }).ok, true);
    return briefText(store).text;
  };
  const quoted = DOC.match(/^Example \(brief\): `(.+)`$/m)[1];
  assert.ok(roll('moderate').split('\n').includes(`- ${quoted}`), quoted);
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(readme.match(/```text\n([\s\S]*?)\n```/)[1], roll('half_marathon'));
});

test('section 9 of docs/MEMORY-LOGIC.md names every guardrail code, state and operation', async () => {
  const { CODE_TEXT, STATES, OPS } = await import('../src/agent/index.mjs');
  const agent = DOC.slice(DOC.indexOf('The memory agent'));
  for (const word of [...Object.keys(CODE_TEXT), ...STATES, ...OPS]) assert.ok(agent.includes(word), word);
});
