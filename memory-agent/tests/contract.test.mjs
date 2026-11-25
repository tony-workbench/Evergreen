import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateSnapshot, validateFacts, parseTimestamp } from '../src/contract/index.mjs';
import { lintFact, lintWords } from '../src/facts/index.mjs';
import { completedFacts } from './helpers/completed-day.mjs';
import { generateScenario, SCENARIO_KINDS } from '../src/scenarios/generate.mjs';

const dir = new URL('../fixtures/personas/', import.meta.url);
const personas = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]);

test('every persona fixture is a valid snapshot', () => {
  assert.equal(personas.length, 3);
  for (const [name, snap] of personas) {
    const v = validateSnapshot(snap);
    assert.deepEqual(v.errors, [], name);
  }
});

test('every generated scenario is a valid snapshot and its facts are valid', () => {
  for (const kind of SCENARIO_KINDS) {
    for (const seed of [1, 2, 3]) {
      const { snapshot, now } = generateScenario(kind, seed);
      assert.deepEqual(validateSnapshot(snapshot).errors, [], `${kind}/${seed}`);
      assert.deepEqual(validateFacts(completedFacts(snapshot, now)).errors, [], `${kind}/${seed}`);
    }
  }
});

test('persona facts are valid for each of the last 28 days', () => {
  for (const [, snap] of personas) {
    for (const s of snap.dailySummaries.slice(-28)) {
      assert.deepEqual(validateFacts(completedFacts({ ...snap, exportDate: `${s.date}T23:00:00-08:00` }, `${s.date}T23:00:00-08:00`)).errors, [], s.date);
    }
  }
});

test('calendar events never change the facts, and no title reaches them', () => {
  for (const [name, snap] of personas) {
    assert.ok(snap.calendar.events.length > 0, name);
    const { calendar, ...without } = snap;
    const titles = [...new Set(calendar.events.map((e) => e.title))];
    for (const s of snap.dailySummaries.slice(-28)) {
      const now = `${s.date}T23:00:00-08:00`;
      const facts = completedFacts({ ...snap, exportDate: now }, now);
      assert.deepEqual(facts, completedFacts({ ...without, exportDate: now }, now), `${name} ${s.date}`);
      const text = JSON.stringify(facts);
      for (const title of titles) assert.ok(!text.includes(title), `${name} ${s.date}: ${title}`);
    }
  }
});

test('the snapshot validator rejects broken input', () => {
  const good = structuredClone(personas[0][1]);
  const cases = {
    'not an object': null,
    'missing export date': { ...good, exportDate: undefined },
    'date without offset': { ...good, exportDate: '2026-11-18T07:30:00' },
    'impossible calendar date': { ...good, dailySummaries: [{ date: '2026-02-31' }] },
    'negative duration': { ...good, workouts: [{ ...good.workouts[0], durationMin: -1 }] },
    'end before start': { ...good, workouts: [{ ...good.workouts[0], end: '2000-01-01T00:00:00-08:00' }] },
    'summaries not an array': { ...good, dailySummaries: {} },
    'effort out of range': { ...good, workouts: [{ ...good.workouts[0], effort: 11 }] },
    'bad target': { ...good, target: { workoutsPerWeek: 0 } },
    'sleep out of range': { ...good, dailySummaries: [{ date: '2026-11-01', sleepMinutes: { totalAsleep: 5000 } }] },
    'calendar without events': { ...good, calendar: {} },
    'calendar event without title': { ...good, calendar: { events: [{ ...good.calendar.events[0], title: ' ' }] } },
    'calendar event without offset': { ...good, calendar: { events: [{ ...good.calendar.events[0], start: '2026-11-18T09:00:00' }] } },
    'calendar event ends at start': { ...good, calendar: { events: [{ ...good.calendar.events[0], end: good.calendar.events[0].start }] } },
  };
  for (const [name, bad] of Object.entries(cases)) {
    assert.equal(validateSnapshot(bad).ok, false, name);
  }
  assert.equal(validateSnapshot({ ...good, target: { workoutsPerWeek: 4 } }).ok, true);
  assert.equal(validateSnapshot({ ...good, workouts: [{ ...good.workouts[0], effort: 7 }] }).ok, true);
});

