// Rebuilds what is derived from schemas/*.schema.json: src/schemas.mjs (the schemas as one module, for bundles) and fixtures/.
// Run after changing a schema, a persona or a stand-in bundle: node scripts/generate.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const writeText = (path, text) => { mkdirSync(`${root}${path}`.replace(/\/[^/]*$/, ''), { recursive: true }); writeFileSync(`${root}${path}`, text); };
const write = (path, value) => writeText(path, `${JSON.stringify(value, null, 2)}\n`);

// 1. The schemas as a module.
const schemas = Object.fromEntries(readdirSync(`${root}schemas`).filter((f) => f.endsWith('.schema.json')).sort().map((f) => [f.replace('.schema.json', ''), JSON.parse(readFileSync(`${root}schemas/${f}`, 'utf8'))]));
writeText('src/schemas.mjs', `// Generated from schemas/*.schema.json by scripts/generate.mjs. Do not edit: change the schema files and run it again.\nexport const SCHEMAS = ${JSON.stringify(schemas, null, 2)};\n`);

// 2. The three people. Four weeks of Health data before Monday 9 November 2026 (UTC-8), and that week's calendar.
const OFFSET = '-08:00', FIRST = '2026-10-12';
const p2 = (n) => String(n).padStart(2, '0');
const dayAt = (n) => new Date(Date.parse(`${FIRST}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const time = (day, hour, minute = 0) => `${day}T${p2(hour + Math.floor(minute / 60))}:${p2(minute % 60)}:00${OFFSET}`;
const week = (n, hour, minute) => time(dayAt(28 + n), hour, minute);
const event = (id, title, weekday, from, to) => ({ id, title, start: week(weekday, ...from), end: week(weekday, ...to), fixed: true });
// habit: [Health type, weekday (Monday 0), hour, minutes, the week it was skipped or null]
function person(key, user, name, habits, sleep, heart, events) {
  const workouts = [];
  for (let w = 0; w < 4; w++) for (const [activityType, weekday, hour, minutes, skipped] of habits) {
    if (skipped === w) continue;
    const day = dayAt(w * 7 + weekday);
    workouts.push({ activityType, start: time(day, hour, 5), end: time(day, hour, 5 + minutes), durationMin: minutes });
  }
  workouts.sort((a, b) => (a.start < b.start ? -1 : 1));
  const dailySummaries = Array.from({ length: 28 }, (_, i) => ({ date: dayAt(i), restingHeartRate: heart + (i % 3), steps: 4000 + ((i * 739) % 5000), sleepMinutes: { totalAsleep: sleep + ((i * 37) % 50) } }));
  return { persona: key, user, name, now: week(0, 0, 5), planNow: week(0, 8), tzOffsetMinutes: -480, snapshot: { exportDate: week(0, 0, 5), persona: { key, name }, dailySummaries, workouts }, events };
}
const PEOPLE = [
  person('sam', 'usr_5a17c0de', 'Sam', [['Walking', 0, 12, 30, null], ['Walking', 2, 18, 30, 1], ['Yoga', 5, 9, 30, null], ['Walking', 4, 17, 20, 0]], 370, 71,
    [event('e1', 'Lunch with a friend', 0, [12, 0], [13, 0]), event('e2', 'Dentist', 2, [15, 0], [16, 0]), event('e3', 'School meeting', 3, [9, 0], [10, 0])]),
  person('alex', 'usr_a1e7c0de', 'Alex', [['Running', 0, 18, 30, null], ['TraditionalStrengthTraining', 2, 12, 45, 2], ['Running', 4, 18, 30, null], ['Yoga', 6, 9, 40, 0]], 440, 57,
    [event('e1', 'Team sync', 0, [17, 30], [18, 30]), event('e2', 'Client call', 1, [14, 0], [15, 0]), event('e3', 'Design review', 3, [10, 0], [12, 0])]),
  person('jordan', 'usr_107da9c0de', 'Jordan', [['Running', 0, 18, 45, null], ['Running', 1, 6, 50, 3], ['FunctionalStrengthTraining', 3, 18, 40, null], ['Running', 6, 7, 100, null]], 500, 48,
    [event('e1', 'Dinner with family', 0, [18, 0], [19, 0]), event('e2', 'Evening class', 2, [19, 0], [20, 0]), event('e3', 'Lunch talk', 4, [12, 0], [13, 0])]),
];
rmSync(`${root}fixtures`, { recursive: true, force: true });
for (const p of PEOPLE) write(`fixtures/personas/${p.persona}.json`, p);

// 3. Valid examples: what crosses each boundary when the week runs on the stand-in bundles.
const { loadBundles, STUBS } = await import('../tests/host.mjs');
const { runWeek } = await import('../tests/week-scenario.mjs');
const { assertValid } = await import('../src/validate.mjs');
const good = {};
// The rules each person set: written by hand, since no stand-in bundle makes them. Made-up people, generic answers.
const RULES = {
  sam: { restWeekdays: [5, 6], sessionMinutes: { min: 15, max: 20 }, window: { from: '10:00', to: '18:00' }, mornings: false, equipment: ['chair', 'wall', 'floor'], avoid: [], movements: {} },
  alex: { restWeekdays: [2, 5, 6], sessionMinutes: { min: 20, max: 25 }, window: { from: '12:00', to: '20:30' }, mornings: false, equipment: ['backpack', 'chair', 'table', 'sofa', 'book', 'step'], avoid: ['jump_squat'], movements: { split_squat: 'can', push_up: 'untried' } },
  jordan: { restWeekdays: [4], sessionMinutes: { min: 30, max: 40 }, window: { from: '06:00', to: '20:00' }, mornings: true, equipment: ['backpack', 'step'], avoid: [], movements: { pike_push_up: 'cannot' } },
};
// A home session of each person's: written by hand with movements from the library, as workoutContent returns them.
const item = (movementId, sets, dose, rest, extra = {}) => ({ movementId, sets, ...dose, rest, isNew: false, ...extra });
const CONTENT = {
  sam: { sessionId: null, focus: 'full', minutes: 18, items: [item('sit_to_stand', 3, { reps: [8, 12] }, 60), item('wall_push_up', 3, { reps: [10, 15] }, 60), item('dead_bug', 2, { reps: [8, 12] }, 45)] },
  alex: { sessionId: 'w1-wed', focus: 'upper', minutes: 24, items: [item('table_push_up', 3, { reps: [8, 12] }, 60), item('backpack_row', 3, { reps: [10, 15] }, 60, { load: 5 }), item('backpack_press', 3, { reps: [8, 12] }, 60, { load: 2 }), item('forearm_plank', 2, { seconds: [20, 40] }, 45, { isNew: true })] },
  jordan: { sessionId: 'w1-sat', focus: 'full_lower', minutes: 35, items: [item('reverse_lunge', 3, { reps: [8, 12] }, 60), item('backpack_hip_hinge', 4, { reps: [8, 12] }, 60, { load: 6 }), item('push_up', 3, { reps: [6, 12] }, 60)] },
};
for (const p of PEOPLE) {
  const S = await runWeek(loadBundles(STUBS), p, async (title, needs, fn) => { await fn(); });
  const row = S.table.rows.find((r) => r.kind === 'usual_slot');
  const values = {
    activity: S.accepted.activity, 'memory-row': row, 'memory-table': S.table, session: S.accepted, plan: S.plan, 'plan-check': S.check,
    'calendar-intent': S.intent, 'preview-block': S.block, 'calendar-result': S.calendarResult, outcome: S.outcomes.find((o) => o.done), error: S.error, 'stopped-slot': S.stopped[0],
  };
  values['user-rules'] = RULES[p.persona];
  values['workout-content'] = CONTENT[p.persona];
  for (const [name, value] of Object.entries(values)) write(`fixtures/valid/${p.persona}/${name}.json`, assertValid(name, value));
  write(`fixtures/valid/${p.persona}/plan-check.rejected.json`, assertValid('plan-check', S.staleCheck));
  write(`fixtures/valid/${p.persona}/outcome.missed.json`, assertValid('outcome', S.outcomes.find((o) => !o.done)));
  // The hand-offs with their inputs and results, for the Swift app to reproduce.
  write(`fixtures/handoffs/${p.persona}.json`, {
    sessionToIntent: { session: S.accepted, intent: S.intent },
    rowsToCalendarMemory: { rows: S.table.rows, memory: S.calendarMemory },
    keysToReject: { session: S.declined, rows: S.table.rows, keys: S.rejected },
    rowsToStopped: { rows: S.table.rows.filter((r) => S.rejected.includes(r.key)), stopped: S.stopped },
    outcomesFor: { planRecords: S.planRecords, healthWorkouts: S.healthWorkouts, days: S.outcomeDays, outcomes: S.outcomes },
  });
  good[p.persona] = values;
}

// One row of every kind the stand-in memory does not write, so each `data` shape has an example.
const base = good.jordan['memory-row'];
const kinds = {
  load: ['load', 'This week had 215 active minutes, 1.1 times the usual.', { minutes7d: 215, ratioToUsual: 1.1 }],
  mix: ['routine', 'The last four weeks were mostly runs.', { byActivity: { run: 7, long_run: 4, strength: 4 } }],
  response: ['response', 'Early sessions are often skipped.', { about: 'early sessions', pattern: 'skipped 3 of the last 4' }],
  gear: ['gear', 'The daily trainers have 512 km on them.', { item: 'Daily trainers', km: 512, boughtOn: '2026-05-02' }],
  goal: ['goal', 'A half marathon on 6 December.', { what: 'Half marathon', date: '2026-12-06' }],
};
for (const [kind, [group, statement, data]] of Object.entries(kinds)) write(`fixtures/valid/kinds/memory-row.${kind}.json`, assertValid('memory-row', { ...base, memoryId: `m-${kind}`, key: `mem:${kind}`, slot: kind, group, kind, statement, data }));
write('fixtures/valid/kinds/memory-row.other.json', assertValid('memory-row', { ...base, memoryId: 'm-other', key: 'mem:other', slot: 'usual_slot/other/2/19', statement: 'Rowing on Wednesday at 19:00 in 3 of the last 4 weeks.', data: { activity: 'other', label: 'Rowing', weekday: 2, hour: 19, minutes: 40, weeksSeen: 3, weeksTotal: 4 } }));
write('fixtures/valid/kinds/activity.other.json', assertValid('activity', 'other'));
write('fixtures/valid/kinds/session.rest.json', assertValid('session', { ...good.jordan.session, id: 's-2026-11-14-rest', day: '2026-11-14', start: '2026-11-14T00:00:00-08:00', minutes: 0, activity: 'rest', reason: 'The day before the long run.', basedOn: [] }));
write('fixtures/valid/kinds/preview-block.rest.json', assertValid('preview-block', { id: 'new-2026-11-14-rest', activity: 'rest', title: 'Rest day', start: '2026-11-14T00:00:00-08:00', end: '2026-11-15T00:00:00-08:00', minutes: 0, status: 'new', reason: 'A full day with no workout.' }));
write('fixtures/valid/kinds/calendar-intent.rest.json', assertValid('calendar-intent', { kind: 'add', activity: 'rest', sessionId: 's-2026-11-14-rest', day: '2026-11-14' }));
write('fixtures/valid/kinds/calendar-intent.other.json', assertValid('calendar-intent', { kind: 'add', activity: 'other', title: 'Rowing', minutes: 40, sessionId: 's-2026-11-11-other-1900', day: '2026-11-11', after: '19:00', exact: true }));
write('fixtures/valid/kinds/calendar-intent.race.json', assertValid('calendar-intent', { kind: 'race', raceDate: '2026-12-06' }));

// 4. Invalid examples: Sam's values with one thing wrong. The file name says what.
const g = structuredClone(good.sam);
const change = (value, edit) => { const copy = structuredClone(value); edit(copy); return copy; };
const without = (value, field) => change(value, (v) => { delete v[field]; });
const bad = {
  activity: { 'not-on-the-list': 'jog', 'long-run-with-a-space': 'long run', 'health-name': 'Running', 'display-name': 'Walk', 'not-a-string': 3 },
  'memory-row': {
    'data-missing': without(g['memory-row'], 'data'),
    'usual-slot-weekday-7': change(g['memory-row'], (v) => { v.data.weekday = 7; }),
    'usual-slot-weekday-as-name': change(g['memory-row'], (v) => { v.data.weekday = 'mon'; }),
    'usual-slot-hour-as-clock-text': change(g['memory-row'], (v) => { v.data.hour = '12:00'; }),
    'usual-slot-activity-as-health-name': change(g['memory-row'], (v) => { v.data.activity = 'Walking'; }),
    'usual-slot-data-missing-minutes': change(g['memory-row'], (v) => { delete v.data.minutes; }),
    'kind-not-on-the-list': change(g['memory-row'], (v) => { v.kind = 'regularity'; }),
    'sleep-kind-with-usual-slot-data': change(g['memory-row'], (v) => { v.kind = 'sleep'; }),
    'state-not-on-the-list': change(g['memory-row'], (v) => { v.state = 'stopped'; }),
    'confidence-above-1': change(g['memory-row'], (v) => { v.confidence = 80; }),
    'updated-is-a-time-not-a-day': change(g['memory-row'], (v) => { v.updated = '2026-11-09T00:05:00-08:00'; }),
    'group-not-on-the-list': change(g['memory-row'], (v) => { v.group = 'feedback'; }),
    'state-review': change(g['memory-row'], (v) => { v.state = 'review'; }),
    'since-is-a-time-not-a-day': change(g['memory-row'], (v) => { v.since = '2026-11-08T00:00:00-08:00'; }),
    'extra-field': change(g['memory-row'], (v) => { v.text = v.statement; }),
  },
  'memory-table': {
    'rows-missing': without(g['memory-table'], 'rows'),
    'ok-false': change(g['memory-table'], (v) => { v.ok = false; }),
    'rows-are-keys-not-rows': change(g['memory-table'], (v) => { v.rows = v.rows.map((r) => r.key); }),
    'a-row-without-key': change(g['memory-table'], (v) => { delete v.rows[0].key; }),
  },
  session: {
    'start-without-offset': change(g.session, (v) => { v.start = v.start.slice(0, 19); }),
    'start-ends-in-Z': change(g.session, (v) => { v.start = `${v.start.slice(0, 19)}Z`; }),
    'start-without-seconds': change(g.session, (v) => { v.start = `${v.start.slice(0, 16)}-08:00`; }),
    'day-not-a-day': change(g.session, (v) => { v.day = '11/09/2026'; }),
    'intensity-moderate': change(g.session, (v) => { v.intensity = 'moderate'; }),
    'activity-as-health-name': change(g.session, (v) => { v.activity = 'Walking'; }),
    'minutes-as-text': change(g.session, (v) => { v.minutes = '30'; }),
    'minutes-not-whole': change(g.session, (v) => { v.minutes = 28.5; }),
    'basedOn-missing': without(g.session, 'basedOn'),
    'basedOn-holds-rows-not-keys': change(g.session, (v) => { v.basedOn = [g['memory-row']]; }),
    'reason-empty': change(g.session, (v) => { v.reason = ''; }),
    'extra-field': change(g.session, (v) => { v.title = 'Walk'; }),
  },
  plan: {
    'summary-missing': without(g.plan, 'summary'),
    'sessions-missing': without(g.plan, 'sessions'),
    'sessions-not-a-list': change(g.plan, (v) => { v.sessions = { monday: v.sessions[0] }; }),
    'a-session-without-id': change(g.plan, (v) => { delete v.sessions[0].id; }),
    'ok-missing': without(g.plan, 'ok'),
  },
  'plan-check': {
    'pass-true-with-violations': { ok: true, pass: true, violations: [{ code: 'UnknownMemory', text: 'A session is based on a memory that is not in the table.' }] },
    'pass-false-without-violations': { ok: true, pass: false, violations: [] },
    'violations-missing': { ok: true, pass: true },
    'violations-as-sentences': { ok: true, pass: false, violations: ['A session is based on a memory that is not in the table.'] },
    'violation-without-text': { ok: true, pass: false, violations: [{ code: 'UnknownMemory' }] },
    'pass-as-text': { ok: true, pass: 'yes', violations: [] },
  },
  'calendar-intent': {
    'add-without-activity': without(g['calendar-intent'], 'activity'),
    'kind-missing': without(g['calendar-intent'], 'kind'),
    'kind-not-on-the-list': change(g['calendar-intent'], (v) => { v.kind = 'schedule'; }),
    'activity-long-run-with-a-space': change(g['calendar-intent'], (v) => { v.activity = 'long run'; }),
    'after-as-hour-number': change(g['calendar-intent'], (v) => { v.after = 12; }),
    'after-as-full-time': change(g['calendar-intent'], (v) => { v.after = g.session.start; }),
    'minutes-below-5': change(g['calendar-intent'], (v) => { v.minutes = 0; }),
    'exact-without-after': { kind: 'add', activity: 'walk', minutes: 30, day: '2026-11-10', exact: true },
    'exact-as-text': change(g['calendar-intent'], (v) => { v.exact = 'yes'; }),
    'title-empty': change(g['calendar-intent'], (v) => { v.title = ''; }),
    'title-over-60-characters': change(g['calendar-intent'], (v) => { v.title = 'A very long name for a workout that nobody could read on a phone'; }),
    'move-without-target': { kind: 'move', day: '2026-11-10' },
    'unknown-field': change(g['calendar-intent'], (v) => { v.start = g.session.start; }),
  },
  'preview-block': {
    'end-missing': without(g['preview-block'], 'end'),
    'reason-missing': without(g['preview-block'], 'reason'),
    'status-not-on-the-list': change(g['preview-block'], (v) => { v.status = 'added'; }),
    'start-without-offset': change(g['preview-block'], (v) => { v.start = v.start.slice(0, 19); }),
    'activity-long-run-with-a-space': change(g['preview-block'], (v) => { v.activity = 'long run'; }),
    'minutes-as-text': change(g['preview-block'], (v) => { v.minutes = '30'; }),
    'extra-field': change(g['preview-block'], (v) => { v.isNew = true; }),
    'allDay-is-not-a-field': change(g['preview-block'], (v) => { v.allDay = false; }),
  },
  'calendar-result': {
    'proposed-missing': without(g['calendar-result'], 'proposed'),
    'undoToken-missing': without(g['calendar-result'], 'undoToken'),
    'kind-not-on-the-list': change(g['calendar-result'], (v) => { v.kind = 'added'; }),
    'a-block-without-status': change(g['calendar-result'], (v) => { delete v.proposed[0].status; }),
    'question-with-four-answers': change(g['calendar-result'], (v) => { v.question = { text: 'Which one?', answers: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })) }; }),
    'ok-false': change(g['calendar-result'], (v) => { v.ok = false; }),
  },
  outcome: {
    'done-missing': without(g.outcome, 'done'),
    'done-as-text': change(g.outcome, (v) => { v.done = 'yes'; }),
    'plannedStart-without-offset': change(g.outcome, (v) => { v.plannedStart = v.plannedStart.slice(0, 19); }),
    'actualStart-with-six-fraction-digits': change(g.outcome, (v) => { v.actualStart = v.actualStart.replace(':00-', ':00.216112-'); }),
    'actualMinutes-negative': change(g.outcome, (v) => { v.actualMinutes = -5; }),
    'activity-as-health-name': change(g.outcome, (v) => { v.activity = 'Walking'; }),
    'extra-field': change(g.outcome, (v) => { v.status = 'done'; }),
  },
  'stopped-slot': {
    'activity-missing': without(g['stopped-slot'], 'activity'),
    'weekday-as-name': change(g['stopped-slot'], (v) => { v.weekday = 'wed'; }),
    'weekday-7': change(g['stopped-slot'], (v) => { v.weekday = 7; }),
    'hour-as-clock-text': change(g['stopped-slot'], (v) => { v.hour = '18:00'; }),
    'activity-as-health-name': change(g['stopped-slot'], (v) => { v.activity = 'Walking'; }),
    'whole-row-instead-of-its-slot': g['memory-row'],
  },
  'user-rules': {
    'rest-weekday-7': change(g['user-rules'], (v) => { v.restWeekdays = [7]; }),
    'rest-weekday-as-name': change(g['user-rules'], (v) => { v.restWeekdays = ['sat']; }),
    'session-minutes-as-one-number': change(g['user-rules'], (v) => { v.sessionMinutes = 20; }),
    'session-minutes-below-10': change(g['user-rules'], (v) => { v.sessionMinutes = { min: 5, max: 20 }; }),
    'window-as-hour-numbers': change(g['user-rules'], (v) => { v.window = { from: 12, to: 20 }; }),
    'window-clock-25': change(g['user-rules'], (v) => { v.window = { from: '12:00', to: '25:00' }; }),
    'equipment-not-on-the-list': change(g['user-rules'], (v) => { v.equipment = ['barbell']; }),
    'movement-state-not-on-the-list': change(g['user-rules'], (v) => { v.movements = { squat: 'maybe' }; }),
    'avoid-id-with-a-space': change(g['user-rules'], (v) => { v.avoid = ['jump squat']; }),
    'home-is-not-a-field': change(g['user-rules'], (v) => { v.home = { latitude: 1, longitude: 2 }; }),
  },
  'workout-content': {
    'focus-not-on-the-list': change(g['workout-content'], (v) => { v.focus = 'arms'; }),
    'no-items': change(g['workout-content'], (v) => { v.items = []; }),
    'reps-and-seconds': change(g['workout-content'], (v) => { v.items[0].seconds = [20, 30]; }),
    'neither-reps-nor-seconds': change(g['workout-content'], (v) => { delete v.items[0].reps; delete v.items[0].seconds; }),
    'reps-as-one-number': change(g['workout-content'], (v) => { v.items[0].reps = 10; delete v.items[0].seconds; }),
    'sets-0': change(g['workout-content'], (v) => { v.items[0].sets = 0; }),
    'load-over-what-a-backpack-holds': change(g['workout-content'], (v) => { v.items[0].load = 20; }),
    'movement-name-instead-of-id': change(g['workout-content'], (v) => { v.items[0].movementId = 'Push-up'; }),
    'words-in-the-item': change(g['workout-content'], (v) => { v.items[0].steps = ['Stand tall.']; }),
  },
  error: {
    'error-is-a-name-not-an-object': { ok: false, error: 'BadJSON' },
    'ok-true': { ok: true, error: { code: 'BadJSON', text: 'The arguments are not JSON.' } },
    'ok-missing': { error: { code: 'BadJSON', text: 'The arguments are not JSON.' } },
    'text-missing': { ok: false, error: { code: 'BadJSON' } },
    'text-empty': { ok: false, error: { code: 'BadJSON', text: '' } },
    'code-has-a-space': { ok: false, error: { code: 'bad json', text: 'The arguments are not JSON.' } },
    'extra-field': { ok: false, error: { code: 'BadJSON', text: 'The arguments are not JSON.' }, message: 'bad' },
  },
};
// 5. For the Swift app: one file per value type, a list of every valid example, to decode as [Type].
const all = Object.fromEntries(Object.keys(schemas).map((name) => [name, []]));
for (const group of readdirSync(`${root}fixtures/valid`).sort()) for (const f of readdirSync(`${root}fixtures/valid/${group}`).sort()) all[f.split('.')[0]].push(assertValid(f.split('.')[0], JSON.parse(readFileSync(`${root}fixtures/valid/${group}/${f}`, 'utf8'))));
for (const [name, values] of Object.entries(all)) write(`fixtures/swift/${name}.json`, values);
write('fixtures/swift/handoffs.json', PEOPLE.map((p) => JSON.parse(readFileSync(`${root}fixtures/handoffs/${p.persona}.json`, 'utf8'))));

let count = 0;
for (const [name, cases] of Object.entries(bad)) for (const [reason, value] of Object.entries(cases)) { write(`fixtures/invalid/${name}/${reason}.json`, value); count++; }
console.log(`wrote src/schemas.mjs (${Object.keys(schemas).length} schemas) and fixtures/ (${PEOPLE.length} people, ${count} invalid examples)`);
