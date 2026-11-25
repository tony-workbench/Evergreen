import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { completedFacts } from './helpers/completed-day.mjs';
import { computeFacts as engine } from '../src/facts/index.mjs';
import { validateSnapshot } from '../src/contract/index.mjs';
import { generateScenario, SCENARIO_KINDS } from '../src/scenarios/generate.mjs';

const dir = new URL('../fixtures/personas/', import.meta.url);
const personas = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
const find = (facts, id) => facts.find((f) => f.id === id);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('abstains below 14 days: only the not-enough-history statement, no comparison', () => {
  for (const days of [3, 7, 13]) {
    const { snapshot, now } = generateScenario('thin', 5, { days });
    const facts = completedFacts(snapshot, now);
    assert.equal(facts.length, 1, `${days} days`);
    assert.equal(facts[0].id, 'history.thin');
    assert.equal(facts[0].text, `${days} days of data; fewer than 14.`);
    assert.deepEqual(facts[0].numbers, { daysOfData: days, daysNeeded: 14, spanDays: days }); // the thin scenario logs consecutive days
    assert.equal(facts[0].window, `${days}d`); // the span from the first to the last logged date, not `day`
    assert.doesNotMatch(facts[0].text, /not enough|needed/i);
  }
  assert.equal(completedFacts(generateScenario('thin', 5, { days: 1 }).snapshot, '2026-11-18T21:00:00-08:00')[0].text, '1 day of data; fewer than 14.');
  const empty = completedFacts({ exportDate: '2026-11-18T07:30:00-08:00', persona: { key: 'x' }, dailySummaries: [], workouts: [] }, '2026-11-18T07:30:00-08:00');
  assert.equal(empty[0].numbers.daysOfData, 0);
});

test('writes comparisons from 14 days on', () => {
  for (const days of [14, 28, 60]) {
    const { snapshot, now } = generateScenario('thin', 5, { days });
    const facts = completedFacts(snapshot, now);
    assert.ok(facts.length > 10, `${days} days`);
    assert.ok(!find(facts, 'history.thin'));
    assert.ok(find(facts, 'past.week_vs_avg'));
  }
});

test('states coverage when days are missing', () => {
  for (const seed of SEEDS) {
    const { snapshot, now, planted } = generateScenario('missing_days', seed);
    const facts = completedFacts(snapshot, now);
    const missing = planted[0].dates.length;
    assert.equal(find(facts, 'volume.28d').numbers.loggedDays, 28 - missing);
    assert.match(find(facts, 'volume.28d').text, new RegExp(`on ${28 - missing} logged days`));
    assert.equal(find(facts, 'volume.28d').numbers.unloggedDays, missing);
    assert.match(find(facts, 'volume.28d').text, /^Counted in the last 28 days \(.*; workouts of 10 minutes or more\)/);
    // a week with an unlogged day gets no comparison, only the statement with the counts
    const unloggedInWeek = planted[0].dates.filter((d) => d > '2026-11-11').length;
    assert.equal(find(facts, 'volume.week').numbers.unloggedDays, unloggedInWeek);
    if (unloggedInWeek > 0) {
      assert.deepEqual(find(facts, 'past.week_comparisons_skipped').numbers, { loggedDays: 7 - unloggedInWeek, windowDays: 7 });
      for (const id of ['past.week_vs_avg', 'past.week_rank', 'load.ratio', 'goal.workouts_per_week']) assert.ok(!find(facts, id), id);
    } else assert.ok(find(facts, 'past.week_vs_avg'));
  }
});

test('missing days are not counted as zero minutes', () => {
  const { snapshot, now } = generateScenario('missing_days', 3);
  const f = completedFacts(snapshot, now);
  const avg = find(f, 'past.today_vs_avg').numbers;
  const total = snapshot.workouts
    .filter((w) => w.start.slice(0, 10) < now.slice(0, 10) && w.start.slice(0, 10) >= '2026-10-21')
    .reduce((s, w) => s + w.durationMin, 0);
  assert.ok(Math.abs(avg.averageMinutesPerDay - total / avg.loggedDays) < 0.01);
  assert.ok(avg.loggedDays < 28);
});

test('a planted spike day is detected by a matching fact', () => {
  for (const seed of SEEDS) {
    const { snapshot, now, planted } = generateScenario('spike', seed);
    const facts = completedFacts(snapshot, now);
    const spike = find(facts, 'past.today_vs_highest');
    assert.ok(spike, `seed ${seed}: spike statement`);
    assert.ok(spike.numbers.ratio >= 2);
    assert.equal(spike.numbers.minutes, planted[0].minutes);
    assert.equal(find(facts, 'past.today_rank').numbers.rank, 1);
    assert.match(find(facts, 'past.today_vs_avg').text, /above/);
  }
});

test('a planted missed week is detected by matching facts', () => {
  for (const seed of SEEDS) {
    const { snapshot, now } = generateScenario('missed_week', seed);
    const facts = completedFacts(snapshot, now);
    assert.equal(find(facts, 'volume.week').numbers.workouts, 0);
    assert.equal(find(facts, 'regularity.per_week').numbers.perWeek[0], 0);
    assert.ok(find(facts, 'regularity.days_since_last').numbers.daysSinceLast >= 7);
    assert.ok(find(facts, 'regularity.longest_gap').numbers.gapDays >= 7);
    assert.equal(find(facts, 'past.week_vs_avg').numbers.ratio, 0);
    assert.equal(find(facts, 'past.week_vs_avg').numbers.percent, null); // no percentage for a value of 0
    assert.match(find(facts, 'past.week_vs_avg').text, /\(ratio 0, \d+ logged days before this week\)/);
    assert.equal(find(facts, 'past.week_vs_avg').numbers.direction, 'below');
  }
});

test('a comeback after a gap shows the gap and the resumed week', () => {
  for (const seed of SEEDS) {
    const { snapshot, now, planted } = generateScenario('comeback', seed);
    const facts = completedFacts(snapshot, now);
    assert.equal(find(facts, 'regularity.longest_gap').numbers.gapDays, planted[0].gapDays);
    const pw = find(facts, 'regularity.per_week').numbers.perWeek;
    assert.ok(pw[0] > 0 && pw[1] === 0);
  }
});