test('the facts validator rejects broken facts', () => {
  const ok = { id: 'a.b', group: 'volume', text: 'Today: 2 workouts.', numbers: { n: 2 }, window: 'day' };
  assert.equal(validateFacts([ok]).ok, true);
  const bads = {
    'no number in text': { ...ok, text: 'Today had workouts.' },
    'two sentences': { ...ok, text: 'Today: 2 workouts. Last week: 3.' },
    'no final period': { ...ok, text: 'Today: 2 workouts' },
    'unknown group': { ...ok, group: 'advice' },
    'bad window': { ...ok, window: 'lately' },
    'NaN number': { ...ok, numbers: { n: NaN } },
    'extra key': { ...ok, extra: 1 },
    'numbers not an object': { ...ok, numbers: [1] },
    'second sentence without a space': { ...ok, text: '3 workouts.Today was hard.' },
    'second sentence without a number': { ...ok, text: 'Today: 3 workouts.Hard.' },
    'second sentence with a number': { ...ok, text: 'Today: 3 workouts.Last week: 4.' },
    'bad id': { ...ok, id: 'has space' },
  };
  for (const [name, bad] of Object.entries(bads)) assert.equal(validateFacts([bad]).ok, false, name);
  assert.equal(validateFacts([ok, ok]).ok, false, 'duplicate ids');
  assert.equal(validateFacts('x').ok, false);
});

test('conflicting daily summaries for one date are rejected, identical ones are accepted', () => {
  const good = structuredClone(personas[0][1]);
  const first = good.dailySummaries[0];
  assert.equal(validateSnapshot({ ...good, dailySummaries: [...good.dailySummaries, structuredClone(first)] }).ok, true);
  const conflict = { ...good, dailySummaries: [...good.dailySummaries, { ...first, restingHeartRate: first.restingHeartRate + 5 }] };
  const v = validateSnapshot(conflict);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /conflicts/);
});

test('decimals and dates are not sentence boundaries', () => {
  const ok = { id: 'a', group: 'volume', numbers: {}, window: 'day' };
  for (const text of ['Today: 3.1 workouts, 0.25 ratio.', 'Last 7 days (2026-11-11 to 2026-11-17): 5.5 h.', 'Ratio is 1.14x.']) {
    assert.equal(validateFacts([{ ...ok, text }]).ok, true, text);
  }
});

// No validation or lint message may contain a value from the input (a person's name, an id, a number): fixed text plus
// the field name only. Every field below carries a distinctive value.
const NAME = 'ZQXNAME';
const NUM = -987654.321;
const leaks = (messages) => messages.filter((m) => m.includes('ZQX') || m.includes('987654'));

test('snapshot validation messages never echo input values', () => {
  const bad = {
    exportDate: NAME,
    persona: NAME,
    dailySummaries: [
      { date: NAME, restingHeartRate: NAME, steps: NUM, sleepMinutes: NAME },
      { date: '2026-02-31', restingHeartRate: NUM, steps: NAME, sleepMinutes: { totalAsleep: NUM } },
      { date: '2026-10-01', restingHeartRate: 50 },
      { date: '2026-10-01', restingHeartRate: 51 }, // conflicting duplicate
      { date: NAME, restingHeartRate: 1 }, // conflicting with the first NAME one
      { date: NAME, restingHeartRate: 2 },
    ],
    workouts: [
      { activityType: NUM, start: NAME, end: NAME, durationMin: NAME, indoor: NAME, effort: NAME, heartRate: { avg: NAME } },
      { activityType: NAME, start: '2026-10-01T07:00:00-08:00', end: '2020-01-01T00:00:00Z', durationMin: NUM, effort: NUM, heartRate: NAME },
      { activityType: NAME, start: '2026-10-01T07:00:00-08:00', end: '2026-10-01T08:00:00-08:00', durationMin: 30, effort: 3 },
      { activityType: NAME, start: '2026-10-01T07:00:00-08:00', end: '2026-10-01T08:00:00-08:00', durationMin: 30, effort: 4 }, // conflicting effort
      { activityType: NAME, durationMin: NUM, [NAME]: NAME },
    ],
    target: { workoutsPerWeek: NAME },
  };
  const v = validateSnapshot(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 15, `errors: ${v.errors.length}`);
  assert.deepEqual(leaks(v.errors), []);
  for (const weird of [{ ...bad, target: { workoutsPerWeek: NUM } }, { ...bad, target: NAME }, NAME, NUM, [NAME], { exportDate: NUM }, { dailySummaries: NAME, workouts: NAME }]) {
    assert.deepEqual(leaks(validateSnapshot(weird).errors), [], JSON.stringify(weird).slice(0, 60));
  }
  // the conflict message in particular is fixed text
  assert.ok(v.errors.some((e) => e === 'dailySummaries[4]: conflicts with another summary for the same date'));
});

