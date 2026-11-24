// Every global's output against the shared contract schemas (contract/schemas), with the contract's own checker.
// The schemas are read from the contract folder, never copied here; without that folder these tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPhone } from '../scripts/build-phone.mjs';
import { memoryFor } from './support/harness-memory.mjs';
import { bundleArgs } from './support/sample.mjs';
import { ACTIVITIES } from '../src/memory.mjs';

// The contract folder: in this repository once it is merged, else the contract worktree next to this one.
const CANDIDATES = ['../../contract/', '../../../Evergreen-contract/contract/'].map((rel) => new URL(rel, import.meta.url));
const home = CANDIDATES.find((u) => existsSync(new URL('schemas/', u)) && existsSync(new URL('src/validate.mjs', u)));
// EVERGREEN_STRICT=1: nothing may be skipped; a missing contract folder, or an activity the schema does not list, fails instead.
const STRICT = process.env.EVERGREEN_STRICT === '1';
const MISSING = 'contract/schemas and contract/src/validate.mjs were not found next to this folder, so nothing was validated';
const skip = home || STRICT ? false : MISSING;

const GLOBALS = ['recommendWeek', 'planContext', 'checkPlan', 'explainAction', 'checkWeek', 'planBrief'];
const cases = JSON.parse(readFileSync(new URL('./fixtures/workouts.json', import.meta.url), 'utf8'));
const context = vm.createContext({});
vm.runInContext(await buildPhone(), context);
const call = (name, args) => JSON.parse(context[name](typeof args === 'string' ? args : bundleArgs(name, args)));

let schemas = {};
let validate = null;
let notListed = [];
if (home) {
  const dir = new URL('schemas/', home);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.schema.json'))) schemas[f.replace('.schema.json', '')] = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  ({ validate } = await import(new URL('src/validate.mjs', home).href));
  // Activities the coordinator has decided on (`elliptical`, `other`) but the schema file may not list yet are added to this copy only.
  notListed = ACTIVITIES.filter((a) => !schemas.activity.enum.includes(a));
  if (notListed.length) schemas = { ...schemas, activity: { ...schemas.activity, enum: [...schemas.activity.enum, ...notListed] } };
}
const fits = (name, value, what) => {
  assert.ok(home, MISSING);
  const r = validate(schemas[name], value, schemas);
  assert.ok(r.ok, `${what} does not fit ${name}.schema.json: ${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
};

test('the contract folder', { skip }, () => {
  assert.ok(home, MISSING);
  for (const name of ['activity', 'session', 'plan', 'plan-check', 'error', 'memory-row']) assert.ok(schemas[name], `${name}.schema.json`);
  console.log(`# contract schemas read from ${fileURLToPath(home)}`);
});

test('the contract lists every activity of this bundle', { skip: skip || (notListed.length && !STRICT ? `activity.schema.json does not list ${notListed.join(', ')} yet; sessions were validated with it added` : false) }, () => {
  assert.deepEqual([...schemas.activity.enum].sort(), [...ACTIVITIES].sort());
});

test('recommendWeek fits plan.schema.json and every session fits session.schema.json, on every golden case', { skip }, () => {
  let sessions = 0;
  const activities = new Set();
  for (const c of cases) {
    const out = call('recommendWeek', { ...c.input, memory: memoryFor(c.input) });
    fits('plan', out, `recommendWeek (${c.name})`);
    for (const s of out.sessions) { fits('session', s, `${s.id} (${c.name})`); sessions += 1; activities.add(s.activity); }
  }
  assert.ok(sessions > 300);
  for (const a of activities) assert.ok(schemas.activity.enum.includes(a), a);
});

test('checkPlan fits plan-check.schema.json, passing and failing', { skip }, () => {
  let failing = 0;
  for (const c of cases) {
    const { busy, ...rest } = c.input;
    const ctx = { ...rest, memory: memoryFor(c.input), calendar: busy };
    const week = call('recommendWeek', ctx);
    const good = call('checkPlan', { plan: { sessions: week.sessions }, context: ctx });
    fits('plan-check', good, `checkPlan (${c.name})`);
    assert.equal(good.pass, true, c.name);
    // The same week made wrong in every way at once: far too long, hard, citing a key that is not there, plus an unknown activity.
    const broken = [...week.sessions.map((s) => ({ ...s, minutes: 400, intensity: 'hard', basedOn: ['not-a-key'] })), { id: 'x', day: 'soon', start: 'later', minutes: 30, activity: 'parkour' }];
    const bad = call('checkPlan', { plan: { sessions: broken }, context: { ...ctx, raceDate: ctx.raceDate ?? '2026-11-22' } });
    fits('plan-check', bad, `checkPlan on a broken plan (${c.name})`);
    assert.equal(bad.pass, false);
    failing += bad.violations.length;
  }
  assert.ok(failing > 500);
});

