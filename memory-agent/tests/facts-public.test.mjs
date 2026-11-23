// The public engine, called the way the app calls it: the real supplied time, default options, and expectations written
// by hand (not derived from the engine). Both day modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFacts, FACT_TEMPLATES } from '../src/facts/index.mjs';

const day = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
const rec = (date, startHhmm, endHhmm, min) => ({ activityType: 'Running', start: `${date}T${startHhmm}:00-08:00`, end: `${date}T${endHhmm}:00-08:00`, durationMin: min });
const snapshot = (workouts, exportDate) => ({
  exportDate,
  persona: { key: 't' },
  dailySummaries: day('2026-10-01', 30).map((date) => ({ date, restingHeartRate: 50, sleepMinutes: { totalAsleep: 420 } })), // Oct 1 to 30, all logged
  workouts,
});
const text = (facts, id) => facts.find((f) => f.id === id)?.text;
const ids = (facts) => facts.map((f) => f.id);
const TODAY_COMPARISONS = ['past.today_vs_avg', 'past.today_vs_highest', 'past.today_rank'];

// Oct 22: 60 min. Oct 29: 30 min. Oct 30 (the day in progress or just ended): 45 min, 07:00 to 07:45.
const WORK = [rec('2026-10-22', '07:00', '08:00', 60), rec('2026-10-29', '07:00', '07:30', 30), rec('2026-10-30', '07:00', '07:45', 45)];

test('default call at midday: the day is in progress (hand-written expectations)', () => {
  const now = '2026-10-30T12:00:00-08:00';
  const f = computeFacts(snapshot(WORK, now), now); // no options
  assert.equal(text(f, 'volume.today_so_far'), 'So far today (2026-10-30): 1 counted workout (10 minutes or more) and 45 workout minutes, day not finished.');
  // everything else describes the days up to the end of Oct 29
  assert.equal(text(f, 'volume.week'), 'Counted in the last 7 days (2026-10-23 to 2026-10-29; workouts of 10 minutes or more): 1 workout and 30 workout minutes on 7 logged days (0 unlogged days).');
  assert.equal(text(f, 'volume.28d'), 'Counted in the last 28 days (2026-10-02 to 2026-10-29; workouts of 10 minutes or more): 2 workouts and 90 workout minutes on 28 logged days (0 unlogged days).');
  assert.equal(text(f, 'regularity.days_since_last'), 'Days since the last counted workout (10 minutes or more) as of 2026-10-29: 0 (2026-10-29); 2 counted workouts in the last 28 days.');
  // nothing about today is compared
  for (const id of ['volume.today', ...TODAY_COMPARISONS]) assert.ok(!ids(f).includes(id), id);
  for (const fact of f) {
    if (fact.id !== 'volume.today_so_far') assert.doesNotMatch(fact.text, /2026-10-30/, fact.id);
  }
});

test('default call in progress, the last workout was before yesterday: the as-of date makes the count honest', () => {
  const now = '2026-10-30T12:00:00-08:00';
  // workouts on Oct 28 and (today) Oct 30; none on Oct 29
  const f = computeFacts(snapshot([rec('2026-10-28', '07:00', '07:30', 30), rec('2026-10-30', '07:00', '07:45', 45)], now), now);
  assert.equal(text(f, 'regularity.days_since_last'), 'Days since the last counted workout (10 minutes or more) as of 2026-10-29: 1 (2026-10-28); 1 counted workout in the last 28 days.');
  // only today's workout (no earlier one in 28 days): the sentence names the as-of date too
  const g = computeFacts(snapshot([rec('2026-10-30', '07:00', '07:45', 45)], now), now);
  assert.equal(text(g, 'regularity.days_since_last'), 'No counted workout in the last 28 days as of 2026-10-29: 0 workouts.');
  assert.equal(text(g, 'volume.today_so_far'), 'So far today (2026-10-30): 1 counted workout (10 minutes or more) and 45 workout minutes, day not finished.');
});

