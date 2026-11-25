// Four weeks (28 daily rolls at local midnight) over each sample persona, with scripted taps, one forgotten day, one forgotten
// recommendation and one stopped fact type. No network, no clock: everything is a fixed string.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryStore, recordFeedback, forgetRecommendation, forgetFactKey, forgetFactType, factLines } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import { plannerText, MAX_WORDS } from '../src/memory/planner-text.mjs';
import { lintFact, lintWords } from '../src/facts/index.mjs';
import { makeMemoryIO } from './memory-io.mjs';

const ROOT = '/mem';
const USER = `usr_${'a1'.repeat(8)}`;
const FIRST = Date.UTC(2026, 9, 21);                      // the first midnight roll: 2026-10-21 (describes 10-20)
const date = (i) => new Date(FIRST + i * 86400000).toISOString().slice(0, 10);
const persona = (who) => JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${who}.json`, import.meta.url), 'utf8'));
const REC = (n) => `rec_${String(n).padStart(8, '0')}`;
const FORGET_DAY = '2026-11-02';
const FORGET_DAY_AT = 20;                                   // forgotten just before the midnight roll of date(20) = 2026-11-10
const COMPARISON = /ratio|rank|above|below|percent|%|average|baseline/;

/** Runs all 28 days and returns what a reader could see: every file after every roll, and every planner text. */
function scenario(snapshot) {
  const mem = makeMemoryIO();
  const store = new MemoryStore(ROOT, USER, { io: mem.io });
  const log = { planner: [], inProgress: [], rolls: [], mem, store };
  for (let i = 0; i < 28; i++) {
    const d = date(i);
    if (i === 5) recordFeedback(store, { recId: REC(1), activity: 'run', weekday: 3, hour: 7, action: 'declined', reason: 'too_early', now: `${d}T12:00:00.000Z` });
    if (i === 7) recordFeedback(store, { recId: REC(2), activity: 'run', weekday: 5, hour: 6, action: 'declined', reason: 'too_early', now: `${d}T12:00:00.000Z` });
    if (i === 9) recordFeedback(store, { recId: REC(3), activity: 'walk', weekday: 2, hour: 18, action: 'accepted', now: `${d}T12:00:00.000Z` });
    if (i === 15) assert.equal(forgetRecommendation(store, REC(1)), true);
    if (i === FORGET_DAY_AT) assert.equal(forgetFactKey(store, 'daily', FORGET_DAY), true);
    if (i === 24) assert.equal(forgetFactType(store, 'body'), true);
    const midnight = `${d}T00:00:00-08:00`;
    log.rolls.push(rollDay({ store, snapshot: { ...snapshot, exportDate: midnight }, now: midnight }));
    log.planner.push(plannerText(store));
    const evening = `${d}T18:00:00-08:00`;
    const inProgress = rollDay({ store, snapshot: { ...snapshot, exportDate: evening }, now: evening });
    log.inProgress.push({ result: inProgress, today: (store.read('rolling')?.facts ?? []).filter((f) => f.kind === 'today').map((f) => f.text), planner: plannerText(store) });
  }
  return log;
}

const files = (log) => log.mem.dump(ROOT);

for (const who of ['sedentary', 'moderate', 'half_marathon']) {
  const snapshot = persona(who);
  const run = scenario(snapshot);

  test(`${who}: every roll and every planner text succeeds, and the planner text stays within 600 words`, () => {
    for (const r of [...run.rolls, ...run.inProgress.map((x) => x.result)]) assert.equal(r.ok, true, r.error);
    for (const p of [...run.planner, ...run.inProgress.map((x) => x.planner)]) {
      assert.equal(p.ok, true, p.error);
      assert.ok(p.words <= MAX_WORDS, `${p.words} words`);
    }
  });

  test(`${who}: the same four weeks twice give identical files and identical planner text`, () => {
    const again = scenario(snapshot);
    assert.deepEqual(files(again), files(run));
    assert.deepEqual(again.planner.map((p) => p.text), run.planner.map((p) => p.text));
  });

  test(`${who}: under 14 days of data the rolling file holds only the days-of-data line and there is no profile`, () => {
    const thinRolls = run.rolls.filter((r) => r.thin);
    assert.ok(thinRolls.length >= 10, 'the first days are thin');
    run.planner.slice(0, thinRolls.length).forEach((p) => {
      const lines = p.text.split('\n').filter((l) => l.startsWith('- '));
      assert.equal(lines.filter((l) => /^- Days of data: \d+ \(ending \d{4}-\d{2}-\d{2}\)$/.test(l)).length, 1);
      assert.ok(!p.text.includes('about-user/profile.md'), 'no profile file while the history is thin');
      assert.ok(!lines.some((l) => /^- \[(daily|weekly)\]/.test(l) || COMPARISON.test(l)), lines.join('\n'));
    });
    assert.equal(run.rolls.at(-1).thin, false);
  });

  test(`${who}: no raw health data, timestamp or name in any file or planner text`, () => {
    const all = [...Object.values(files(run)), ...run.planner.map((p) => p.text), ...run.inProgress.map((x) => x.planner.text)].join('\n');
    const stamps = snapshot.workouts.flatMap((w) => [w.start, w.end]);
    const steps = snapshot.dailySummaries.map((s) => String(s.steps)).filter((s) => s.length >= 4);
    assert.ok(!all.includes(snapshot.persona.name), 'persona name');
    for (const s of stamps) assert.ok(!all.includes(s), `raw timestamp ${s}`);
    for (const s of steps) assert.ok(!new RegExp(`\\b${s}\\b`).test(all), `raw step count ${s}`);
    assert.ok(!/HKWorkoutActivityType|activeEnergy|distanceKm|heartRate/i.test(all));
  });

  test(`${who}: every fact line in the planner text passes lint`, () => {
    const last = run.planner.at(-1).text;
    const facts = last.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)).filter((l) => !/^health\/|^feedback\/|^history\//.test(l));
    assert.ok(facts.length > 10);
    for (const text of facts) {
      // Engine sentences have their own templates; the store's own lines are checked for banned words and shape (they end without a period).
      const engine = lintFact(text).length === 0;
      assert.deepEqual(engine ? [] : lintWords(`${text}.`), [], text);
    }
  });

  test(`${who}: a forgotten day never comes back, and its week says a day was left out`, () => {
    for (let i = FORGET_DAY_AT; i < 28; i++) {
      assert.ok(!run.planner[i].text.includes(`[daily] ${FORGET_DAY}`), `day line back at roll ${i}`);
    }
    const rolling = files(run)[`${USER}/health/rolling.md`];
    assert.ok(!rolling.includes(`[daily] ${FORGET_DAY}`));
    const week = /^- \[weekly\] Week of 2026-11-02: (\d+) workouts, (\d+) min( \(1 forgotten day left out\))?$/m.exec(rolling);
    assert.ok(week && week[3], 'the week of the forgotten day says so');
    const counted = new Set();
    for (const w of snapshot.workouts) {
      const day = w.start.slice(0, 10);
      if (day >= '2026-11-02' && day <= '2026-11-08' && day !== FORGET_DAY && w.durationMin >= 10) counted.add(`${w.activityType}|${w.start}`);
    }
    assert.equal(Number(week[1]), counted.size, 'the week count leaves the forgotten day out');
  });

  test(`${who}: a forgotten recommendation and a stopped fact type stay gone`, () => {
    const fb = files(run)[`${USER}/feedback/recommendations.md`] ?? '';
    assert.ok(!fb.includes(REC(1)));
    assert.ok(fb.includes(REC(2)));
    for (let i = 24; i < 28; i++) assert.ok(!/sleep|resting heart/i.test(run.planner[i].text), `body fact back at roll ${i}`);
    assert.equal(recordFeedback(run.store, { recId: REC(1), activity: 'run', weekday: 3, hour: 7, action: 'declined', reason: 'too_early', now: '2026-11-18T12:00:00.000Z' }).written, false);
  });

  test(`${who}: during the day only raw counts are written, never a comparison, rank or percentage`, () => {
    for (const x of run.inProgress) {
      assert.ok(x.today.length <= 1);
      for (const t of x.today) {
        assert.match(t, /^(So far today \(\d{4}-\d{2}-\d{2}\): \d+ counted workouts? \(10 minutes or more\) and [\d.]+ workout minutes, day not finished|\d{4}-\d{2}-\d{2} has no data so far: 0 of 1 days logged)/);
        assert.ok(!COMPARISON.test(t), t);
      }
    }
    // the only fact of the unfinished day is the raw one: the planner shows none of yesterday's day comparisons after the evening refresh
    const lastText = run.inProgress.at(-1).planner.text;
    assert.ok(!/rank \d+ of \d+ logged days/.test(lastText) && !/to the daily average/.test(lastText));
  });

  test(`${who}: the store reads every file back as valid (nothing was written around the store)`, () => {
    for (const name of ['profile', 'rolling', 'preferences', 'feedback', 'history']) {
      const doc = run.store.read(name);
      if (doc) assert.ok(factLines(run.store.view(name)).length === doc.facts.length);
    }
  });
}
