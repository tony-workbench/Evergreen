// The thirty-week eval: AFTER (src/) holds every guard and every comparison's bar against the baseline recorded from the
// engine before this change set (c247786), each lever-only arm holds its own bar, and weeks known to be wrong do not pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  cases, makeWeek, grade, evaluate, verdict, knownBadWeek, loadEngine, runArm, leverProblems, worstMinutes,
  BASELINE, LEVERS_DIR, BEFORE_COMMIT, GUARDS, LEVERS, BARS, KNOWN_BAD_CODES, SCRIPTED_BAD,
} from '../scripts/eval-home-weeks.mjs';

const codes = (fails) => fails.map((f) => f.code);
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const engine = await loadEngine();
const result = evaluate(engine);
const hasBefore = (() => { try { execFileSync('git', ['cat-file', '-e', `${BEFORE_COMMIT}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } })();

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

test('AFTER holds every guard on all thirty weeks and every bar against BEFORE', () => {
  assert.deepEqual(result.failures, []);
  for (const g of GUARDS) assert.equal(result.guards[g], 30, g);
  assert.deepEqual(verdict(result, baseline), []);
});

test('the baseline comes from the engine before this change set, with one arm per lever and one patch per lever', () => {
  assert.equal(baseline.source.commit, BEFORE_COMMIT);
  assert.deepEqual(Object.keys(baseline.levers), LEVERS);
  assert.deepEqual(readdirSync(LEVERS_DIR).filter((f) => f.endsWith('.patch')).sort(), LEVERS.map((l) => `${l}.patch`).sort());
  for (const arm of [baseline.before, ...Object.values(baseline.levers)]) assert.deepEqual(Object.keys(arm.guards), GUARDS);
});

test('each comparison is live: BEFORE misses its bar, and the arm with only its lever holds it without lowering a guard', () => {
  for (const lever of LEVERS) {
    assert.ok(BARS[lever](baseline.before.outcomes[lever], baseline.before.outcomes[lever]).length > 0, `${lever}: BEFORE already holds the bar`);
    assert.deepEqual(leverProblems(lever, baseline.levers[lever], baseline.before), [], lever);
  }
});

test('BEFORE, rebuilt from git now, grades exactly as the committed baseline', { skip: !hasBefore && `${BEFORE_COMMIT} is not in this clone` }, async () => {
  assert.deepEqual(await runArm(null), baseline.before);
});

test('a guard below every week, a missed bar or the known-bad week passing stops the run', () => {
  assert.equal(verdict({ ...result, guards: { ...result.guards, floor: 29 } }, baseline).length, 1);
  assert.match(verdict({ ...result, outcomes: { ...result.outcomes, timing: { overTime: 1, sessions: 67 } } }, baseline)[0], /^timing:/);
  assert.match(verdict({ ...result, outcomes: { ...result.outcomes, earning: { ...result.outcomes.earning, earned: 0 } } }, baseline)[0], /fewer than BEFORE/);
  assert.match(verdict({ ...result, knownBad: [] }, baseline)[0], /known-bad week was not caught/);
});

test('a lever-only arm that lowers a guard below BEFORE fails, even when its own bar holds', () => {
  const arm = structuredClone(baseline.levers.timing);
  arm.guards.plan -= 1;
  assert.match(leverProblems('timing', arm, baseline.before)[0], /guard plan/);
});

test('the known-bad week fails on a rest-day session, an avoided movement, too long a session and too many sets', () => {
  const { c, made } = knownBadWeek(engine);
  const found = codes(grade(engine, c, made));
  for (const code of KNOWN_BAD_CODES) assert.ok(found.includes(code), `${code}: ${found.join()}`);
  assert.deepEqual(KNOWN_BAD_CODES.filter((code) => !result.knownBad.includes(code)), []);
});

test('a week whose sessions are too thin fails on the floor of sets, since one more set would fit', () => {
  const c = cases()[0];
  const made = makeWeek(engine, c);
  const thin = { ...made, contents: made.contents.map((content) => ({ ...content, items: content.items.slice(0, 1).map((i) => ({ ...i, sets: 1 })) })) };
  assert.ok(codes(grade(engine, c, thin)).includes('sets_below_floor'));
});

test('a week under the floor with no room for one more set is let off, and the same week with longer sessions is not', () => {
  const c = cases()[4];
  const made = makeWeek(engine, c);
  assert.ok(!codes(grade(engine, c, made)).includes('sets_below_floor'), 'two 20-minute sessions with no room');
  const roomy = { ...c, rules: { ...c.rules, sessionMinutes: { min: 15, max: 60 } } };
  assert.ok(codes(grade(engine, roomy, made)).includes('sets_below_floor'), 'the same sessions with 60 minutes each');
});

test('a rainy week that drops a session or changes a movement fails the rain check', () => {
  const c = cases().find((x) => x.rain.length >= 2);
  const made = makeWeek(engine, c);
  const dropped = { ...made, plan: { ...made.plan, sessions: made.plan.sessions.filter((s) => !s.start.startsWith(c.rain[0])) } };
  assert.ok(codes(grade(engine, c, dropped)).includes('rain_day_dropped'));
  const changed = { ...made, contents: made.contents.map((x, k) => (k ? x : { ...x, items: x.items.slice(1) })) };
  assert.ok(codes(grade(engine, c, changed)).includes('rain_changed_movements'));
});

test('after a week all done something steps up, and after a week all missed nothing does', () => {
  const done = cases().find((x) => x.last === 'done' && x.homeDays.length > 0);
  const made = makeWeek(engine, done);
  // Only movements done last week, none of them slower: nothing steps up.
  const doneBefore = (i) => made.history.some((h) => h.movementId === i.movementId);
  const flat = { ...made, contents: made.contents.map((x) => ({ ...x, items: x.items.filter(doneBefore).map(({ slow, ...i }) => i) })) };
  assert.ok(codes(grade(engine, done, flat)).includes('no_step_after_done_week'));
  const missed = cases().find((x) => x.last === 'missed' && x.homeDays.length > 0);
  const m = makeWeek(engine, missed);
  const pushed = { ...m, contents: m.contents.map((x, k) => (k ? x : { ...x, items: x.items.map((i, j) => (j ? i : { ...i, slow: true })) })) };
  assert.ok(codes(grade(engine, missed, pushed)).includes('step_after_missed_week'));
});

test('a session cut to three movements counts under four, and one of six counts over five', () => {
  const c = cases()[0];
  const made = makeWeek(engine, c);
  const cut = { ...made, contents: made.contents.map((x, k) => (k ? x : { ...x, items: x.items.slice(0, 3) })) };
  assert.ok(codes(grade(engine, c, cut)).includes('under_four'));
  const six = { ...made, contents: made.contents.map((x, k) => (k ? x : { ...x, items: [...x.items, ...x.items].slice(0, 6).map((i) => ({ ...i, sets: 1 })) })) };
  assert.ok(codes(grade(engine, c, six)).includes('over_five'));
});

test('more than ten sets of a pattern in a week, or a session too long at worst, is found', () => {
  const c = cases()[0];
  const made = makeWeek(engine, c);
  const piled = { ...made, contents: made.contents.map((x) => ({ ...x, items: x.items.map((i) => ({ ...i, sets: 6 })) })) };
  const found = codes(grade(engine, c, piled));
  assert.ok(found.includes('sets_above_ten') && found.includes('session_over_time'), found.join());
});

test('the worst-case timer counts the top of every range, the slow step, the rests and setting up', () => {
  const item = { movementId: 'sit_to_stand', sets: 3, reps: [8, 12], rest: 60 };   // tempo 3-1-1: 5 s a rep, 7 s slow
  assert.equal(worstMinutes([item]), Math.ceil((3 * 12 * 5 + 2 * 60 + 30) / 60));
  assert.equal(worstMinutes([{ ...item, slow: true }]), Math.ceil((3 * 12 * 7 + 2 * 60 + 30) / 60));
});

test('the scripted bad picks each fail with their own code, and good picks pass', () => {
  const c = cases()[0];
  const made = makeWeek(engine, c);
  const content = made.contents[0];
  const ask = (items) => engine.proposedContent({ proposal: { items }, sessionId: content.sessionId, focus: content.focus, rules: c.rules, history: made.history, week: made.contents, rulesWeek: made.contents });
  assert.equal(ask(content.items.map((i) => ({ movementId: i.movementId, sets: i.sets })).reverse()).pass, true);
  for (const [name, bad] of Object.entries(SCRIPTED_BAD)) {
    const r = ask(bad.items(content.items));
    assert.equal(r.pass, false, name);
    assert.ok(r.violations.some((v) => v.code === bad.code), `${name}: ${r.violations.map((v) => v.code).join()}`);
  }
  // The picks guard itself goes red when good picks are refused: here, picks with an avoided movement in them.
  const bad = knownBadWeek(engine);
  assert.ok(codes(grade(engine, bad.c, bad.made)).includes('good_picks_refused'));
});
