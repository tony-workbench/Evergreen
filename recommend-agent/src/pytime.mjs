// Dates and times the way the Python rules see them: an instant in whole microseconds plus a fixed UTC offset in minutes.
// Days are whole numbers (days since 1970-01-01), weekdays run Mon=0..Sun=6.
export const US_MIN = 60e6;
export const US_HOUR = 3600e6;
export const US_DAY = 86400e6;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class InputError extends Error {
  constructor(code) { super(code); this.name = 'InputError'; this.code = code; }
}

const mod = (a, b) => ((a % b) + b) % b;
const p2 = (n) => String(n).padStart(2, '0');
const DT = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d{1,6})\d*)?)?\s*(Z|z|[+-]\d\d(?::?\d\d)?)$/;
const DAY = /^(\d{4})-(\d\d)-(\d\d)$/;

/** 'YYYY-MM-DD' -> day number. */
export function parseDay(v) {
  const m = typeof v === 'string' ? DAY.exec(v) : null;
  if (!m) throw new InputError('bad_date');
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (dayISO(ms / 864e5) !== v) throw new InputError('bad_date');
  return ms / 864e5;
}

/** ISO 8601 with an offset (or Z) -> { mic, off }. */
export function parseDT(v) {
  if (v && typeof v === 'object' && Number.isFinite(v.mic) && Number.isFinite(v.off)) return v;
  const m = typeof v === 'string' ? DT.exec(v.trim()) : null;
  if (!m) throw new InputError('bad_datetime');
  let off = 0;
  if (m[8] !== 'Z' && m[8] !== 'z') {
    const d = m[8].replace(':', '');
    off = (d[0] === '-' ? -1 : 1) * (+d.slice(1, 3) * 60 + +(d.slice(3, 5) || 0));
  }
  const day = parseDay(`${m[1]}-${m[2]}-${m[3]}`);
  const mic = day * US_DAY + +m[4] * US_HOUR + +m[5] * US_MIN + +(m[6] || 0) * 1e6 + +(m[7] || '').padEnd(6, '0') - off * US_MIN;
  return { mic, off };
}

const local = (dt) => dt.mic + dt.off * US_MIN;
export const dayOf = (dt) => Math.floor(local(dt) / US_DAY);
export const hourOf = (dt) => Math.floor(mod(local(dt), US_DAY) / US_HOUR);
export const minuteOf = (dt) => Math.floor(mod(local(dt), US_HOUR) / US_MIN);
export const weekdayOf = (day) => mod(day + 3, 7);
export const dayISO = (day) => new Date(day * 864e5).toISOString().slice(0, 10);
export const atDay = (day, off, hour = 0, minute = 0) => ({ mic: day * US_DAY + hour * US_HOUR + minute * US_MIN - off * US_MIN, off });
export const addUs = (dt, mic) => ({ mic: dt.mic + mic, off: dt.off });

/** Python's datetime.isoformat(); `z` writes a zero offset as Z (how pydantic writes JSON). */
export function isoDT(dt, z = false) {
  const l = local(dt);
  const inDay = mod(l, US_DAY);
  const sec = Math.floor(mod(inDay, US_MIN) / 1e6);
  const micro = mod(inDay, 1e6);
  const a = Math.abs(dt.off);
  const offset = z && dt.off === 0 ? 'Z' : `${dt.off < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
  return `${dayISO(Math.floor(l / US_DAY))}T${p2(Math.floor(inDay / US_HOUR))}:${p2(Math.floor(mod(inDay, US_HOUR) / US_MIN))}:${p2(sec)}`
    + `${micro ? `.${String(micro).padStart(6, '0')}` : ''}${offset}`;
}

/** strftime('%a %b %d') of a day number. */
export function shortDay(day) {
  const d = new Date(day * 864e5);
  return `${WEEKDAYS[weekdayOf(day)]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())}`;
}

/** '6 AM', '7:15 PM'. */
export function clock(hour, minute = 0) {
  const h = mod(hour, 12) === 0 ? 12 : mod(hour, 12);
  return `${h}${minute ? `:${p2(minute)}` : ''} ${mod(hour, 24) < 12 ? 'AM' : 'PM'}`;
}
export const hhmm = (dt) => `${p2(hourOf(dt))}:${p2(minuteOf(dt))}`;
