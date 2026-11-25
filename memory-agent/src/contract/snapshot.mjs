import { parseTimestamp } from './time.mjs';

// Validator for the health snapshot (the input). No dependencies.
// Returns { ok, errors }; errors is a list of "path: problem" strings.
// No message contains any value from the input: fixed text, the field name and an array index only.

export const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
// at most n decimals (readings are scaled to integers by the engine; the tolerance absorbs binary representation)
const decimalsOk = (x, n) => Math.abs(x * 10 ** n - Math.round(x * 10 ** n)) < 1e-4;

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function validDate(s) {
  if (typeof s !== 'string' || !DATE_ONLY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validTimestamp(s) {
  return parseTimestamp(s) !== null; // strict: hour 24, minute 60 and a bad offset are rejected
}

export function validateSnapshot(snapshot) {
  const errors = [];
  const bad = (path, msg) => errors.push(`${path}: ${msg}`);
  if (!isObj(snapshot)) return { ok: false, errors: ['snapshot: must be an object'] };

  if (!validTimestamp(snapshot.exportDate)) bad('exportDate', 'must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
  if (!isObj(snapshot.persona) || typeof snapshot.persona.key !== 'string' || !snapshot.persona.key) {
    bad('persona', 'must be an object with a non-empty key');
  }

  if (!Array.isArray(snapshot.dailySummaries)) bad('dailySummaries', 'must be an array');
  else {
    snapshot.dailySummaries.forEach((s, i) => {
      const p = `dailySummaries[${i}]`;
      if (!isObj(s)) return bad(p, 'must be an object');
      if (!validDate(s.date)) bad(`${p}.date`, 'must be a calendar date YYYY-MM-DD');
      if (isNum(s.restingHeartRate) && !decimalsOk(s.restingHeartRate, 6)) bad(`${p}.restingHeartRate`, 'must have at most 6 decimals');
      if (s.sleepMinutes && isNum(s.sleepMinutes.totalAsleep) && !decimalsOk(s.sleepMinutes.totalAsleep, 6)) bad(`${p}.sleepMinutes`, 'must have at most 6 decimals');
      if (s.restingHeartRate !== undefined && !(isNum(s.restingHeartRate) && s.restingHeartRate > 0 && s.restingHeartRate <= 250)) {
        bad(`${p}.restingHeartRate`, 'must be a number between 0 and 250');
      }
      if (s.steps !== undefined && !(isNum(s.steps) && s.steps >= 0)) bad(`${p}.steps`, 'must be a number >= 0');
      if (s.sleepMinutes !== undefined) {
        if (!isObj(s.sleepMinutes) || !(isNum(s.sleepMinutes.totalAsleep) && s.sleepMinutes.totalAsleep >= 0 && s.sleepMinutes.totalAsleep <= 1440)) {
          bad(`${p}.sleepMinutes`, 'must be an object with totalAsleep between 0 and 1440');
        }
      }
    });
  }

  if (Array.isArray(snapshot.dailySummaries)) {
    // Two summaries for one date are allowed only when identical; otherwise the facts would depend on input order.
    const byDate = new Map();
    snapshot.dailySummaries.forEach((s, i) => {
      if (!isObj(s) || typeof s.date !== 'string') return;
      const form = stable(s);
      if (byDate.has(s.date) && byDate.get(s.date) !== form) bad(`dailySummaries[${i}]`, 'conflicts with another summary for the same date');
      else byDate.set(s.date, form);
    });
  }

  if (!Array.isArray(snapshot.workouts)) bad('workouts', 'must be an array');
  else {
    snapshot.workouts.forEach((w, i) => {
      const p = `workouts[${i}]`;
      if (!isObj(w)) return bad(p, 'must be an object');
      if (typeof w.activityType !== 'string' || !w.activityType) bad(`${p}.activityType`, 'must be a non-empty string');
      const okStart = validTimestamp(w.start);
      const okEnd = validTimestamp(w.end);
      if (!okStart) bad(`${p}.start`, 'must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
      if (!okEnd) bad(`${p}.end`, 'must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
      if (okStart && okEnd && parseTimestamp(w.end).ms < parseTimestamp(w.start).ms) bad(`${p}.end`, 'must not be before start');
      if (!(isNum(w.durationMin) && w.durationMin >= 0)) bad(`${p}.durationMin`, 'must be a number >= 0');
      if (isNum(w.effort) && !decimalsOk(w.effort, 2)) bad(`${p}.effort`, 'must have at most 2 decimals');
      if (w.effort !== undefined && !(isNum(w.effort) && w.effort >= 1 && w.effort <= 10)) bad(`${p}.effort`, 'must be a number from 1 to 10');
      if (w.indoor !== undefined && typeof w.indoor !== 'boolean') bad(`${p}.indoor`, 'must be a boolean');
      if (w.heartRate !== undefined) {
        if (!isObj(w.heartRate) || !Object.values(w.heartRate).every(isNum)) bad(`${p}.heartRate`, 'must be an object of numbers');
      }
    });
  }

  if (Array.isArray(snapshot.workouts)) {
    // The same activity at the same instant with the same duration but a different effort score is a conflict
    // (which score is right?). Identical repeats are fine.
    const seen = new Map();
    snapshot.workouts.forEach((w, i) => {
      if (!isObj(w) || parseTimestamp(w.start) === null) return;
      const key = `${w.activityType}|${parseTimestamp(w.start).ms}|${w.durationMin}`;
      const effort = w.effort === undefined ? 'none' : String(w.effort);
      if (seen.has(key) && seen.get(key) !== effort) bad(`workouts[${i}]`, 'conflicts with another workout of the same activity, instant and duration that has a different effort');
      else if (!seen.has(key)) seen.set(key, effort);
    });
  }

  // Calendar events: mock input for now. Validated here, never read by the facts engine, so a title can't reach memory or output.
  if (snapshot.calendar !== undefined) {
    if (!isObj(snapshot.calendar) || !Array.isArray(snapshot.calendar.events)) bad('calendar', 'must be an object with an events array');
    else {
      snapshot.calendar.events.forEach((e, i) => {
        const p = `calendar.events[${i}]`;
        if (!isObj(e)) return bad(p, 'must be an object');
        if (typeof e.title !== 'string' || !e.title.trim()) bad(`${p}.title`, 'must be a non-empty string');
        const okStart = validTimestamp(e.start);
        const okEnd = validTimestamp(e.end);
        if (!okStart) bad(`${p}.start`, 'must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
        if (!okEnd) bad(`${p}.end`, 'must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
        if (okStart && okEnd && parseTimestamp(e.end).ms <= parseTimestamp(e.start).ms) bad(`${p}.end`, 'must be after start');
      });
    }
  }

  if (snapshot.target !== undefined) {
    const t = isObj(snapshot.target) ? snapshot.target.workoutsPerWeek : undefined;
    if (!(isNum(t) && t > 0 && Math.abs(t * 100 - Math.round(t * 100)) < 1e-9)) {
      bad('target', 'must be an object with workoutsPerWeek greater than 0 and at most 2 decimals');
    }
  }
  return { ok: errors.length === 0, errors };
}
