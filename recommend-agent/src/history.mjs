// The person's history as the app reads it from Apple Health:
// { workouts: [{ activityType, start, end, durationMin?, avgHeartRate?, effort?, distanceKm?, indoor? }], daily: [{ date, sleepMin?, restingHeartRate? }] }.
import { InputError, parseDT, parseDay, dayOf } from './pytime.mjs';

const KEEP = ['id', 'activityType', 'start', 'end', 'avgHeartRate', 'effort', 'distanceKm', 'indoor'];

/** [workouts, daily summaries]. Throws missing_history when there is none. */
export function readHistory(history, now) {
  if (!history || typeof history !== 'object') throw new InputError('missing_history');
  return [historyWorkouts(history, now), historyDaily(history, now)];
}

/** Workouts that ended by `now`, oldest first, with their minutes: the logged duration when given, else end minus start. */
export function historyWorkouts(doc, now) {
  const out = [];
  for (const raw of doc.workouts ?? []) {
    const w = {};
    for (const k of KEEP) w[k] = raw[k] ?? null;
    const start = parseDT(raw.start);
    const end = parseDT(raw.end);
    if (end.mic <= now.mic) {
      const minutes = Number.isFinite(raw.durationMin) && raw.durationMin > 0 ? raw.durationMin : (end.mic - start.mic) / 1e6 / 60;
      out.push({ ...w, start, end, durationMin: minutes });
    }
  }
  return out.map((w, i) => [w, i]).sort((a, b) => a[0].start.mic - b[0].start.mic || a[1] - b[1]).map(([w]) => w);
}

/** Daily summaries for days before today, oldest first. */
export function historyDaily(doc, now) {
  const out = [];
  (doc.daily ?? []).forEach((d, i) => {
    const day = parseDay(d.date);
    if (day < dayOf(now)) out.push([{ sleepMin: d.sleepMin ?? null, restingHeartRate: d.restingHeartRate ?? null, date: day }, i]);
  });
  return out.sort((a, b) => a[0].date - b[0].date || a[1] - b[1]).map(([d]) => d);
}
