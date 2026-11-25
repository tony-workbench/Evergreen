// An independent oracle: a plain, separate implementation written from the raw snapshot.
// It imports nothing from the engine. It works on date strings and arrays, the engine works on day numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { completedFacts } from './helpers/completed-day.mjs';
import { computeFacts as engine } from '../src/facts/index.mjs';
import { endOfDay } from './helpers/completed-day.mjs';
import { generateScenario, SCENARIO_KINDS } from '../src/scenarios/generate.mjs';

const dir = new URL('../fixtures/personas/', import.meta.url);
const personas = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]);

const plus = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const total = (a) => a.reduce((x, y) => x + y, 0);
const med = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Independent specification of what may be claimed. Unlogged days are UNKNOWN, never zero:
//  - today is claimed only if today is logged; otherwise only "today has no data".
//  - totals say what was recorded, with the logged and unlogged day counts of their window.
//  - comparisons that need the whole week (week vs 4-week average, load, workouts per week, target) are claimed only
//    when all 7 of the last days are logged; otherwise one "not stated" fact with the counts.
//  - an average over earlier days is claimed only with at least 7 logged days behind it.
const KNOWN = ['Running', 'Walking', 'Cycling', 'Hiking', 'Swimming', 'Rowing', 'Elliptical', 'StairClimbing', 'Yoga', 'Pilates', 'Dance', 'CoreTraining', 'Flexibility', 'MixedCardio', 'FunctionalStrengthTraining', 'TraditionalStrengthTraining', 'HighIntensityIntervalTraining', 'Boxing', 'Tennis', 'Soccer', 'Basketball', 'Golf', 'Skiing', 'Climbing'];

