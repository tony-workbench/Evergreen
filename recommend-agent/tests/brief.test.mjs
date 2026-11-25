// planBrief: the week's constraints as plain lines for the model. Every rule checkPlan can fire for a context has a line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planBrief, planContext, checkPlan } from './support/sample.mjs';
import { memoryFor } from './support/harness-memory.mjs';

const cases = JSON.parse(readFileSync(new URL('./fixtures/workouts.json', import.meta.url), 'utf8'));
const NOW = '2026-11-20T09:00:00-08:00';
const slot = (key, weekday, hour, state = 'saved', data = {}) => ({ key, kind: 'usual_slot', state, data: { activity: 'run', weekday, hour, minutes: 40, weeksSeen: 3, weeksTotal: 4, ...data } });

// The line that tells the model about each rule before it can break it.
const LINE_FOR = {
  invalid_session: /^Use only activities the app knows, and give each session a day, a start time and a length\.$/,
  unknown_activity: /^Use only activities the app knows/,
  bad_duration: /^Every session lasts between 10 and 180 minutes/,
  overlap: /no two sessions overlap\.$/,
  outside_window: /^Plan from today, \w+ the \d+\w\w, through \w+ the \d+\w\w; today nothing starts before .+ or ends after 10 PM\.$/,
  calendar_conflict: /^(Free on \w+ the \d+\w\w: .+|Nothing is free on \w+ the \d+\w\w)\.$/,
  load_over_cap: /^The whole week can hold about \d+ minutes/,
  hard_when_tired: /: nothing hard today or tomorrow\.$/,
  race_day_session: /^Race \w+ the \d+\w\w: nothing else that day/,
  no_rest_before_race: /^Race .*rest on \w+ the \d+\w\w\.$/,
  taper_too_long: /runs in the 10 days before it stay at about four fifths of their usual length/,
  worn_shoes_long_run: /^The running shoes are nearly worn out: no run longer than 45 minutes/,
  break_in_too_long: /^The first two runs after the new pair arrives on .+ are easy and at most 30 minutes\.$/,
  break_in_not_easy: /^The first two runs after the new pair arrives on .+ are easy/,
  too_many_sessions: /^At most \d training sessions? this week\.$/,
  too_many_minutes: /^At most \d+ minutes of training this week(, because the last 7 days were heavier than usual)?\.$/,
  too_many_days_in_a_row: /most \d training days in a row before a rest day\.$/,
  back_to_back_hard: /^Hard days go back to back only on days that are both usually hard/,
  unknown_memory_key: /^Say a session comes from a habit only when that habit is in the memory you were given\.$/,
  stopped_memory_key: /^Do not bring back any habit that was stopped\.$/,
  stopped_slot: /^Do not plan .+ on \w+day at \d+ [AP]M\.$/,
};

// A plan that is wrong in as many ways as the context allows.
function brokenPlan(context) {
  const c = planContext(context);
  const first = Date.parse(`${c.window.from}T00:00:00Z`);
  const off = context.now.endsWith('Z') ? '+00:00' : context.now.slice(-6);
  const sessions = [];
  for (let i = 0; i <= 7; i += 1) {
    const day = new Date(first + i * 864e5).toISOString().slice(0, 10);
    sessions.push({ id: `r${i}`, day, start: `${day}T07:00:00${off}`, minutes: 100, activity: 'run', intensity: 'hard', basedOn: ['no such memory', ...c.stoppedKeys] });
    sessions.push({ id: `y${i}`, day, start: `${day}T07:30:00${off}`, minutes: 5, activity: 'yoga', intensity: 'easy', basedOn: [] });
    for (const x of c.stoppedSlots) if ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7 === x.weekday) sessions.push({ id: `s${i}`, day, start: `${day}T${String(x.hour).padStart(2, '0')}:10:00${off}`, minutes: 20, activity: x.activity, intensity: 'easy', basedOn: [] });
    sessions.push({ id: `w${i}`, day, start: `${day}T19:00:00${off}`, minutes: 240, activity: 'walk', intensity: 'steady', basedOn: [] });
  }
  sessions.push({ id: 'p', day: c.window.from, start: `${c.window.from}T12:00:00${off}`, minutes: 30, activity: 'parkour' }, { id: 'x', day: 'soon', start: 'later', minutes: 30, activity: 'run' });
  return sessions;
}

const contexts = [
  ...cases.map((c) => { const { busy, ...rest } = c.input; return { ...rest, memory: memoryFor(c.input), calendar: busy }; }),
  { persona: 'jordan', now: NOW, memory: { rows: [slot('a', 1, 18), slot('b', 2, 8, 'rejected'), slot('c', 4, 19, 'rejected', { activity: 'other', label: 'HIIT' }), { key: 'd', kind: 'sleep', state: 'rejected', data: { hours7d: 7, hours28d: 7 } }] },
    shoes: { boughtOn: '2026-10-22', startMiles: 267 }, raceDate: '2026-11-24', newPairArrives: '2026-11-20', calendar: [{ start: '2026-11-21T05:00:00-08:00', end: '2026-11-21T22:00:00-08:00' }] },
  { now: NOW, memory: { rows: [slot('a', 1, 18), { key: 'l', kind: 'load', state: 'saved', data: { minutes7d: 200, ratioToUsual: 1 } }, { key: 's', kind: 'sleep', state: 'saved', data: { hours7d: 5, hours28d: 7 } }] }, raceDate: '2026-11-27' },
  { now: '2026-11-20T23:30:00+09:00' },
];

