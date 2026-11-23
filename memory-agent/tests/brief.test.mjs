// The brief: plain bullets from workouts, sleep and heart rate only, short enough to read, every number a stored fact's number.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryStore, recordFeedback, forgetFactKey, forgetFactType, restoreFactType, F, S } from '../src/store/index.mjs';
import { rollDay } from '../src/memory/roll.mjs';
import { plannerText, fullText } from '../src/memory/planner-text.mjs';
import { briefText, stopKey, restoreKey, rounded, BRIEF_MAX_WORDS, BRIEF_MAX_LINES } from '../src/memory/brief.mjs';
import { lintFact, BRIEF_TEMPLATES } from '../src/facts/lint.mjs';
import { makeMemoryIO } from './memory-io.mjs';

const USER = `usr_${'c3'.repeat(8)}`;
const MIDNIGHT = '2026-11-18T00:00:00-08:00';
const persona = (who) => JSON.parse(fs.readFileSync(new URL(`../fixtures/personas/${who}.json`, import.meta.url), 'utf8'));
const fresh = () => { const mem = makeMemoryIO(); return { mem, store: new MemoryStore('/mem', USER, { io: mem.io }) }; };
const rolled = (who, now = MIDNIGHT) => {
  const { mem, store } = fresh();
  const snapshot = persona(who);
  assert.equal(rollDay({ store, snapshot, now }).ok, true);
  return { mem, store, snapshot };
};
const bullets = (b) => b.text.split('\n').map((l) => l.slice(2));
const textId = (line) => (line.startsWith('Usual times:') ? 'usual_times' : null);

for (const who of ['sedentary', 'moderate', 'half_marathon']) {
  test(`${who}: at most 8 plain bullets and 120 words, nothing that looks like code, every line passes the lint`, () => {
    const b = briefText(rolled(who).store);
    assert.equal(b.ok, true, b.error);
    const lines = b.text.split('\n');
    assert.ok(lines.length >= 4 && lines.length <= BRIEF_MAX_LINES);
    assert.ok(b.words <= BRIEF_MAX_WORDS && b.words === b.text.split(/\s+/).filter(Boolean).length, `${b.words} words`);
    for (const l of lines) {
      assert.ok(l.startsWith('- '), l);
      for (const token of ['#', '[', '.md', '/', '_', '`', 'facts']) assert.ok(!l.includes(token), `${token} in: ${l}`);
    }
    for (const l of b.lines) assert.deepEqual(lintFact(l.text, { templates: BRIEF_TEMPLATES, id: l.id }), [], l.text);
    for (const l of bullets(b)) assert.deepEqual(lintFact(l, { templates: BRIEF_TEMPLATES, id: textId(l) ?? undefined }), [], l);
    assert.ok(b.lines.every((l) => ['routine', 'body'].includes(l.group)));
    // The text holds the same lines, with the fixed slots joined into one.
    assert.deepEqual(bullets(b).filter((l) => !l.startsWith('Usual times:')), b.lines.filter((l) => l.id !== 'usual_time').map((l) => l.text));
  });
}

test('half_marathon: the brief is exactly this', () => {
  assert.equal(briefText(rolled('half_marathon').store).text, [
    '- Workouts: 6.5 a week (4-week average).',
    '- Usual times: Running Tue 6 PM, Thu 6 AM, Sun 8 AM (3 of the last 4 weeks).',
    '- Mix over 4 weeks: Running 20, Strength training 4, Yoga 2.',
    '- Last 4 fully logged weeks: 6, 6, 7, 6 workouts.',
    '- Load: 368 min in the last 7 days, 1.14× the 28-day weekly average.',
    '- Average sleep: 8.8 h a night over 7 days (28-day average 8.6 h).',
    '- Resting heart rate: 49 bpm over 7 days (28-day average 48 bpm).',
  ].join('\n'));
});

// An independent rounding: whole hundredths first, then half up.
const round = (x, places) => { const h = Math.round(Number(x) * 100); const step = 10 ** (2 - places); return Math.floor((h + step / 2) / step) * step / 100; };
const nums = (s) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

