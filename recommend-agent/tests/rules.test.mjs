// Edge cases of the rules, the Python-style numbers and dates under them, and the wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pyRound, pySum, pyMean, pyMedian, pyFloat } from '../src/pynum.mjs';
import { parseDT, parseDay, isoDT, dayOf, hourOf, weekdayOf, dayISO, shortDay, clock, InputError } from '../src/pytime.mjs';
import { effort, signals } from '../src/workouts.mjs';
import { recommendWeek, planContext, checkPlan, explainAction } from './support/sample.mjs';
import { ACTIVITIES, INTENSITIES, readMemory } from '../src/memory.mjs';
import { memoryFor } from './support/harness-memory.mjs';

const cases = JSON.parse(readFileSync(new URL('./fixtures/workouts.json', import.meta.url), 'utf8'));
const NOW = '2026-11-20T09:00:00-08:00';

test('round is half to even on the exact value, like Python', () => {
  assert.deepEqual([0.5, 1.5, 2.5, 6.5, -0.5, -1.5, 2.4999, 2.5001].map((x) => pyRound(x)), [0, 2, 2, 6, -0, -2, 2, 3]);
  assert.deepEqual([0.25, 0.35, 2.675, 1.005, 0.125, 0.375].map((x) => pyRound(x, x === 0.125 || x === 0.375 ? 2 : x === 0.25 || x === 0.35 ? 1 : 2)), [0.2, 0.3, 2.67, 1, 0.12, 0.38]);
  assert.equal(pyRound(1917.4999999), 1917);
  assert.equal(pyRound(54.37 * 0.8), 43);
});

test('sum, mean and median match Python', () => {
  assert.equal(pySum([0.1, 0.2, 0.3]), 0.6);                // plain addition gives 0.6000000000000001
  assert.equal(pySum([1e16, 1, -1e16]), 1);
  assert.equal(pySum([]), 0);
  assert.equal(pyMean([0.1, 0.2, 0.3]), 0.2);               // plain addition then division gives 0.20000000000000004
  assert.equal(pyMean([1e308, 1e308]), 1e308);
  assert.equal(pyMean([-3, 3]), 0);
  assert.equal(pyMean([7.3]), 7.3);
  assert.equal(pyMedian([6, 7]), 6.5);
  assert.equal(pyMedian([9, 1, 5]), 5);
  assert.deepEqual([16, 16.1, 0].map(pyFloat), ['16.0', '16.1', '0.0']);
});

test('times keep their offset and their microseconds', () => {
  const t = parseDT('2026-10-23T06:58:39.044802-08:00');
  assert.equal(isoDT(t), '2026-10-23T06:58:39.044802-08:00');
  assert.equal(hourOf(t), 6);
  assert.equal(weekdayOf(dayOf(t)), 4);                      // a Friday
  assert.equal(isoDT(parseDT('2026-11-25T12:00:00Z')), '2026-11-25T12:00:00+00:00');
  assert.equal(isoDT(parseDT('2026-11-25T12:00:00Z'), true), '2026-11-25T12:00:00Z');
  assert.equal(dayOf(parseDT('2026-11-21T01:00:00+09:30')), parseDay('2026-11-21'));
  assert.equal(dayOf(parseDT('2026-11-21T01:00:00+09:30')) - dayOf({ ...parseDT('2026-11-21T01:00:00+09:30'), off: 0 }), 1);
  assert.equal(dayISO(parseDay('2028-02-29')), '2028-02-29');
  assert.equal(shortDay(parseDay('2026-12-06')), 'Sun Dec 06');
  assert.deepEqual([clock(0), clock(6), clock(12), clock(18, 5)], ['12 AM', '6 AM', '12 PM', '6:05 PM']);
  for (const bad of ['2026-11-20', '2026-11-20T09:00:00', 'now', 5, null]) assert.throws(() => parseDT(bad), InputError);
  for (const bad of ['2026-02-30', '26-01-01', '']) assert.throws(() => parseDay(bad), InputError);
});

