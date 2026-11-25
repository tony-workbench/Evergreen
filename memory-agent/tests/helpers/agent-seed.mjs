// A small agent state with eight days of made-up evidence (sleep, one usual slot, the weekly volume), for the guardrail and lifecycle tests.
import { createHash } from 'node:crypto';
import { freshState, recordFacts, recordOutcomes, applyDaily } from '../../src/agent/index.mjs';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const USER = `usr_${'f6'.repeat(8)}`;
export const DAYS = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
export const DAY = DAYS[7];
export const AT = '2026-11-18T00:00:00-08:00';

export const sleepFact = (a7 = 8.75, a28 = 8.55) => ({
  id: 'body.sleep', group: 'body', window: '7d vs 28d', numbers: { average7: a7, average28: a28, logged7: 7, logged28: 28, exact: { average7: { num: 1, den: 3 } } },
  text: `Average sleep over the last 7 days: ${a7.toFixed(2)} h (from 7 nights), ${Math.abs(a7 - a28).toFixed(2)} h ${a7 >= a28 ? 'above' : 'below'} the 28-day average of ${a28.toFixed(2)} h (from 28 nights).`,
});
export const slotFact = (weeks = 3) => ({
  id: 'regularity.slot.Running.Sun.08', group: 'regularity', window: '28d', numbers: { activityType: 'Running', weekday: 'Sun', hour: 8, hourEnd: 9, endsNextDay: false, weeks },
  text: `Fixed slot among recognised activities: running on Sun between 08:00 and 09:00, in ${weeks} of the last 4 weeks.`,
});
export const volumeFact = () => ({
  id: 'volume.28d', group: 'volume', window: '28d', numbers: { from: '2026-10-21', to: '2026-11-17', workouts: 26, minutes: 1292.5, loggedDays: 28, unloggedDays: 0 },
  text: 'Counted in the last 28 days (2026-10-21 to 2026-11-17; workouts of 10 minutes or more): 26 workouts and 1292.5 workout minutes on 28 logged days (0 unlogged days).',
});
export const medianFact = () => ({ id: 'mix.median_length', group: 'mix', window: '28d', numbers: { medianMinutesByActivity: { Running: 49.45 } }, text: 'Median length of counted workouts (10 minutes or more) by activity in the last 28 days: running 49.45 min.' });

/** Eight days of the same evidence; `days` limits how many of them (the latest ones) exist. */
export function seed(days = 8, facts = [sleepFact(), slotFact(), volumeFact(), medianFact()]) {
  const state = freshState(USER);
  for (const d of DAYS.slice(8 - days)) recordFacts(state, d, facts);
  return state;
}
export const SLEEP = { op: 'ADD', slot: 'body.sleep', kind: 'sleep', statement: 'Average sleep is 8.8 h a night over 7 days and 8.6 h over 28 days.', evidenceIds: ['body.sleep'] };
export const SLOT = { op: 'ADD', slot: 'routine.run.sun_08', kind: 'usual_slot', statement: 'Running on Sun between 08:00 and 09:00 in 3 of the last 4 weeks.', evidenceIds: ['regularity.slot.Running.Sun.08'] };
export const VOLUME = { op: 'ADD', slot: 'routine.weekly_volume', kind: 'weekly_volume', statement: 'Weekly average over 4 weeks: 6.5 workouts and 323 workout minutes.', evidenceIds: ['volume.per_week'] };
export const apply = (state, proposals, day = DAY) => applyDaily(state, { day, proposals, at: AT, sha256 });
export const CTX = { day: DAY, at: AT };
export const outcome = (day, done, hour = '06') => ({ sessionId: `s-${day}-run-${hour}`, day, activity: 'run', plannedStart: `${day}T${hour}:00:00-08:00`, done });
const record = (state, outcomes) => { for (const o of outcomes) recordOutcomes(state, [o], o.day); };
export { record as recordOutcomes, recordFacts };
