import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { computeFacts, FORGOTTEN_ERROR } from '../src/facts/index.mjs';
import { generateScenario, SCENARIO_KINDS } from '../src/scenarios/generate.mjs';

const dir = new URL('../fixtures/personas/', import.meta.url);
const personas = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
const plus = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dateOf = (w) => w.start.slice(0, 10);
const without = (snap, d) => ({ ...snap, workouts: snap.workouts.filter((w) => dateOf(w) !== d), dailySummaries: snap.dailySummaries.filter((s) => s.date !== d) });

// Both day modes: a midnight roll (completed) and a refresh at noon (in progress); exportDate = now.
function runs(snap, lastDay) {
  const mid = `${plus(lastDay, 1)}T00:00:00-08:00`;
  const noon = `${plus(lastDay, 1)}T12:00:00-08:00`;
  return [
    ['completed', { ...snap, exportDate: mid }, mid],
    ['in_progress', { ...snap, exportDate: noon }, noon],
  ];
}

function cases() {
  const out = [];
  for (const p of personas) out.push([p, p.dailySummaries.at(-1).date]);
  for (const kind of SCENARIO_KINDS) { const g = generateScenario(kind, 4); out.push([g.snapshot, g.now.slice(0, 10)]); }
  return out;
}

test('a forgotten day is an unlogged day: the facts equal those of a snapshot without that day\'s records, in both day modes', () => {
  let compared = 0;
  for (const [snap, lastDay] of cases()) {
    for (const back of [0, 1, 2, 5, 8, 15, 27]) {
      const d = plus(lastDay, -back);
      for (const [mode, s, now] of runs(snap, lastDay)) {
        const got = computeFacts(s, now, { forgottenDays: [d] });
        const expected = computeFacts(without(s, d), now);
        assert.equal(JSON.stringify(got), JSON.stringify(expected), `${mode} ${d}`);
        compared++;
      }
    }
  }
  assert.ok(compared > 100);
});

test('no number in any fact depends on a forgotten day\'s data', () => {
  for (const [snap, lastDay] of cases()) {
    for (const back of [0, 1, 3, 10]) {
      const d = plus(lastDay, -back);
      for (const [mode, s, now] of runs(snap, lastDay)) {
        // change everything recorded on that day: durations, sleep, resting heart rate, and add a workout
        const altered = {
          ...s,
          workouts: [...s.workouts.map((w) => (dateOf(w) === d ? { ...w, durationMin: w.durationMin * 3 + 17.13, effort: 9 } : w)), { activityType: 'Cycling', start: `${d}T05:15:00-08:00`, end: `${d}T06:15:00-08:00`, durationMin: 61.37 }],
          dailySummaries: s.dailySummaries.map((x) => (x.date === d ? { ...x, restingHeartRate: 111, sleepMinutes: { totalAsleep: 777 }, steps: 98765 } : x)),
        };
        const a = computeFacts(s, now, { forgottenDays: [d] });
        const b = computeFacts(altered, now, { forgottenDays: [d] });
        assert.equal(JSON.stringify(a), JSON.stringify(b), `${mode} ${d}`);
        assert.ok(!JSON.stringify(b).includes('61.37'), `${mode} ${d} leaks the forgotten workout`);
      }
    }
  }
});

test('the unlogged counts change, and the day is never a zero', () => {
  const [snap, lastDay] = cases()[1]; // a persona
  const [, s, now] = runs(snap, lastDay)[0]; // completed
  const d = plus(lastDay, -3);
  const base = computeFacts(s, now);
  const got = computeFacts(s, now, { forgottenDays: [d] });
  const get = (f, id) => f.find((x) => x.id === id);
  assert.equal(get(got, 'volume.28d').numbers.unloggedDays, get(base, 'volume.28d').numbers.unloggedDays + 1);
  assert.equal(get(got, 'volume.28d').numbers.loggedDays, get(base, 'volume.28d').numbers.loggedDays - 1);
  assert.ok(get(got, 'past.week_comparisons_skipped'), 'a week with a forgotten day is not fully logged');
  assert.ok(!get(got, 'past.week_vs_avg'));
  // the described day forgotten: no figures for it, and no comparison
  const dayOf = plus(lastDay, 0);
  const none = computeFacts(s, now, { forgottenDays: [dayOf] });
  assert.ok(get(none, 'volume.today_unlogged') && !get(none, 'volume.today') && !get(none, 'past.today_vs_avg'));
  // in progress: the unfinished day forgotten reads "no data so far"
  const [, sp, nowp] = runs(snap, lastDay)[1];
  const live = plus(lastDay, 1);
  const f = computeFacts(sp, nowp, { forgottenDays: [live] });
  assert.ok(get(f, 'volume.today_unlogged'));
});

test('dates outside the windows change nothing, duplicates are fine, and it combines with suppression', () => {
  const [snap, lastDay] = cases()[0];
  for (const [, s, now] of runs(snap, lastDay)) {
    const base = JSON.stringify(computeFacts(s, now));
    assert.equal(JSON.stringify(computeFacts(s, now, { forgottenDays: [] })), base);
    assert.equal(JSON.stringify(computeFacts(s, now, { forgottenDays: ['2031-05-05'] })), base); // in the future
    assert.equal(JSON.stringify(computeFacts(s, now, { forgottenDays: ['2019-01-01'] })), base); // long ago, no records
    const d = plus(lastDay, -4);
    assert.equal(JSON.stringify(computeFacts(s, now, { forgottenDays: [d, d, d] })), JSON.stringify(computeFacts(s, now, { forgottenDays: [d] })));
    const withSuppression = computeFacts(s, now, { forgottenDays: [d], suppressed: { types: ['body'] } });
    assert.ok(!withSuppression.some((x) => x.group === 'body'));
    assert.equal(JSON.stringify(withSuppression), JSON.stringify(computeFacts(s, now, { forgottenDays: [d] }).filter((x) => x.group !== 'body')));
  }
});

test('malformed forgottenDays are refused with a fixed text that does not echo the value', () => {
  const [snap, lastDay] = cases()[0];
  const [, s, now] = runs(snap, lastDay)[0];
  assert.equal(FORGOTTEN_ERROR, 'forgottenDays lists a malformed date');
  for (const bad of [['2026-02-30'], ['ZQXNAME'], ['2026-10-5'], ['2026-10-05T00:00:00Z'], [20261005], [null], [''], 'ZQXNAME', 5, { 0: '2026-10-05' }, ['2026-10-05', 'ZQXNAME']]) {
    assert.throws(() => computeFacts(s, now, { forgottenDays: bad }), (e) => e instanceof Error && e.message === FORGOTTEN_ERROR && !e.message.includes('ZQX'), JSON.stringify(bad));
  }
  // also under thin history
  const thin = generateScenario('thin', 1, { days: 3 });
  assert.throws(() => computeFacts(thin.snapshot, thin.now, { forgottenDays: ['nope'] }), (e) => e.message === FORGOTTEN_ERROR);
});