test('effort: logged, else from heart rate between 1 and 10, else 5', () => {
  assert.deepEqual([{ effort: 7 }, { avgHeartRate: 150 }, { avgHeartRate: 60 }, { avgHeartRate: 250 }, {}].map(effort), [7, 7, 1, 10, 5]);
});

test('an empty history plans nothing and says why', () => {
  const w = recommendWeek({ now: NOW, history: { workouts: [], daily: [] } });
  assert.deepEqual([w.sessions, w.actions, w.suggestions], [[], [], []]);
  assert.equal(w.summaryReasons[0].code, 'no_history');
  assert.equal(w.signals.loadRatio, null);
  assert.equal(w.memorySource, null);
});

test('a day used in one week only is not a habit', () => {
  const run = (day) => ({ activityType: 'Running', start: `${day}T07:00:00-08:00`, end: `${day}T07:40:00-08:00`, avgHeartRate: 140 });
  const w = recommendWeek({ now: NOW, history: { workouts: [run('2026-11-03'), run('2026-11-10'), run('2026-11-17'), run('2026-11-12')], daily: [] } });
  assert.deepEqual(w.sessions.map((s) => [s.day, s.activity, s.minutes, s.start]), [['2026-11-24', 'run', 40, '2026-11-24T07:00:00-08:00']]);
});

test('readiness needs both averages and a real drop', () => {
  const day = (i, sleepMin, restingHeartRate) => ({ date: parseDay('2026-11-20') - i, sleepMin, restingHeartRate });
  const now = parseDT(NOW);
  const rows = (s7, r7) => Array.from({ length: 28 }, (_, i) => day(i + 1, i < 7 ? s7 : 480, i < 7 ? r7 : 50));
  assert.equal(signals([], rows(480, 50), now).readiness, 'normal');
  assert.equal(signals([], rows(440, 53), now).readiness, 'normal');       // 30 minutes and 2.2 bpm on the averages: not enough
  assert.equal(signals([], rows(400, 50), now).readiness, 'ease off: sleep down 60 min/night');
  assert.equal(signals([], rows(480, 56), now).readiness, 'ease off: resting HR up 4.5 bpm');
  assert.equal(signals([], [], now).readiness, 'normal');
});

test('memory rows: only saved and confirmed rows count, and a key is never read into', () => {
  const row = (key, state, data = { activity: 'run', weekday: 1, hour: 18 }) => ({ key, kind: 'usual_slot', state, data });
  const m = readMemory({ rows: [row('a', 'saved'), row('b', 'confirmed'), row('c', 'rejected'), row('d', 'proposed'), row('', 'saved'), null,
    row('e', 'saved', { activity: 'parkour', weekday: 1, hour: 18 }), row('f', 'saved', { activity: 'run', weekday: 9, hour: 18 }), row('slot:running:sun:06', 'saved', { activity: 'yoga', weekday: 0, hour: 12 })] });
  assert.deepEqual(m.keys, ['a', 'b', 'e', 'f', 'slot:running:sun:06']);
  assert.deepEqual(m.stoppedKeys, ['c']);
  assert.deepEqual(m.slots.map((s) => [s.key, s.activity, s.weekday, s.hour]), [['a', 'run', 1, 18], ['b', 'run', 1, 18], ['slot:running:sun:06', 'yoga', 0, 12]]);
  assert.equal(readMemory(undefined).given, false);
  assert.throws(() => readMemory({ facts: [] }), InputError);
});

test('a memory slot sets the hour and its key goes into basedOn as it is; a rejected one does not', () => {
  const slot = (state) => ({ rows: [{ key: 'any opaque key', kind: 'usual_slot', state, data: { activity: 'run', weekday: 1, hour: 5 } }] });
  const tue = (state) => recommendWeek({ persona: 'jordan', now: NOW, memory: slot(state) }).sessions.find((s) => s.day === '2026-11-24');
  assert.deepEqual([tue('saved').start, tue('saved').basedOn], ['2026-11-24T05:00:00-08:00', ['any opaque key']]);
  assert.match(tue('saved').reason, /^Your usual Tuesday 5 AM run\./);
  assert.deepEqual([tue('rejected').start, tue('rejected').basedOn], ['2026-11-24T18:00:00-08:00', []]);
});