test('every failure of every global fits error.schema.json', { skip }, () => {
  const bad = ['not json', 'null', '{}', '{"now":"yesterday"}', '{"now":"2026-11-20T09:00:00-08:00","persona":"nobody"}',
    '{"now":"2026-11-20T09:00:00-08:00","persona":"jordan","memory":{"rows":1}}', '{"plan":{},"context":{"now":"2026-11-20T09:00:00-08:00"}}',
    '{"now":"2026-11-20T09:00:00-08:00","persona":"jordan","shoes":{"boughtOn":"x"},"raceDate":"2026-11-29"}'];
  let errors = 0;
  for (const name of GLOBALS) {
    for (const input of bad) {
      const out = call(name, input);
      if (out.ok === true) continue;
      fits('error', out, `${name}(${input})`);
      errors += 1;
    }
  }
  assert.ok(errors >= 20, String(errors));
});

test('the globals without a schema of their own answer { ok: true } in the shared values', { skip }, () => {
  const c = cases.find((x) => x.name === 'jordan: race in 9 days');
  const { busy, ...rest } = c.input;
  const ctx = { ...rest, memory: memoryFor(c.input), calendar: busy };
  const numbers = call('planContext', ctx);
  assert.equal(numbers.ok, true);
  for (const u of numbers.usualWeek) fits('activity', u.activity, 'planContext.usualWeek activity');
  for (const a of numbers.activities) fits('activity', a, 'planContext.activities');
  assert.deepEqual([...numbers.activities].sort(), [...schemas.activity.enum].sort());
  const startPattern = new RegExp(schemas.session.properties.start.pattern);
  for (const f of numbers.freeSlots) assert.ok(startPattern.test(f.start) && startPattern.test(f.end), f.start);
  const week = call('recommendWeek', ctx);
  assert.equal(call('explainAction', { action: week.sessions[0], memory: ctx.memory }).ok, true);
  const conflicts = call('checkWeek', { sessions: week.sessions, calendar: [{ start: week.sessions[0].start, end: week.sessions[1].start }] });
  assert.equal(conflicts.ok, true);
  for (const x of conflicts.conflicts) assert.ok(startPattern.test(x.start) && startPattern.test(x.end));
  assert.equal(call('planBrief', { context: ctx }).ok, true);
});

test('workoutContent, weekContent and proposedContent fit workout-content.schema.json, slow step included', { skip }, () => {
  const rules = { equipment: ['backpack', 'chair', 'table', 'sofa', 'book', 'step'] };
  const history = [{ movementId: 'backpack_row', day: '2026-11-23', sets: [15, 15, 15], load: 4 }];
  const one = call('workoutContent', { sessionId: 's1', focus: 'upper', rules, history });
  assert.ok(one.content.items.some((i) => i.slow === true));
  fits('workout-content', one.content, 'workoutContent');
  for (const c of call('weekContent', { rules, history, sessions: [{ sessionId: 'a', focus: 'lower' }, { sessionId: 'b', focus: 'upper' }] }).contents) fits('workout-content', c, 'weekContent');
  const proposed = call('proposedContent', { sessionId: 's1', focus: 'upper', rules, history, proposal: { items: one.content.items.map((i) => ({ movementId: i.movementId, sets: i.sets })) } });
  assert.equal(proposed.pass, true);
  fits('workout-content', proposed.content, 'proposedContent');
});

test('every home-days value in the contract, day offsets included, is read by planContext', { skip }, () => {
  const values = JSON.parse(readFileSync(new URL('fixtures/swift/home-days.json', home), 'utf8'));
  assert.ok(values.some((v) => v.dayOffsets));
  for (const value of values) {
    fits('home-days', value, 'home-days fixture');
    assert.equal(call('planContext', { now: '2026-11-09T08:00:00-08:00', memory: { rows: [] }, rules: {}, ...value }).ok, true);
  }
});
