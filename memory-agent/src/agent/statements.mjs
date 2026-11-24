// One short sentence per kind, written by code from an evidence item: the same wording family as the brief, numbers
// rounded the same way (minutes and bpm whole, hours to one decimal, ratios to two). Used when forgetting a day changed a
// memory's numbers (no model is asked then), and by the rule-based stand-in for the model. null when the item has no template.
import { rounded } from '../memory/brief.mjs';
import { PLACE_STATEMENT } from './place.mjs';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const r = (v, places) => rounded(String(v), places);
const RATIO_PLACES = 2;   // ratios to two decimals
const WHOLE_PLACES = 0;   // minutes and bpm whole
const ONE_PLACE = 1;      // hours and workouts a week to one decimal
const BAND_TEXT = { early: 'before 08:00', morning: 'between 08:00 and 12:00', afternoon: 'between 12:00 and 17:00', evening: 'from 17:00' };

export function statementFor(e) {
  const n = e.numbers;
  if (e.id.startsWith('regularity.slot.')) return cap(e.text.replace('Fixed slot among recognised activities: ', '').replace(', in ', ' in '));
  if (e.id === 'volume.per_week') return `Weekly average over 4 weeks: ${r(n.workoutsPerWeek, ONE_PLACE)} workouts and ${r(n.minutesPerWeek, WHOLE_PLACES)} workout minutes.`;
  if (e.id === 'load.ratio') return `Load over the last 7 days: ${r(n.load7, WHOLE_PLACES)} ${n.basis === 'minutes' ? 'minutes' : 'effort-minutes'}, ${r(n.ratio, RATIO_PLACES)} times the 28-day weekly average.`;
  if (e.id === 'body.sleep') return `Average sleep is ${r(n.average7, ONE_PLACE)} h a night over 7 days and ${r(n.average28, ONE_PLACE)} h over 28 days.`;
  if (e.id === 'body.resting_hr') return `Average resting heart rate is ${r(n.average7, WHOLE_PLACES)} bpm over 7 days and ${r(n.average28, WHOLE_PLACES)} bpm over 28 days.`;
  if (e.id === 'mix.count' && e.text.includes('last 28 days: ')) return `Workouts by activity over the last 28 days: ${e.text.split('last 28 days: ')[1]}`;
  if (e.id.startsWith('gear.') || e.id.startsWith('goal.')) return e.text;
  if (e.id === 'place.home') return PLACE_STATEMENT;
  if (e.id.startsWith('outcomes.')) {
    const [, activity, band] = e.id.split('.');
    return `${n.notDone} of ${n.planned} planned ${activity} sessions ${BAND_TEXT[band]} were not done in the last 28 days.`;
  }
  return null;
}