function oracle(snap, nowStr, mode = 'completed') {
  const nowDate = nowStr.slice(0, 10);
  const midnight = /T00:00(:00(\.0+)?)?(Z|[+-]\d\d:\d\d)$/.test(nowStr);
  // completed: the day that has just ended (the day before now when now is exactly 00:00 local), else the day of now.
  // in_progress: the last completed day is the day before now; now's own day is unfinished.
  const today = mode === 'in_progress' ? plus(nowDate, -1) : midnight ? plus(nowDate, -1) : nowDate;
  const liveDate = mode === 'in_progress' ? nowDate : null;
  const nowT = new Date(nowStr).getTime();
  // Repeats (same activity and instant) are one workout whatever their offsets: keep the longest, then the smallest start string.
  const groups = {};
  for (const w of snap.workouts) {
    const t = new Date(w.start).getTime();
    if (t > nowT || new Date(w.end).getTime() > nowT || w.start.slice(0, 10) > (liveDate ?? today)) continue;
    (groups[`${w.activityType}@${t}`] ||= []).push(w);
  }
  const uniqueAll = Object.values(groups).map((g) => g.slice().sort((x, y) => y.durationMin - x.durationMin || (x.start < y.start ? -1 : 1))[0]);
  const unique = uniqueAll.filter((w) => w.start.slice(0, 10) <= today); // completed days only
  const liveRecords = uniqueAll.filter((w) => w.start.slice(0, 10) === liveDate);
  const ws = unique
    .filter((w) => w.durationMin * 60000 >= 600000)
    .map((w) => ({ date: w.start.slice(0, 10), raw: w.activityType, type: KNOWN.includes(w.activityType) ? w.activityType : 'Other', hour: Number(w.start.slice(11, 13)), min: w.durationMin, effort: typeof w.effort === 'number' && w.effort >= 1 && w.effort <= 10 ? w.effort : null }));
  // A summary dated today counts only if the snapshot was exported at or before now; a later export is a look-back,
  // and then only summaries dated strictly before today are known as of now.
  const lookBack = new Date(snap.exportDate).getTime() > nowT;
  // Short workouts (under 10 minutes): real records, not counted. The oracle counts them per day.
  const shortDates = unique.filter((w) => !(w.durationMin * 60000 >= 600000)).map((w) => w.start.slice(0, 10));
  const sums = snap.dailySummaries.filter((s) => s.date <= today && !(lookBack && s.date >= today));
  // A day is logged by a summary or by ANY unique workout record up to now, short ones included.
  const loggedDates = new Set([...sums.map((s) => s.date), ...unique.map((w) => w.start.slice(0, 10))]);
  const at = (k) => plus(today, -k);
  const minAt = (k) => total(ws.filter((w) => w.date === at(k)).map((w) => w.min));
  const cntAt = (k) => ws.filter((w) => w.date === at(k)).length;
  const isLogged = (k) => loggedDates.has(at(k));
  const ks = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const out = { logged: loggedDates.size, ids: [], day: today };
  out.live = liveDate === null ? null : { workouts: liveRecords.filter((w) => w.durationMin * 60000 >= 600000).length, minutes: total(liveRecords.filter((w) => w.durationMin * 60000 >= 600000).map((w) => w.durationMin)), short: liveRecords.filter((w) => !(w.durationMin * 60000 >= 600000)).length, logged: liveRecords.length > 0 || (!lookBack && snap.dailySummaries.some((s) => s.date === liveDate)) };
  if (loggedDates.size < 14) {
    out.ids = ['history.thin'];
    return out;
  }
  const first = [...loggedDates].sort()[0];
  const m = (a, b) => total(ks(a, b).map(minAt));
  const c = (a, b) => total(ks(a, b).map(cntAt));
  const lg = (a, b) => ks(a, b).filter(isLogged).length;
  const ids = ['volume.week', 'volume.28d', 'regularity.days_since_last', 'regularity.longest_gap', 'regularity.per_week', 'mix.count'];
  out.ids = ids;

  out.coverage = lg(0, 27);
  const shortAt = (k) => shortDates.filter((d) => d === at(k)).length;
  out.short = { today: shortAt(0), week: total(ks(0, 6).map(shortAt)), d28: total(ks(0, 27).map(shortAt)) };
  out.todayLogged = isLogged(0);
  out.today = { workouts: cntAt(0), minutes: minAt(0) };
  out.week = { workouts: c(0, 6), minutes: m(0, 6), logged: lg(0, 6), unlogged: 7 - lg(0, 6) };
  out.d28 = { workouts: c(0, 27), minutes: m(0, 27), logged: lg(0, 27), unlogged: 28 - lg(0, 27) };
  if (mode === 'completed') ids.push(out.todayLogged ? 'volume.today' : 'volume.today_unlogged');
  else ids.push(out.live.logged ? 'volume.today_so_far' : 'volume.today_unlogged');

  if (mode === 'completed' && out.todayLogged && lg(1, 28) >= 7) {
    const avg = m(1, 28) / lg(1, 28);
    out.vsAvg = { avg, ratio: avg > 0 ? minAt(0) / avg : null, pct: avg > 0 && minAt(0) !== 0 && minAt(0) / avg >= 0.1 && minAt(0) / avg <= 10 ? Math.abs(minAt(0) / avg - 1) * 100 : null, logged: lg(1, 28), dir: minAt(0) === avg ? 'equal' : minAt(0) > avg ? 'above' : 'below' };
    ids.push('past.today_vs_avg');
    const hi = Math.max(...ks(1, 28).map(minAt));
    out.vsHighest = hi > 0 && minAt(0) / hi >= 2 ? { hi, ratio: minAt(0) / hi } : null;
    if (out.vsHighest) ids.push('past.today_vs_highest');
  }
  if (mode === 'completed' && out.todayLogged && minAt(0) > 0) {
    const pool = ks(0, 27).filter(isLogged);
    out.dayRank = { rank: 1 + pool.filter((k) => minAt(k) > minAt(0)).length, of: pool.length };
    ids.push('past.today_rank');
  }
  const weekComplete = lg(0, 6) === 7;
  if (!weekComplete) ids.push('past.week_comparisons_skipped');
  if (weekComplete && lg(7, 34) >= 7) {
    const base = (m(7, 34) / lg(7, 34)) * 7;
    out.weekVsAvg = { avg: base, ratio: base > 0 ? m(0, 6) / base : null, pct: base > 0 && m(0, 6) !== 0 && m(0, 6) / base >= 0.1 && m(0, 6) / base <= 10 ? Math.abs(m(0, 6) / base - 1) * 100 : null, logged: lg(7, 34), dir: m(0, 6) === base ? 'equal' : m(0, 6) > base ? 'above' : 'below' };
    const bpw = (c(7, 34) / lg(7, 34)) * 7;
    out.goal = { base: bpw, ratio: bpw > 0 ? c(0, 6) / bpw : null, logged: lg(7, 34) };
    ids.push('past.week_vs_avg', 'goal.workouts_per_week');
  }
  if (weekComplete && typeof snap.target?.workoutsPerWeek === 'number' && snap.target.workoutsPerWeek > 0) ids.push('goal.target_progress');
  const complete = [];
  for (let j = 0; j < 12; j++) if (ks(7 * j, 7 * j + 6).every(isLogged)) complete.push(m(7 * j, 7 * j + 6));
  if (complete.length >= 2 && weekComplete) {
    out.weekRank = { rank: 1 + complete.filter((x) => x > complete[0]).length, of: complete.length };
    ids.push('past.week_rank');
  }
  // load: effort x minutes when every counted workout of the last 28 days has an effort score, else minutes
  if (weekComplete && lg(0, 27) >= 7) {
    const in28 = ws.filter((w) => w.date >= at(27));
    const effort = in28.length > 0 && in28.every((w) => w.effort !== null);
    const val = (w) => (effort ? w.effort * w.min : w.min);
    const weekly = (total(in28.map(val)) / lg(0, 27)) * 7;
    const l7 = total(in28.filter((w) => w.date >= at(6)).map(val));
    if (weekly > 0) {
      out.load = { ratio: l7 / weekly, weekly, l7, basis: effort ? 'effort' : 'minutes', pct: l7 !== 0 && l7 / weekly >= 0.1 && l7 / weekly <= 10 ? Math.abs(l7 / weekly - 1) * 100 : null };
      ids.push('load.ratio', 'coverage.28d'); // the coverage sentence belongs to the load average
    }
  }
  // regularity
  const lastDate = ws.filter((w) => w.date >= at(27)).map((w) => w.date).sort().pop(); // latest local date among counted workouts of the last 28 days
  out.sinceLast = lastDate ? Math.round((new Date(today) - new Date(lastDate)) / 86400000) : null;
  const winDates = ks(0, 27).map(at).filter((d) => d >= first).sort();
  // One letter per day of the window: W workout, L logged without a workout, U unlogged. Longest run of L.
  const seq = winDates.map((d) => (ws.some((w) => w.date === d) ? 'W' : loggedDates.has(d) ? 'L' : 'U')).join('');
  out.gap = { gap: Math.max(0, ...(seq.match(/L+/g) || []).map((r) => r.length)), window: winDates.length, unlogged: (seq.match(/U/g) || []).length };
  out.perWeek = [];
  out.perWeekLogged = [];
  for (let j = 0; j < 4 && at(7 * j + 6) >= first; j++) {
    out.perWeek.push(c(7 * j, 7 * j + 6));
    out.perWeekLogged.push(lg(7 * j, 7 * j + 6));
  }
  // slots: grouped by the ORIGINAL activity; an unrecognised activity never gets a slot
  const slotWeeks = {};
  for (const w of ws) {
    const k = Math.round((new Date(today) - new Date(w.date)) / 86400000);
    if (k > 27) continue;
    const wd = new Date(`${w.date}T12:00:00Z`).getUTCDay();
    (slotWeeks[`${w.raw}|${wd}|${w.hour}`] ||= new Set()).add(Math.floor(k / 7));
  }
  out.slots = Object.fromEntries(Object.entries(slotWeeks).filter(([k, st]) => st.size >= 3 && KNOWN.includes(k.split('|')[0])).map(([k, st]) => [k, st.size]));
  if (!Object.keys(out.slots).length) ids.push('regularity.slots_none');
  // mix
  const w28 = ws.filter((w) => w.date >= at(27));
  out.mix = {};
  for (const w of w28) (out.mix[w.type] ||= []).push(w.min);
  out.bands = { morning: w28.filter((w) => w.hour < 12).length, afternoon: w28.filter((w) => w.hour >= 12 && w.hour < 17).length, evening: w28.filter((w) => w.hour >= 17).length };
  if (w28.length) ids.push('mix.median_length', 'mix.start_bands');
  // body
  const vals = (pick, a, b) => ks(a, b).map((k) => sums.find((s) => s.date === at(k))).filter(Boolean).map(pick).filter((v) => typeof v === 'number');
  const sleep = (s) => (s.sleepMinutes ? s.sleepMinutes.totalAsleep / 60 : undefined);
  const hr = (s) => s.restingHeartRate;
  const avgOf = (a) => total(a) / a.length;
  const bodyOf = (pick) => (vals(pick, 0, 6).length >= 3 && vals(pick, 0, 27).length >= 3 ? { a7: avgOf(vals(pick, 0, 6)), a28: avgOf(vals(pick, 0, 27)), n7: vals(pick, 0, 6).length, n28: vals(pick, 0, 27).length } : null);
  out.sleep = bodyOf(sleep);
  out.rhr = bodyOf(hr);
  if (out.sleep) ids.push('body.sleep');
  if (out.rhr) ids.push('body.resting_hr');
  return out;
}

