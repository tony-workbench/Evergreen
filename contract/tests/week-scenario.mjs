// A week in the life of one person, as the app would run it: every value that crosses from one agent to the next is
// checked against its schema. `step(title, needs, fn)` runs one part; the caller decides what a missing global means.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertValid, SCHEMAS } from '../src/index.mjs';
import { sessionToIntent, rowsToCalendarMemory, outcomesFor, keysToReject, rowsToStopped, dayOfTime, weekdayOfDay } from '../src/adapt.mjs';
import { scriptedRecommendModel, windowProblems, usable, addDays, offsetText } from './models.mjs';
import { BUNDLES } from './host.mjs';

export const PERSONAS = ['sam', 'alex', 'jordan'];
export const fixture = (path) => JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8'));
export const persona = (name) => fixture(`personas/${name}.json`);

const TEXT = { type: 'string', minLength: 1 };
const DAY = SCHEMAS.session.properties.day;
// Results the contract describes in its Calls table rather than in a schema file.
const OK = { name: '{ ok: true }', schema: { type: 'object', required: ['ok'], properties: { ok: { const: true } } } };
const REQUEST = { name: 'the memoryDailyRequest result { ok, day, evidence: [{ id, text, numbers }] }', schema: { type: 'object', required: ['ok', 'day', 'evidence'], properties: { ok: { const: true }, day: DAY, evidence: { type: 'array', items: { type: 'object', required: ['id', 'text'], properties: { id: TEXT, text: TEXT, numbers: { type: 'object' } } } } } } };
const APPLIED = { name: 'the memoryDailyApply result { ok, applied: [...] }', schema: { type: 'object', required: ['ok', 'applied'], properties: { ok: { const: true }, applied: { type: 'array' } } } };
const REVIEWS = { name: 'the memoryReviewQueue result { ok, rows: [{ memoryId, key, kind, statement, data }] }', schema: { type: 'object', required: ['ok', 'rows'], properties: { ok: { const: true }, rows: { type: 'array', items: { type: 'object', required: ['memoryId', 'key', 'kind', 'statement', 'data'], properties: { memoryId: TEXT, key: TEXT, kind: SCHEMAS['memory-row'].properties.kind, statement: TEXT, data: { type: 'object' } } } } } } };
const LIMITS = { name: 'the planContext result { ok, maxMinutes, maxSessions }', schema: { type: 'object', required: ['ok', 'maxMinutes', 'maxSessions'], properties: { ok: { const: true }, maxMinutes: { type: ['number', 'null'], minimum: 0 }, maxSessions: { type: 'integer', minimum: 0 } } } };
const ANSWER = { name: 'a model answer (an object)', schema: { type: 'object' } };
const HEALTH_TYPE = { run: 'Running', long_run: 'Running', walk: 'Walking', strength: 'TraditionalStrengthTraining', yoga: 'Yoga', ride: 'Cycling', swim: 'Swimming', elliptical: 'Elliptical', stretch: 'Flexibility', other: 'Rowing' };

const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);
// A time some minutes after another, written with the same offset.
const later = (time, minutes) => { const sign = time.at(-6) === '-' ? -1 : 1, off = sign * (Number(time.slice(-5, -3)) * 60 + Number(time.slice(-2))); return `${new Date(Date.parse(time) + (minutes + off) * 60000).toISOString().slice(0, 19)}${time.slice(-6)}`; };
const slotKeys = (rows) => new Set(rows.filter((r) => r.kind === 'usual_slot').map((r) => r.key));
const onSlot = (session, rows) => session.basedOn.some((k) => slotKeys(rows).has(k));
const citesOnlyTable = (plan, rows, what) => {
  const keys = new Set(usable(rows).map((r) => r.key));
  for (const s of plan.sessions) for (const k of s.basedOn) assert.ok(keys.has(k), `${what}: session ${s.id} is based on "${k}", which is not a key in the table it was given`);
};