test('default call at midnight: the day that just ended is described and compared (hand-written expectations)', () => {
  const now = '2026-10-31T00:00:00-08:00';
  const f = computeFacts(snapshot(WORK, now), now); // no options
  assert.equal(text(f, 'volume.today'), 'On 2026-10-30: 1 counted workout (10 minutes or more) and 45 workout minutes.');
  assert.equal(text(f, 'volume.week'), 'Counted in the last 7 days (2026-10-24 to 2026-10-30; workouts of 10 minutes or more): 2 workouts and 75 workout minutes on 7 logged days (0 unlogged days).');
  assert.equal(text(f, 'volume.28d'), 'Counted in the last 28 days (2026-10-03 to 2026-10-30; workouts of 10 minutes or more): 3 workouts and 135 workout minutes on 28 logged days (0 unlogged days).');
  assert.equal(text(f, 'regularity.days_since_last'), 'Days since the last counted workout (10 minutes or more) as of 2026-10-30: 0 (2026-10-30); 3 counted workouts in the last 28 days.');
  // previous 28 days (Oct 2 to 29): 90 minutes over 28 logged days = 3.2143 a day; 45 / 3.2143 = 14; above 10, so no percentage
  assert.equal(text(f, 'past.today_vs_avg'), '45 workout minutes on 2026-10-30, ratio 14.00 to the daily average of 3.21 minutes over the previous 28 days (28 logged days).');
  assert.equal(text(f, 'past.today_rank'), 'The workout minutes on 2026-10-30 (45) rank 2 of 28 logged days in the last 28 days, where 1 is the highest.');
  assert.ok(!ids(f).includes('volume.today_so_far'));
});

test('any other time of day is in progress: a refresh never compares today, and the other facts do not move', () => {
  let previous = null;
  for (const t of ['00:00:01', '00:00:00.500', '06:00:00', '07:44:59', '07:45:00', '12:00:00', '23:59:59']) {
    const now = `2026-10-30T${t}-08:00`;
    const f = computeFacts(snapshot(WORK, now), now);
    for (const id of ['volume.today', ...TODAY_COMPARISONS]) assert.ok(!ids(f).includes(id), `${t} ${id}`);
    const sofar = f.find((x) => x.id === 'volume.today_so_far');
    assert.ok(sofar, t);
    // the workout counts from 07:45:00 on (it has ended)
    const counted = t >= '07:45:00' ? 1 : 0;
    assert.equal(sofar.numbers.workouts, counted, t);
    assert.equal(sofar.numbers.minutes, counted ? 45 : 0, t);
    assert.doesNotMatch(sofar.text, /ratio|%|above|below|average|rank/, t);
    // every other fact is the same at every time of the day
    const rest = JSON.stringify(f.filter((x) => x.id !== 'volume.today_so_far'));
    if (previous !== null) assert.equal(rest, previous, t);
    previous = rest;
  }
});

test('durations are exact to the millisecond in numbers; sentences show two decimals', () => {
  const now = '2026-10-31T00:00:00-08:00';
  const one = (min) => computeFacts(snapshot([rec('2026-10-30', '07:00', '08:30', min)], now), now).find((f) => f.id === 'volume.today');
  assert.equal(one(10.004).numbers.minutes, 10.004);
  assert.equal(one(10.004).text, 'On 2026-10-30: 1 counted workout (10 minutes or more) and 10 workout minutes.');
  assert.equal(one(10.005).text.endsWith('and 10.01 workout minutes.'), true); // half rounds away from zero
  assert.equal(one(10.006).numbers.minutes, 10.006);
  assert.equal(one(10.994).text.endsWith('and 10.99 workout minutes.'), true);
  assert.equal(one(10.995).text.endsWith('and 11 workout minutes.'), true);
  assert.equal(one(54.4).text.endsWith('and 54.4 workout minutes.'), true);
  assert.equal(one(54.43).text.endsWith('and 54.43 workout minutes.'), true);
  assert.equal(one(10.0000004).numbers.minutes, 10); // below a millisecond: held as 10 minutes
  // sums are exact: three workouts of 10.004 minutes are 30.012, not 30.011999999999997
  const three = computeFacts(snapshot([rec('2026-10-30', '05:00', '06:00', 10.004), rec('2026-10-30', '07:00', '08:00', 10.004), rec('2026-10-30', '09:00', '10:00', 10.004)], now), now);
  assert.equal(three.find((f) => f.id === 'volume.today').numbers.minutes, 30.012);
  assert.equal(three.find((f) => f.id === 'volume.week').numbers.minutes, 30.012);
  assert.equal(three.find((f) => f.id === 'volume.today').text.endsWith('and 30.01 workout minutes.'), true);
  // 0.1-style noise: 10.1 + 10.2 + 10.3 is 30.6
  const noise = computeFacts(snapshot([rec('2026-10-30', '05:00', '06:00', 10.1), rec('2026-10-30', '07:00', '08:00', 10.2), rec('2026-10-30', '09:00', '10:00', 10.3)], now), now);
  assert.equal(noise.find((f) => f.id === 'volume.today').numbers.minutes, 30.6);
  // a duration under 10 minutes by a millisecond is not counted
  const short = computeFacts(snapshot([rec('2026-10-30', '07:00', '08:00', 9.99998)], now), now).find((f) => f.id === 'volume.today');
  assert.equal(short.numbers.workouts, 0);
  assert.equal(short.numbers.shortWorkouts, 1);
});

