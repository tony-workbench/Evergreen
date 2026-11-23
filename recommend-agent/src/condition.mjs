// Shoe wear from logged run distances.
import { dayOf, dayISO, US_DAY } from './pytime.mjs';
import { pyRound, pySum, pyFloat } from './pynum.mjs';

export const KM_PER_MILE = 1.609344;
export const DEFAULT_LIFE_KM = 650; // about 400 miles, a daily road trainer
export const WORN_AT = 0.60;
export const REPLACE_AT = 0.85;

export const runs = (workouts) => workouts.filter((w) => w.activityType === 'Running' && (w.durationMin ?? 0) >= 10);

/** Wear of the current pair: miles before tracking plus every logged run since it was bought. */
export function condition(workouts, shoes, now, lifeKm = DEFAULT_LIFE_KM) {
  const counted = runs(workouts).filter((w) => dayOf(w.start) >= shoes.boughtOn && w.end.mic <= now.mic);
  const dist = counted.map((w) => w.distanceKm || 0);
  const runKm = pySum(dist);
  const km = shoes.startMiles * KM_PER_MILE + runKm;
  const share = km / lifeKm;
  const kmText = dist.some((d) => d) ? pyFloat(pyRound(runKm, 1)) : '0';
  return {
    km: pyRound(km, 1),
    miles: pyRound(km / KM_PER_MILE),
    lifeKm,
    percentLife: pyRound(share * 100),
    status: share >= REPLACE_AT ? 'replace' : share >= WORN_AT ? 'worn' : 'fresh',
    runsCounted: counted.length,
    why: `${pyRound(shoes.startMiles)} mi on the pair before tracking plus ${kmText} km from ${counted.length} logged runs since `
      + `${dayISO(shoes.boughtOn)}: ${pyRound(share * 100)}% of a ${lifeKm} km life.`,
  };
}
