// Where the person trains, read from the kinds of their Health workouts: with at least 8 weeks of history and some
// workouts in the last 8 weeks, none of a gym-equipment type means they train at home. Code writes the evidence and the
// one sentence a memory of it may say; the model never words it. Pure: no clock, no file access.
import { parseTimestamp } from '../contract/index.mjs';
import { MIN_WORKOUT_MINUTES } from '../facts/constants.mjs';
import { addDays, dayNum } from './evidence.mjs';

export const PLACE_WEEKS = 8;
export const PLACE_DAYS = PLACE_WEEKS * 7;
export const PLACE_SLOT = 'routine.training_place';
export const PLACE_KIND = 'training_place';
/** The only sentence a training_place memory may say (the lint's "no you" and "a number" rules do not fit it, so it is fixed). */
export const PLACE_STATEMENT = 'You train at home, without gym equipment.';

// Health workout types that need equipment a home rarely has: an elliptical trainer and a stair climber (stepper).
// Strength training is not on the list: a home session is written to Health as strength training too. Types that
// can be done either way (rowing on water or on a machine, cycling, climbing outdoors) are left out as well.
export const GYM_ACTIVITY_TYPES = ['Elliptical', 'StairClimbing'];

/**
 * The training-place evidence of the completed `day` (local YYYY-MM-DD) from a validated snapshot:
 *   { items: [evidence item] , gym: boolean }
 * `items` holds `place.home` when the history reaches back at least 56 days (its first logged day to `day`) and the last
 * 56 days hold a counted workout (10 minutes or more) but none of a gym type. `gym` is true when such a workout is there.
 * `nowMs` is the instant the day ended: a workout that had not ended by then is left out. Forgotten days are unlogged.
 */
export function placeEvidence(snapshot, day, nowMs, forgottenDays = []) {
  const forgot = new Set(forgottenDays);
  const records = [];
  for (const w of snapshot.workouts ?? []) {
    const s = parseTimestamp(w.start);
    const e = parseTimestamp(w.end);
    if (s === null || e === null) continue;
    records.push({ type: w.activityType, ms: s.ms, day: w.start.slice(0, 10), ended: e.ms <= nowMs && s.ms <= nowMs, minutes: w.durationMin });
  }
  // A workout is one identity (activity and instant); if any record of it is on a forgotten day, all of it is forgotten.
  const gone = new Set(records.filter((r) => forgot.has(r.day)).map((r) => `${r.type}|${r.ms}`));
  const seen = new Set();
  const workouts = records.filter((r) => {
    const id = `${r.type}|${r.ms}`;
    if (!r.ended || r.day > day || gone.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const logged = [...(snapshot.dailySummaries ?? []).map((x) => x.date), ...workouts.map((w) => w.day)].filter((d) => d <= day && !forgot.has(d)).sort();
  if (logged.length === 0 || dayNum(day) - dayNum(logged[0]) + 1 < PLACE_DAYS) return { items: [], gym: false };
  const from = addDays(day, -(PLACE_DAYS - 1));
  const counted = workouts.filter((w) => w.day >= from && Number.isFinite(w.minutes) && w.minutes >= MIN_WORKOUT_MINUTES);
  const gymWorkouts = counted.filter((w) => GYM_ACTIVITY_TYPES.includes(w.type)).length;
  if (gymWorkouts > 0) return { items: [], gym: true };
  if (counted.length === 0) return { items: [], gym: false };
  return {
    gym: false,
    items: [{
      id: 'place.home', window: `${PLACE_DAYS}d`, numbers: { from, to: day, workouts: counted.length, gymWorkouts: 0, weeks: PLACE_WEEKS },
      text: `Counted workouts in the last ${PLACE_DAYS} days (${from} to ${day}; workouts of ${MIN_WORKOUT_MINUTES} minutes or more): ${counted.length}, of which 0 of a gym-equipment type (elliptical, stair climbing).`,
      slots: [{ slot: PLACE_SLOT, kind: PLACE_KIND, data: { place: 'home', gymWorkouts: 0, weeks: PLACE_WEEKS } }],
    }],
  };
}