test('facts validation, lint and suppression messages never echo input values', () => {
  const sentence = 'Today: 3 workouts.';
  const bads = [
    { id: NAME + ' x', group: NAME, text: NAME, numbers: { [NAME]: NUM, n: NaN }, window: NAME },
    { id: NAME, group: 'volume', text: `3 workouts.${NAME} was hard.`, numbers: {}, window: 'day', [NAME]: NUM },
    { id: NAME, group: 'volume', text: `${NAME} ${NUM}`, numbers: [NAME], window: 'day' },
    { id: NAME, group: 'volume', text: sentence, numbers: {}, window: 'day' }, // duplicate id with the next
    { id: NAME, group: 'volume', text: sentence, numbers: {}, window: 'day' },
    { [NAME]: NAME },
    NAME,
  ];
  const v = validateFacts(bads);
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 10);
  assert.deepEqual(leaks(v.errors), []);
  assert.deepEqual(leaks(validateFacts(NAME).errors), []);
  // lint problems and the engine's thrown errors
  for (const text of [`${NAME} should try ${NUM}`, `3 workouts.${NAME}`, `${NAME} ${NUM}?`]) {
    assert.deepEqual(leaks(lintWords(text)), [], text);
    assert.deepEqual(leaks(lintFact(text)), [], text);
    assert.deepEqual(leaks(lintFact(text, { id: NAME })), [], text);
  }
  const snap = JSON.parse(readFileSync(new URL('../fixtures/personas/moderate.json', import.meta.url), 'utf8'));
  for (const suppressed of [{ types: [NAME] }, { keys: [{ type: NAME, key: NAME }] }, { types: NAME }, { [NAME]: [] }, NAME]) {
    assert.throws(() => completedFacts(snap, '2026-11-17T23:00:00-08:00', { suppressed }), (e) => !e.message.includes('ZQX'));
  }
  assert.throws(() => generateScenario(NAME, 1), (e) => !e.message.includes('ZQX') && e instanceof Error);
});

