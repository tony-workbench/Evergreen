// Test helper for tests that are ABOUT COMPLETED DAYS. `completedFacts(snapshot, now)` takes a `now` that names the day to
// describe (for example "<day>T23:00"), moves it to the local midnight that ends that day and asks the engine for 'completed'.
// It is NOT how the engine is called in production: tests of the default behaviour, of in-progress days and of the day modes
// use the public `computeFacts` directly with the real time (see facts-public.test.mjs). When `dayMode` is passed the call goes
// straight to the engine unchanged.
import { computeFacts as engine } from '../../src/facts/index.mjs';
import { parseTimestamp } from '../../src/contract/index.mjs';

const MIDNIGHT = /T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function endOfDay(now, snapshot) {
  let str = now;
  if (now instanceof Date) {
    const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(snapshot.exportDate);
    const off = !m || m[1] === 'Z' ? 0 : (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]));
    str = new Date(now.getTime() + off * 60000).toISOString().slice(0, 19) + (m ? m[1] : 'Z');
  }
  if (MIDNIGHT.test(str)) return str;
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(str)[1];
  const next = new Date(Date.parse(`${str.slice(0, 10)}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return `${next}T00:00:00${offset}`;
}

export function completedFacts(snapshot, now, options = {}) {
  if (options.dayMode !== undefined) return engine(snapshot, now, options);
  const bad = (typeof now === 'string' && parseTimestamp(now) === null) || (now instanceof Date && Number.isNaN(now.getTime())) || (typeof now !== 'string' && !(now instanceof Date));
  if (bad) return engine(snapshot, now, options); // let the engine refuse it
  return engine(snapshot, endOfDay(now, snapshot), { ...options, dayMode: 'completed' });
}