const near = (actual, expected, tol, label) => {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tol, `${label}: engine ${actual}, oracle ${expected}`);
};

function check(snap, givenNow, label, mode = 'completed') {
  // a completed day is read at the local midnight that ends it
  const nowStr = mode === 'completed' ? endOfDay(givenNow, snap) : givenNow;
  const facts = engine(snap, nowStr, { dayMode: mode });
  const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
  const o = oracle(snap, nowStr, mode);
  const L = (s) => `${label} ${s}`;
  // Exactly the claims the specification allows, nothing stronger (slot facts are compared separately).
  const gotIds = facts.map((f) => f.id).filter((id) => !id.startsWith('regularity.slot.')).sort();
  assert.deepEqual(gotIds, [...o.ids].sort(), L('claims'));
  if (o.logged < 14) {
    assert.equal(byId['history.thin'].numbers.daysOfData, o.logged);
    return 'thin';
  }
  const n = (id) => byId[id].numbers;
  if (o.load) assert.equal(n('coverage.28d').loggedDays, o.coverage, L('coverage'));
  if (mode === 'in_progress') {
    if (o.live.logged) {
      assert.equal(n('volume.today_so_far').workouts, o.live.workouts, L('so far workouts'));
      near(n('volume.today_so_far').minutes, o.live.minutes, 1e-6, L('so far minutes'));
      assert.equal(n('volume.today_so_far').shortWorkouts, o.live.short);
    } else assert.deepEqual(n('volume.today_unlogged'), { date: nowStr.slice(0, 10), loggedDays: 0, windowDays: 1 });
  } else if (o.todayLogged) {
    assert.equal(n('volume.today').workouts, o.today.workouts, L('today workouts'));
    assert.equal(n('volume.today').shortWorkouts, o.short.today, L('today short'));
    near(n('volume.today').minutes, o.today.minutes, 1e-6, L('today minutes'));
  } else {
    assert.deepEqual(n('volume.today_unlogged'), { date: o.day, loggedDays: 0, windowDays: 1 });
  }
  for (const [id, key] of [['volume.week', 'week'], ['volume.28d', 'd28']]) {
    assert.equal(n(id).workouts, o[key].workouts, L(`${id} workouts`));
    near(n(id).minutes, o[key].minutes, 1e-6, L(`${id} minutes`));
    assert.equal(n(id).loggedDays, o[key].logged, L(`${id} logged`));
    assert.equal(n(id).unloggedDays, o[key].unlogged, L(`${id} unlogged`));
    assert.equal(n(id).shortWorkouts, o.short[key === 'week' ? 'week' : 'd28'], L(`${id} short`));
  }
  if (o.vsAvg) {
    const v = n('past.today_vs_avg');
    near(v.averageMinutesPerDay, o.vsAvg.avg, 0.0051, L('avg day'));
    assert.equal(v.loggedDays, o.vsAvg.logged);
    assert.equal(v.direction, o.vsAvg.dir);
    if (o.vsAvg.ratio === null) assert.equal(v.ratio, null);
    else {
      near(v.ratio, o.vsAvg.ratio, 0.0051, L('ratio'));
    }
    if (o.vsAvg.pct === null) assert.equal(v.percent, null, L('no percent'));
    else {
      near(v.percent, o.vsAvg.pct, 0.051, L('percent'));
    }
    if (o.vsHighest) near(n('past.today_vs_highest').ratio, o.vsHighest.ratio, 0.0051, L('vs highest'));
  }
  if (o.dayRank) {
    assert.equal(n('past.today_rank').rank, o.dayRank.rank, L('day rank'));
    assert.equal(n('past.today_rank').of, o.dayRank.of);
  }
  if (!byId['past.week_comparisons_skipped']) {
    // nothing to compare
  } else {
    assert.deepEqual(n('past.week_comparisons_skipped'), { loggedDays: o.week.logged, windowDays: 7 });
  }
  if (o.weekVsAvg) {
    const v = n('past.week_vs_avg');
    near(v.averageMinutesPerWeek, o.weekVsAvg.avg, 0.0051, L('week avg'));
    assert.equal(v.direction, o.weekVsAvg.dir);
    if (o.weekVsAvg.ratio !== null) {
      near(v.ratio, o.weekVsAvg.ratio, 0.0051, L('week ratio'));
    }
    if (o.weekVsAvg.pct === null) assert.equal(v.percent, null, L('no week percent'));
    else {
      near(v.percent, o.weekVsAvg.pct, 0.051, L('week percent'));
    }
    const g = n('goal.workouts_per_week');
    near(g.baselineWorkoutsPerWeek, o.goal.base, 0.0051, L('goal base'));
    if (o.goal.ratio !== null) near(g.ratio, o.goal.ratio, 0.0051, L('goal ratio'));
  }
  if (o.weekRank) {
    assert.equal(n('past.week_rank').rank, o.weekRank.rank, L('week rank'));
    assert.equal(n('past.week_rank').of, o.weekRank.of);
  }
  if (o.load) {
    const v = n('load.ratio');
    assert.equal(v.basis, o.load.basis, L('load basis'));
    near(v.ratio, o.load.ratio, 0.0051, L('load'));
    if (o.load.pct === null) assert.equal(v.percent, null);
    else near(v.percent, o.load.pct, 0.051, L('load percent'));
    near(v.averagePerWeek28, o.load.weekly, 0.0051, L('load weekly'));
    near(v.load7, o.load.l7, 1e-6, L('load 7'));
  }

  assert.equal(n('regularity.days_since_last').daysSinceLast, o.sinceLast, L('since last'));
  assert.equal(n('regularity.longest_gap').gapDays, o.gap.gap, L('gap'));
  assert.equal(n('regularity.longest_gap').windowDays, o.gap.window);
  assert.equal(n('regularity.longest_gap').unloggedDays, o.gap.unlogged, L('unlogged'));
  assert.deepEqual(n('regularity.per_week').perWeek, o.perWeek, L('per week'));
  assert.equal(byId['regularity.per_week'].window, `${o.perWeek.length * 7}d`, L('per week window'));
  assert.equal(byId['regularity.longest_gap'].window, `${o.gap.window}d`, L('gap window'));
  assert.deepEqual(n('regularity.per_week').loggedDays, o.perWeekLogged, L('per week logged'));
  const slotFacts = facts.filter((f) => f.id.startsWith('regularity.slot.'));
  const wdNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const got = Object.fromEntries(slotFacts.map((f) => [`${f.numbers.activityType}|${wdNames.indexOf(f.numbers.weekday)}|${f.numbers.hour}`, f.numbers.weeks]));
  assert.deepEqual(got, o.slots, L('slots'));

  const types = Object.keys(o.mix);
  if (types.length) {
    const cnt = n('mix.count');
    assert.deepEqual(Object.fromEntries(Object.entries(cnt.byActivity)), Object.fromEntries(types.map((t) => [t, o.mix[t].length])), L('mix counts'));
    const meds = n('mix.median_length').medianMinutesByActivity;
    for (const t of types) near(meds[t], med(o.mix[t]), 0.0051, L(`median ${t}`));
    assert.deepEqual(n('mix.start_bands'), o.bands, L('bands'));
  } else assert.equal(n('mix.count').total, 0);

  for (const [id, key] of [['body.sleep', 'sleep'], ['body.resting_hr', 'rhr']]) {
    if (!o[key]) continue;
    const v = n(id);
    const tol = key === 'sleep' ? 0.0051 : 0.051;
    near(v.average7, o[key].a7, tol, L(`${id} 7`));
    near(v.average28, o[key].a28, tol, L(`${id} 28`));
    assert.equal(v.logged7, o[key].n7);
    assert.equal(v.logged28, o[key].n28);
  }
  return 'full';
}