test('every rule checkPlan can fire for a context has a matching line in its brief', () => {
  const fired = new Set();
  for (const context of contexts) {
    const { lines } = planBrief({ context });
    const codes = new Set(checkPlan({ plan: { sessions: brokenPlan(context) }, context }).violations.map((v) => v.code));
    for (const code of codes) {
      fired.add(code);
      assert.ok(LINE_FOR[code], `no line is known for ${code}`);
      assert.ok(lines.some((l) => LINE_FOR[code].test(l)), `${code} can fire, but no line says so:\n${lines.join('\n')}`);
    }
  }
  assert.deepEqual([...fired].sort(), Object.keys(LINE_FOR).sort()); // every rule was exercised
});

test('every line is a sentence a person could read: no keys, no field names, no markup', () => {
  let seen = 0;
  for (const context of contexts) {
    const keys = (context.memory?.rows ?? []).map((r) => r.key).filter((k) => k.length > 3);
    for (const line of planBrief({ context }).lines) {
      seen += 1;
      assert.match(line, /^[A-Z][^\n]*\.$/, line);
      assert.doesNotMatch(line, /[_[\]{}<>=`"]|[a-z][A-Z]|\b(null|undefined|NaN|true|false)\b|slot:|\d{4}-\d\d-\d\d|T\d\d:\d\d/, line);
      for (const key of keys) assert.ok(!line.includes(key), `${line} has the key ${key}`);
    }
  }
  assert.ok(seen > 1500);
});

test('the brief for a full context, line by line', () => {
  const { lines } = planBrief({ context: contexts[cases.length] });
  assert.deepEqual(lines, [
    'Plan from today, Friday the 20th, through Thursday the 26th; today nothing starts before 10 AM or ends after 10 PM.',
    'Use only activities the app knows, and give each session a day, a start time and a length.',
    'Every session lasts between 10 and 180 minutes, and no two sessions overlap.',
    'Usual: yoga Mon at 12 PM, 27 minutes, easy.',
    'Usual: run Tue at 6 PM, 53 minutes, hard.',
    'Usual: run Wed at 6 AM, 40 minutes, steady.',
    'Usual: run Thu at 6 AM, 50 minutes, hard.',
    'Usual: strength session Fri at 7 AM, 43 minutes, easy.',
    'Usual: run Sat at 8 AM, 35 minutes, steady.',
    'Usual: long run Sun at 8 AM, 89 minutes, hard.',
    'Usually 7 training days a week; at most 7 training days in a row before a rest day.',
    'The whole week can hold about 391 minutes at a steady effort; hard minutes count for more, easy ones for less.',
    'At most 7 training sessions this week.',
    'At most 337 minutes of training this week.',
    'Hard days go back to back only on days that are both usually hard (usually hard: Tuesday, Thursday, Sunday).',
    'Sleep and resting heart rate look normal.',
    'Race Tuesday the 24th: nothing else that day, and rest on Monday the 23rd.',
    'With the race 4 days away, runs in the 10 days before it stay at about four fifths of their usual length, the longest run at three fifths.',
    'The running shoes are nearly worn out: no run longer than 45 minutes until the new pair arrives on Friday the 20th.',
    'The first two runs after the new pair arrives on Friday the 20th are easy and at most 30 minutes.',
    'Free on Friday the 20th: 10 AM to 10 PM.',
    'Nothing is free on Saturday the 21st.',
    'Free on Sunday the 22nd: 6 AM to 9 PM.',
    'Free on Monday the 23rd: 6 AM to 9 PM.',
    'Free on Tuesday the 24th: 6 AM to 9 PM.',
    'Free on Wednesday the 25th: 6 AM to 9 PM.',
    'Free on Thursday the 26th: 6 AM to 9 PM.',
    'Say a session comes from a habit only when that habit is in the memory you were given.',
    'Do not plan runs on Wednesday at 8 AM.',
    'Do not plan HIIT on Friday at 7 PM.',
    'Do not bring back any habit that was stopped.',
  ]);
});

test('from memory rows alone: minutes, readiness and grouped usual days', () => {
  const rows = [slot('a', 0, 7), slot('b', 2, 7), slot('c', 4, 7), { key: 'l', kind: 'load', state: 'saved', data: { minutes7d: 200, ratioToUsual: 1 } },
    { key: 's', kind: 'sleep', state: 'saved', data: { hours7d: 5, hours28d: 7 } }, { key: 'h', kind: 'resting_hr', state: 'saved', data: { bpm7d: 60, bpm28d: 50 } }];
  const { lines } = planBrief({ context: { now: NOW, memory: { rows } } });
  assert.ok(lines.includes('Usual: run Mon, Wed, Fri at 7 AM, 40 minutes.'));
  assert.ok(lines.includes('The whole week can hold about 220 minutes of training.'));
  assert.ok(lines.includes('Sleep has been short and resting heart rate is up: nothing hard today or tomorrow.'));
  assert.deepEqual(planBrief({ context: { now: NOW } }).lines.slice(3, 6), ['No usual week is known yet, so keep this one light.', 'At most 6 training days in a row before a rest day.', 'At most 3 training sessions this week.']);
  assert.equal(JSON.stringify(planBrief({ context: { now: NOW, memory: { rows } } })), JSON.stringify(planBrief({ now: NOW, memory: { rows } })));
});
