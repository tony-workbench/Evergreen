// Test-only: three sample histories (harness-personas/*.json, the files the Python rules read) as the history the bundle takes,
// and the bundle's functions wrapped so a test can name a sample history (`persona`) instead of spelling it out.
// The bundle itself knows no sample person: it plans only from the history it is given.
import { readFileSync, existsSync } from 'node:fs';
import { parseDT, dayOf, parseDay, dayISO, isoDT, addUs, US_DAY } from '../../src/pytime.mjs';
import * as workouts from '../../src/workouts.mjs';
import * as plan from '../../src/plan.mjs';

const files = new Map();
function sample(name) {
  if (!files.has(name)) {
    const url = new URL(`./harness-personas/${name}.json`, import.meta.url);
    files.set(name, typeof name === 'string' && /^[a-z]+$/.test(name) && existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : null);
  }
  return files.get(name);
}

/** A sample person's history moved by whole weeks so it ends just before `now`, as the Python rules move it; null for an unknown name. */
export function historyFor(name, nowISO) {
  const d = sample(name);
  if (!d) return null;
  const now = parseDT(nowISO);
  const shift = Math.floor((dayOf(now) - dayOf(parseDT(d.exportDate))) / 7) * 7;
  const move = (iso) => isoDT(addUs(parseDT(iso), shift * US_DAY));
  return {
    workouts: d.workouts.map((w) => ({
      activityType: w.activityType, start: move(w.start), end: move(w.end), durationMin: w.durationMin,
      avgHeartRate: w.avgHeartRate ?? null, effort: w.effort ?? null, distanceKm: w.distanceKm ?? null, indoor: w.indoor ?? null,
    })),
    daily: (d.dailySummaries ?? []).map((s) => ({
      date: dayISO((s.date.length > 10 ? dayOf(parseDT(s.date)) : parseDay(s.date)) + shift), sleepMin: s.sleepMin ?? null, restingHeartRate: s.restingHeartRate ?? null,
    })),
  };
}

/** The arguments with `persona` replaced by that sample history (when no history is given). */
export function prepare(args) {
  if (!args || typeof args !== 'object' || !('persona' in args)) return args;
  const { persona, ...rest } = args;
  const history = rest.history ?? historyFor(persona, rest.now);
  return history ? { ...rest, history } : rest;
}
const inContext = (args) => (args && typeof args === 'object' && args.context ? { ...args, context: prepare(args.context) } : prepare(args));

export const recommendWeek = (args, firstDay) => workouts.recommendWeek(prepare(args), firstDay);
export const planContext = (args) => plan.planContext(prepare(args));
export const planBrief = (args) => plan.planBrief(inContext(args));
export const checkPlan = (args) => plan.checkPlan(inContext(args));
export const { explainAction, checkWeek } = plan;
/** The same for a call into the built bundle: the JSON string to pass. */
export const bundleArgs = (name, args) => JSON.stringify(name === 'checkPlan' || name === 'planBrief' ? inContext(args) : prepare(args));
