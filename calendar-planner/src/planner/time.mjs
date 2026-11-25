// Local time for the planner. The planner works in "wall time": a timestamp whose UTC fields read as the person's local clock,
// so day and hour arithmetic stays as simple as in the original UTC-only Plan Calendar. This file converts in and out.
// tzOffsetMinutes is minutes east of UTC at `now` (Swift: TimeZone.current.secondsFromGMT() / 60; -480 for 08:00 behind UTC).
// tzChanges lists later offset changes (daylight saving): [{ at: ISO instant, tzOffsetMinutes }]. Without it the offset is constant.
import { fail } from './errors.mjs';

const MIN = 60000;
const two = (n) => String(n).padStart(2, '0');

// The offset written at the end of an ISO string, or null when it has none.
export function offsetOf(text) {
  const m = /(Z|[+-]\d\d:?\d\d)$/.exec(String(text ?? ''));
  if (!m) return null;
  if (m[1] === 'Z') return 0;
  const sign = m[1][0] === '-' ? -1 : 1, digits = m[1].replace(/[+:-]/g, '');
  return sign * (+digits.slice(0, 2) * 60 + +digits.slice(2));
}

export function makeZone({ now, tzOffsetMinutes, tzChanges } = {}) {
  const nowUtc = Date.parse(now);
  if (!Number.isFinite(nowUtc)) throw fail('BadNow');
  const base = Number.isFinite(tzOffsetMinutes) ? Math.round(tzOffsetMinutes) : offsetOf(now) ?? 0;
  const changes = (Array.isArray(tzChanges) ? tzChanges : [])
    .map((c) => ({ at: Date.parse(c?.at), off: Math.round(c?.tzOffsetMinutes) }))
    .filter((c) => Number.isFinite(c.at) && Number.isFinite(c.off) && c.at > nowUtc)
    .sort((a, b) => a.at - b.at);
  const offsetAt = (utc) => { let off = base; for (const c of changes) if (c.at <= utc) off = c.off; return off; };
  const toWall = (utc) => utc + offsetAt(utc) * MIN;
  // A wall time that happens twice (clocks go back) reads as the first one; one that never happens (clocks go forward) moves on by the gap.
  const fromWall = (wall) => {
    for (const off of [base, ...changes.map((c) => c.off)]) if (offsetAt(wall - off * MIN) === off) return wall - off * MIN;
    return wall - offsetAt(wall - base * MIN) * MIN;
  };
  return {
    nowWall: toWall(nowUtc),
    // An ISO string from the host -> the wall-time string the planner works with.
    wall: (text) => { const utc = Date.parse(text); return Number.isFinite(utc) ? new Date(toWall(utc)).toISOString() : null; },
    // A wall-time value from the planner -> an ISO string with the local offset in force at that moment.
    local: (wallValue) => {
      const utc = fromWall(typeof wallValue === 'number' ? wallValue : Date.parse(wallValue)), off = offsetAt(utc), a = Math.abs(off);
      return `${new Date(utc + off * MIN).toISOString().slice(0, 19)}${off < 0 ? '-' : '+'}${two(Math.floor(a / 60))}:${two(a % 60)}`;
    },
  };
}