test('auto mode compares instants, not strings: a Date at 00:00:00.500 is not a midnight (string and Date forms)', () => {
  const forms = [
    // [label, now as a string, now as a Date, expected mode]
    ['00:00:00.000', '2026-10-31T00:00:00.000-08:00', new Date('2026-10-31T08:00:00.000Z'), 'completed'],
    ['00:00:00.500', '2026-10-31T00:00:00.500-08:00', new Date('2026-10-31T08:00:00.500Z'), 'in_progress'],
    ['23:59:59.999', '2026-10-30T23:59:59.999-08:00', new Date('2026-10-31T07:59:59.999Z'), 'in_progress'],
    ['00:00:00.001', '2026-10-31T00:00:00.001-08:00', new Date('2026-10-31T08:00:00.001Z'), 'in_progress'],
  ];
  for (const [label, str, date, mode] of forms) {
    for (const now of [str, date]) {
      const snap = snapshot(WORK, '2026-10-31T00:00:00-08:00'); // exportDate carries the -08:00 offset
      const f = computeFacts(snap, now);
      if (mode === 'completed') {
        assert.ok(ids(f).includes('volume.today') && ids(f).includes('past.today_vs_avg'), `${label} ${now instanceof Date ? 'Date' : 'string'}`);
        assert.match(text(f, 'volume.today'), /^On 2026-10-30:/);
      } else {
        assert.ok(!ids(f).includes('volume.today') && !TODAY_COMPARISONS.some((id) => ids(f).includes(id)), `${label} ${now instanceof Date ? 'Date' : 'string'}`);
        assert.ok(ids(f).includes('volume.today_so_far') || ids(f).includes('volume.today_unlogged'), label);
      }
    }
    // the two forms give the same facts
    const snap = snapshot(WORK, '2026-10-31T00:00:00-08:00');
    assert.equal(JSON.stringify(computeFacts(snap, str)), JSON.stringify(computeFacts(snap, date)), label);
  }
});

test('a duration just below 10 minutes is short, however it rounds', () => {
  const now = '2026-10-31T00:00:00-08:00';
  const day = (min) => computeFacts(snapshot([rec('2026-10-30', '07:00', '08:00', min)], now), now).find((f) => f.id === 'volume.today');
  for (const min of [9.999999, 9.99999999, 9.9999999999]) {
    const f = day(min);
    assert.equal(f.numbers.workouts, 0, String(min));
    assert.equal(f.numbers.shortWorkouts, 1, String(min));
    assert.equal(f.numbers.minutes, 0, String(min));
    assert.match(f.text, /, 1 under 10 minutes not counted\.$/);
  }
  for (const min of [10, 10.0000001, 10.000001]) {
    const f = day(min);
    assert.equal(f.numbers.workouts, 1, String(min));
    assert.equal(f.numbers.shortWorkouts, 0, String(min));
  }
  // counted workouts still sum exactly in integer milliseconds
  assert.equal(day(10.000001).numbers.minutes, 10); // 600000.06 ms is held as 600000 ms
});