test('the week is 7 local days starting today; today only with an hour to spare and done by 22:00', () => {
  const days = (now, more = {}) => recommendWeek({ persona: 'jordan', now, ...more }).sessions.map((s) => s.start.slice(0, 16));
  // Jordan's usual Friday is a strength session at 07:00.
  assert.deepEqual([days('2026-11-20T05:59:00-08:00')[0], days('2026-11-20T05:59:00-08:00').length], ['2026-11-20T07:00', 7]);
  assert.equal(days('2026-11-20T06:00:00-08:00')[0], '2026-11-20T07:00');
  assert.deepEqual([days('2026-11-20T06:01:00-08:00')[0], days('2026-11-20T06:01:00-08:00').length], ['2026-11-21T08:00', 6]);
  assert.equal(days('2026-11-20T06:01:00-08:00').at(-1), '2026-11-26T06:00');           // never shifted to an eighth day
  const late = [{ start: '2026-11-20T06:30:00-08:00', end: '2026-11-20T21:30:00-08:00' }];
  assert.equal(days('2026-11-20T05:00:00-08:00', { busy: late })[0], '2026-11-21T08:00'); // moved past 22:00, so today has none
  const moved = [{ start: '2026-11-20T06:30:00-08:00', end: '2026-11-20T12:00:00-08:00' }];
  assert.equal(days('2026-11-20T05:00:00-08:00', { busy: moved })[0], '2026-11-20T12:00');
});

test('long_run is the longest run of the week only when it lasts an hour or more', () => {
  // A person whose only runs are 30 minutes on Mondays at 18:00, with that slot in the memory table.
  const run = (day) => ({ activityType: 'Running', start: `${day}T18:00:00-08:00`, end: `${day}T18:30:00-08:00`, avgHeartRate: 140 });
  const memory = { rows: [{ key: 'mon-run', kind: 'usual_slot', state: 'saved', data: { activity: 'run', weekday: 0, hour: 18, minutes: 30, weeksSeen: 3, weeksTotal: 4 } }] };
  const short = recommendWeek({ now: NOW, memory, history: { workouts: [run('2026-10-26'), run('2026-11-02'), run('2026-11-09'), run('2026-11-16')], daily: [] } });
  assert.deepEqual(short.sessions.map((s) => [s.id, s.activity, s.minutes, s.basedOn]), [['ses-2026-11-23-run-1800', 'run', 30, ['mon-run']]]); // a short longest run stays a run
  assert.deepEqual(short.actions[0].rules, ['memory_slot', 'long_run']);
  assert.equal(short.sessions[0].reason, 'Your usual Monday 6 PM run. It is your longest run of the week.');           // the reason may still say so
  assert.equal(planContext({ now: NOW, memory, history: { workouts: [run('2026-10-26'), run('2026-11-02'), run('2026-11-09'), run('2026-11-16')], daily: [] } }).usualWeek[0].activity, 'run');
  const jordan = recommendWeek({ persona: 'jordan', now: NOW });
  assert.deepEqual(jordan.sessions.filter((s) => s.activity === 'long_run').map((s) => [s.day, s.minutes >= 60]), [['2026-11-22', true]]);
  const taper = recommendWeek({ persona: 'jordan', now: NOW, raceDate: '2026-11-29' }).sessions.find((s) => s.day === '2026-11-22');
  assert.deepEqual([taper.activity, taper.minutes], ['run', 53]);             // tapered under an hour: a run
});

