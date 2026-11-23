// The hand-offs the app does between the agents (contract/AGENTS.md, "Hand-off functions"). Pure functions:
// no clock, no storage, no network. The Swift app must do exactly the same; the fixtures and tests pin the results.

const USABLE = ['saved', 'confirmed'];

/** Apple Health workout types by contract activity. A Health run counts for `run` and `long_run`. */
const HEALTH = [
  [/^running$/i, 'run'], [/^(walking|hiking)$/i, 'walk'], [/strengthtraining$/i, 'strength'], [/^(yoga|pilates)$/i, 'yoga'],
  [/^cycling$/i, 'ride'], [/^swimming$/i, 'swim'], [/^elliptical$/i, 'elliptical'], [/^(flexibility|cooldown|preparationandrecovery)$/i, 'stretch'],
];
/** The contract activity of a Health workout type ("Running" -> "run"); `other` for a type the contract does not name. */
export const activityOfHealth = (type) => HEALTH.find(([re]) => re.test(String(type ?? '')))?.[1] ?? 'other';

/** A Health time in the contract's form: at most 3 fractional digits. */
export const contractTime = (time) => String(time).replace(/(\.\d{3})\d+/, '$1');

/** The local day written in a time: "2026-11-09T18:00:00-08:00" -> "2026-11-09". */
export const dayOfTime = (time) => String(time).slice(0, 10);

/**
 * Session -> the intent for calendarPlan: add this activity on its day, exactly at its start (the time the person accepted).
 * For `other`, the title is the original name (`data.label`) from the first memory row the session is based on that has one.
 */
export function sessionToIntent(session, rows = []) {
  const label = session.activity === 'other' ? (session.basedOn ?? []).map((key) => rows.find((r) => r.key === key)?.data?.label).find((x) => typeof x === 'string' && x.length > 0) : undefined;
  const title = label ? { title: label.slice(0, 60) } : {};
  if (session.activity === 'rest') return { kind: 'add', activity: 'rest', sessionId: session.id, day: session.day };
  return { kind: 'add', activity: session.activity, ...title, minutes: session.minutes, sessionId: session.id, day: session.day, after: String(session.start).slice(11, 16), exact: true };
}

/** Memory rows -> the calendar engine's `memory`: the person's usual times, one per usable usual_slot row, copied from `data`. */
export function rowsToCalendarMemory(rows) {
  const slots = (rows ?? []).filter((row) => row.kind === 'usual_slot' && USABLE.includes(row.state))
    .map((row) => ({ key: row.key, activity: row.data.activity, weekday: row.data.weekday, hour: row.data.hour, minutes: row.data.minutes }));
  return { slots };
}

/**
 * The outcomes of one local day. planRecords: [{ sessionId, day, activity, plannedStart }], the sessions the person put in
 * the plan. healthWorkouts: Health workouts [{ activityType, start, durationMin }]. A record is done when a workout of its
 * activity started that day; each workout counts once, the closest planned and actual starts first. Rest records give no outcome.
 */
export function outcomesFor(planRecords, healthWorkouts, day) {
  const left = (healthWorkouts ?? []).filter((w) => dayOfTime(w.start) === day).map((w) => ({ ...w, activity: activityOfHealth(w.activityType ?? w.activity) }));
  const records = (planRecords ?? []).filter((r) => r.day === day && r.activity !== 'rest')
    .sort((a, b) => Date.parse(a.plannedStart) - Date.parse(b.plannedStart) || (a.sessionId < b.sessionId ? -1 : 1));
  // Pair the closest planned and actual starts first, so one workout never counts for two records.
  const wanted = (r) => (r.activity === 'long_run' ? 'run' : r.activity);
  const pairs = records.flatMap((r) => left.filter((w) => w.activity === wanted(r)).map((w) => ({ r, w, gap: Math.abs(Date.parse(w.start) - Date.parse(r.plannedStart)) })))
    .sort((a, b) => a.gap - b.gap || records.indexOf(a.r) - records.indexOf(b.r) || left.indexOf(a.w) - left.indexOf(b.w));
  const done = new Map(), used = new Set();
  for (const { r, w } of pairs) if (!done.has(r) && !used.has(w)) { done.set(r, w); used.add(w); }
  return records.map((r) => {
    const base = { sessionId: r.sessionId, day: r.day, activity: r.activity, plannedStart: r.plannedStart }, w = done.get(r);
    return w ? { ...base, done: true, actualStart: contractTime(w.start), actualMinutes: Math.round(w.durationMin) } : { ...base, done: false };
  });
}

/** The weekday of a local day, Monday 0. */
export const weekdayOfDay = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/**
 * The memory keys to pass to memoryReject, one call each, when the person says "Not now" to a session: only the usual_slot
 * rows with the session's activity, weekday and start hour. The other rows a session cites are the model's choice and stay.
 */
export function keysToReject(session, rows) {
  const weekday = weekdayOfDay(session.day), hour = Number(String(session.start).slice(11, 13));
  return [...new Set((rows ?? []).filter((r) => r.kind === 'usual_slot' && r.data.activity === session.activity && r.data.weekday === weekday && r.data.hour === hour).map((r) => r.key))];
}

/** The usual_slot rows the person rejected -> the `stopped` list for planContext, checkPlan and recommendWeek. */
export const rowsToStopped = (rows) => (rows ?? []).filter((r) => r.kind === 'usual_slot')
  .map((r) => ({ key: r.key, activity: r.data.activity, weekday: r.data.weekday, hour: r.data.hour }));