test('oracle agrees with the engine for each persona and each of its last 28 days', () => {
  const counts = { thin: 0, full: 0 };
  for (const [name, snap] of personas) {
    const dates = snap.dailySummaries.slice(-28).map((s) => s.date);
    assert.equal(dates.length, 28);
    for (const d of dates) counts[check({ ...snap, exportDate: `${d}T23:00:00-08:00` }, `${d}T23:00:00-08:00`, `${name} ${d}`)]++;
  }
  assert.ok(counts.full >= 30, `full comparisons: ${counts.full}`);
  assert.ok(counts.thin >= 3);
});

test('oracle agrees with the engine on generated scenarios (every kind, several seeds, several thin lengths)', () => {
  for (const kind of SCENARIO_KINDS) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { snapshot, now } = generateScenario(kind, seed);
      check(snapshot, now, `${kind}/${seed}`);
      // and on earlier days of the same history
      for (const back of [1, 3, 10]) {
        const d = plus(now.slice(0, 10), -back);
        check(snapshot, `${d}T21:00:00${now.slice(-6)}`, `${kind}/${seed}/-${back}`);
      }
    }
  }
  for (const days of [3, 7, 13, 14, 15, 28, 60]) {
    check(generateScenario('thin', 9, { days }).snapshot, generateScenario('thin', 9, { days }).now, `thin ${days}`);
  }
});

