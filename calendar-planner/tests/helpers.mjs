// A sample week and small helpers shared by the tests. Day 0 is Monday 9 November 2026, UTC-8.
import { calendarPlan, calendarReplan } from '../src/phone/entry.mjs';

export const day = (n, hh, mm = '00') => `2026-11-${String(9 + n).padStart(2, '0')}T${hh}:${mm}:00-08:00`;
export const WEEK = {
  now: day(0, '09'),
  tzOffsetMinutes: -480,
  events: [
    { id: 'e1', title: 'Team sync', start: day(0, '17'), end: day(0, '18'), fixed: true },
    { id: 'e2', title: 'Client call', start: day(1, '14'), end: day(1, '15'), fixed: true },
    { id: 'e3', title: 'Evening class', start: day(2, '19'), end: day(2, '20'), fixed: true },
    { id: 'e4', title: 'Design review', start: day(3, '10'), end: day(3, '12'), fixed: true },
  ],
  workouts: [
    { id: 'w1', activity: 'Running', title: 'Run', start: day(1, '18'), end: day(1, '18', '45'), minutes: 45 },
    { id: 'w2', activity: 'TraditionalStrengthTraining', title: 'Strength', start: day(3, '07'), end: day(3, '07', '40'), minutes: 40 },
    { id: 'w3', activity: 'Running', title: 'Long run', start: day(6, '07'), end: day(6, '08', '30'), minutes: 90 },
  ],
};
export const plan = (request, more = {}) => JSON.parse(calendarPlan(JSON.stringify({ ...WEEK, ...more, request })));
export const replan = (p, change, more = {}) => JSON.parse(calendarReplan(JSON.stringify({ ...WEEK, ...more, plan: p, change })));
export const hm = (text) => text.slice(11, 16);
export const date = (text) => text.slice(0, 10);
export const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);
export const get = (r, id) => r.proposed.find((p) => p.id === id);

// The week as it would look if the proposal were confirmed: every workout with its proposed time, cancelled ones gone.
export function after(r, more = {}) {
  const base = (more.workouts ?? WEEK.workouts).map((x) => ({ id: x.id, start: x.start, end: x.end }));
  const out = new Map(base.map((x) => [x.id, x]));
  for (const p of r.proposed) { if (p.status === 'cancelled') out.delete(p.id); else if (p.activity !== 'rest') out.set(p.id, { id: p.id, start: p.start, end: p.end }); }
  return [...out.values()];
}

// A test that cannot run because something is not there (esbuild, the built bundle, the contract folder) is skipped,
// and with EVERGREEN_STRICT=1 it fails instead, so a full check cannot pass by skipping.
export function need(t, there, what) {
  if (there) return true;
  if (process.env.EVERGREEN_STRICT === '1') throw new Error(`missing: ${what}`);
  t.skip(`missing: ${what}`);
  return false;
}