test('steady noise produces no spike statement on any day', () => {
  for (const seed of SEEDS) {
    const { snapshot, now } = generateScenario('steady', seed);
    const lastDay = now.slice(0, 10);
    for (let back = 0; back < 28; back++) {
      const d = new Date(Date.parse(`${lastDay}T12:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
      const facts = completedFacts({ ...snapshot, exportDate: `${d}T21:00:00-08:00` }, `${d}T21:00:00-08:00`);
      assert.ok(!find(facts, 'past.today_vs_highest'), `seed ${seed} ${d}`);
    }
  }
});

test('personas produce no spike statement on any of their last 28 days except real outliers', () => {
  // Real persona days may include an unusually long session; the statement must then carry a ratio of at least 2.
  for (const snap of personas) {
    for (const s of snap.dailySummaries.slice(-28)) {
      const f = find(completedFacts({ ...snap, exportDate: `${s.date}T23:00:00-08:00` }, `${s.date}T23:00:00-08:00`), 'past.today_vs_highest');
      if (f) assert.ok(f.numbers.ratio >= 2);
    }
  }
});

test('duplicate workouts are counted once', () => {
  for (const seed of SEEDS) {
    const { snapshot, now, planted } = generateScenario('duplicates', seed);
    assert.ok(planted[0].indices.length > 3);
    const clean = { ...snapshot, workouts: snapshot.workouts.filter((_, i) => !planted[0].indices.includes(i)) };
    assert.deepEqual(completedFacts(snapshot, now), completedFacts(clean, now));
  }
});

test('local dates come from the offset in the timestamp, across a time-zone change', () => {
  for (const seed of SEEDS) {
    const { snapshot, now, planted } = generateScenario('tz_change', seed);
    const late = planted[0].lateWorkout;
    assert.equal(late.start.slice(0, 10), late.localDate);
    // On the local evening of the late workout the workout is today's; its UTC date would be the next day.
    const f = completedFacts(snapshot, `${late.localDate}T23:50:00-08:00`);
    const today = find(f, 'volume.today').numbers;
    assert.equal(today.date, late.localDate);
    assert.ok(today.minutes >= late.minutes);
    assert.ok(today.workouts >= 1);
    const yoga = find(f, 'mix.count').numbers.byActivity.Yoga;
    assert.ok(yoga >= 1);
    // Just after the change, in the new offset, the workout is still counted once on the previous day.
    const after = completedFacts(snapshot, now);
    assert.ok(find(after, 'mix.count').numbers.byActivity.Yoga >= 1);
  }
});

test('records after now are ignored', () => {
  const { snapshot } = generateScenario('steady', 4);
  const early = completedFacts(snapshot, '2026-11-10T21:00:00-08:00');
  const cut = { ...snapshot, workouts: snapshot.workouts.filter((w) => w.start.slice(0, 10) <= '2026-11-10'), dailySummaries: snapshot.dailySummaries.filter((s) => s.date <= '2026-11-10') };
  assert.deepEqual(early, completedFacts(cut, '2026-11-10T21:00:00-08:00'));
});

test('same input gives byte-identical output, whatever the order or the clock type', () => {
  for (const kind of SCENARIO_KINDS) {
    const { snapshot, now } = generateScenario(kind, 11);
    const a = JSON.stringify(completedFacts(snapshot, now));
    assert.equal(a, JSON.stringify(completedFacts(JSON.parse(JSON.stringify(snapshot)), now)));
    const shuffled = { ...snapshot, workouts: [...snapshot.workouts].reverse(), dailySummaries: [...snapshot.dailySummaries].reverse() };
    assert.equal(a, JSON.stringify(completedFacts(shuffled, now)), kind);
    if (kind !== 'tz_change') assert.equal(a, JSON.stringify(completedFacts(snapshot, new Date(Date.parse(now)))), kind);
  }
  for (const persona of personas) {
    const now = `${persona.dailySummaries.at(-1).date}T23:00:00-08:00`;
    const snap = { ...persona, exportDate: now };
    assert.equal(JSON.stringify(completedFacts(snap, now)), JSON.stringify(completedFacts(snap, new Date(Date.parse(now)))));
  }
});

test('the input is not changed', () => {
  const { snapshot, now } = generateScenario('duplicates', 2);
  const before = JSON.stringify(snapshot);
  completedFacts(snapshot, now);
  assert.equal(JSON.stringify(snapshot), before);
});

test('the generator is deterministic and differs between seeds', () => {
  for (const kind of SCENARIO_KINDS) {
    assert.deepEqual(generateScenario(kind, 5), generateScenario(kind, 5));
    assert.notDeepEqual(generateScenario(kind, 5).snapshot, generateScenario(kind, 6).snapshot);
  }
  assert.throws(() => generateScenario('nope', 1));
});

test('no raw health value reaches any fact; only a resting heart rate daily average (3 or more readings) is a heart-rate figure', () => {
  // Plant a distinct raw value in every field the engine must never output. Each value is unique, so a match cannot be a coincidence.
  let n = 0;
  const plant = (snap) => {
    const planted = [];
    const uniq = (base) => { const v = Number((base + (n++) * 0.01).toFixed(2)); planted.push(v); return v; };
    const out = structuredClone(snap);
    out.workouts = out.workouts.map((w) => ({
      ...w,
      heartRate: { avg: uniq(1000.01), min: uniq(2000.01), max: uniq(3000.01) },
      distanceKm: uniq(4000.01),
      activeEnergyKcal: uniq(4500.01),
      route: [{ lat: uniq(5000.01), lon: uniq(6000.01) }],
      samples: [{ t: w.start, bpm: uniq(7000.01) }],
    }));
    out.dailySummaries = out.dailySummaries.map((d) => ({
      ...d,
      steps: uniq(9000.01),
      sleepMinutes: { ...(d.sleepMinutes || {}), core: uniq(8000.01), deep: uniq(8500.01), rem: uniq(8700.01), awake: uniq(8900.01) },
    }));
    return { snap: out, planted };
  };
  const cases = personas.map((p) => { const now = `${p.dailySummaries.at(-1).date}T23:00:00-08:00`; return [{ ...p, exportDate: now }, now]; });
  for (const kind of SCENARIO_KINDS) { const g = generateScenario(kind, 3); cases.push([g.snapshot, g.now]); }
  let checked = 0;
  for (const [base, now] of cases) {
    const { snap, planted } = plant(base);
    const facts = completedFacts(snap, now);
    const serialized = JSON.stringify(facts);
    for (const v of planted) {
      const token = String(v);
      assert.ok(!new RegExp(`(?<![\\d.])${token.replace('.', '\\.')}(?![\\d])`).test(serialized), `planted raw value ${token} found in facts`);
      checked++;
    }
    // Same facts as without the planted fields: raw data does not influence the output at all.
    assert.equal(serialized, JSON.stringify(completedFacts(base, now)));
    // The only heart-rate figure allowed: the resting heart rate daily average, from at least 3 readings in each window.
    for (const f of facts) {
      const mentions = /heart/i.test(f.text) || /heart/i.test(Object.keys(f.numbers).join(' '));
      if (f.id === 'body.resting_hr') {
        assert.ok(f.numbers.logged7 >= 3 && f.numbers.logged28 >= 3, 'resting heart rate average needs 3 or more readings');
        assert.deepEqual(Object.keys(f.numbers).sort(), ['average28', 'average7', 'difference', 'direction', 'exact', 'logged28', 'logged7']);
      } else assert.ok(!mentions, `${f.id} mentions heart rate`);
      assert.doesNotMatch(f.text, /route|sample|latitude|longitude|distance|kcal|\bkm\b/i);
    }
  }
  assert.ok(checked > 200);
});

test('a target in the snapshot adds a progress fact, and none is invented without one', () => {
  const { snapshot, now } = generateScenario('steady', 2);
  assert.ok(!find(completedFacts(snapshot, now), 'goal.target_progress'));
  const f = find(completedFacts({ ...snapshot, target: { workoutsPerWeek: 5 } }, now), 'goal.target_progress');
  assert.equal(f.numbers.target, 5);
  assert.equal(f.numbers.workouts7, 4);
  assert.equal(f.numbers.percentOfTarget, 80);
});

test('hand-checked numbers on a tiny history', () => {
  const summaries = [];
  const workouts = [];
  for (let i = 0; i < 20; i++) {
    const date = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    summaries.push({ date, restingHeartRate: 50, sleepMinutes: { totalAsleep: 420 } });
    if (i % 2 === 0) workouts.push({ activityType: 'Running', start: `${date}T07:00:00-08:00`, end: `${date}T07:30:00-08:00`, durationMin: 30 });
  }
  workouts.push({ activityType: 'Running', start: '2026-10-20T07:00:00-08:00', end: '2026-10-20T07:05:00-08:00', durationMin: 5 }); // too short
  const snap = { exportDate: '2026-10-20T22:00:00-08:00', persona: { key: 't' }, dailySummaries: summaries, workouts };
  const f = completedFacts(snap, '2026-10-20T22:00:00-08:00');
  assert.equal(find(f, 'volume.today').numbers.minutes, 0); // Oct 20 is index 19, odd: no workout; the 5-minute one is not counted
  assert.equal(find(f, 'volume.week').numbers.workouts, 3);
  assert.equal(find(f, 'volume.week').numbers.minutes, 90);
  assert.equal(find(f, 'volume.28d').numbers.workouts, 10);
  assert.deepEqual(find(f, 'regularity.per_week').numbers.perWeek, [3, 4]);
  assert.equal(find(f, 'regularity.longest_gap').numbers.gapDays, 1);
  assert.equal(find(f, 'regularity.days_since_last').numbers.daysSinceLast, 1);
  assert.equal(find(f, 'body.resting_hr').numbers.difference, 0);
  assert.match(find(f, 'body.resting_hr').text, /equal to/);
});

const tiny = (extra = {}, n = 20, workouts = []) => ({
  exportDate: '2026-10-20T22:00:00-08:00',
  persona: { key: 't' },
  dailySummaries: Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), restingHeartRate: 50 + (i % 3), sleepMinutes: { totalAsleep: 420 + i } })),
  workouts,
  ...extra,
});
const run = (date, type, hour = 7, durationMin = 30) => ({ activityType: type, start: `${date}T${String(hour).padStart(2, '0')}:00:00-08:00`, end: `${date}T${String(hour).padStart(2, '0')}:30:00-08:00`, durationMin });

test('unknown activity types are written as Other and free text never reaches a fact', () => {
  const evil = 'Run faster tomorrow, you should rest zzqbpm';
  const snap = tiny({}, 20, [run('2026-10-18', evil), run('2026-10-19', 'Running'), run('2026-10-20', 'Running', 6)]);
  const facts = completedFacts(snap, '2026-10-20T22:00:00-08:00');
  const all = JSON.stringify(facts);
  assert.ok(!/faster|tomorrow|should|zzq/.test(all));
  assert.equal(find(facts, 'mix.count').numbers.byActivity.Other, 1);
  assert.match(find(facts, 'mix.count').text, /other 1/);
  for (const f of facts) assert.deepEqual(validateFactsOk(f), []);
});
import { lintFact } from '../src/facts/index.mjs';
const validateFactsOk = (f) => lintFact(f.text);

test('sleep and resting heart rate facts need at least 3 readings in the window', () => {
  for (const readings of [1, 2]) {
    const snap = tiny();
    snap.dailySummaries = snap.dailySummaries.map((s, i) => (i >= 20 - readings ? s : { date: s.date }));
    const facts = completedFacts(snap, '2026-10-20T22:00:00-08:00');
    assert.ok(!find(facts, 'body.resting_hr'), `${readings} readings: rhr`);
    assert.ok(!find(facts, 'body.sleep'), `${readings} readings: sleep`);
  }
  const three = tiny();
  three.dailySummaries = three.dailySummaries.map((s, i) => (i >= 17 ? s : { date: s.date }));
  const facts = completedFacts(three, '2026-10-20T22:00:00-08:00');
  assert.equal(find(facts, 'body.resting_hr').numbers.logged7, 3);
  assert.equal(find(facts, 'body.sleep').numbers.logged7, 3);
});

test('a day with only a short workout is a logged day', () => {
  const snap = tiny();
  snap.dailySummaries = snap.dailySummaries.filter((s) => s.date !== '2026-10-10');
  const without = completedFacts(snap, '2026-10-20T22:00:00-08:00');
  assert.equal(find(without, 'volume.28d').numbers.loggedDays, 19);
  snap.workouts = [run('2026-10-10', 'Walking', 8, 5)];
  const withShort = completedFacts(snap, '2026-10-20T22:00:00-08:00');
  assert.equal(find(withShort, 'volume.28d').numbers.loggedDays, 20);
  assert.equal(find(withShort, 'volume.28d').numbers.workouts, 0);
  // a snapshot whose only data on a day is a short workout still reaches 14 days of data
  const thin = { exportDate: '2026-10-14T20:00:00-08:00', persona: { key: 't' }, dailySummaries: [], workouts: Array.from({ length: 14 }, (_, i) => run(`2026-10-${String(1 + i).padStart(2, '0')}`, 'Walking', 8, 5)) };
  assert.ok(!find(completedFacts(thin, '2026-10-14T20:00:00-08:00'), 'history.thin'));
});

test('days since the last workout uses the latest local date, also across a time-zone change', () => {
  // A: 2026-11-10 23:30 -08:00 = 07:30Z on 11-11 (later instant, earlier local date).
  // B: 2026-11-11 01:00 -05:00 = 06:00Z on 11-11 (earlier instant, later local date).
  const base = tiny({}, 20, []);
  base.dailySummaries = Array.from({ length: 20 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 25 + i)).toISOString().slice(0, 10) }));
  base.workouts = [
    { activityType: 'Running', start: '2026-11-10T23:30:00-08:00', end: '2026-11-11T00:00:00-08:00', durationMin: 30 },
    { activityType: 'Running', start: '2026-11-11T01:00:00-05:00', end: '2026-11-11T01:30:00-05:00', durationMin: 30 },
  ];
  const now = '2026-11-13T12:00:00-05:00';
  for (const order of [base.workouts, [...base.workouts].reverse()]) {
    const f = find(completedFacts({ ...base, workouts: order }, now), 'regularity.days_since_last');
    assert.equal(f.numbers.lastWorkoutDate, '2026-11-11');
    assert.equal(f.numbers.daysSinceLast, 2);
  }
});

test('input order does not change the facts when summaries are identical duplicates', () => {
  const snap = tiny();
  const dup = { ...snap, dailySummaries: [...snap.dailySummaries, { ...snap.dailySummaries[3] }] };
  assert.equal(JSON.stringify(completedFacts(dup, '2026-10-20T22:00:00-08:00')), JSON.stringify(completedFacts(snap, '2026-10-20T22:00:00-08:00')));
});

test('a workout that has not ended by now is ignored everywhere', () => {
  // the unfinished workout is today's (Oct 20, 21:30 to 22:30); now is 22:00, so the day is in progress
  const snap = tiny({}, 20, [run('2026-10-19', 'Running', 7), { activityType: 'Running', start: '2026-10-20T21:30:00-08:00', end: '2026-10-20T22:30:00-08:00', durationMin: 60 }]);
  const at = (hhmm) => { const n = `2026-10-20T${hhmm}:00-08:00`; return engine({ ...snap, exportDate: n }, n, { dayMode: 'in_progress' }); };
  const f = at('22:00');
  assert.equal(find(f, 'volume.today_so_far').numbers.minutes, 0);
  assert.equal(find(f, 'volume.today_so_far').numbers.workouts, 0);
  assert.equal(find(f, 'volume.28d').numbers.minutes, 30); // Oct 19's workout
  assert.equal(find(f, 'regularity.days_since_last').numbers.daysSinceLast, 0); // measured from the last completed day, Oct 19
  // once it has ended it counts, in the so-far fact only
  const g = at('22:30');
  assert.equal(find(g, 'volume.today_so_far').numbers.minutes, 60);
  assert.equal(JSON.stringify(stripToday(f)), JSON.stringify(stripToday(g)));
  // and at the midnight that ends the day it counts in full
  const m = '2026-10-21T00:00:00-08:00';
  assert.equal(find(engine({ ...snap, exportDate: m }, m), 'volume.today').numbers.minutes, 60);
  // a day that only has an unfinished workout is not made logged by it
  const only = tiny({}, 20, []);
  only.dailySummaries = only.dailySummaries.filter((d) => d.date !== '2026-10-20');
  only.workouts = [snap.workouts[1]];
  const n = '2026-10-20T22:00:00-08:00';
  assert.ok(find(engine({ ...only, exportDate: n }, n, { dayMode: 'in_progress' }), 'volume.today_unlogged'));
});

test('coverage covers workout averages only, and each body fact states its own count', () => {
  const snap = tiny({}, 20, [run('2026-10-18', 'Running'), run('2026-10-12', 'Running')]);
  snap.dailySummaries = snap.dailySummaries.map((d, i) => (i % 2 ? { date: d.date } : d)); // readings on half of the days
  const f = completedFacts(snap, '2026-10-20T22:00:00-08:00');
  assert.match(find(f, 'coverage.28d').text, /the 28-day load average uses 20 days/);
  assert.doesNotMatch(find(f, 'coverage.28d').text, /workout averages|28-day averages/);
  // baselines carry their own windows and counts in their own facts
  assert.notEqual(find(f, 'past.week_vs_avg').numbers.loggedDays, 20);
  assert.match(find(f, 'past.week_vs_avg').text, new RegExp(`\\(${find(f, 'past.week_vs_avg').numbers.loggedDays} logged days before this week`));
  assert.match(find(f, 'past.today_vs_avg').text, new RegExp(`${find(f, 'past.today_vs_avg').numbers.loggedDays} logged days\\b`));
  assert.match(find(f, 'goal.workouts_per_week').text, /the 28 days before this week/);
  assert.equal(find(f, 'coverage.28d').numbers.loggedDays, 20);
  const sleep = find(f, 'body.sleep');
  const hr = find(f, 'body.resting_hr');
  assert.match(sleep.text, new RegExp(`from ${sleep.numbers.logged7} nights.*from ${sleep.numbers.logged28} nights`));
  assert.match(hr.text, new RegExp(`from ${hr.numbers.logged28} days with a reading`));
  assert.equal(sleep.numbers.logged28, 10);
});

test('duplicates with the same instant but different offsets give identical output in either input order', () => {
  const a = { activityType: 'Running', start: '2026-10-18T23:30:00-08:00', end: '2026-10-19T00:00:00-08:00', durationMin: 30 };
  const b = { activityType: 'Running', start: '2026-10-19T02:30:00-05:00', end: '2026-10-19T03:00:00-05:00', durationMin: 30 };
  assert.equal(Date.parse(a.start), Date.parse(b.start));
  const now = '2026-10-20T22:00:00-08:00';
  const x = JSON.stringify(completedFacts(tiny({}, 20, [a, b]), now));
  const y = JSON.stringify(completedFacts(tiny({}, 20, [b, a]), now));
  assert.equal(x, y);
  assert.equal(find(JSON.parse(x), 'volume.28d').numbers.workouts, 1);
  // also with a third, identical record
  assert.equal(x, JSON.stringify(completedFacts(tiny({}, 20, [b, a, { ...a }]), now)));
});

const mk = (dates, workouts = [], extra = {}) => ({
  exportDate: '2020-01-01T00:00:00Z', // exported before any `now` used here
  persona: { key: 't' },
  dailySummaries: dates.map((date) => ({ date, restingHeartRate: 50, sleepMinutes: { totalAsleep: 420 } })),
  workouts,
  ...extra,
});
const dayList = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
const wk = (date, type = 'Running', hour = 7, min = 30, extra = {}) => ({ activityType: type, start: `${date}T${String(hour).padStart(2, '0')}:00:00-08:00`, end: `${date}T${String(hour).padStart(2, '0')}:30:00-08:00`, durationMin: min, ...extra });

test('only what was recorded is claimed: an unlogged today is not "0 workouts"', () => {
  // 14 logged days (Oct 1 to 14), then nothing: now is Oct 20.
  const snap = mk(dayList('2026-10-01', 14), [wk('2026-10-05'), wk('2026-10-12')]);
  const f = completedFacts(snap, '2026-10-20T22:00:00-08:00');
  assert.ok(!find(f, 'volume.today'), 'no zero for an unknown day');
  assert.deepEqual(find(f, 'volume.today_unlogged').numbers, { date: '2026-10-20', loggedDays: 0, windowDays: 1 });
  for (const id of ['past.today_vs_avg', 'past.today_rank', 'past.today_vs_highest', 'past.week_vs_avg', 'past.week_rank', 'load.ratio', 'goal.workouts_per_week']) assert.ok(!find(f, id), id);
  assert.deepEqual(find(f, 'past.week_comparisons_skipped').numbers, { loggedDays: 1, windowDays: 7 }); // Oct 14 only
  const w = find(f, 'volume.week');
  assert.match(w.text, /^Counted in the last 7 days \(.*; workouts of 10 minutes or more\)/);
  assert.equal(w.numbers.unloggedDays, 6);
  assert.equal(w.numbers.loggedDays, 1);
  assert.match(w.text, /on 1 logged day \(6 unlogged days\)/);
  assert.equal(find(f, 'volume.28d').numbers.unloggedDays, 14);
  // the target is not compared with an incomplete week either
  assert.ok(!find(completedFacts({ ...snap, target: { workoutsPerWeek: 4 } }, '2026-10-20T22:00:00-08:00'), 'goal.target_progress'));
});

test('a week with some unlogged days gets the "not stated" fact with the counts, a full week gets the comparisons', () => {
  const all = dayList('2026-10-01', 30); // Oct 1 to Oct 30
  const now = '2026-10-30T22:00:00-08:00';
  const full = completedFacts(mk(all, [wk('2026-10-05'), wk('2026-10-28')]), now);
  assert.ok(find(full, 'past.week_vs_avg') && find(full, 'load.ratio') && find(full, 'goal.workouts_per_week'));
  assert.ok(!find(full, 'past.week_comparisons_skipped'));
  const partial = completedFacts(mk(all.filter((d) => d !== '2026-10-27' && d !== '2026-10-29'), [wk('2026-10-05'), wk('2026-10-28')]), now);
  assert.deepEqual(find(partial, 'past.week_comparisons_skipped').numbers, { loggedDays: 5, windowDays: 7 });
  assert.match(find(partial, 'past.week_comparisons_skipped').text, /only 5 of 7 days are logged/);
  assert.equal(find(partial, 'volume.week').numbers.unloggedDays, 2);
  for (const id of ['past.week_vs_avg', 'load.ratio', 'goal.workouts_per_week', 'past.week_rank']) assert.ok(!find(partial, id), id);
});

test('an average needs at least 7 logged days behind it', () => {
  // 14 logged days long ago, then only Oct 28 to 30: the previous 28 days hold 2 logged days, so no average is written.
  const old = dayList('2026-08-01', 14);
  const snap = mk([...old, '2026-10-28', '2026-10-29', '2026-10-30'], [wk('2026-10-30')]);
  const f = completedFacts(snap, '2026-10-30T22:00:00-08:00');
  assert.ok(!find(f, 'past.today_vs_avg'));
  assert.ok(find(f, 'volume.today'));
  // with 7 logged days behind it the average is written
  const seven = mk([...old, ...dayList('2026-10-23', 8)], [wk('2026-10-30')]);
  assert.equal(find(completedFacts(seven, '2026-10-30T22:00:00-08:00'), 'past.today_vs_avg').numbers.loggedDays, 7);
});

test('slots are grouped by the original activity: unrecognised activities never make a slot', () => {
  const dates = dayList('2026-10-01', 28); // Oct 1 to 28; Mondays are Oct 5, 12, 19, 26
  const now = '2026-10-28T22:00:00-08:00';
  const mondays = ['2026-10-12', '2026-10-19', '2026-10-26'];
  const three = completedFacts(mk(dates, mondays.map((d, i) => wk(d, ['Frobnicate', 'Zorbing', 'Quidditch'][i]))), now);
  assert.ok(!three.some((f) => f.id.startsWith('regularity.slot.')), 'three different unknown activities');
  assert.ok(find(three, 'regularity.slots_none'));
  // the same unknown activity three times is still never written as a slot
  const same = completedFacts(mk(dates, mondays.map((d) => wk(d, 'Frobnicate'))), now);
  assert.ok(!same.some((f) => f.id.startsWith('regularity.slot.')));
  assert.equal(find(same, 'mix.count').numbers.byActivity.Other, 3);
  // a recognised activity is
  const known = completedFacts(mk(dates, mondays.map((d) => wk(d, 'Running'))), now);
  assert.ok(find(known, 'regularity.slot.Running.Mon.07'));
});

test('load is effort-weighted only when every counted workout has an effort score (hand-computed)', () => {
  const dates = dayList('2026-11-01', 28); // Nov 1 to 28, all logged
  const now = '2026-11-28T22:00:00-08:00';
  const flows = [
    wk('2026-11-25', 'Running', 7, 30, { effort: 5 }), // 150
    wk('2026-11-27', 'Running', 7, 60, { effort: 8 }), // 480
    wk('2026-11-03', 'Running', 7, 40, { effort: 3 }), // 120 each
    wk('2026-11-10', 'Running', 7, 40, { effort: 3 }),
    wk('2026-11-17', 'Running', 7, 40, { effort: 3 }),
  ];
  // effort: last 7 days 630, last 28 days 990 over 28 logged days -> weekly 990 / 28 * 7 = 247.5 -> ratio 630 / 247.5 = 2.5454...
  const eff = find(completedFacts(mk(dates, flows), now), 'load.ratio');
  assert.equal(eff.numbers.basis, 'effort');
  assert.equal(eff.numbers.load7, 630);
  assert.equal(eff.numbers.averagePerWeek28, 247.5);
  assert.equal(eff.numbers.ratio, 2.55);
  assert.match(eff.text, /^The effort-weighted 7-day load is 630 effort-minutes, ratio 2\.55 to the 28-day weekly average of 247\.50 effort-minutes/);
  // one counted workout without an effort score: minutes only. Last 7 days 90, 28 days 210 -> weekly 52.5 -> 1.714
  const noEffort = flows.map((w, i) => (i === 2 ? (({ effort, ...rest }) => rest)(w) : w));
  const mins = find(completedFacts(mk(dates, noEffort), now), 'load.ratio');
  assert.equal(mins.numbers.basis, 'minutes');
  assert.equal(mins.numbers.load7, 90);
  assert.equal(mins.numbers.averagePerWeek28, 52.5);
  assert.equal(mins.numbers.ratio, 1.71);
  assert.match(mins.text, /^The minutes-based 7-day load is 90 minutes, ratio 1\.71 to the 28-day weekly average of 52\.50 minutes/);
  // an effort outside 1 to 10, or with more than 2 decimals, is refused
  for (const effort of [11, 0, 5.123]) assert.throws(() => completedFacts(mk(dates, flows.map((w, i) => (i === 0 ? { ...w, effort } : w))), now), /snapshot failed validation: workouts\[\d+\]\.effort/, String(effort));
});

test('"equal to" is written only for exactly equal values; tiny differences keep their direction', () => {
  const dates = dayList('2026-10-01', 29); // Oct 1 to 29
  const now = '2026-10-29T22:00:00-08:00';
  const days28 = dates.slice(0, 28);
  // exactly equal: 30 minutes today, 30 minutes on each previous day
  const same = find(completedFacts(mk(dates, dates.map((d) => wk(d))), now), 'past.today_vs_avg');
  assert.equal(same.numbers.direction, 'equal');
  assert.match(same.text, /ratio 1\.00 to the daily average of 30\.00 minutes over the previous 28 days \(28 logged days, equal\)\.$/);
  // one earlier day is 0.01 minutes longer: the average is 30.00036, today is below it by far less than 0.1 percent
  const nearly = find(completedFacts(mk(dates, dates.map((d) => wk(d, 'Running', 7, d === '2026-10-05' ? 30.01 : 30))), now), 'past.today_vs_avg');
  assert.equal(nearly.numbers.direction, 'below');
  assert.match(nearly.text, /ratio 1\.00 to the daily average of 30\.00 minutes over the previous 28 days \(28 logged days, less than 0\.1% below\)\.$/);
  assert.equal(nearly.numbers.percent, 0);
  assert.doesNotMatch(nearly.text, /equal to/);
  // sleep: the 7-day average is 0.0003 h under the 28-day average
  const snap = mk(dates, []);
  snap.dailySummaries = snap.dailySummaries.map((s) => (s.date === '2026-10-02' ? { ...s, sleepMinutes: { totalAsleep: 420.5 } } : s));
  const sleep = find(completedFacts(snap, now), 'body.sleep');
  assert.equal(sleep.numbers.direction, 'below');
  assert.match(sleep.text, /less than 0\.01 h below the 28-day average/);
  assert.doesNotMatch(sleep.text, /equal to/);
  // resting heart rate: exactly equal stays "equal to"
  assert.match(find(completedFacts(snap, now), 'body.resting_hr').text, /equal to the 28-day average/);
  assert.ok(days28.length === 28);
});

test('computeFacts refuses conflicting daily summaries, in either order, with the contract\'s fixed text', () => {
  const dates = dayList('2026-10-01', 20);
  const snap = mk(dates, []);
  const a = { date: '2026-10-19', restingHeartRate: 90, sleepMinutes: { totalAsleep: 300 } };
  const b = { date: '2026-10-19', restingHeartRate: 40, sleepMinutes: { totalAsleep: 500 } };
  const without = snap.dailySummaries.filter((d) => d.date !== '2026-10-19');
  const now = '2026-10-20T22:00:00-08:00';
  for (const list of [[a, b], [b, a]]) {
    assert.throws(() => engine({ ...snap, dailySummaries: [...without, ...list], exportDate: now }, now), (e) => e.message.startsWith('snapshot failed validation: ') && e.message.includes('conflicts with another summary for the same date') && !/\b(90|40|300|500)\b/.test(e.message));
  }
  // identical duplicates are fine and change nothing
  const x = engine({ ...snap, dailySummaries: [...without, a, { ...a }], exportDate: now }, now);
  assert.equal(JSON.stringify(x), JSON.stringify(engine({ ...snap, dailySummaries: [...without, a], exportDate: now }, now)));
});

test('the coverage sentence is written only when the 28-day load average is written', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  // load average written: complete week, workouts exist
  const withLoad = completedFacts(mk(dates, [wk('2026-10-05'), wk('2026-10-28')]), now);
  assert.ok(find(withLoad, 'load.ratio'));
  assert.equal(find(withLoad, 'coverage.28d').numbers.loggedDays, 28);
  assert.equal(withLoad[0].id, 'coverage.28d');
  // no counted workout in the window: no load average, so no coverage sentence
  const none = completedFacts(mk(dates, []), now);
  assert.ok(!find(none, 'load.ratio'));
  assert.ok(!find(none, 'coverage.28d'));
  // incomplete current week: no load average, so no coverage sentence (the counts stay in the volume facts)
  const partial = completedFacts(mk(dates.filter((d) => d !== '2026-10-29'), [wk('2026-10-05')]), now);
  assert.ok(!find(partial, 'load.ratio'));
  assert.ok(!find(partial, 'coverage.28d'));
  assert.equal(find(partial, 'volume.28d').numbers.unloggedDays, 1);
});

test('otherwise identical workouts with different effort scores: rejected by the validator, and the engine ignores input order', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  const a = wk('2026-10-28', 'Running', 7, 60, { effort: 1 });
  const b = wk('2026-10-28', 'Running', 7, 60, { effort: 10 });
  const base = mk(dates, [wk('2026-10-05', 'Running', 7, 60, { effort: 5 })]);
  for (const order of [[a, b], [b, a]]) {
    const snap = { ...base, workouts: [...base.workouts, ...order] };
    const v = validateSnapshot(snap);
    assert.equal(v.ok, false);
    assert.match(v.errors.join(' '), /different effort/);
  }
  // identical repeats, and a repeat with the same effort, are accepted
  assert.equal(validateSnapshot({ ...base, workouts: [...base.workouts, a, { ...a }] }).ok, true);
  // one with an effort and one without is also a conflict
  const { effort, ...noEffort } = a;
  assert.equal(validateSnapshot({ ...base, workouts: [...base.workouts, a, noEffort] }).ok, false);
  // a different duration is not this conflict (the longest repeat is kept)
  assert.equal(validateSnapshot({ ...base, workouts: [...base.workouts, a, { ...b, durationMin: 61 }] }).ok, true);
  // the engine refuses them too, in both orders
  for (const order of [[a, b], [b, a]]) assert.throws(() => engine({ ...base, exportDate: now, workouts: [...base.workouts, ...order] }, now), (e) => e.message.startsWith('snapshot failed validation: ') && e.message.includes('different effort'));
});

test('look-back: with an export later than now, the unfinished day\'s summary (it may hold later data) is not used', () => {
  const dates = dayList('2026-10-01', 20); // Oct 1 to 20
  const now = '2026-10-20T12:00:00-08:00';
  const base = mk(dates, [wk('2026-10-05'), wk('2026-10-19')]);
  const later = { ...base, exportDate: '2026-10-20T23:00:00-08:00' };
  const atNow = { ...base, exportDate: now };
  const fl = engine(later, now, { dayMode: 'in_progress' });
  const fa = engine(atNow, now, { dayMode: 'in_progress' });
  assert.ok(find(fl, 'volume.today_unlogged'), 'a later export may hold data from after now');
  assert.ok(find(fa, 'volume.today_so_far'), 'an export at or before now is used');
  assert.ok(find(completedFacts({ ...base, exportDate: '2026-10-20T12:00:00-08:00' }, now, { dayMode: 'in_progress' }), 'volume.today_so_far'));
  // a look-back uses only summaries dated before the last day the facts describe (Oct 19 here): it equals the same snapshot without Oct 19's and Oct 20's summaries
  const trimmed = { ...base, exportDate: now, dailySummaries: base.dailySummaries.filter((d) => d.date < '2026-10-19') };
  assert.equal(JSON.stringify(fl), JSON.stringify(engine(trimmed, now, { dayMode: 'in_progress' })));
  // a look-back at the midnight roll: the ended day's summary may have been updated after now, so it is not used
  // (the facts equal those of a snapshot without it); with an export at or before now it is used
  const m = '2026-10-21T00:00:00-08:00';
  const noEnded = { ...base, exportDate: m, dailySummaries: base.dailySummaries.filter((d) => d.date !== '2026-10-20') };
  assert.equal(JSON.stringify(engine({ ...base, exportDate: '2026-10-21T00:30:00-08:00' }, m)), JSON.stringify(engine(noEnded, m)));
  assert.ok(find(engine({ ...base, exportDate: m }, m), 'volume.today'));
  assert.ok(find(engine({ ...base, exportDate: '2026-10-21T00:30:00-08:00' }, m), 'volume.today_unlogged'));
});

test('days since the last workout searches only the last 28 days', () => {
  const dates = dayList('2026-09-01', 60); // Sept 1 to Oct 30
  const now = '2026-10-30T22:00:00-08:00';
  const f = completedFacts(mk(dates, [wk('2026-09-05')]), now);
  const last = find(f, 'regularity.days_since_last');
  assert.equal(last.text, 'No counted workout in the last 28 days as of 2026-10-30: 0 workouts.');
  assert.equal(last.window, '28d');
  assert.deepEqual(last.numbers, { asOf: '2026-10-30', daysSinceLast: null, lastWorkoutDate: null, workouts28: 0 });
  // a workout exactly 27 days back is found, 28 days back is not
  assert.equal(find(completedFacts(mk(dates, [wk('2026-10-03')]), now), 'regularity.days_since_last').numbers.daysSinceLast, 27);
  assert.equal(find(completedFacts(mk(dates, [wk('2026-10-02')]), now), 'regularity.days_since_last').numbers.daysSinceLast, null);
});

test('a target is shown as it is used: at most 2 decimals, and the engine never prints a tiny target as 0', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  const base = mk(dates, [wk('2026-10-28'), wk('2026-10-29')]);
  for (const bad of [0.001, 4.567]) assert.throws(() => completedFacts({ ...base, target: { workoutsPerWeek: bad } }, now), /snapshot failed validation: target/);
  const t = find(completedFacts({ ...base, target: { workoutsPerWeek: 4.57 } }, now), 'goal.target_progress');
  assert.equal(t.numbers.target, 4.57);
  assert.equal(t.numbers.percentOfTarget, Math.round((2 / 4.57) * 1000) / 10);
  for (const bad of [0.001, 0, -1, 4.567, 1 / 3, NaN]) assert.equal(validateSnapshot({ ...base, target: { workoutsPerWeek: bad } }).ok, false, String(bad));
  for (const good of [4, 4.5, 4.25, 0.01, 2.1]) assert.equal(validateSnapshot({ ...base, target: { workoutsPerWeek: good } }).ok, true, String(good));
});

test('every planted date and value matches a real record in the snapshot', () => {
  const dateOf = (w) => w.start.slice(0, 10);
  for (const kind of SCENARIO_KINDS) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { snapshot, planted } = generateScenario(kind, seed);
      const ws = snapshot.workouts;
      const sums = new Set(snapshot.dailySummaries.map((d) => d.date));
      for (const p of planted) {
        const label = `${kind}/${seed}`;
        if (p.type === 'spike') {
          const w = ws.find((x) => dateOf(x) === p.date && x.durationMin === p.minutes);
          assert.ok(w, `${label} spike record`);
          assert.ok(p.previousHighestMinutes > 0 && Math.abs(p.multiple - p.minutes / p.previousHighestMinutes) < 0.01);
          assert.equal(Math.max(...ws.filter((x) => dateOf(x) < p.date).map((x) => x.durationMin)), p.previousHighestMinutes);
        }
        if (p.type === 'missed_week') {
          assert.ok(!ws.some((x) => dateOf(x) >= p.start && dateOf(x) <= p.end), `${label} no workout in the missed week`);
          assert.ok(sums.has(p.start) && sums.has(p.end), `${label} the missed week is logged`);
          assert.ok(ws.some((x) => dateOf(x) === p.lastWorkoutBefore), `${label} last workout before`);
          assert.equal(ws.filter((x) => dateOf(x) < p.start).map(dateOf).pop(), p.lastWorkoutBefore);
        }
        if (p.type === 'comeback') {
          assert.ok(ws.some((x) => dateOf(x) === p.resumedOn), `${label} first workout after the gap is on ${p.resumedOn}`);
          assert.ok(ws.some((x) => dateOf(x) === p.lastWorkoutBeforeGap), `${label} last workout before the gap`);
          assert.ok(!ws.some((x) => dateOf(x) > p.lastWorkoutBeforeGap && dateOf(x) < p.resumedOn), `${label} nothing inside the gap`);
          assert.equal(p.gapDays, Math.round((Date.parse(p.resumedOn) - Date.parse(p.lastWorkoutBeforeGap)) / 86400000) - 1);
          assert.ok(p.gapDays >= 14);
        }
        if (p.type === 'missing_days') {
          for (const d of p.dates) assert.ok(!sums.has(d) && !ws.some((x) => dateOf(x) === d), `${label} ${d} has no record`);
        }
        if (p.type === 'duplicates') {
          for (const i of p.indices) assert.deepEqual(ws[i], ws[i - 1], `${label} index ${i} repeats the one before`);
        }
        if (p.type === 'tz_change') {
          assert.ok(ws.some((x) => x.start === p.lateWorkout.start), `${label} late workout`);
          assert.ok(ws.some((x) => x.start.endsWith(p.offsetAfter) && dateOf(x) >= p.changeDate));
          assert.ok(ws.some((x) => x.start.endsWith(p.offsetBefore) && dateOf(x) < p.changeDate));
        }
        if (p.type === 'thin') assert.equal(new Set([...sums, ...ws.map(dateOf)]).size, p.days);
      }
    }
  }
  // the earlier mistake: the comeback must not report a resume date that has no workout
  const c = generateScenario('comeback', 1).planted[0];
  assert.ok(generateScenario('comeback', 1).snapshot.workouts.some((w) => w.start.startsWith(c.resumedOn)));
});

test('a fixed slot is stated as an hour range, because the workouts did not start on the hour', () => {
  const dates = dayList('2026-10-01', 28);
  const now = '2026-10-28T22:00:00-08:00';
  const at = (date, hhmm) => ({ activityType: 'Running', start: `${date}T${hhmm}:00-08:00`, end: `${date}T${hhmm.slice(0, 2)}:59:00-08:00`, durationMin: 30 });
  const f = completedFacts(mk(dates, [at('2026-10-12', '07:10'), at('2026-10-19', '07:45'), at('2026-10-26', '07:30')]), now);
  const slot = find(f, 'regularity.slot.Running.Mon.07');
  assert.equal(slot.text, 'Fixed slot among recognised activities: running on Mon between 07:00 and 08:00, in 3 of the last 4 weeks.');
  assert.doesNotMatch(slot.text, /at 07:00/);
  assert.equal(slot.numbers.hourEnd, 8);
  const late = completedFacts(mk(dates, ['2026-10-12', '2026-10-19', '2026-10-26'].map((d) => at(d, '23:15'))), now);
  const l = find(late, 'regularity.slot.Running.Mon.23');
  assert.equal(l.text, 'Fixed slot among recognised activities: running on Mon between 23:00 and 00:00 the next day, in 3 of the last 4 weeks.');
  assert.doesNotMatch(l.text, /24:00/);
  assert.equal(l.numbers.hourEnd, 0);
  assert.equal(l.numbers.endsNextDay, true);
  assert.equal(slot.numbers.endsNextDay, false);
  assert.equal(lintFact(l.text, { id: l.id }).length, 0);
  assert.equal(lintFact(slot.text, { id: slot.id }).length, 0);
});

test('days since the last workout speaks only of counted workouts (10 minutes or more)', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  // a 5-minute workout today does not count; the last counted workout was Oct 27
  const f = find(completedFacts(mk(dates, [wk('2026-10-27'), wk('2026-10-30', 'Walking', 8, 5)]), now), 'regularity.days_since_last');
  assert.equal(f.numbers.daysSinceLast, 3);
  assert.equal(f.text, 'Days since the last counted workout (10 minutes or more) as of 2026-10-30: 3 (2026-10-27); 1 counted workout in the last 28 days.');
  assert.doesNotMatch(f.text, /recorded/);
  assert.equal(lintFact(f.text, { id: f.id }).length, 0);
  assert.ok(lintFact('Days since the last recorded workout: 1 (2026-10-29); 1 recorded workout in the last 28 days.', { id: f.id }).length > 0);
});

test('every workout-counting sentence says "counted ... (10 minutes or more)" and none says "recorded workout"', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  const withWork = completedFacts(mk(dates, [wk('2026-10-27'), wk('2026-10-30', 'Walking', 8, 5)]), now);
  const none = completedFacts(mk(dates, []), now);
  for (const facts of [withWork, none]) {
    for (const f of facts) assert.doesNotMatch(f.text, /recorded workout/i, f.id);
  }
  for (const id of ['volume.week', 'volume.28d', 'regularity.per_week', 'mix.count', 'mix.median_length', 'mix.start_bands']) {
    assert.match(find(withWork, id).text, /(Counted|counted) .*10 minutes or more/, id);
  }
  assert.equal(find(none, 'mix.count').text, 'No counted workouts (10 minutes or more) by activity in the last 28 days (0 workouts).');
  assert.ok(lintFact('Recorded workouts by activity in the last 28 days: running 3.', { id: 'mix.count' }).length > 0);
});

test('an unrecognised activity that repeats does not turn the zero-slot sentence into a false claim', () => {
  const dates = dayList('2026-10-01', 28);
  const now = '2026-10-28T22:00:00-08:00';
  const f = completedFacts(mk(dates, ['2026-10-12', '2026-10-19', '2026-10-26'].map((d) => wk(d, 'Frobnicate'))), now);
  const none = find(f, 'regularity.slots_none');
  assert.equal(none.text, 'Fixed slots among recognised activities (same activity, weekday and hour in 3 of the last 4 weeks) found: 0.');
  assert.match(none.text, /among recognised activities/);
  assert.equal(lintFact(none.text, { id: none.id }).length, 0);
  assert.ok(lintFact('Fixed slots (same activity, weekday and hour in 3 of the last 4 weeks) found: 0.', { id: none.id }).length > 0);
});

test('a stretch of days with only short workouts is a stretch "without a counted workout", and the sentence says so', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  const shorts = dayList('2026-10-20', 11).map((d) => wk(d, 'Walking', 8, 5)); // Oct 20 to 30, 5 minutes each
  const f = find(completedFacts(mk(dates, [wk('2026-10-10'), ...shorts]), now), 'regularity.longest_gap');
  assert.match(f.text, /^Longest stretch of logged days without a counted workout \(10 minutes or more\) in the last 28 days: 20 days /);
  assert.equal(f.numbers.gapDays, 20); // Oct 11 to 30
  assert.doesNotMatch(f.text, /without a workout/);
  const v = find(completedFacts(mk(dates, shorts), now), 'volume.week');
  assert.equal(v.numbers.shortWorkouts, 7);
  assert.match(v.text, /, 7 under 10 minutes not counted\.$/);
  assert.match(find(completedFacts(mk(dates, shorts), now), 'volume.today').text, /^On 2026-10-30: 0 counted workouts \(10 minutes or more\) and 0 workout minutes, 1 under 10 minutes not counted\.$/);
});

// ---- A: the day the facts describe ------------------------------------------------------------------------------

const TODAY_COMPARISONS = ['past.today_vs_avg', 'past.today_vs_highest', 'past.today_rank'];
const stripToday = (facts) => facts.filter((f) => !['volume.today', 'volume.today_so_far', 'volume.today_unlogged', ...TODAY_COMPARISONS].includes(f.id));

test('in_progress: a refresh at any hour of the day never writes a comparison, rank or percentage for today', () => {
  const { snapshot } = generateScenario('steady', 3); // the last day (Wed 2026-11-18) has a workout 07:00 to about 07:40
  const day = '2026-11-18';
  let previous = null;
  for (let h = 0; h < 24; h++) {
    for (const mm of ['00', '30', '59']) {
      const now = `${day}T${String(h).padStart(2, '0')}:${mm}:00-08:00`;
      const facts = completedFacts({ ...snapshot, exportDate: now }, now, { dayMode: 'in_progress' });
      const ids = facts.map((f) => f.id);
      for (const id of [...TODAY_COMPARISONS, 'volume.today']) assert.ok(!ids.includes(id), `${now} writes ${id}`);
      const today = facts.filter((f) => f.id === 'volume.today_so_far' || f.id === 'volume.today_unlogged');
      assert.equal(today.length, 1, now);
      assert.doesNotMatch(today[0].text, /ratio|%|above|below|average|rank/i, now);
      if (today[0].id === 'volume.today_so_far') {
        assert.match(today[0].text, /^So far today \(2026-11-18\): \d+ counted workouts? \(10 minutes or more\) and [\d.]+ workout minutes, day not finished/);
        assert.equal(today[0].numbers.dayFinished, false);
        assert.equal(today[0].numbers.workouts, now >= `${day}T07:50` ? 1 : 0); // the workout counts once it has ended
      }
      // every other fact uses completed days only: identical at every hour, whatever happened today
      const rest = JSON.stringify(stripToday(facts));
      if (previous !== null) assert.equal(rest, previous, now);
      previous = rest;
      // and no fact text anywhere compares today
      for (const f of facts) assert.doesNotMatch(f.text, /\b2026-11-18\b.*(ratio|%)/, `${now} ${f.id}`);
    }
  }
  // a Date for now gives the same
  const n = '2026-11-18T12:00:00-08:00';
  assert.equal(JSON.stringify(completedFacts({ ...snapshot, exportDate: n }, new Date(Date.parse(n)), { dayMode: 'in_progress' })), JSON.stringify(completedFacts({ ...snapshot, exportDate: n }, n, { dayMode: 'in_progress' })));
});

test('in_progress: the other facts equal the midnight roll of the day before', () => {
  const { snapshot } = generateScenario('steady', 3);
  const midnight = '2026-11-18T00:00:00-08:00'; // ends 2026-11-17
  const roll = completedFacts({ ...snapshot, exportDate: midnight }, midnight); // completed (default)
  const refresh = completedFacts({ ...snapshot, exportDate: '2026-11-18T15:00:00-08:00' }, '2026-11-18T15:00:00-08:00', { dayMode: 'in_progress' });
  assert.equal(JSON.stringify(stripToday(roll)), JSON.stringify(stripToday(refresh)));
  assert.equal(find(roll, 'volume.today').numbers.date, '2026-11-17'); // the day that just ended
  assert.match(find(roll, 'volume.today').text, /^On 2026-11-17: /);
  assert.ok(find(roll, 'past.today_vs_avg'), 'the completed day is compared');
});

test('completed (default): now at the local midnight describes the day that just ended, also when the export is later', () => {
  const { snapshot } = generateScenario('steady', 3);
  const midnight = '2026-11-19T00:00:00-08:00'; // ends 2026-11-18
  const atEnd = completedFacts({ ...snapshot, exportDate: '2026-11-18T23:59:59-08:00' }, '2026-11-18T23:59:59-08:00');
  const roll = completedFacts({ ...snapshot, exportDate: midnight }, midnight);
  assert.equal(JSON.stringify(roll), JSON.stringify(atEnd));
  const lateExport = completedFacts({ ...snapshot, exportDate: '2026-11-19T00:30:00-08:00' }, midnight);
  // a later export is a look-back: the ended day's summary may have changed after now, so it is not used
  const noEnded = { ...snapshot, exportDate: midnight, dailySummaries: snapshot.dailySummaries.filter((d) => d.date !== '2026-11-18') };
  assert.equal(JSON.stringify(lateExport), JSON.stringify(completedFacts(noEnded, midnight)));
  assert.equal(JSON.stringify(completedFacts({ ...snapshot, exportDate: midnight }, midnight, { dayMode: 'completed' })), JSON.stringify(roll));
  assert.equal(find(roll, 'volume.today').numbers.date, '2026-11-18');
  // not exactly midnight: the day containing now
  assert.equal(find(completedFacts({ ...snapshot, exportDate: '2026-11-18T00:00:01-08:00' }, '2026-11-18T00:00:01-08:00'), 'volume.today').numbers.date, '2026-11-18');
});

test('dayMode: auto (the default) reads a local midnight as the roll of the day that ended, any other time as an unfinished day', () => {
  const { snapshot } = generateScenario('steady', 3);
  const day = '2026-11-18';
  const next = '2026-11-19';
  const run = (now, opts) => engine({ ...snapshot, exportDate: now }, now, opts);
  const ids = (f) => f.map((x) => x.id);
  const midnight = run(`${next}T00:00:00-08:00`);
  assert.ok(ids(midnight).includes('volume.today') && ids(midnight).includes('past.today_vs_avg'));
  assert.equal(find(midnight, 'volume.today').numbers.date, day);
  assert.equal(JSON.stringify(midnight), JSON.stringify(run(`${next}T00:00:00-08:00`, { dayMode: 'auto' })));
  assert.equal(JSON.stringify(midnight), JSON.stringify(run(`${next}T00:00:00-08:00`, { dayMode: 'completed' })));
  assert.equal(JSON.stringify(run(`${next}T00:00:00.000-08:00`)), JSON.stringify(midnight));
  // at any other time the day is in progress: no completed-day facts, no comparison for it
  for (const t of ['00:00:01', '00:00:00.5', '00:01:00', '03:30:00', '12:00:00', '17:45:10', '23:59:59']) {
    const now = `${day}T${t}-08:00`;
    const f = run(now);
    assert.equal(JSON.stringify(f), JSON.stringify(run(now, { dayMode: 'in_progress' })), t);
    assert.equal(JSON.stringify(f), JSON.stringify(run(now, { dayMode: 'auto' })), t);
    for (const id of ['volume.today', ...TODAY_COMPARISONS]) assert.ok(!ids(f).includes(id), `${t} ${id}`);
    assert.ok(ids(f).includes('volume.today_so_far') || ids(f).includes('volume.today_unlogged'), t);
    assert.ok(f.every((x) => !/On 2026-11-18:/.test(x.text)), t);
  }
  // a Date is read in the offset of exportDate: -08:00 midnight is 08:00Z
  const d = new Date('2026-11-19T08:00:00Z');
  assert.equal(JSON.stringify(engine({ ...snapshot, exportDate: '2026-11-19T00:00:00-08:00' }, d)), JSON.stringify(midnight));
  // midnight in another offset: only the offset the timestamps carry counts
  assert.ok(find(engine({ ...snapshot, exportDate: '2026-11-19T00:00:00+05:30' }, '2026-11-19T00:00:00+05:30'), 'volume.today'));
  assert.ok(!find(engine({ ...snapshot, exportDate: '2026-11-19T08:00:00Z' }, '2026-11-19T08:00:00Z'), 'volume.today'));
});

test('dayMode: an explicit completed needs a local midnight, and other values are refused with fixed texts', () => {
  const { snapshot, now } = generateScenario('steady', 1); // 21:00, not a midnight
  for (const t of ['2026-11-18T21:00:00-08:00', '2026-11-18T00:00:01-08:00', '2026-11-18T12:00:00Z', '2026-11-18T23:59:59-08:00']) {
    assert.throws(() => engine({ ...snapshot, exportDate: t }, t, { dayMode: 'completed' }), (e) => e.message === 'dayMode completed needs now to be a local midnight', t);
  }
  assert.throws(() => engine(snapshot, new Date(Date.parse(now)), { dayMode: 'completed' }), (e) => e.message === 'dayMode completed needs now to be a local midnight');
  for (const bad of ['live', '', 'Completed', 1, null]) assert.throws(() => engine(snapshot, now, { dayMode: bad }), (e) => e.message === 'dayMode must be auto, completed or in_progress', String(bad));
  engine(snapshot, now, { dayMode: 'in_progress' });
  engine(snapshot, now, { dayMode: 'auto' });
  engine({ ...snapshot, exportDate: '2026-11-19T00:00:00-08:00' }, '2026-11-19T00:00:00-08:00', { dayMode: 'completed' });
});

// ---- B: wording of comparisons ---------------------------------------------------------------------------------

test('comparison wording: both numbers and the ratio; a percentage only for a non-zero value with a ratio from 0.1 to 10', () => {
  const dates = dayList('2026-10-01', 29); // Oct 1 to 29; the compared day is Oct 29
  const now = '2026-10-29T22:00:00-08:00';
  const text = (todayMin, prevMin = 30) => {
    const work = dates.slice(0, 28).map((d) => wk(d, 'Running', 7, prevMin));
    if (todayMin > 0) work.push(wk('2026-10-29', 'Running', 7, todayMin));
    return find(completedFacts(mk(dates, work), now), 'past.today_vs_avg');
  };
  assert.equal(text(0).text, '0 workout minutes on 2026-10-29; the daily average over the previous 28 days is 30.00 minutes (ratio 0, 28 logged days).');
  assert.equal(text(0).numbers.percent, null);
  assert.equal(text(35.4).text, '35.4 workout minutes on 2026-10-29, ratio 1.18 to the daily average of 30.00 minutes over the previous 28 days (28 logged days, 18.0% above).');
  assert.equal(text(35.4).numbers.percent, 18);
  assert.equal(text(30).text, '30 workout minutes on 2026-10-29, ratio 1.00 to the daily average of 30.00 minutes over the previous 28 days (28 logged days, equal).');
  // above 10: ratio only
  assert.equal(text(400).text, '400 workout minutes on 2026-10-29, ratio 13.33 to the daily average of 30.00 minutes over the previous 28 days (28 logged days).');
  assert.equal(text(400).numbers.percent, null);
  // exactly 10 and exactly 0.1 still get a percentage
  assert.match(text(300).text, /ratio 10\.00 to .*\(28 logged days, 900\.0% above\)\.$/);
  assert.match(text(10, 100).text, /ratio 0\.10 to .*\(28 logged days, 90\.0% below\)\.$/);
  // below 0.1: ratio only
  assert.equal(text(10, 150).text, '10 workout minutes on 2026-10-29, ratio 0.07 to the daily average of 150.00 minutes over the previous 28 days (28 logged days).');
  // the baseline is 0: no ratio, and nothing is divided
  const base0 = find(completedFacts(mk(dates, [wk('2026-10-29', 'Running', 7, 30)]), now), 'past.today_vs_avg');
  assert.equal(base0.text, '30 workout minutes on 2026-10-29; the daily average over the previous 28 days is 0.00 minutes, so the ratio is not defined (28 logged days).');
  assert.equal(base0.numbers.ratio, null);
  assert.equal(base0.numbers.percent, null);
  // 0 against 0
  assert.match(find(completedFacts(mk(dates, []), now), 'past.today_vs_avg')?.text ?? 'none', /^none$|so the ratio is not defined/);
});

test('comparison wording for the week and for load follows the same rule', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  // an earlier week of 60 minutes a day, then a week with nothing counted
  const base = dates.slice(0, 23).map((d) => wk(d, 'Running', 7, 60));
  const missed = find(completedFacts(mk(dates, base), now), 'past.week_vs_avg');
  assert.match(missed.text, /^0 workout minutes in the last 7 days; the 4-week average is [\d.]+ minutes per week \(ratio 0, \d+ logged days before this week\)\.$/);
  assert.equal(find(completedFacts(mk(dates, base), now), 'load.ratio').text.match(/^The minutes-based 7-day load is 0 minutes, ratio 0 to the 28-day weekly average of [\d.]+ minutes \(\d+ logged days\)\.$/) !== null, true);
  // a normal week: ratio and percentage
  const steady = dates.map((d) => wk(d, 'Running', 7, 60));
  const t = find(completedFacts(mk(dates, steady), now), 'past.week_vs_avg').text;
  assert.match(t, /^420 workout minutes in the last 7 days, ratio 1\.00 to the 4-week average of 420\.00 minutes per week \(\d+ logged days before this week, equal\)\.$/);
  assert.match(find(completedFacts(mk(dates, steady), now), 'load.ratio').text, /ratio 1\.00 to the 28-day weekly average of 420\.00 minutes \(28 logged days, equal\)\.$/);
  // a week more than 10 times the baseline: ratio only
  const spike = [wk('2026-10-05', 'Running', 7, 10), ...dayList('2026-10-24', 7).map((d) => wk(d, 'Running', 7, 120))];
  const wsp = find(completedFacts(mk(dates, spike), now), 'past.week_vs_avg');
  assert.ok(wsp.numbers.ratio > 10);
  assert.equal(wsp.numbers.percent, null);
  assert.doesNotMatch(wsp.text, /%/);
});

// ---- C: shorter activity names in sentences ----------------------------------------------------------------------

test('sentences say "strength training"; canonical names stay in numbers; colliding labels keep the longer names', () => {
  const dates = dayList('2026-10-01', 28);
  const now = '2026-10-28T22:00:00-08:00';
  const one = completedFacts(mk(dates, ['2026-10-12', '2026-10-19', '2026-10-26', '2026-10-20'].map((d, i) => wk(d, i < 3 ? 'TraditionalStrengthTraining' : 'Running'))), now);
  assert.match(find(one, 'mix.count').text, /: strength training 3, running 1\.$/);
  assert.deepEqual(find(one, 'mix.count').numbers.byActivity, { TraditionalStrengthTraining: 3, Running: 1 });
  assert.match(find(one, 'mix.median_length').text, /strength training 30 min, running 30 min\.$/);
  assert.deepEqual(Object.keys(find(one, 'mix.median_length').numbers.medianMinutesByActivity), ['TraditionalStrengthTraining', 'Running']);
  const slot = find(one, 'regularity.slot.TraditionalStrengthTraining.Mon.07');
  assert.match(slot.text, /^Fixed slot among recognised activities: strength training on Mon between 07:00 and 08:00/);
  assert.equal(slot.numbers.activityType, 'TraditionalStrengthTraining');
  assert.doesNotMatch(JSON.stringify(one.map((f) => f.text)), /traditional|functional/);
  // functional alone gets the same label
  const fn = completedFacts(mk(dates, [wk('2026-10-12', 'FunctionalStrengthTraining')]), now);
  assert.match(find(fn, 'mix.count').text, /: strength training 1\.$/);
  // both in one sentence: two canonical names must not collapse into one label
  const both = completedFacts(mk(dates, [wk('2026-10-12', 'TraditionalStrengthTraining'), wk('2026-10-13', 'FunctionalStrengthTraining'), wk('2026-10-14', 'FunctionalStrengthTraining')]), now);
  const txt = find(both, 'mix.count').text;
  assert.match(txt, /: functional strength training 2, traditional strength training 1\.$/);
  assert.doesNotMatch(txt, /(: |, )strength training \d/);
  assert.match(find(both, 'mix.median_length').text, /functional strength training 30 min, traditional strength training 30 min\.$/);
  assert.equal(lintFact(txt, { id: 'mix.count' }).length, 0);
  // a colliding pair does not change the label of a third activity in the same sentence
  const three = completedFacts(mk(dates, [wk('2026-10-12', 'TraditionalStrengthTraining'), wk('2026-10-13', 'FunctionalStrengthTraining'), wk('2026-10-14', 'Running')]), now);
  assert.match(find(three, 'mix.count').text, /traditional strength training 1.*functional strength training 1.*running 1|running 1.*/);
});

test('minutes are exact in numbers and shown with at most 2 decimals, trailing zeros trimmed', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  const w = (d, min, hour = 7) => ({ activityType: 'Running', start: `${d}T${String(hour).padStart(2, '0')}:00:00-08:00`, end: `${d}T${String(hour).padStart(2, '0')}:59:00-08:00`, durationMin: min });
  const one = completedFacts(mk(dates, [w('2026-10-30', 10.04)]), now);
  assert.equal(find(one, 'volume.today').numbers.minutes, 10.04);
  assert.match(find(one, 'volume.today').text, /and 10\.04 workout minutes\.$/);
  assert.equal(find(one, 'volume.week').numbers.minutes, 10.04);
  assert.match(find(one, 'volume.28d').text, /10\.04 workout minutes/);
  assert.equal(find(one, 'past.today_vs_avg').numbers.minutes, 10.04);
  assert.match(find(one, 'past.today_vs_avg').text, /^10\.04 workout minutes on 2026-10-30/);
  assert.equal(find(one, 'mix.median_length').numbers.medianMinutesByActivity.Running, 10.04);
  assert.match(find(one, 'mix.median_length').text, /running 10\.04 min/);
  // a day of three such workouts: the sum is exact (30.12), not 30.1 and not float noise
  const three = completedFacts(mk(dates, [w('2026-10-30', 10.04, 6), w('2026-10-30', 10.04, 8), w('2026-10-30', 10.04, 10)]), now);
  assert.equal(find(three, 'volume.today').numbers.minutes, 30.12);
  assert.equal(find(three, 'volume.today').numbers.workouts, 3);
  assert.match(find(three, 'volume.today').text, /3 counted workouts \(10 minutes or more\) and 30\.12 workout minutes\.$/);
  assert.equal(find(three, 'volume.28d').numbers.minutes, 30.12);
  // float noise is removed from exact sums: 10.1 + 10.2 + 10.3 is 30.6, not 30.599999999999998
  const noise = completedFacts(mk(dates, [w('2026-10-30', 10.1, 6), w('2026-10-30', 10.2, 8), w('2026-10-30', 10.3, 10)]), now);
  assert.equal(find(noise, 'volume.today').numbers.minutes, 30.6);
  // display: 54.4, 10, 54.43 (third decimal rounded for display only; numbers stay exact)
  assert.match(find(completedFacts(mk(dates, [w('2026-10-30', 54.4)]), now), 'volume.today').text, /and 54\.4 workout minutes/);
  assert.match(find(completedFacts(mk(dates, [w('2026-10-30', 10)]), now), 'volume.today').text, /and 10 workout minutes/);
  const long = find(completedFacts(mk(dates, [w('2026-10-30', 54.4349)]), now), 'volume.today');
  assert.equal(long.numbers.minutes, 54.4349);
  assert.match(long.text, /and 54\.43 workout minutes/);
  // so-far today (in progress) keeps the same precision
  const n = '2026-10-30T12:00:00-08:00';
  const sofar = find(engine({ ...mk(dates, [w('2026-10-30', 10.04, 6)]), exportDate: n }, n, { dayMode: 'in_progress' }), 'volume.today_so_far');
  assert.equal(sofar.numbers.minutes, 10.04);
  assert.match(sofar.text, /and 10\.04 workout minutes, day not finished/);
});

test('look-back: body facts use only days before the last described day', () => {
  const dates = dayList('2026-10-01', 30);
  const base = mk(dates, [wk('2026-10-05')]);
  // the last completed day (Oct 29) was edited after now: an extreme reading
  base.dailySummaries = base.dailySummaries.map((d) => (d.date === '2026-10-29' ? { ...d, restingHeartRate: 120, sleepMinutes: { totalAsleep: 900 } } : d));
  const midnight = '2026-10-30T00:00:00-08:00'; // completed: describes Oct 29
  const atNow = engine({ ...base, exportDate: midnight }, midnight);
  const later = engine({ ...base, exportDate: '2026-10-30T09:00:00-08:00' }, midnight);
  assert.equal(find(atNow, 'body.sleep').numbers.logged7, 7);
  assert.ok(find(atNow, 'body.sleep').numbers.average7 > 8);
  assert.equal(find(later, 'body.sleep').numbers.logged7, 6); // Oct 23 to 28
  assert.equal(find(later, 'body.resting_hr').numbers.logged7, 6);
  assert.ok(find(later, 'body.sleep').numbers.average7 < 8);
  assert.ok(find(later, 'volume.today_unlogged'), 'the described day is unlogged without its summary');
  assert.equal(JSON.stringify(later), JSON.stringify(engine({ ...base, exportDate: midnight, dailySummaries: base.dailySummaries.filter((d) => d.date !== '2026-10-29') }, midnight)));
  // in progress (the last described day is Oct 29): the same
  const noon = '2026-10-30T12:00:00-08:00';
  const lateP = engine({ ...base, exportDate: '2026-10-30T20:00:00-08:00' }, noon, { dayMode: 'in_progress' });
  assert.equal(find(lateP, 'body.sleep').numbers.logged7, 6);
  assert.equal(find(engine({ ...base, exportDate: noon }, noon, { dayMode: 'in_progress' }), 'body.sleep').numbers.logged7, 7);
  // earlier days are still used
  assert.equal(find(later, 'body.sleep').numbers.logged28, 27);
});

test('forgetting a date forgets the whole workout when its twin record (another offset) falls on another local date', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-31T00:00:00-08:00';
  // one workout, the same instant (2026-10-21T04:00Z), written in two offsets: Oct 20 local (-08:00) and Oct 21 local (+10:00)
  const a = { activityType: 'Running', start: '2026-10-20T20:00:00-08:00', end: '2026-10-20T20:45:00-08:00', durationMin: 45 };
  const b = { activityType: 'Running', start: '2026-10-21T14:00:00+10:00', end: '2026-10-21T14:45:00+10:00', durationMin: 45 };
  assert.equal(Date.parse(a.start), Date.parse(b.start));
  const other = wk('2026-10-10');
  const snap = { ...mk(dates, [other, a, b]), exportDate: now };
  const clean = { ...mk(dates, [other]), exportDate: now };
  const noRecords = (d) => ({ ...clean, dailySummaries: clean.dailySummaries.filter((x) => x.date !== d) });
  for (const d of ['2026-10-20', '2026-10-21']) {
    const got = engine(snap, now, { forgottenDays: [d] });
    assert.equal(JSON.stringify(got), JSON.stringify(engine(noRecords(d), now)), d);
    assert.equal(find(got, 'volume.28d').numbers.workouts, 1, d); // only Oct 10's: the duplicate is gone from both dates
    assert.ok(!JSON.stringify(got).includes('45'), `${d}: the forgotten workout's minutes appear`);
  }
  // not forgotten: counted once
  assert.equal(find(engine(snap, now), 'volume.28d').numbers.workouts, 2);
});

test('target progress: a percentage only for a non-zero value with a ratio from 0.1 to 10', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  const text = (n, target) => {
    const work = dayList('2026-10-24', n).map((d) => wk(d));
    return find(completedFacts(mk(dates, work, { target: { workoutsPerWeek: target } }), now), 'goal.target_progress');
  };
  assert.equal(text(2, 4).text, 'Progress to the target of 4 workouts per week: 2 counted workouts (10 minutes or more) in the last 7 days, ratio 0.50 to the target (50.0% of the target).');
  assert.equal(text(2, 4).numbers.percentOfTarget, 50);
  assert.equal(text(4, 4).text.endsWith('ratio 1.00 to the target (100.0% of the target).'), true);
  assert.equal(text(0, 4).text, 'Progress to the target of 4 workouts per week: 0 counted workouts (10 minutes or more) in the last 7 days, ratio 0 to the target.');
  assert.equal(text(0, 4).numbers.percentOfTarget, null);
  assert.equal(text(0, 4).numbers.ratio, 0);
  assert.equal(text(1, 20).text.endsWith('ratio 0.05 to the target.'), true); // below 0.1
  assert.equal(text(1, 20).numbers.percentOfTarget, null);
  assert.equal(text(7, 0.5).text.endsWith('ratio 14.00 to the target.'), true); // above 10
  assert.equal(text(5, 0.5).text.endsWith('ratio 10.00 to the target (1000.0% of the target).'), true); // exactly 10
  assert.equal(text(1, 10).text.endsWith('ratio 0.10 to the target (10.0% of the target).'), true); // exactly 0.1
});

test('the window of a fact is the days it represents when history is short', () => {
  const run = (days) => completedFacts(...(() => { const g = generateScenario('thin', 3, { days }); return [g.snapshot, g.now]; })());
  for (const [days, perWeekWindow, gapWindow, weeks] of [[14, '14d', '14d', 2], [20, '14d', '20d', 2], [21, '21d', '21d', 3], [27, '21d', '27d', 3], [28, '28d', '28d', 4], [60, '28d', '28d', 4]]) {
    const f = run(days);
    const pw = find(f, 'regularity.per_week');
    assert.equal(pw.window, perWeekWindow, `${days} days: per_week`);
    assert.equal(pw.numbers.perWeek.length, weeks);
    assert.match(pw.text, new RegExp(`in each of the last ${weeks} weeks`));
    const gap = find(f, 'regularity.longest_gap');
    assert.equal(gap.window, gapWindow, `${days} days: gap`);
    assert.match(gap.text, new RegExp(`in the last ${gapWindow.slice(0, -1)} days`));
    assert.equal(gap.numbers.windowDays, Number(gapWindow.slice(0, -1)));
  }
});