/** What the engine's intent schema allows that the contract does not, and the other way round. */
export function intentSchemaDifferences(theirs) {
  const ours = SCHEMAS['calendar-intent'], out = [];
  const mine = Object.keys(ours.properties), yours = Object.keys(theirs?.properties ?? {});
  for (const k of mine) if (!yours.includes(k)) out.push(`the engine's intent has no "${k}"`);
  for (const k of yours) if (!mine.includes(k)) out.push(`the engine's intent has "${k}", which the contract does not`);
  for (const k of mine.filter((x) => yours.includes(x))) {
    const a = (ours.properties[k].$ref ? SCHEMAS[ours.properties[k].$ref.replace('.schema.json', '')] : ours.properties[k]).enum, b = theirs.properties[k].enum;
    if (!a || !b) continue;
    const extra = b.filter((x) => !a.includes(x)), lacking = a.filter((x) => !b.includes(x));
    if (extra.length) out.push(`"${k}" also allows ${extra.map((x) => JSON.stringify(x)).join(', ')}`);
    if (lacking.length) out.push(`"${k}" does not allow ${lacking.map((x) => JSON.stringify(x)).join(', ')}`);
  }
  return out;
}

/** Runs the week for one persona on one host. Returns what crossed each boundary, for fixtures and reports. */
export async function runWeek(host, P, step) {
  const who = { root: '/memory', user: P.user }, tz = P.tzOffsetMinutes, offset = offsetText(tz);
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(dayOfTime(P.planNow), n));
  const week = { now: P.planNow, tzOffsetMinutes: tz, events: P.events, workouts: [] };
  const calendar = P.events.map((e) => ({ start: e.start, end: e.end, title: e.title }));
  const history = { workouts: P.snapshot.workouts, daily: P.snapshot.dailySummaries.map((d) => ({ date: d.date, sleepMin: d.sleepMinutes?.totalAsleep, restingHeartRate: d.restingHeartRate })) };
  const contextFor = (rows, stopped = []) => ({ now: P.planNow, memory: { rows }, stopped, calendar, history });
  const S = { live: false, rows: null, plan: null };
  const model = (context, rows, limits) => (host.has('recommendDemoModel') ? host.call('recommendDemoModel', { context, rows }, ANSWER) : scriptedRecommendModel({ rows, days, tzOffsetMinutes: tz, calendar, now: P.planNow, maxMinutes: limits.maxMinutes, maxSessions: limits.maxSessions }));
  const inWindow = (plan, what) => { const problems = windowProblems(plan, P.planNow); assert.ok(!problems.length, `${what} leaves the plan window (7 local days from today; today only from 60 minutes after now until 22:00): ${problems.join('; ')}`); };
  const daily = (now, snapshot, outcomes) => {
    for (const o of outcomes) assertValid('outcome', o, 'an outcome passed to memoryDailyRequest');
    const request = host.call('memoryDailyRequest', { ...who, now, snapshot, outcomes }, REQUEST);
    const proposals = host.call('memoryDemoModel', request, ANSWER);
    const applied = host.call('memoryDailyApply', { ...who, now, day: request.day, proposals }, APPLIED);
    return { request, proposals, applied, table: host.call('memoryTable', who, 'memory-table') };
  };

  // 1. Facts, then Remember.
  await step('day 0: facts go to memory, its changes are applied, and the table fits the schema', ['memoryDailyRequest', 'memoryDemoModel', 'memoryDailyApply', 'memoryTable'], () => {
    const first = daily(P.now, P.snapshot, []);
    assert.equal(first.request.day, addDays(dayOfTime(P.now), -1), 'the request is for the day that ended at the last local midnight');
    assert.ok(first.request.evidence.length > 0, 'four weeks of Health data give some evidence');
    for (const row of first.table.rows) assert.ok(['saved', 'confirmed'].includes(row.state), `the table holds only saved and confirmed rows, but ${row.key} is ${row.state}`);
    assert.equal(new Set(first.table.rows.map((r) => r.key)).size, first.table.rows.length, 'every row has its own key');
    assert.ok(slotKeys(first.table.rows).size >= 3, `the table should hold the person's three or four usual times as usual_slot rows, but holds ${slotKeys(first.table.rows).size}`);
    Object.assign(S, { live: true, rows: first.table.rows, request: first.request, table: first.table });
  });
  S.rows ??= fixture(`valid/${P.persona}/memory-table.json`).rows; // memory not there yet: carry on from the fixture table

  // 2. Recommend.
  S.plan = { ok: true, ...scriptedRecommendModel({ rows: S.rows, days, tzOffsetMinutes: tz, calendar, now: P.planNow }) };
  await step('the model proposes a week from the table keys only and checkPlan passes it', ['planContext', 'checkPlan'], () => {
    const context = contextFor(S.rows);
    const limits = host.call('planContext', context, LIMITS);
    const plan = assertValid('plan', { ok: true, ...model(context, S.rows, limits) }, 'the proposed plan');
    citesOnlyTable(plan, S.rows, 'the proposed plan');
    inWindow(plan, 'the proposed plan');
    assert.ok(plan.sessions.filter((s) => onSlot(s, S.rows)).length >= 3, 'the proposed week has sessions based on the usual times');
    const check = host.call('checkPlan', { plan, context }, 'plan-check');
    assert.equal(check.pass, true, `checkPlan must pass this plan, but said: ${check.violations.map((v) => `[${v.code}] ${v.text}`).join(' ')}`);
    const invented = structuredClone(plan);
    invented.sessions[0].basedOn.push('a-key-the-model-made-up');
    assert.equal(host.call('checkPlan', { plan: invented, context }, 'plan-check').pass, false, 'checkPlan must reject a session based on a key that is not in the table');
    // The size: a week over maxMinutes or over maxSessions is rejected, each with its own code.
    const codes = (p) => host.call('checkPlan', { plan: p, context }, 'plan-check').violations.map((v) => v.code);
    assert.equal(typeof limits.maxMinutes, 'number', 'with four weeks of history planContext knows maxMinutes');
    const minutes = plan.sessions.reduce((sum, x) => sum + x.minutes, 0);
    assert.ok(minutes <= limits.maxMinutes && plan.sessions.length <= limits.maxSessions, 'the proposed plan fits maxMinutes and maxSessions');
    const long = structuredClone(plan);
    long.sessions[0].minutes += limits.maxMinutes - minutes + 15;
    assert.ok(codes(long).includes('too_many_minutes'), `checkPlan must answer a week of ${limits.maxMinutes + 15} minutes (maxMinutes ${limits.maxMinutes}) with too_many_minutes`);
    const many = structuredClone(plan);
    for (let i = 0; many.sessions.length <= limits.maxSessions; i++) many.sessions.push({ ...plan.sessions[0], id: `${plan.sessions[0].id}-again-${i}`, day: days[1 + (i % 6)], start: `${days[1 + (i % 6)]}T${String(6 + Math.floor(i / 6)).padStart(2, '0')}:00:00${offset}`, minutes: 10 });
    assert.ok(codes(many).includes('too_many_sessions'), `checkPlan must answer a week of ${many.sessions.length} sessions (maxSessions ${limits.maxSessions}) with too_many_sessions`);
    // The window: nothing within 60 minutes of now, nothing after the seventh day.
    const soon = structuredClone(plan), far = structuredClone(plan);
    Object.assign(soon.sessions[0], { day: days[0], start: later(P.planNow, 30) });
    Object.assign(far.sessions[0], { day: addDays(days[6], 1), start: `${addDays(days[6], 1)}${plan.sessions[0].start.slice(10)}` });
    assert.equal(host.call('checkPlan', { plan: soon, context }, 'plan-check').pass, false, 'checkPlan must reject a session that starts less than 60 minutes after now');
    assert.equal(host.call('checkPlan', { plan: far, context }, 'plan-check').pass, false, 'checkPlan must reject a session after the seventh day');
    Object.assign(S, { plan, context, check });
  });
  await step('recommendWeek returns a plan from the table keys only and checkPlan passes it', ['recommendWeek', 'planContext', 'checkPlan'], () => {
    const context = contextFor(S.rows);
    const plan = host.call('recommendWeek', context, 'plan');
    citesOnlyTable(plan, S.rows, 'recommendWeek');
    inWindow(plan, 'recommendWeek');
    assert.ok(plan.sessions.some((x) => x.day === days[0]), `recommendWeek plans today (${days[0]}) when a usual time is still more than 60 minutes away`);
    const check = host.call('checkPlan', { plan, context }, 'plan-check');
    assert.equal(check.pass, true, `checkPlan must pass what recommendWeek returns, but said: ${check.violations.map((v) => `[${v.code}] ${v.text}`).join(' ')}`);
  });

  // 3. Place: the first session is accepted. Since the plan was made, something new landed on the calendar at that
  // very time, so the calendar agent has to find another one.
  const sessions = S.plan.sessions.filter((s) => s.activity !== 'rest');
  const A = sessions[0];
  const events = [...P.events, { id: 'late', title: 'Added after the plan', start: A.start, end: later(A.start, 30), fixed: true }];
  const B = sessions.find((s) => s !== A && keysToReject(s, S.rows).length > 0);
  const M = sessions.find((s) => s !== A && s !== B) ?? B;
  const intent = assertValid('calendar-intent', sessionToIntent(A, S.rows), 'sessionToIntent(session, rows)');
  Object.assign(S, { accepted: A, declined: B, missed: M, intent, calendarMemory: rowsToCalendarMemory(S.rows), block: null });
  await step('the accepted session becomes an intent and calendarPlan places it clear of the person\'s events', ['calendarPlan'], () => {
    const result = host.call('calendarPlan', { ...week, events, intent, memory: S.calendarMemory }, 'calendar-result');
    const added = result.proposed.filter((b) => b.status === 'new');
    assert.equal(added.length, 1, `one new block is proposed (${result.kind}: ${result.message})`);
    const [block] = added;
    assert.equal(block.activity, A.activity, 'the block has the session\'s activity, in the contract\'s spelling');
    assert.equal(block.minutes, A.minutes, 'the block has the session\'s length');
    assert.equal(block.sessionId, A.id, 'the block carries the session\'s id');
    assert.equal(dayOfTime(block.start), A.day, 'the block is on the session\'s day');
    assert.ok(block.start.slice(11, 16) >= intent.after, `the block starts at or after ${intent.after}, not at ${block.start.slice(11, 16)}`);
    assert.equal(Date.parse(block.end) - Date.parse(block.start), block.minutes * 60000, 'end is start plus minutes');
    for (const e of events) assert.ok(!overlaps(block, e), `the block ${block.start} to ${block.end} overlaps "${e.title}"`);
    // With nothing in the way, an accepted session goes exactly where it was shown.
    const free = host.call('calendarPlan', { ...week, intent, memory: S.calendarMemory }, 'calendar-result').proposed.filter((b) => b.status === 'new');
    assert.equal(free[0]?.start, A.start, 'with the time free, the block starts exactly at the session\'s start');
    Object.assign(S, { block, calendarResult: result });
  });
  await step('calendarReplan answers a drag with a result that fits the schema', ['calendarPlan', 'calendarReplan'], () => {
    assert.ok(S.block, 'calendarPlan placed no block to drag');
    const result = host.call('calendarReplan', { ...week, events, memory: S.calendarMemory, plan: S.calendarResult, change: { type: 'drag', id: S.block.id, start: `${A.day}T20:00:00${offset}` } }, 'calendar-result');
    for (const b of result.proposed) for (const e of events) assert.ok(b.status === 'cancelled' || !overlaps(b, e), `after the drag, ${b.title} overlaps "${e.title}"`);
  });
  await step('calendarPlan takes every activity on the contract\'s list and gives it back with the same name', ['calendarPlan'], () => {
    const problems = [];
    for (const activity of SCHEMAS.activity.enum) {
      const one = activity === 'rest' ? { kind: 'add', activity, day: days[5] } : { kind: 'add', activity, ...(activity === 'other' ? { title: 'Rowing' } : {}), minutes: 30, day: days[5], after: '10:00' };
      const r = host.tryCall('calendarPlan', { ...week, intent: assertValid('calendar-intent', one) }, 'calendar-result');
      const block = r.problem ? null : r.value.proposed.find((b) => b.status === 'new'), got = block?.activity;
      const problem = r.problem ?? (got !== activity ? `calendarPlan was asked to add "${activity}" and proposed ${JSON.stringify(got)}` : one.title && block.title !== one.title ? `calendarPlan was given the title "${one.title}" and proposed "${block.title}"` : null);
      host.note('calendarPlan', problem);
      if (problem) problems.push(`${activity}: ${problem}`);
    }
    assert.deepEqual(problems, []);
  });
  await step('calendarIntentSchema is the contract\'s intent schema', ['calendarIntentSchema'], () => {
    const differences = intentSchemaDifferences(host.call('calendarIntentSchema', {}, { name: 'a JSON Schema object', schema: { type: 'object', required: ['properties'] } }));
    if (differences.length) host.note('calendarIntentSchema', differences.join('; '));
    assert.deepEqual(differences, []);
  });

  // 4. Feedback: "Not now" on a session that came from a usual time.
  S.rejected = B ? keysToReject(B, S.rows) : [];
  S.stopped = rowsToStopped(S.rows.filter((r) => S.rejected.includes(r.key)));
  for (const x of S.stopped) assertValid('stopped-slot', x, 'rowsToStopped(rows)');
  const atStopped = (s) => S.stopped.some((x) => x.activity === s.activity && x.weekday === weekdayOfDay(s.day) && x.hour === Number(s.start.slice(11, 13)));
  await step('"Not now" rejects the keys of a session based on a usual time, and the next table lacks that row', ['memoryDailyRequest', 'memoryDemoModel', 'memoryDailyApply', 'memoryTable', 'memoryReject'], () => {
    assert.ok(S.live, 'day 0 did not finish, so memory holds no table to reject from');
    assert.ok(B, 'the plan has a second session at one of the usual times');
    const cited = B.basedOn.filter((k) => !S.rejected.includes(k));
    assert.equal(S.rejected.length, 1, 'only the usual time the session stands on is rejected');
    assert.ok(cited.some((k) => S.rows.find((r) => r.key === k)?.kind === 'weekly_volume'), 'the declined session also cites the weekly volume row');
    for (const key of S.rejected) host.call('memoryReject', { ...who, key, now: P.planNow }, OK);
    const table = host.call('memoryTable', who, 'memory-table');
    for (const key of S.rejected) assert.ok(!table.rows.some((r) => r.key === key), `the rejected row ${key} is still in the table`);
    for (const key of cited) assert.ok(table.rows.some((r) => r.key === key), `"Not now" must not remove ${key}, a row the session only cited`);
    assert.equal(table.rows.length, S.rows.length - S.rejected.length, 'the other rows stay');
    S.rowsAfter = table.rows;
  });
  S.rowsAfter ??= S.rows.filter((r) => !S.rejected.includes(r.key));
  await step('the next plan has no session based on the rejected row, and checkPlan rejects a plan that still cites it', ['planContext', 'checkPlan'], () => {
    const context = contextFor(S.rowsAfter, S.stopped);
    const limits = host.call('planContext', context, LIMITS);
    const next = assertValid('plan', { ok: true, ...model(context, S.rowsAfter, limits) }, 'the next plan');
    for (const s of next.sessions) for (const key of S.rejected) assert.ok(!s.basedOn.includes(key), `session ${s.id} of the next plan is still based on the rejected row`);
    assert.equal(host.call('checkPlan', { plan: next, context }, 'plan-check').pass, true, 'checkPlan passes the next plan');
    const stale = host.call('checkPlan', { plan: S.plan, context }, 'plan-check');
    assert.equal(stale.pass, false, 'checkPlan must reject the old plan, which still cites the rejected row');
    const named = stale.violations.filter((v) => v.sessionId !== undefined);
    if (named.length) assert.ok(named.some((v) => v.sessionId === B.id), 'a violation names the session that cites the rejected row');
    Object.assign(S, { nextPlan: next, staleCheck: stale });
  });
  await step('the stopped slot goes to the recommendation agent: a plan that still books it fails with stopped_slot, and recommendWeek leaves it out', ['planContext', 'checkPlan', 'recommendWeek'], () => {
    assert.ok(B && S.stopped.length === 1, 'one usual time was stopped');
    const context = contextFor(S.rowsAfter, S.stopped);
    // The same session again, now citing only rows that are still in the table: the key check cannot catch it, the slot check must.
    const again = { ok: true, sessions: [{ ...B, basedOn: B.basedOn.filter((k) => !S.rejected.includes(k)) }], summary: 'One session.' };
    const check = host.call('checkPlan', { plan: again, context }, 'plan-check');
    assert.ok(check.violations.some((v) => v.code === 'stopped_slot'), `checkPlan must answer a session at a stopped slot with stopped_slot, but said: ${check.violations.map((v) => v.code).join(', ') || 'pass'}`);
    assert.equal(host.call('checkPlan', { plan: again, context: contextFor(S.rows) }, 'plan-check').violations.some((v) => v.code === 'stopped_slot'), false, 'without the stop, the same session has no stopped_slot');
    const week2 = host.call('recommendWeek', context, 'plan');
    for (const s of week2.sessions) assert.ok(!atStopped(s), `recommendWeek still proposes ${s.id} at the stopped slot`);
    assert.ok(host.call('recommendWeek', contextFor(S.rows), 'plan').sessions.some(atStopped), 'before the stop, recommendWeek did propose that slot');
    for (const s of S.nextPlan?.sessions ?? []) assert.ok(!atStopped(s), `the next plan still books the stopped slot (${s.id})`);
  });

  // 5. Outcomes: the accepted session was done, another was missed; both go to the next daily run.
  const plannedStart = S.block?.start ?? A.start;
  const records = [A, M].filter(Boolean).map((s) => ({ sessionId: s.id, day: s.day, activity: s.activity, plannedStart: s === A ? plannedStart : s.start }));
  const actual = later(plannedStart, 5);
  const done = { activityType: HEALTH_TYPE[A.activity], start: actual, end: later(actual, A.minutes + 2), durationMin: A.minutes + 1.6 };
  const health = [...P.snapshot.workouts, done], lastDay = [A.day, M?.day ?? A.day].sort().at(-1), nextNow = `${addDays(lastDay, 1)}T00:05:00${offset}`;
  S.outcomes = [...new Set(records.map((r) => r.day))].sort().flatMap((day) => outcomesFor(records, health, day));
  for (const o of S.outcomes) assertValid('outcome', o, 'outcomesFor(...)');
  Object.assign(S, { planRecords: records, healthWorkouts: [done], outcomeDays: [...new Set(records.map((r) => r.day))].sort() });
  await step('a done and a missed session reach the next day\'s memory request and appear in its evidence', ['memoryDailyRequest', 'memoryDemoModel', 'memoryDailyApply', 'memoryTable'], () => {
    assert.ok(S.live, 'day 0 did not finish, so there is no memory to continue from');
    assert.deepEqual(S.outcomes.map((o) => o.done).sort(), [false, true], 'one session done and one missed');
    const next = daily(nextNow, { ...P.snapshot, exportDate: nextNow, workouts: health }, S.outcomes);
    for (const o of S.outcomes) {
      const id = `outcome.${o.sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`, item = next.request.evidence.find((e) => e.id === id);
      assert.ok(item, `the evidence has no item with the id ${id}`);
      assert.equal(item.numbers?.done, o.done, `the evidence item ${id} should have numbers.done ${o.done}`);
    }
    for (const key of S.rejected) assert.ok(!next.table.rows.some((r) => r.key === key), `the rejected row ${key} came back after the next daily run`);
    S.nextRequest = next.request;
  });
  await step('memoryRestore brings the row back, memoryConfirm confirms one, and the review queue fits the schema', ['memoryTable', 'memoryRestore', 'memoryConfirm', 'memoryReviewQueue'], () => {
    assert.ok(S.live && S.rejected.length, 'nothing was rejected, so there is nothing to restore');
    for (const key of S.rejected) host.call('memoryRestore', { ...who, key, now: nextNow }, OK);
    const kept = S.rowsAfter[0].key;
    host.call('memoryConfirm', { ...who, key: kept, now: nextNow }, OK);
    const table = host.call('memoryTable', who, 'memory-table');
    for (const key of S.rejected) assert.ok(table.rows.some((r) => r.key === key), `the restored row ${key} is not back in the table`);
    assert.equal(table.rows.find((r) => r.key === kept)?.state, 'confirmed', 'the confirmed row says so');
    host.call('memoryReviewQueue', who, REVIEWS);
  });

  // Every failure is the same Error value, whichever bundle it comes from.
  await step('every global answers arguments that are not JSON with an Error value', [], () => {
    const problems = [];
    for (const name of Object.values(BUNDLES).flatMap((b) => b.globals).filter((g) => g !== 'calendarIntentSchema' && host.has(g))) {
      const r = host.tryCall(name, '{', 'error');
      host.note(name, r.problem);
      if (r.problem) problems.push(r.problem);
      else S.error ??= r.value;
    }
    assert.deepEqual(problems, []);
  });
  return S;
}