test('oracle and engine agree on a day that has only a short workout (it is a logged day)', () => {
  const summaries = [];
  for (let i = 0; i < 12; i++) summaries.push({ date: plus('2026-10-01', i), restingHeartRate: 50 });
  // Days 12 to 15 have no summary: only a short workout, which makes the day logged but does not count for volume.
  const workouts = [12, 13, 14, 15].map((i) => ({ activityType: 'Walking', start: `${plus('2026-10-01', i)}T08:00:00-08:00`, end: `${plus('2026-10-01', i)}T08:05:00-08:00`, durationMin: 5 }));
  const snap = { exportDate: '2026-10-16T20:00:00-08:00', persona: { key: 't' }, dailySummaries: summaries, workouts };
  assert.equal(oracle(snap, '2026-10-16T20:00:00-08:00').logged, 16);
  assert.equal(check(snap, '2026-10-16T20:00:00-08:00', 'short only'), 'full');
  const f = completedFacts(snap, '2026-10-16T20:00:00-08:00');
  assert.equal(f.find((x) => x.id === 'volume.28d').numbers.loggedDays, 16);
  assert.equal(f.find((x) => x.id === 'volume.28d').numbers.workouts, 0);
});

test('longest gap never counts unlogged days (independent hand-made cases)', () => {
  const row = (date) => ({ date, restingHeartRate: 50 });
  const wk = (date) => ({ activityType: 'Running', start: `${date}T07:00:00-08:00`, end: `${date}T07:30:00-08:00`, durationMin: 30 });
  const now = '2026-10-30T20:00:00-08:00';
  // Days Oct 1 to 30. Logged days: 1-12 and 25-30. Unlogged: 13-24. Workouts on 3, 8, 26.
  const dates = Array.from({ length: 30 }, (_, i) => plus('2026-10-01', i));
  const logged = dates.filter((d) => Number(d.slice(8)) <= 12 || Number(d.slice(8)) >= 25);
  const snap = { exportDate: now, persona: { key: 't' }, dailySummaries: logged.map(row), workouts: ['2026-10-03', '2026-10-08', '2026-10-26'].map(wk) };
  // Window is Oct 3 to Oct 30 (28 days). Runs of logged days without a workout: 4-7 (4), 9-12 (4), 25 (1), 27-30 (4). Unlogged: 12.
  const f = completedFacts(snap, now).find((x) => x.id === 'regularity.longest_gap').numbers;
  assert.deepEqual(f, { gapDays: 4, windowDays: 28, unloggedDays: 12 });
  // A gap that crosses unlogged days is not one long gap: only logged days count, and an unlogged day ends the run.
  const snap2 = { ...snap, workouts: [wk('2026-10-03')] };
  assert.equal(completedFacts(snap2, now).find((x) => x.id === 'regularity.longest_gap').numbers.gapDays, 9); // days 4-12
  check(snap, now, 'hand case 1');
  check(snap2, now, 'hand case 2');
  // All-unlogged window: 14 logged days long ago, nothing in the last 28 days.
  const old = Array.from({ length: 14 }, (_, i) => plus('2026-08-01', i));
  const snap3 = { exportDate: now, persona: { key: 't' }, dailySummaries: old.map(row), workouts: [] };
  assert.deepEqual(completedFacts(snap3, now).find((x) => x.id === 'regularity.longest_gap').numbers, { gapDays: 0, windowDays: 28, unloggedDays: 28 });
  check(snap3, now, 'all unlogged');
});

