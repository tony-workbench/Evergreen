// The thirty-week eval: every made-up week passes the code checks, the counts match the committed baseline, and weeks
// known to be wrong do not pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cases, makeWeek, grade, evaluate, verdict, knownBadWeek, BASELINE, CHECKS } from '../scripts/eval-home-weeks.mjs';

const codes = (fails) => fails.map((f) => f.code);
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const result = evaluate();

test('there are thirty cases: no day at home to four, rain or none, last week all done or all missed, avoid lists', () => {
  const list = cases();
  assert.equal(list.length, 30);
  assert.equal(new Set(list.map((c) => c.name)).size, 30);
  const homeDays = new Set(list.map((c) => 4 - Object.keys(c.dayKinds).length));
  assert.deepEqual([...homeDays].sort(), [0, 1, 2, 3, 4]);
  assert.ok(list.some((c) => c.rules.equipment.length === 0));
  assert.ok(list.some((c) => c.last === 'done') && list.some((c) => c.last === 'missed'));
  assert.ok(list.some((c) => c.rain.length === 0) && list.some((c) => c.rain.length === 1) && list.some((c) => c.rain.length >= 3));
  assert.ok(new Set(list.map((c) => c.rules.avoid.join())).size >= 3);
});

test('every one of the thirty weeks passes every check', () => {
  assert.deepEqual(result.failures, []);
  assert.equal(result.passed, 30);
});

test('the run matches the committed baseline, which holds every check at all thirty weeks', () => {
  assert.deepEqual(Object.keys(baseline.checks), CHECKS);
  for (const k of CHECKS) assert.equal(baseline.checks[k], 30, k);
  assert.deepEqual(result.checks, baseline.checks);
  assert.deepEqual(verdict(result, baseline), []);
});

test('a check below the baseline, or the known-bad week passing, stops the run', () => {
  assert.equal(verdict({ ...result, checks: { ...result.checks, sets: 29 } }, baseline).length, 1);
  assert.match(verdict({ ...result, knownBad: [] }, baseline)[0], /known-bad week was not caught/);
});

test('the known-bad week fails on a rest-day session, an avoided movement and too long a session', () => {
  const { c, made } = knownBadWeek();
  const found = codes(grade(c, made));
  for (const code of ['session_on_rest_day', 'rest_day_rule', 'avoided_movement', 'session_too_long']) assert.ok(found.includes(code), `${code}: ${found.join()}`);
  assert.deepEqual(result.knownBad, baseline.knownBad);
});

test('a week whose sessions are too thin fails on the floor of sets', () => {
  const c = cases()[0];
  const made = makeWeek(c);
  const thin = { ...made, contents: made.contents.map((content) => ({ ...content, items: content.items.slice(0, 1).map((i) => ({ ...i, sets: 1 })) })) };
  assert.ok(codes(grade(c, thin)).includes('sets_below_floor'));
});

test('a rainy week that drops a session or changes a movement fails the rain check', () => {
  const c = cases().find((x) => x.rain.length >= 2);
  const made = makeWeek(c);
  const dropped = { ...made, plan: { ...made.plan, sessions: made.plan.sessions.filter((s) => !s.start.startsWith(c.rain[0])) } };
  assert.ok(codes(grade(c, dropped)).includes('rain_day_dropped'));
  const changed = { ...made, contents: made.contents.map((x, k) => (k ? x : { ...x, items: x.items.slice(1) })) };
  assert.ok(codes(grade(c, changed)).includes('rain_changed_movements'));
});

test('after a week all done something steps up, and after a week all missed nothing does', () => {
  const done = cases().find((x) => x.last === 'done' && 4 - Object.keys(x.dayKinds).length > 0);
  const made = makeWeek(done);
  const flat = { ...made, contents: made.contents.map((x) => ({ ...x, items: x.items.map(({ slow, ...i }) => i) })) };
  assert.ok(codes(grade(done, flat)).includes('no_step_after_done_week'));
  const missed = cases().find((x) => x.last === 'missed' && 4 - Object.keys(x.dayKinds).length > 0);
  const m = makeWeek(missed);
  const pushed = { ...m, contents: m.contents.map((x, k) => (k ? x : { ...x, items: x.items.map((i, j) => (j ? i : { ...i, slow: true })) })) };
  assert.ok(codes(grade(missed, pushed)).includes('step_after_missed_week'));
});
