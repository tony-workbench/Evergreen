// The engine against the shared contract (contract/schemas). The folder sits next to this one in the full repository;
// EVERGREEN_CONTRACT_DIR points somewhere else. Without it these tests are skipped, or fail with EVERGREEN_STRICT=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { calendarIntentSchema } from '../src/phone/entry.mjs';
import { plan, need } from './helpers.mjs';

const DIR = process.env.EVERGREEN_CONTRACT_DIR || fileURLToPath(new URL('../../contract', import.meta.url));
const there = existsSync(join(DIR, 'schemas', 'calendar-intent.schema.json'));
const schema = (name) => JSON.parse(readFileSync(join(DIR, 'schemas', `${name}.schema.json`), 'utf8'));
const WHAT = `the contract folder (${DIR}; set EVERGREEN_CONTRACT_DIR)`;

test('the intent schema has the contract\'s fields, lists and patterns', (t) => {
  if (!need(t, there, WHAT)) return;
  const ours = JSON.parse(calendarIntentSchema()).properties, theirs = schema('calendar-intent').properties, activities = schema('activity').enum;
  assert.deepEqual(Object.keys(ours).sort(), Object.keys(theirs).sort());
  assert.deepEqual([...ours.activity.enum].sort(), [...activities].sort());
  for (const [key, rule] of Object.entries(theirs)) {
    if (rule.enum) assert.deepEqual([...ours[key].enum].sort(), [...rule.enum].sort(), key);
    if (rule.type) assert.equal(ours[key].type, rule.type, key);
    for (const limit of ['minimum', 'maximum', 'exclusiveMinimum', 'minLength']) if (limit in rule) assert.equal(ours[key][limit], rule[limit], `${key}.${limit}`);
  }
});

test('every activity on the contract\'s list can be added and comes back as a contract block', (t) => {
  if (!need(t, there, WHAT)) return;
  const block = schema('preview-block'), allowed = Object.keys(block.properties);
  for (const activity of schema('activity').enum) {
    const r = plan(undefined, { intent: { kind: 'add', activity, day: '2026-11-10' } });
    assert.equal(r.ok, true, activity);
    assert.equal(r.proposed[0].activity, activity);
    for (const key of Object.keys(r.proposed[0])) assert.ok(allowed.includes(key), `${activity}: ${key}`);
    for (const key of block.required ?? []) assert.ok(key in r.proposed[0], `${activity}: ${key}`);
  }
});