test('an activity the list does not name is kept as `other`, with its label in the reason', () => {
  const hiit = (day) => ({ activityType: 'HighIntensityIntervalTraining', start: `${day}T19:00:00-08:00`, end: `${day}T19:35:00-08:00`, avgHeartRate: 130 });
  const history = { workouts: ['2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19'].map(hiit), daily: [] };
  const slot = (label) => ({ rows: [{ key: 'thu-hiit', kind: 'usual_slot', state: 'saved', data: { activity: 'other', label, weekday: 3, hour: 19, minutes: 35, weeksSeen: 4, weeksTotal: 4 } }] });
  const week = recommendWeek({ now: NOW, history, memory: slot('HIIT') });
  assert.deepEqual(week.sessions, [{
    id: 'ses-2026-11-26-other-1900', day: '2026-11-26', start: '2026-11-26T19:00:00-08:00', minutes: 35, activity: 'other', intensity: 'steady',
    reason: 'Your usual Thursday 7 PM HIIT.', basedOn: ['thu-hiit'],
  }]);
  assert.equal(recommendWeek({ now: NOW, history }).sessions[0].reason, 'Your usual Thursday HIIT.');               // no row: the type's plain name
  assert.equal(recommendWeek({ now: NOW, history, memory: slot('Bootcamp') }).sessions[0].basedOn.length, 0);      // a row about something else is not used
  assert.deepEqual(recommendWeek({ now: NOW, history, memory: slot(undefined) }).sessions[0].basedOn, ['thu-hiit']);
  const rowing = { workouts: history.workouts.map((w) => ({ ...w, activityType: 'Rowing' })), daily: [] };
  assert.equal(recommendWeek({ now: NOW, history: rowing }).sessions[0].reason, 'Your usual Thursday rowing.');

  const numbers = planContext({ now: NOW, history, memory: slot('HIIT') });
  assert.deepEqual(numbers.usualWeek, [{ weekday: 3, weekdayName: 'Thu', activity: 'other', minutes: 35, hour: 19, intensity: 'steady', basedOn: ['thu-hiit'], label: 'HIIT' }]);
  assert.equal(numbers.loadThisWeek, 175);                                                                         // effort 5 x 35 minutes
  assert.ok(numbers.activities.includes('other'));
  const fromRows = planContext({ now: NOW, memory: slot('HIIT') }).usualWeek[0];
  assert.deepEqual([fromRows.activity, fromRows.label, fromRows.minutes, fromRows.intensity], ['other', 'HIIT', 35, 'steady']);

  const check = (sessions, context = { now: NOW, history, memory: slot('HIIT') }) => checkPlan({ plan: { sessions }, context });
  assert.equal(check(week.sessions).pass, true);
  const noIntensity = [{ id: 'a', day: '2026-11-26', start: '2026-11-26T19:00:00-08:00', minutes: 30, activity: 'other', basedOn: ['thu-hiit'] }];
  assert.deepEqual([check(noIntensity).pass, check(noIntensity).load.planned], [true, 150]);                       // steady by default: 5 x 30
  assert.equal(check(noIntensity, { now: NOW, memory: slot('HIIT') }).load.planned, 30);                           // from rows alone, load is its minutes
  assert.deepEqual(check([{ ...noIntensity[0], minutes: 200 }]).violations.map((v) => v.code), ['bad_duration', 'load_over_cap', 'too_many_minutes']);
  assert.match(explainAction({ action: week.sessions[0], memory: slot('HIIT') }).text, /HIIT on Thursdays around 7 PM, seen in 4 of the last 4 weeks\.$/);
});

test('sessions follow the shared shape and ids are stable', () => {
  for (const c of cases) {
    const input = { ...c.input, memory: memoryFor(c.input) };
    const w = recommendWeek(input);
    assert.deepEqual(recommendWeek(input).sessions.map((s) => s.id), w.sessions.map((s) => s.id));
    assert.equal(new Set(w.sessions.map((s) => s.id)).size, w.sessions.length);
    for (const s of w.sessions) {
      assert.deepEqual(Object.keys(s), ['id', 'day', 'start', 'minutes', 'activity', 'intensity', 'reason', 'basedOn']);
      assert.ok(ACTIVITIES.includes(s.activity) && INTENSITIES.includes(s.intensity));
      assert.equal(s.id, `ses-${s.day}-${s.activity}-${s.start.slice(11, 13)}${s.start.slice(14, 16)}`);
      assert.match(s.start, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d:\d\d$/);
      assert.equal(s.start.slice(0, 10), s.day);
      assert.ok(Number.isInteger(s.minutes) && s.minutes >= 1);
      for (const key of s.basedOn) assert.ok(input.memory.rows.some((r) => r.key === key));
    }
  }
});

