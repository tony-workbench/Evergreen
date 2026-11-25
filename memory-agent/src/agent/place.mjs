// Where the person trains, read from the kinds of their Health workouts (plan 5.A.3): no workout of a gym-equipment type in
// the last 8 weeks means they train at home without gym equipment. The 8 weeks are how far back it looks, not how much
// history it needs: a person with two weeks of Health records and no gym workout in them gets the row too. Code writes the
// evidence and the one sentence a memory of it may say; the model never words it. Pure: no clock, no file access.
import { parseTimestamp } from '../contract/index.mjs';
import { MIN_WORKOUT_MINUTES } from '../facts/constants.mjs';
import { addDays } from './evidence.mjs';

export const PLACE_WEEKS = 8;
const DATE_LENGTH = 10;   // "YYYY-MM-DD"
export const PLACE_DAYS = PLACE_WEEKS * 7;
export const PLACE_SLOT = 'routine.training_place';
export const PLACE_KIND = 'training_place';
/** The only sentence a training_place memory may say (the lint's "no you" and "a number" rules do not fit it, so it is fixed). */
export const PLACE_STATEMENT = 'You train at home, without gym equipment.';

// Health workout types that need gym equipment, and when (Health's `indoor` flag, where the workout carries it):
//   always          an elliptical trainer and a stair climber (Health logs real stairs as another type) are machines;
//   unless_outdoors rowing is nearly always a rowing machine; a row Health marks outdoors is on water, not at home either
//                   way, but it needs no gym, so it doesn't count;
//   if_indoors      cycling and climbing are done outdoors without a gym; indoors they need a stationary bike or a wall.
// Strength training (traditional or functional) is not on the list, though some of it is done on gym machines: the app
// writes every home session to Health as strength training, so counting it would retire the row after the first home
// workout. Swimming needs a pool, not equipment, and is left out; so are sports played on a court or a field.
export const GYM_TYPES = Object.freeze({ Elliptical: 'always', StairClimbing: 'always', Rowing: 'unless_outdoors', Cycling: 'if_indoors', Climbing: 'if_indoors' });
export const GYM_ACTIVITY_TYPES = Object.keys(GYM_TYPES);

/** Does this workout need gym equipment: its type, and for some types whether Health marked it indoors. */
export function isGymWorkout(type, indoor) {
  const rule = GYM_TYPES[type];
  if (rule === 'always') return true;
  if (rule === 'unless_outdoors') return indoor !== false;
  return rule === 'if_indoors' && indoor === true;
}

/**
 * The training-place evidence of the completed `day` (local YYYY-MM-DD) from a validated snapshot:
 *   { items: [evidence item] , gym: boolean }
 * `items` holds `place.home` when the last 56 days hold Health records (a daily summary or a workout) and no counted
 * workout (10 minutes or more) of a gym type. `gym` is true when such a workout is there. With no record at all in the
 * 56 days nothing is known about where the person trains, so nothing is written.
 * `when` is { day, nowMs, forgottenDays? }: `nowMs` is the instant the day ended (a workout that had not ended by then is
 * left out), and forgotten days are unlogged.
 */
export function placeEvidence(snapshot, when) {
  const { day, nowMs } = when;
  const forgot = new Set(when.forgottenDays ?? []);
  const from = addDays(day, -(PLACE_DAYS - 1));
  const workouts = endedWorkouts(snapshot, { day, nowMs, forgot }).filter((w) => w.day >= from);
  const logged = [...(snapshot.dailySummaries ?? []).map((x) => x.date), ...workouts.map((w) => w.day)].filter((d) => d >= from && d <= day && !forgot.has(d));
  const counted = workouts.filter((w) => Number.isFinite(w.minutes) && w.minutes >= MIN_WORKOUT_MINUTES);
  if (counted.some((w) => isGymWorkout(w.type, w.indoor))) return { items: [], gym: true };
  if (logged.length === 0) return { items: [], gym: false };
  return { gym: false, items: [homeItem(from, day, counted.length)] };
}

// The workouts that had ended by `nowMs`, up to `day`, each once. A workout is one identity (activity and instant); if any
// record of it is on a forgotten day, all of it is forgotten. `when` is { day, nowMs, forgot: a Set of days }.
function endedWorkouts(snapshot, when) {
  const { day, nowMs, forgot } = when;
  const records = [];
  for (const w of snapshot.workouts ?? []) {
    const s = parseTimestamp(w.start);
    const e = parseTimestamp(w.end);
    if (s === null || e === null) continue;
    records.push({ type: w.activityType, indoor: w.indoor, ms: s.ms, day: w.start.slice(0, DATE_LENGTH), ended: e.ms <= nowMs && s.ms <= nowMs, minutes: w.durationMin });
  }
  const gone = new Set(records.filter((r) => forgot.has(r.day)).map((r) => `${r.type}|${r.ms}`));
  const seen = new Set();
  return records.filter((r) => {
    const id = `${r.type}|${r.ms}`;
    if (!r.ended || r.day > day || gone.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function homeItem(from, day, workouts) {
  return {
    id: 'place.home', window: `${PLACE_DAYS}d`, numbers: { from, to: day, workouts, gymWorkouts: 0, weeks: PLACE_WEEKS },
    text: `Counted workouts in the last ${PLACE_DAYS} days (${from} to ${day}; workouts of ${MIN_WORKOUT_MINUTES} minutes or more): ${workouts}, of which 0 of a gym-equipment type (elliptical, stair climbing, rowing machine, indoor cycling, indoor climbing).`,
    slots: [{ slot: PLACE_SLOT, kind: PLACE_KIND, data: { place: 'home', gymWorkouts: 0, weeks: PLACE_WEEKS } }],
  };
}