for (const who of ['sedentary', 'moderate', 'half_marathon']) {
  test(`${who}: every number in the brief is a stored fact's number, rounded (minutes and bpm whole, hours one decimal, ratios two)`, () => {
    const { store } = rolled(who);
    const b = briefText(store);
    const profile = store.read('profile').facts;
    const rolling = store.read('rolling').facts;
    const line = (id) => b.lines.find((l) => l.id === id)?.text;
    const stored = (key) => profile.find((f) => f.key === key)?.text;
    let checked = 0;
    const same = (id, want) => { if (want === null) { assert.equal(line(id), undefined, id); return; } assert.deepEqual(nums(line(id)), want, id); checked++; };

    same('workouts_per_week', [round(/average: (\S+) workouts/.exec(stored('profile'))[1], 1), 4]);
    const weeks = rolling.filter((f) => f.kind === 'weekly').slice(-4).map((f) => Number(/: (\d+) workouts/.exec(f.text)[1]));
    same('recent_weeks', [weeks.length, ...weeks]);
    const load = /load is (\S+) minutes, ratio (\S+) to/.exec(stored('computed:load.ratio') ?? '');
    same('load', load ? [round(load[1], 0), 7, round(load[2], 2), 28] : null);
    const sleep = /days: (\S+) h .*average of (\S+) h/.exec(stored('computed:body.sleep') ?? '');
    same('sleep', sleep ? [round(sleep[1], 1), 7, 28, round(sleep[2], 1)] : null);
    const heart = /days: (\S+) bpm .*average of (\S+) bpm/.exec(stored('computed:body.resting_hr') ?? '');
    same('resting_hr', heart ? [round(heart[1], 0), 7, 28, round(heart[2], 0)] : null);

    const mix = profile.find((f) => f.key === 'mix').items;
    const shown = [...line('mix').matchAll(/([A-Z][A-Za-z ]+?) (\d+)(?=[,.])/g)].map((m) => [m[1], Number(m[2])]);
    for (const [activity, count] of shown) assert.equal(mix.find((i) => i.activity === activity).count, count, activity);
    const other = / (\d+) in (\d+) other types?\./.exec(line('mix'));
    assert.equal(shown.reduce((n, s) => n + s[1], 0) + Number(other?.[1] ?? 0), mix.reduce((n, i) => n + i.count, 0));
    assert.equal(shown.length + Number(other?.[2] ?? 0), mix.length);

    const slots = profile.filter((f) => f.text.startsWith('Fixed slot'));
    const slotLines = b.lines.filter((l) => l.id === 'usual_time');
    assert.equal(slotLines.length, slots.length);
    for (const l of slotLines) {
      const m = /^(\S+) (\S+) (\d+) (AM|PM) \((\d) of/.exec(l.text);
      const hour = String((Number(m[3]) % 12) + (m[4] === 'PM' ? 12 : 0)).padStart(2, '0');
      assert.ok(slots.some((f) => f.text.includes(`${m[1].toLowerCase()} on ${m[2]} between ${hour}:00`) && f.text.includes(`in ${m[5]} of the last 4 weeks`)), l.text);
    }
    assert.ok(checked >= 4);
  });
}

test('rounding is half up on the written digits', () => {
  assert.deepEqual([rounded('8.75', 1), rounded('8.55', 1), rounded('49.00', 0), rounded('48.5', 0), rounded('1.10', 2), rounded('6.5', 1), rounded('2', 1), rounded('0.04', 1), rounded('9.96', 1)],
    ['8.8', '8.6', '49', '49', '1.1', '6.5', '2', '0', '10']);
});

test('the same data gives the same brief, and an unfinished day adds nothing', () => {
  const a = rolled('moderate');
  const b = rolled('moderate');
  assert.deepEqual(briefText(a.store), briefText(b.store));
  const before = briefText(a.store);
  const noon = '2026-11-18T12:00:00-08:00';
  assert.equal(rollDay({ store: a.store, snapshot: { ...a.snapshot, exportDate: noon }, now: noon }).mode, 'in_progress');
  assert.equal(briefText(a.store).text, before.text);
  assert.deepEqual(briefText(a.store).lines, before.lines);
});

test('taps add nothing to the brief: memory comes from data only', () => {
  const { store } = rolled('half_marathon');
  const before = briefText(store);
  for (const n of [1, 2]) recordFeedback(store, { recId: `rec_0000000${n}`, activity: 'run', weekday: 3, hour: 7, action: 'declined', reason: 'too_early', now: '2026-11-17T12:00:00.000Z' });
  assert.equal(store.read('preferences').facts.length, 1);
  const after = briefText(store);
  assert.deepEqual([after.text, after.lines, after.facts], [before.text, before.lines, before.facts]);
  assert.doesNotMatch(JSON.stringify(after), /Declined|too early/);
});

test('a forgotten day leaves the brief at once and stays out of its numbers', () => {
  const { store, snapshot } = rolled('half_marathon');
  assert.match(briefText(store).text, /Running 20/);
  assert.equal(forgetFactKey(store, 'daily', '2026-11-15'), true);
  const gone = briefText(store);
  assert.doesNotMatch(gone.text, /Running 20|Workouts: 6\.5/);             // every total that counted that day is gone until the next roll
  assert.ok(!gone.facts.some((f) => f.text.includes('2026-11-15')));
  assert.equal(rollDay({ store, snapshot, now: MIDNIGHT }).ok, true);
  const b = briefText(store);
  assert.match(b.text, /Workouts: 6\.25 a week|Workouts: 6\.3 a week/);
  assert.match(b.text, /Running 19/);
  assert.ok(!b.facts.some((f) => f.text.includes('2026-11-15')));
});

test('a stopped fact type disappears and comes back only after it is restored', () => {
  const { store, snapshot } = rolled('half_marathon');
  assert.equal(forgetFactType(store, 'body'), true);
  for (let i = 0; i < 2; i++) {
    const b = briefText(store);
    assert.doesNotMatch(b.text, /sleep|heart rate/i);
    assert.ok(!b.lines.some((l) => l.id === 'sleep' || l.id === 'resting_hr'));
    rollDay({ store, snapshot, now: MIDNIGHT });
  }
  assert.equal(restoreFactType(store, 'body'), true);
  rollDay({ store, snapshot, now: MIDNIGHT });
  assert.match(briefText(store).text, /Average sleep: .*\n- Resting heart rate: \d+ bpm/);
});

test('stop one fixed slot: it leaves the text, the lines, the facts and the full text; the other slots stay; restore brings it back', () => {
  const { store, snapshot } = rolled('half_marathon');
  const before = briefText(store);
  const key = 'slot:running:sun:08';
  assert.deepEqual(before.lines.filter((l) => l.id === 'usual_time').map((l) => l.key), ['slot:running:tue:18', 'slot:running:thu:06', key]);
  assert.equal(stopKey(store, key), true);
  const next = { ...snapshot, exportDate: '2026-11-19T00:00:00-08:00' };
  for (const roll of [null, [snapshot, MIDNIGHT], [next, '2026-11-19T00:00:00-08:00']]) {
    if (roll) assert.equal(rollDay({ store, snapshot: roll[0], now: roll[1] }).ok, true);
    const b = briefText(store);
    assert.match(b.text, /Usual times: Running Tue 6 PM, Thu 6 AM \(3 of the last 4 weeks\)\./);
    assert.deepEqual(b.lines.filter((l) => l.id === 'usual_time').map((l) => l.key), ['slot:running:tue:18', 'slot:running:thu:06']);
    assert.ok(!b.facts.some((f) => f.text.includes('on Sun between 08:00')));
    assert.equal(b.facts.filter((f) => f.text.startsWith('Fixed slot')).length, 2);
    assert.doesNotMatch(fullText(store).text, /on Sun between 08:00/);
    assert.deepEqual(b.stopped, [{ key, label: 'Running, Sunday 8 AM' }]);
    assert.deepEqual(briefText(store), b);
  }
  assert.equal(restoreKey(store, key), true);
  assert.equal(rollDay({ store, snapshot, now: MIDNIGHT }).ok, true);
  assert.deepEqual(briefText(store), before);
});

test('every keyed line can be stopped and restored on its own', () => {
  const { store, snapshot } = rolled('half_marathon');
  const before = briefText(store);
  const labels = { workouts_per_week: 'Workouts per week', mix: 'Activity mix', recent_weeks: 'Recent weeks', load: 'Training load', sleep: 'Sleep', resting_hr: 'Resting heart rate' };
  for (const [key, label] of Object.entries(labels)) {
    assert.equal(stopKey(store, key), true, key);
    rollDay({ store, snapshot, now: MIDNIGHT });
    const b = briefText(store);
    assert.deepEqual(b.lines.map((l) => l.key), before.lines.map((l) => l.key).filter((k) => k !== key), key);
    assert.deepEqual(b.stopped, [{ key, label }]);
    assert.equal(b.text.split('\n').length, before.text.split('\n').length - 1);
    assert.equal(restoreKey(store, key), true, key);
    rollDay({ store, snapshot, now: MIDNIGHT });
    assert.deepEqual(briefText(store), before, key);
  }
  for (const bad of ['slot:running:sun:8', 'slot:flying:sun:08', 'body', 'thin', '', null, 7]) {
    assert.equal(stopKey(store, bad), false);
    assert.equal(restoreKey(store, bad), false);
  }
  assert.deepEqual(briefText(store), before);
});

test('under 14 days of data: one line and nothing else', () => {
  const { store } = fresh();
  const snapshot = persona('moderate');
  const days = snapshot.dailySummaries.slice(-9).map((d) => d.date);
  const thin = { ...snapshot, dailySummaries: snapshot.dailySummaries.slice(-9), workouts: snapshot.workouts.filter((w) => w.start.slice(0, 10) >= days[0]) };
  const r = rollDay({ store, snapshot: thin, now: MIDNIGHT });
  assert.deepEqual([r.ok, r.thin], [true, true]);
  const b = briefText(store);
  assert.equal(b.text, '- 9 days of data, fewer than 14.');
  assert.deepEqual(b.lines, [{ group: 'routine', id: 'thin', key: null, text: '9 days of data, fewer than 14.' }]);
  assert.deepEqual(lintFact(b.lines[0].text, { templates: BRIEF_TEMPLATES, id: 'thin' }), []);
});

test('an empty memory gives an empty brief; an invalid file gives an error and no text', () => {
  const { mem, store } = fresh();
  const empty = briefText(store);
  assert.deepEqual([empty.ok, empty.text, empty.words, empty.lines, empty.stopped, empty.facts], [true, '', 0, [], [], []]);
  store.create('rolling', [F.weekly({ weekStart: '2026-11-09', count: 3, minutes: 120 })], [S.roll({ date: '2026-11-17', at: '2026-11-18T08:00:00.000Z' })]);
  assert.equal(briefText(store).text, '- Last 1 fully logged week: 3 workouts.');
  mem.plant(`${store.dir}/health/rolling.md`, 'not a memory file\n');
  const bad = briefText(store);
  assert.deepEqual([bad.ok, Object.hasOwn(bad, 'text'), bad.error], [false, false, plannerText(store).error]);
});

test('advice, judgement or a different wording does not pass the brief lint', () => {
  for (const [id, text] of [
    ['sleep', 'Average sleep: 8.8 h a night over 7 days, which is good.'],
    ['load', 'Load: 368 min in the last 7 days, above usual.'],
    ['workouts_per_week', 'You should do 6.5 workouts a week.'],
    ['usual_times', 'Usual times: run on Sun at 8 AM tomorrow.'],
  ]) assert.notDeepEqual(lintFact(text, { templates: BRIEF_TEMPLATES, id }), [], text);
});