test('one workout recorded under two offsets adds one logged day, in either order', () => {
  const row = (date) => ({ date, restingHeartRate: 50 });
  const a = { activityType: 'Running', start: '2026-10-18T23:30:00-08:00', end: '2026-10-19T00:00:00-08:00', durationMin: 30 };
  const b = { activityType: 'Running', start: '2026-10-19T02:30:00-05:00', end: '2026-10-19T03:00:00-05:00', durationMin: 30 };
  const days = Array.from({ length: 14 }, (_, i) => plus('2026-10-01', i)); // Oct 1 to 14: neither workout date has a summary
  const now = '2026-10-20T22:00:00-08:00';
  const x = completedFacts({ exportDate: now, persona: { key: 't' }, dailySummaries: days.map(row), workouts: [a, b] }, now);
  const y = completedFacts({ exportDate: now, persona: { key: 't' }, dailySummaries: days.map(row), workouts: [b, a] }, now);
  assert.equal(JSON.stringify(x), JSON.stringify(y));
  assert.equal(x.find((f) => f.id === 'volume.28d').numbers.loggedDays, 15);
  assert.equal(check({ exportDate: now, persona: { key: 't' }, dailySummaries: days.map(row), workouts: [a, b] }, now, 'two offsets'), 'full');
});

test('missing coverage: the oracle and the engine claim exactly the same, and nothing stronger (today, week and window unlogged)', () => {
  const row = (date) => ({ date, restingHeartRate: 50, sleepMinutes: { totalAsleep: 420 } });
  const wk = (date) => ({ activityType: 'Running', start: `${date}T07:00:00-08:00`, end: `${date}T07:30:00-08:00`, durationMin: 30 });
  const all = Array.from({ length: 30 }, (_, i) => plus('2026-10-01', i)); // Oct 1 to 30
  const work = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-10-28'].map(wk);
  const idsOf = (snap, now) => completedFacts(snap, now).map((f) => f.id);

  // 1. today unlogged (everything up to Oct 29 logged, now is Oct 30)
  const s1 = { exportDate: '2026-10-30T09:00:00-08:00', persona: { key: 't' }, dailySummaries: all.slice(0, 29).map(row), workouts: work };
  const ids1 = idsOf(s1, s1.exportDate);
  assert.ok(ids1.includes('volume.today_unlogged') && !ids1.includes('volume.today'));
  assert.ok(ids1.includes('past.week_comparisons_skipped'));
  for (const id of ['past.today_vs_avg', 'past.today_rank', 'past.week_vs_avg', 'load.ratio', 'goal.workouts_per_week']) assert.ok(!ids1.includes(id), id);
  check(s1, s1.exportDate, 'today unlogged');

  // 2. week partly unlogged (Oct 24 and 25 missing)
  const s2 = { exportDate: '2026-10-30T22:00:00-08:00', persona: { key: 't' }, dailySummaries: all.filter((d) => d !== '2026-10-24' && d !== '2026-10-25').map(row), workouts: work };
  const ids2 = idsOf(s2, s2.exportDate);
  assert.ok(ids2.includes('volume.today') && ids2.includes('past.today_vs_avg') && ids2.includes('past.week_comparisons_skipped'));
  assert.ok(!ids2.includes('past.week_vs_avg') && !ids2.includes('load.ratio') && !ids2.includes('past.week_rank'));
  assert.equal(completedFacts(s2, s2.exportDate).find((f) => f.id === 'volume.week').numbers.unloggedDays, 2);
  check(s2, s2.exportDate, 'week partly unlogged');

  // 3. window mostly unlogged: 14 logged days in September, a gap, then only Oct 29 and 30
  const sep = Array.from({ length: 14 }, (_, i) => plus('2026-09-01', i));
  const s3 = { exportDate: '2026-10-30T22:00:00-08:00', persona: { key: 't' }, dailySummaries: [...sep, '2026-10-29', '2026-10-30'].map(row), workouts: [wk('2026-10-30')] };
  const ids3 = idsOf(s3, s3.exportDate);
  assert.ok(!ids3.includes('past.today_vs_avg') && !ids3.includes('load.ratio') && !ids3.includes('past.week_vs_avg') && !ids3.includes('goal.workouts_per_week'));
  assert.ok(ids3.includes('past.week_comparisons_skipped'));
  const f3 = completedFacts(s3, s3.exportDate);
  assert.equal(f3.find((f) => f.id === 'volume.28d').numbers.unloggedDays, 26);
  check(s3, s3.exportDate, 'window mostly unlogged');
});

