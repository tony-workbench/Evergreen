export const MIN_WORKOUT_MINUTES = 10; // a workout shorter than this is not counted
export const THIN_DAYS_NEEDED = 14; // under this many days of data: no comparison is written
export const SPIKE_RATIO = 2; // "today vs highest previous day" is written only at this ratio or above
export const MIN_BODY_READINGS = 3; // sleep and resting heart rate need at least this many daily values in a window

// Activity types that may appear in fact text and numbers. Anything else is written as "Other".
export const ACTIVITY_ALLOWLIST = [
  'Running', 'Walking', 'Cycling', 'Hiking', 'Swimming', 'Rowing', 'Elliptical', 'StairClimbing', 'Yoga', 'Pilates',
  'Dance', 'CoreTraining', 'Flexibility', 'MixedCardio', 'FunctionalStrengthTraining', 'TraditionalStrengthTraining',
  'HighIntensityIntervalTraining', 'Boxing', 'Tennis', 'Soccer', 'Basketball', 'Golf', 'Skiing', 'Climbing', 'Other',
];

// "FunctionalStrengthTraining" -> "functional strength training" (the form used in fact text).
export function activityName(activity) {
  let out = '';
  for (let i = 0; i < activity.length; i++) {
    const upper = activity[i] >= 'A' && activity[i] <= 'Z';
    const prevUpper = i > 0 && activity[i - 1] >= 'A' && activity[i - 1] <= 'Z';
    out += (i > 0 && upper && !prevUpper ? ' ' : '') + activity[i];
  }
  return out.toLowerCase();
}
export const MIN_BASELINE_DAYS = 7; // an average over earlier days is written only when it rests on at least this many logged days

// Shorter labels for sentences (the canonical names stay in `numbers`).
export const SHORT_LABELS = { TraditionalStrengthTraining: 'strength training', FunctionalStrengthTraining: 'strength training' };
export const ACTIVITY_LABELS_ALL = [...new Set([...ACTIVITY_ALLOWLIST.map(activityName), ...Object.values(SHORT_LABELS)])];

// Labels for the activities named in ONE sentence: the short label, unless two canonical names would get the same
// label there, in which case those keep their longer (canonical-derived) labels.
export function activityLabels(types) {
  const short = (t) => SHORT_LABELS[t] ?? activityName(t);
  const count = {};
  for (const t of types) count[short(t)] = (count[short(t)] || 0) + 1;
  return Object.fromEntries(types.map((t) => [t, count[short(t)] > 1 ? activityName(t) : short(t)]));
}