// ---- exact arithmetic ------------------------------------------------------------------------------------------------

const withReadings = (rhr, sleep) => ({
  exportDate: '2026-10-31T00:00:00-08:00',
  persona: { key: 't' },
  dailySummaries: day('2026-10-03', 28).map((date, i) => ({ date, restingHeartRate: rhr[i], sleepMinutes: { totalAsleep: sleep[i] } })), // Oct 3 to Oct 30
  workouts: [],
});
const MID = '2026-10-31T00:00:00-08:00';
const body = (snap, id) => computeFacts(snap, MID).find((f) => f.id === id);

test('averages of readings are exact: equal means equal, a tiny real difference keeps its direction', () => {
  const flat = Array(28).fill(60.05);
  const same = body(withReadings(flat, Array(28).fill(441)), 'body.resting_hr');
  assert.equal(same.numbers.direction, 'equal'); // float accumulation of 60.05 would call this above or below
  assert.match(same.text, /^Average resting heart rate over the last 7 days: 60\.05 bpm \(from 7 days with a reading\), equal to the 28-day average of 60\.05 bpm/);
  assert.equal(same.numbers.difference, 0);
  // a periodic pattern: every 7-day block is identical, so the 7-day and 28-day averages are exactly equal
  const block = [60.05, 60.15, 59.95, 60.1, 60.0, 60.2, 59.9];
  const periodic = Array.from({ length: 28 }, (_, i) => block[i % 7]);
  assert.equal(body(withReadings(periodic, Array(28).fill(441)), 'body.resting_hr').numbers.direction, 'equal');
  // 6 decimals: one old reading differs by 0.000001, so the 7-day average is below the 28-day average, by far less than 0.1
  const tiny = [...flat];
  tiny[0] = 60.050001;
  const t = body(withReadings(tiny, Array(28).fill(441)), 'body.resting_hr');
  assert.equal(t.numbers.direction, 'below');
  assert.match(t.text, /less than 0\.01 bpm below the 28-day average/);
  // sleep: 441 minutes is 7.35 hours; one old night 0.000001 minutes longer
  const sleepTiny = Array(28).fill(441);
  sleepTiny[0] = 441.000001;
  const s = body(withReadings(flat, sleepTiny), 'body.sleep');
  assert.equal(s.numbers.direction, 'below');
  assert.match(s.text, /^Average sleep over the last 7 days: 7\.35 h .*less than 0\.01 h below the 28-day average of 7\.35 h/);
  assert.equal(body(withReadings(flat, Array(28).fill(441)), 'body.sleep').numbers.direction, 'equal');
  // a real difference is shown rounded half away from zero: 7-day 60.05 against 28-day 60.1625 (readings 60.05 and 60.2)
  const mixed = Array.from({ length: 28 }, (_, i) => (i >= 21 ? 60.05 : 60.2));
  const m = body(withReadings(mixed, Array(28).fill(441)), 'body.resting_hr');
  assert.equal(m.numbers.direction, 'below');
  assert.match(m.text, /60\.05 bpm \(from 7 days with a reading\), 0\.11 bpm below the 28-day average of 60\.16 bpm/); // 60.1625 -> 60.16, difference 0.1125 -> 0.11
  assert.equal(m.numbers.average28, 60.16);
  assert.equal(m.numbers.average7, 60.05);
  assert.deepEqual(m.numbers.exact.average28, { num: 28 * 0 + 1684550000, den: 28000000 }); // 21 x 60.2 + 7 x 60.05 over 28 days, in 1e-6 units
  // two decimals, not one: an average of 60.04 shows 60.04
  assert.match(body(withReadings(Array(28).fill(60.04), Array(28).fill(441)), 'body.resting_hr').text, /: 60\.04 bpm \(from 7 days/);
});

test('readings with more than 6 decimals are refused with fixed text', () => {
  const bad = withReadings(Array(28).fill(60.0000001), Array(28).fill(441));
  assert.throws(() => computeFacts(bad, MID), (e) => e.message.includes('restingHeartRate: must have at most 6 decimals') && !e.message.includes('0000001'));
  const bad2 = withReadings(Array(28).fill(60), Array(28).fill(441.0000001));
  assert.throws(() => computeFacts(bad2, MID), (e) => e.message.includes('sleepMinutes: must have at most 6 decimals'));
  computeFacts(withReadings(Array(28).fill(60.000001), Array(28).fill(441.000001)), MID); // 6 decimals are fine
});

test('minutes comparisons are exact too: an average that equals today exactly is "equal"', () => {
  // previous 28 days alternate 10.001 and 10.003 minutes (600060 and 600180 ms): average 10.002; the day is 10.002
  const days = day('2026-10-02', 29); // Oct 2 to Oct 30
  const work = days.map((d, i) => rec(d, '07:00', '08:00', d === '2026-10-30' ? 10.002 : i % 2 === 0 ? 10.001 : 10.003));
  const f = computeFacts(snapshot(work, MID), MID).find((x) => x.id === 'past.today_vs_avg');
  assert.equal(f.numbers.direction, 'equal');
  assert.match(f.text, /ratio 1\.00 to the daily average of 10\.00 minutes over the previous 28 days \(28 logged days, equal\)\.$/);
});

test('duplicate records that straddle the counting threshold give the same facts in either order', () => {
  const a = rec('2026-10-30', '07:00', '08:00', 9.999999); // short, though it rounds to 10 minutes
  const b = rec('2026-10-30', '07:00', '08:00', 10);
  const x = computeFacts(snapshot([a, b], MID), MID);
  const y = computeFacts(snapshot([b, a], MID), MID);
  assert.equal(JSON.stringify(x), JSON.stringify(y));
  assert.equal(x.find((f) => f.id === 'volume.today').numbers.workouts, 1); // the longer (unrounded) repeat is the one kept
  assert.equal(x.find((f) => f.id === 'volume.today').numbers.shortWorkouts, 0);
});

test('computeFacts validates first: conflicts and bad values never produce a fact (both orders)', () => {
  const base = snapshot([rec('2026-10-30', '07:00', '08:00', 30)], MID);
  const s1 = { date: '2026-10-29', restingHeartRate: 50 };
  const s2 = { date: '2026-10-29', restingHeartRate: 51 };
  const others = base.dailySummaries.filter((d) => d.date !== '2026-10-29');
  for (const order of [[s1, s2], [s2, s1]]) {
    assert.throws(() => computeFacts({ ...base, dailySummaries: [...others, ...order] }, MID), /snapshot failed validation: dailySummaries\[\d+\]: conflicts with another summary for the same date/);
  }
  const e1 = { ...rec('2026-10-29', '07:00', '08:00', 30), effort: 3 };
  const e2 = { ...e1, effort: 4 };
  for (const order of [[e1, e2], [e2, e1]]) {
    assert.throws(() => computeFacts({ ...base, workouts: [...base.workouts, ...order] }, MID), /snapshot failed validation: workouts\[\d+\]: conflicts with another workout/);
  }
  assert.throws(() => computeFacts({ ...base, exportDate: 'nope' }, MID), /exportDate/);
  assert.throws(() => computeFacts(null, MID), /snapshot failed validation/);
});

test('the median is rounded for display from its exact value, not from a millisecond-rounded one', () => {
  // 10.004983 min is 600298.98 ms (held as 600299) and 10.005 min is 600300 ms: the median is 600299.5 ms = 10.00499... minutes
  const med = (...mins) => computeFacts(snapshot(mins.map((m, i) => rec(day('2026-10-20', 10)[i], '07:00', '08:00', m)), MID), MID).find((f) => f.id === 'mix.median_length');
  assert.match(med(10.004983, 10.005).text, /running 10 min\.$/); // not 10.01
  assert.match(med(10.005).text, /running 10\.01 min\.$/); // a single 10.005 min workout is 600300 ms: half rounds up
  assert.match(med(10.004, 10.006).text, /running 10\.01 min\.$/); // 10.005 exactly
  assert.match(med(10.003, 10.006).text, /running 10 min\.$/); // 10.0045
  assert.match(med(10.004, 10.007, 10.008).text, /running 10\.01 min\.$/);
  // numbers carry the 2-decimal value shown, and `exact` the fraction behind it (exact to the millisecond)
  assert.equal(med(10.004983, 10.005).numbers.medianMinutesByActivity.Running, 10);
  assert.deepEqual(med(10.004983, 10.005).numbers.exact.medianMinutesByActivity.Running, { num: 1200599, den: 120000 });
  assert.equal(med(10.0005).numbers.medianMinutesByActivity.Running, 10); // 10.0005 min shows 10 ...
  assert.deepEqual(med(10.0005).numbers.exact.medianMinutesByActivity.Running, { num: 600030, den: 60000 }); // ... and the fraction keeps it
  assert.equal(med(10, 20).numbers.medianMinutesByActivity.Running, 15);
  assert.equal(med(10.126).numbers.medianMinutesByActivity.Running, 10.13);
});

test('numbers hold 2-decimal values that match the sentence, and `exact` carries the fractions behind them', () => {
  const dates = day('2026-10-02', 29);
  const work = dates.map((d, i) => rec(d, '07:00', '08:00', i % 3 === 0 ? 31 : 29)); // Oct 2 to 30
  const f = computeFacts(snapshot(work, MID), MID);
  const get = (id) => f.find((x) => x.id === id);
  const t = get('past.today_vs_avg');
  // previous 28 days: Oct 2..29, i = 0..27: nine 31s... i%3===0 -> 10 days of 31 and 18 of 29 = 832 minutes, average 29.714285...
  assert.equal(t.numbers.averageMinutesPerDay, 29.71);
  assert.deepEqual(t.numbers.exact.averageMinutesPerDay, { num: 49920000, den: 1680000 }); // 832 min in ms / (28 days * 60000)
  assert.equal(t.numbers.exact.averageMinutesPerDay.num / t.numbers.exact.averageMinutesPerDay.den, 832 / 28);
  assert.match(t.text, /daily average of 29\.71 minutes/);
  assert.equal(t.numbers.ratio, Math.round(100 * t.numbers.exact.ratio.num / t.numbers.exact.ratio.den) / 100);
  for (const id of ['past.week_vs_avg', 'load.ratio']) assert.ok(get(id).numbers.exact.ratio.den > 0, id);
  assert.ok(get('goal.workouts_per_week').numbers.exact.baselineWorkoutsPerWeek.den > 0);
});

test('every fact is linted at the output boundary: an invalid line makes computeFacts throw (the coverage fact included)', () => {
  const work = day('2026-10-02', 29).map((d) => rec(d, '07:00', '08:00', 30));
  const snap = snapshot(work, MID);
  assert.ok(computeFacts(snap, MID).length > 10); // fine as shipped
  const restore = { ...FACT_TEMPLATES };
  try {
    for (const id of ['volume.today', 'coverage.28d', 'load.ratio', 'mix.count', 'past.today_vs_avg']) {
      // a template that no longer matches what the engine writes (the engine's wording and the lint disagree)
      FACT_TEMPLATES[id] = [/^an invalid line$/];
      assert.throws(() => computeFacts(snap, MID), (e) => e.message === `fact failed lint: ${id}: no template match`, id);
      FACT_TEMPLATES[id] = restore[id];
    }
  } finally {
    Object.assign(FACT_TEMPLATES, restore);
  }
  assert.ok(computeFacts(snap, MID).length > 10);
  // the first problem found is reported with the id and categories only, never the sentence
  FACT_TEMPLATES['volume.week'] = [/^nothing$/];
  try {
    assert.throws(() => computeFacts(snap, MID), (e) => !/\d/.test(e.message.replace('volume.week', '')) && !e.message.includes('workout'));
  } finally {
    FACT_TEMPLATES['volume.week'] = restore['volume.week'];
  }
});
