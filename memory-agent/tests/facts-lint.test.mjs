import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { lintFact, lintWords, FACT_TEMPLATES, BANNED_WORDS, BANNED_PHRASES, SECOND_PERSON_WORDS, MODAL_WORDS, MODAL_PHRASES, LINT_CATEGORIES } from '../src/facts/index.mjs';
import { completedFacts } from './helpers/completed-day.mjs';
import { generateScenario, SCENARIO_KINDS } from '../src/scenarios/generate.mjs';

const dir = new URL('../fixtures/personas/', import.meta.url);
const personas = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

test('lint passes on every fact for every persona day and every scenario', () => {
  let checked = 0;
  const all = [];
  for (const snap of personas) {
    for (const s of snap.dailySummaries) all.push(completedFacts({ ...snap, exportDate: `${s.date}T23:00:00-08:00` }, `${s.date}T23:00:00-08:00`));
  }
  for (const kind of SCENARIO_KINDS) {
    for (const seed of [1, 2, 3, 4]) {
      const { snapshot, now } = generateScenario(kind, seed);
      all.push(completedFacts(snapshot, now));
    }
  }
  for (const facts of all) {
    for (const f of facts) {
      assert.deepEqual(lintFact(f.text), [], f.text);
      checked++;
    }
  }
  assert.ok(checked > 500);
});

test('lintWords flags judgement, advice, predictions and missing numbers, each with its category (fixed text, never the matched word)', () => {
  const cases = [
    ['You should rest after 5 workouts.', 'modal verb'],
    ['You should rest after 5 workouts.', 'second person'],
    ['You should rest after 5 workouts.', 'banned word'], // "rest"
    ['That was a great week with 5 workouts.', 'banned word'],
    ['A lot of volume: 300 minutes.', 'banned phrase'],
    ['Too much load at 1.5.', 'banned phrase'],
    ['You are ready for 3 more workouts.', 'banned word'],
    ['Fully recovered after 2 days.', 'banned word'],
    ['Try 2 easy runs.', 'imperative start'],
    ['Take 2 days off.', 'imperative start'],
    ['Keep 3 workouts per week.', 'imperative start'],
    ['Next week will have 4 workouts.', 'banned phrase'],
    ['Next week will have 4 workouts.', 'modal verb'], // "will"
    ['This is likely to reach 5 workouts.', 'banned word'],
    ['You need to run 3 times.', 'modal verb'], // "need to"
    ['Five workouts this week.', 'text must contain a number'],
    ['Did you do 5 workouts?', 'second person'],
    ['Did you do 5 workouts?', 'text must not contain ! or ?'],
    ['Rest days: 2.', 'banned word'],
    ['It could be 5 workouts.', 'modal verb'],
    ['Your 5 workouts.', 'second person'],
    ['3 workouts.Today was hard.', 'text must be one sentence'],
    ['3 workouts.Keep going.', 'imperative start'],
  ];
  for (const [text, category] of cases) assert.ok(lintWords(text).includes(category), `${text} -> ${category}; got ${lintWords(text)}`);
  // every diagnostic is one of the fixed texts
  const fixed = new Set([...LINT_CATEGORIES, 'text must contain a number', 'text must not contain ! or ?', 'text must be one sentence', 'text must be a single line', 'text must end with a period', 'a sentence has no number', 'text must be a non-empty string']);
  for (const [text] of cases) for (const p of lintWords(text)) assert.ok(fixed.has(p), `unexpected diagnostic ${p}`);
  // lintFact reports the same categories and adds the template one
  assert.ok(lintFact('You should rest after 5 workouts.').includes('modal verb'));
  assert.ok(lintFact('You should rest after 5 workouts.').includes('no template match'));
  assert.deepEqual(lintWords('Resting heart rate averaged 48.3 bpm over the last 7 days.'), []);
  assert.deepEqual(lintFact('9 days of data; fewer than 14.'), []);
  assert.ok(lintFact('Not enough history: 9 days of data, 14 needed.').includes('no template match'));
  assert.ok(lintFact('Resting heart rate averaged 48.3 bpm over the last 7 days.').includes('no template match'));
});

test('lint diagnostics never echo the input: a name that is also a banned word is reported by category only', () => {
  const inputs = ['Will had 5 workouts.', 'Will 5 workouts and Rest 3.', 'Hope should 3 Try 4 Good 5.', 'ZQXNAME could 5, ZQXNAME.', 'Today ZQXNAME try 3?'];
  for (const text of inputs) {
    for (const problems of [lintWords(text), lintFact(text), lintFact(text, { id: 'ZQXNAME' }), lintFact(text, { id: 'volume.today' })]) {
      for (const p of problems) {
        assert.ok(!/:/.test(p), `diagnostic with a colon-separated value: ${p}`);
        for (const w of text.split(/[^A-Za-z]+/).filter((x) => x.length > 2)) assert.ok(!p.toLowerCase().split(/[^a-z]+/).includes(w.toLowerCase()) || ['text', 'must', 'be', 'one', 'sentence', 'no', 'number', 'a', 'has', 'second', 'person', 'modal', 'verb', 'banned', 'word', 'phrase', 'imperative', 'start', 'template', 'match'].includes(w.toLowerCase()), `${p} echoes ${w}`);
      }
    }
  }
  assert.ok(lintWords('Will had 5 workouts.').includes('modal verb')); // flagged, but without the word
  assert.deepEqual(lintWords('Will had 5 workouts.'), ['modal verb']);
});