test('timestamps are strict: hour 24, minute 60, second 60 and bad offsets are rejected everywhere the contract validates one', () => {
  const good = JSON.parse(readFileSync(new URL('../fixtures/personas/moderate.json', import.meta.url), 'utf8'));
  const w0 = good.workouts[0];
  const badStamps = ['2026-11-14T12:00:00.1234Z', '2026-11-14T12:00:00.123456+05:30', '2026-11-14T24:00:00Z', '2026-11-14T24:00:00-08:00', '2026-11-14T24:00Z', '2026-11-14T25:00:00Z', '2026-11-14T12:60:00Z', '2026-11-14T12:00:60Z', '2026-11-14T12:00:00+24:00', '2026-11-14T12:00:00+05:60', '2026-02-30T12:00:00Z', '2026-11-14T12:00:00', '2026-11-14'];
  const okStamps = ['2026-11-14T23:59:59Z', '2026-11-14T00:00:00-08:00', '2026-11-14T23:59-08:00', '2026-11-14T12:00:00.123+05:30', '2026-11-14T12:00:00.5Z'];
  for (const t of okStamps) assert.ok(parseTimestamp(t), t);
  for (const t of badStamps) assert.equal(parseTimestamp(t), null, t);
  for (const t of badStamps) {
    assert.equal(validateSnapshot({ ...good, exportDate: t }).ok, false, `exportDate ${t}`);
    assert.equal(validateSnapshot({ ...good, workouts: [{ ...w0, start: t }] }).ok, false, `start ${t}`);
    assert.equal(validateSnapshot({ ...good, workouts: [{ ...w0, end: t }] }).ok, false, `end ${t}`);
  }
  for (const t of okStamps) {
    assert.equal(validateSnapshot({ ...good, exportDate: t }).ok, true, `exportDate ${t}`);
    assert.equal(validateSnapshot({ ...good, workouts: [{ ...w0, start: t, end: '2026-12-31T00:00:00Z' }] }).ok, true, `start ${t}`);
  }
  // daily summaries carry a date only, so a timestamp there is rejected too
  for (const t of ['2026-11-14T24:00:00Z', '2026-11-14T00:00:00Z', '2026-11-15T00:00']) {
    assert.equal(validateSnapshot({ ...good, dailySummaries: [{ date: t }] }).ok, false, `summary date ${t}`);
  }
  // the engine uses the same validation and parser: such a snapshot is refused, and a bad `now` is refused with its own text
  const snap = { ...good, exportDate: '2026-11-18T07:30:00-08:00', workouts: [{ ...w0, start: '2026-11-17T24:00:00Z', end: '2026-11-17T24:30:00Z', durationMin: 30 }] };
  assert.throws(() => completedFacts(snap, '2026-11-17T23:00:00-08:00'), (e) => e.message.startsWith('snapshot failed validation: workouts[0].start'));
  const clean = { ...snap, workouts: [] };
  for (const bad of ['2026-11-17T24:00:00-08:00', 'nonsense', '2026-11-17T23:00:00']) assert.throws(() => completedFacts(clean, bad), (e) => e.message === 'now must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits', bad);
  assert.throws(() => completedFacts(clean, new Date(NaN)), /now must be an ISO 8601/);
});

test('more than 3 fractional digits are rejected with a clear message (they would be dropped silently)', () => {
  const good = JSON.parse(readFileSync(new URL('../fixtures/personas/moderate.json', import.meta.url), 'utf8'));
  const w0 = good.workouts[0];
  // two starts a hair apart would otherwise collapse into one millisecond and be deduplicated; an end could count early
  const v = validateSnapshot({ ...good, workouts: [{ ...w0, start: '2026-11-14T07:00:00.0004Z', end: '2026-11-14T07:30:00.0009Z' }] });
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, ['workouts[0].start: must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits', 'workouts[0].end: must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits']);
  assert.equal(validateSnapshot({ ...good, exportDate: '2026-11-18T07:30:00.1234567-08:00' }).ok, false);
  assert.equal(validateSnapshot({ ...good, workouts: [{ ...w0, start: '2026-11-14T07:00:00.001Z', end: '2026-11-14T07:30:00.999Z' }] }).ok, true);
  assert.equal(parseTimestamp('2026-11-14T07:00:00.0004Z'), null);
  assert.equal(parseTimestamp('2026-11-14T07:00:00.0009Z'), null);
  for (const bad of ['2026-11-18T07:30:00.1234-08:00']) {
    assert.throws(() => completedFacts({ ...good, exportDate: '2026-11-18T07:30:00-08:00' }, bad), (e) => e.message === 'now must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
  }
  // the engine refuses such a snapshot instead of merging the two records
  assert.throws(() => completedFacts({ ...good, workouts: [{ ...w0, start: '2026-11-14T07:00:00.0001Z', end: '2026-11-14T07:30:00Z' }] }, '2026-11-18T23:00:00-08:00'), /snapshot failed validation: workouts\[0\]\.start/);
});
