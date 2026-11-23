// One strict timestamp parser shared by the validator and the engine. Plain ECMAScript only (it runs in
// JavaScriptCore): the instant is computed from the parts, not from Date.parse, whose accepted formats differ between engines.
// Accepts "YYYY-MM-DDTHH:MM[:SS[.f[f[f]]]]" (at most 3 fractional digits: more would be dropped silently) with an offset (Z or +hh:mm / -hh:mm). Hour 0 to 23 (24:00 is rejected),
// minute and second 0 to 59, offset hour 0 to 23 and offset minute 0 to 59, and a real calendar date.
// Returns { ms, date, hour } or null.
const RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

export function parseTimestamp(s) {
  if (typeof s !== 'string') return null;
  const m = RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  if (h > 23 || mi > 59 || sec > 59) return null;
  let offsetMin = 0;
  if (m[8] !== 'Z') {
    const oh = Number(m[10]);
    const om = Number(m[11]);
    if (oh > 23 || om > 59) return null;
    offsetMin = (m[9] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  t.setUTCHours(h, mi, sec, 0);
  const frac = m[7] === undefined ? 0 : Number((m[7] + '00').slice(0, 3)); // milliseconds
  const ms = t.getTime() + frac - offsetMin * 60000;
  const date = m[1] + '-' + m[2] + '-' + m[3];
  return { ms, date, hour: h };
}