test('every banned word and phrase is caught by lintWords under its own category', () => {
  const cat = (w) => (SECOND_PERSON_WORDS.includes(w) ? 'second person' : MODAL_WORDS.includes(w) ? 'modal verb' : 'banned word');
  for (const w of BANNED_WORDS) assert.ok(lintWords(`Today the number ${w} is 5.`).includes(cat(w)), w);
  for (const p of BANNED_PHRASES) assert.ok(lintWords(`Today ${p} is 5.`).includes(MODAL_PHRASES.includes(p) ? 'modal verb' : 'banned phrase'), p);
  assert.deepEqual([...SECOND_PERSON_WORDS].sort(), ['you', 'your', 'yours', 'yourself']);
  for (const w of ['should', 'could', 'must', 'ought', 'will', 'would', 'might', 'shall']) assert.ok(MODAL_WORDS.includes(w) && BANNED_WORDS.includes(w), w);
  // a neutral sentence with the same shape has no such problem
  assert.deepEqual(lintWords('Today the number 5 is 5.'), []);
});

test('advice hidden inside an otherwise normal sentence is rejected (template check and banned words)', () => {
  const sneaky = [
    'You are doing 5 workouts, exercise more.',
    'Today (2026-11-17): 1 workout and 45.9 workout minutes, exercise more.',
    'Today (2026-11-17): 1 workout and 45.9 workout minutes and exercise more tomorrow.',
    'Today (2026-11-17): 1 workout (exercise more) and 45.9 workout minutes.',
    'Today (2026-11-17): 1 workout and exercise more than 45.9 workout minutes.',
    'Last 7 days (2026-11-11 to 2026-11-17): 5 workouts and 250 workout minutes, so push harder.',
    'Longest stretch of logged days without a workout in the last 28 days: 2 days (0 unlogged days in the window), which could be shorter.',
    'Workouts by activity in the last 28 days: running 3, exercise more 2.',
    'Days since the last workout: 2 (2026-11-15); 8 workouts in the last 28 days and you could do more.',
    'Today (2026-11-17): 1 workout and 45.9 workout minutes, and your pace needs to rise.',
    'Today (2026-11-17): 1 workout and 45.9 workout minutes; you must go on.',
    'Today (2026-11-17): 1 workout and 45.9 workout minutes; it ought to be 2.',
  ];
  for (const text of sneaky) assert.ok(lintFact(text).length > 0, text);
  // each of the words alone is caught even where the template check is skipped
  for (const w of ['you', 'your', 'yours', 'should', 'could', 'must', 'ought']) assert.ok(lintWords(`Today 5 workouts, ${w} 3.`).length > 0, w);
  assert.ok(lintWords('Today 5 workouts and need to rest 3.').length > 0);
});

test('a text is checked against the template of its own fact id', () => {
  const real = 'On 2026-11-17: 1 counted workout (10 minutes or more) and 45.9 workout minutes.';
  assert.deepEqual(lintFact(real, { id: 'volume.today' }), []);
  assert.ok(lintFact(real, { id: 'volume.week' }).length > 0);
  assert.ok(lintFact(real, { id: 'unknown.id' }).length > 0);
  assert.deepEqual(lintFact('Fixed slot among recognised activities: running on Mon between 07:00 and 08:00, in 3 of the last 4 weeks.', { id: 'regularity.slot.Running.Mon.07' }), []);
});

test('every fact the engine writes matches the template of its own id, and every template is used', () => {
  const used = new Set();
  const key = (id) => (id.startsWith('regularity.slot.') ? 'regularity.slot' : id);
  const snaps = [];
  for (const p of personas) for (const s of p.dailySummaries) snaps.push([{ ...p, exportDate: `${s.date}T23:00:00-08:00` }, `${s.date}T23:00:00-08:00`]);
  for (const kind of SCENARIO_KINDS) for (const seed of [1, 2, 3]) { const g = generateScenario(kind, seed); snaps.push([{ ...g.snapshot, target: { workoutsPerWeek: 4 } }, g.now]); }
  // an unlogged today, workouts with effort scores, and a snapshot with no counted workouts
  snaps.push([personas[0], '2026-11-19T07:30:00-08:00']);
  const g = generateScenario('steady', 2);
  snaps.push([{ ...g.snapshot, workouts: g.snapshot.workouts.map((w) => ({ ...w, effort: 6 })) }, g.now]);
  snaps.push([{ ...g.snapshot, workouts: [] }, g.now]);
  // day modes: a refresh during the day (with and without data for the unfinished day) and the midnight roll
  const live = generateScenario('steady', 3);
  const day = live.now.slice(0, 10);
  const optsFor = new Map();
  for (const hhmm of ['21:00', '05:00']) { const n = `${day}T${hhmm}:00-08:00`; const snap = { ...live.snapshot, exportDate: n }; snaps.push([snap, n]); optsFor.set(snap, { dayMode: 'in_progress' }); }
  const nextMidnight = `${new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)}T00:00:00-08:00`;
  snaps.push([{ ...live.snapshot, exportDate: nextMidnight }, nextMidnight]);
  for (const [snap, now] of snaps) {
    for (const f of completedFacts(snap, now, optsFor.get(snap) || {})) {
      used.add(key(f.id));
      assert.deepEqual(lintFact(f.text, { id: f.id }), [], f.text);
      used.add(key(f.id));
    }
  }
  const unused = Object.keys(FACT_TEMPLATES).filter((k) => !used.has(k));
  assert.ok(unused.length === 0, `templates never exercised: ${unused}`);
});