test('every reason and summary reads as a sentence for a person', () => {
  const jargon = /load cap|\(memory\)|\bcap\b|ACWR|\bratio\b|readiness|→|off the road|\bslot\b|\d{3,}|\bRHR\b|effort|undefined|null|NaN/i;
  let seen = 0;
  const codes = new Set();
  for (const c of cases) {
    const w = recommendWeek({ ...c.input, memory: memoryFor(c.input) });
    const texts = [w.summary, ...w.summaryReasons.map((r) => r.text), ...w.actions.flatMap((a) => [a.reason, ...a.reasons.map((r) => r.text)]), ...w.suggestions.map((s) => s.why)];
    for (const a of w.actions) for (const r of a.reasons) codes.add(r.code);
    for (const text of texts) {
      seen += 1;
      assert.match(text, /^[A-Z].*\.$/s, text);
      assert.ok(!jargon.test(text.replace(/off the road while your shoes/, '')), text);
    }
  }
  assert.ok(seen > 700, String(seen));
  assert.deepEqual([...codes].sort(), ['break_in', 'calendar_moved', 'ease_off', 'load_trim', 'long_run', 'memory_slot', 'no_free_slot', 'race_day', 'taper', 'usual', 'worn_shoes_swap']);
  const w = recommendWeek({ persona: 'jordan', now: NOW, memory: memoryFor({ persona: 'jordan' }) }, 1);
  assert.equal(w.reasons['ses-2026-11-22-long_run-0800'][0].text, 'Your usual Sunday 8 AM run.');
  assert.ok(w.actions.some((a) => a.reason === 'Your usual Wednesday run, kept short so this week stays close to your normal.'));
});

test('the summary names the kind of week', () => {
  const by = (name) => recommendWeek({ ...cases.find((c) => c.name === name).input }).summaryReasons.map((r) => r.code);
  assert.deepEqual(by('jordan: low load'), ['load_light']);
  assert.deepEqual(by('jordan: high load'), ['load_heavy']);
  assert.deepEqual(by('jordan: poor sleep and raised resting heart rate').slice(1), ['readiness_ease', 'worn_shoes']);
  const texts = new Set(cases.map((c) => recommendWeek({ ...c.input, memory: memoryFor(c.input) }).summaryReasons[0].text));
  assert.ok(texts.has('A lighter week than usual, so there is room to build.') && texts.has('Last week was lighter than usual, so this week builds back up gently.'));
});

test('the week names a publication for a suggestion or a citation and carries no web address', () => {
  let seen = 0;
  for (const c of cases) {
    const w = recommendWeek({ ...c.input, memory: memoryFor(c.input) });
    assert.doesNotMatch(JSON.stringify(w), /https?:|www\.|"url"|"host"|\.(com|net|org|it)\b/i, c.name);
    for (const s of w.suggestions) {
      seen += 1;
      assert.deepEqual(Object.keys(s.source), ['title', 'name']);
      assert.ok(s.why.includes(`; ${s.source.name} suggests it`), s.why);
    }
    for (const e of w.actions.flatMap((a) => a.evidence)) { seen += 1; assert.deepEqual(Object.keys(e), ['source', 'passage']); }
  }
  assert.ok(seen > 50);
});

test('without a history there is nothing to plan from', () => {
  assert.throws(() => recommendWeek({ now: NOW }), { code: 'missing_history' });
  assert.throws(() => recommendWeek({ now: NOW, persona: 'nobody' }), { code: 'missing_history' });
});