// The meaning of the emitted sentences, written from the oracle's own specification (not from the engine's templates):
// only workouts of 10 minutes or more are counted; shorter ones are stated separately and never hidden or counted.
test('short workouts: the sentences say what is counted and what is not, and match the oracle', () => {
  const row = (date) => ({ date, restingHeartRate: 50, sleepMinutes: { totalAsleep: 420 } });
  const rec = (date, min, hour = 7) => ({ activityType: 'Walking', start: `${date}T${String(hour).padStart(2, '0')}:00:00-08:00`, end: `${date}T${String(hour).padStart(2, '0')}:59:00-08:00`, durationMin: min });
  const all = Array.from({ length: 30 }, (_, i) => plus('2026-10-01', i)); // Oct 1 to 30
  const now = '2026-10-30T22:00:00-08:00';
  // Oct 30 (today): only a 5-minute workout. Oct 29: a 9.99-minute one and a 10-minute one. Oct 26 and 27: short only. Oct 10: counted.
  const workouts = [rec('2026-10-30', 5), rec('2026-10-29', 9.99, 6), rec('2026-10-29', 10, 18), rec('2026-10-27', 4), rec('2026-10-26', 8), rec('2026-10-10', 30)];
  const snap = { exportDate: now, persona: { key: 't' }, dailySummaries: all.map(row), workouts };
  const o = oracle(snap, now);
  assert.deepEqual(o.short, { today: 1, week: 4, d28: 4 });
  assert.deepEqual(o.today, { workouts: 0, minutes: 0 });
  const facts = completedFacts(snap, now);
  const text = (id) => facts.find((f) => f.id === id).text;
  const counted = (n) => `${n} counted workout${n === 1 ? '' : 's'}`;
  const note = (n) => (n ? `, ${n} under 10 minutes not counted` : '');
  // today: nothing counted, one short workout stated
  assert.equal(text('volume.today'), `On 2026-10-30: ${counted(o.today.workouts)} (10 minutes or more) and ${o.today.minutes} workout minutes${note(o.short.today)}.`);
  assert.doesNotMatch(text('volume.today'), /^On 2026-10-30: \d+ workouts? and/);
  // week and 28 days
  assert.equal(text('volume.week'), `Counted in the last 7 days (2026-10-24 to 2026-10-30; workouts of 10 minutes or more): ${o.week.workouts} workout${o.week.workouts === 1 ? '' : 's'} and ${o.week.minutes} workout minutes on 7 logged days (0 unlogged days)${note(o.short.week)}.`);
  assert.equal(o.week.workouts, 1);
  assert.equal(text('volume.28d'), `Counted in the last 28 days (2026-10-03 to 2026-10-30; workouts of 10 minutes or more): ${o.d28.workouts} workouts and ${o.d28.minutes} workout minutes on 28 logged days (0 unlogged days)${note(o.short.d28)}.`);
  // the longest gap counts days without a COUNTED workout, so the short-only days belong to it and the sentence says so
  assert.equal(oracle(snap, now).gap.gap, 18); // runs of logged days without a counted workout: Oct 3-9 (7), Oct 11-28 (18), Oct 30 (1)
  assert.match(text('regularity.longest_gap'), /^Longest stretch of logged days without a counted workout \(10 minutes or more\) in the last 28 days: 18 days /);
  // days since the last COUNTED workout is Oct 29, not today's short one
  assert.match(text('regularity.days_since_last'), /^Days since the last counted workout \(10 minutes or more\) as of 2026-10-30: 1 \(2026-10-29\); 2 counted workouts in the last 28 days\./);
  assert.equal(check(snap, now, 'short workouts'), 'full');
  // no short workouts: no note
  const clean = { ...snap, workouts: snap.workouts.filter((w) => w.durationMin * 60000 >= 600000) };
  assert.doesNotMatch(completedFacts(clean, now).find((f) => f.id === 'volume.28d').text, /under 10 minutes/);
  assert.equal(completedFacts(clean, now).find((f) => f.id === 'volume.28d').numbers.shortWorkouts, 0);
  // goal wording counts counted workouts only
  assert.match(text('goal.workouts_per_week'), /^1 counted workout \(10 minutes or more\) in the last 7 days; the baseline is /);
});
