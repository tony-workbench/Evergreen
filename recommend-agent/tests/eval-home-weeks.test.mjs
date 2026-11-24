// The thirty-week eval: every made-up week passes the code checks, and a week known to be wrong does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, makeWeek, grade, evaluate } from '../scripts/eval-home-weeks.mjs';

const codes = (fails) => fails.map((f) => f.code);

test('there are thirty cases, from no day at home to four, with and without equipment', () => {
  const list = cases();
  assert.equal(list.length, 30);
  assert.equal(new Set(list.map((c) => c.name)).size, 30);
  const homeDays = new Set(list.map((c) => 4 - Object.keys(c.dayKinds).length));
  assert.deepEqual([...homeDays].sort(), [0, 1, 2, 3, 4]);
  assert.ok(list.some((c) => c.rules.equipment.length === 0));
  assert.ok(list.some((c) => c.last === 'done') && list.some((c) => c.last === 'missed'));
});

test('every one of the thirty weeks passes every check', () => {
  const result = evaluate();
  assert.deepEqual(result.failures, []);
  assert.equal(result.passed, 30);
});

test('a week with a session on a rest day, an avoided movement and too long a session fails on each', () => {
  const c = cases()[0];
  const made = makeWeek(c);
  const rest = made.days.find((d) => d.kind === 'rest');
  const bad = structuredClone(made);
  bad.plan.sessions.push({ ...bad.plan.sessions[0], id: 'extra', start: `${rest.day}T13:00:00-08:00`, end: `${rest.day}T13:25:00-08:00` });
  bad.contents[0].items.push({ movementId: c.rules.avoid[0] ?? 'glute_bridge', sets: 6, reps: [10, 12], rest: 90, isNew: false });
  const avoiding = { ...c, rules: { ...c.rules, avoid: [c.rules.avoid[0] ?? 'glute_bridge'] } };
  const found = codes(grade(avoiding, bad));
  assert.ok(found.includes('session_on_rest_day'), found.join());
  assert.ok(found.includes('avoided_movement'), found.join());
  assert.ok(found.includes('session_too_long'), found.join());
});

test('a week whose sessions are too thin fails on the floor of sets', () => {
  const c = cases()[0];
  const made = makeWeek(c);
  const thin = { ...made, contents: made.contents.map((content) => ({ ...content, items: content.items.slice(0, 1).map((i) => ({ ...i, sets: 1 })) })) };
  assert.ok(codes(grade(c, thin)).includes('sets_below_floor'));
});
