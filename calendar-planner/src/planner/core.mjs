// Shared building blocks, taken from Plan Calendar (github.com/tony-workbench/plan-calendar, src/planner/core.mjs): time helpers, free-slot finding,
// date and length reading, deadline back-planning, and re-planning after a change.
// Every time here is wall time (see time.mjs). The day window is 06:00-22:00 and meals (07:30, 12:00, 18:30) are protected.
export const MIN = 60000, H = 3600000, D = 86400000;
export const MEALS = [[450, 480, 'breakfast'], [720, 780, 'lunch'], [1110, 1170, 'dinner']];
export const WINDOW = [360, 1320];
export const AWAKE_END = 1410;
// Full-length steps first; shorter variants are used only when the time left is too tight for them.
export const STEP_VARIANTS = [[60, 120, 60], [60, 60, 60], [30, 60, 30], [30, 30, 30]];
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export const iso = (t) => new Date(t).toISOString();
export const ms = (v) => Date.parse(v);
export const dayStart = (t) => Math.floor(t / D) * D;
export const ceilTo = (t, step = 15 * MIN) => Math.ceil(t / step) * step;
export const minOfDay = (t) => (t - dayStart(t)) / MIN;
export const weekStart = (t) => dayStart(t) - ((new Date(dayStart(t)).getUTCDay() + 6) % 7) * D;
export const dur = (b) => ms(b.end) - ms(b.start);
// Cancelled blocks and all-day markers (a rest day) take no room.
const real = (blocks) => blocks.filter((b) => !b.cancelled && !b.allDay);

export function isFree(s, e, { events = [], blocks = [], meals = true } = {}) {
  if ([...events, ...real(blocks)].some((x) => s < ms(x.end) && e > ms(x.start))) return false;
  if (!meals) return true;
  const a = minOfDay(s), b = a + (e - s) / MIN;
  return !MEALS.some(([x, y]) => a < y && b > x);
}

export function* slots(from, length, { window = WINDOW, limit = from + 30 * D, step = 15 * MIN } = {}) {
  for (let ds = dayStart(from); ds < limit; ds += D) {
    const hi = Math.min(ds + window[1] * MIN, limit);
    for (let t = Math.max(ds + window[0] * MIN, ceilTo(from, step)); t + length <= hi; t += step) yield t;
  }
}

export function greedyFinder(from, length, o = {}) {
  for (const t of slots(from, length, o)) if (isFree(t, t + length, o)) return t;
  return null;
}

// ---- reading lengths and dates ----
const WORDS = { an: 1, a: 1, one: 1, two: 2, three: 3, four: 4 };
export function parseMinutes(text) {
  const t = text.toLowerCase();
  if (/half an hour|half hour|half-hour/.test(t)) return 30;
  if (/\b(?:an?|one)\s+(?:hour|hr)\s+and\s+a\s+half\b/.test(t)) return 90;
  if (/\bquarter of an hour\b|\bquarter hour\b/.test(t)) return 15;
  let m = t.match(/(\d+)[\s-]*(?:minutes?|mins?)\b/);
  if (m) return +m[1];
  m = t.match(/(\d+(?:\.\d+)?)[\s-]*(?:hours?|hrs?)\b/);
  if (m) return Math.round(+m[1] * 60);
  m = t.match(/\b(an|a|one|two|three|four)\s+hours?\b/);
  return m ? WORDS[m[1]] * 60 : null;
}

export function parseDay(text, nowMs) {
  const t = text.toLowerCase();
  const today0 = dayStart(nowMs), week0 = weekStart(nowMs);
  if (/\b(today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) return today0;
  if (/\bday after tomorrow\b/.test(t)) return today0 + 2 * D;
  if (/\btomorrow\b/.test(t)) return today0 + D;
  const eow = t.match(/\bend of (?:the )?(this |next )?week\b/);
  if (eow) {
    // On a weekend this week's Friday is already past, so "end of this week" means the coming Friday.
    const friday = week0 + 4 * D + (eow[1] === 'next ' ? 7 * D : 0);
    return friday < today0 ? friday + 7 * D : friday;
  }
  const inDays = t.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) return today0 + +inDays[1] * D;
  const inWeeks = t.match(/\bin (\d{1,2}|an?|one|two|three|four) weeks?\b/);
  if (inWeeks) return today0 + (WORDS[inWeeks[1]] ?? +inWeeks[1]) * 7 * D;
  const ord = t.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?:\s+of\s+(\w+))?/) || t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (ord) {
    const named = /^\d/.test(ord[1]) ? MONTHS.indexOf(ord[2] ?? '') : MONTHS.indexOf(ord[1]);
    const dom = /^\d/.test(ord[1]) ? +ord[1] : +ord[2], base = new Date(today0);
    if (dom >= 1 && dom <= 31) {
      let month = named >= 0 ? named : base.getUTCMonth(), year = base.getUTCFullYear(), d = Date.UTC(year, month, dom);
      if (d < today0) d = named >= 0 ? Date.UTC(year + 1, month, dom) : Date.UTC(year, month + 1, dom);
      return d;
    }
  }
  const m = t.match(/\b(?:(this|next|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (!m) return null;
  let d = week0 + DAYS.indexOf(m[2]) * D;
  if (m[1] === 'next') d += 7 * D; else if (d < today0) d += 7 * D;
  return d;
}

// ---- deadline back-planning ----
// Greedy: each step starts no earlier than its share of the time left and after the previous step.
// intent: { deadline, from?, variants?, apart? }. `apart` puts every step on a later day than the one before (one run a day).
export function stepStart(intent, ctx) { return Math.max(ceilTo(ms(ctx.now)), intent.from ?? -Infinity); }
export const nextFrom = (intent, prevEnd, first) => (intent.apart && !first ? Math.max(prevEnd, dayStart(prevEnd) + D) : prevEnd);

export function greedySteps(intent, ctx, finder = greedyFinder) {
  const { events, blocks = [] } = ctx, start = stepStart(intent, ctx), span = intent.deadline - start;
  if (span <= 0) return [];
  const variants = intent.variants ?? STEP_VARIANTS;
  const run = (variant, spread) => {
    const placed = [];
    let prevEnd = start;
    for (const [i, minutes] of variant.entries()) {
      const length = minutes * MIN, o = { events, blocks, limit: intent.deadline }, after = nextFrom(intent, prevEnd, i === 0);
      const t = finder(Math.max(spread ? start + (span * i) / variant.length : start, after), length, o) ?? finder(after, length, o);
      if (t === null) break;
      placed.push({ s: t, minutes });
      prevEnd = t + length;
    }
    return placed;
  };
  let best = [];
  for (const variant of variants) for (const spread of [true, false]) {
    const placed = run(variant, spread);
    if (placed.length === variant.length) return placed;
    if (placed.length > best.length) best = placed;
  }
  return best;
}

// ---- re-planning ----
// Re-place `order.slice(1)` after the anchor `order[0]`: a block stays where it is unless the order or a clash forces it to move.
// `chained` ids must also start after the block before them; the others only move when they clash.
export function cascade(blocks, order, { events, limit = Infinity, meals = true, chained = null }) {
  const by = new Map(blocks.map((b) => [b.id, { ...b }]));
  const pending = new Set(order.slice(1)), unplaced = [];
  const anchorEnd = ms(by.get(order[0]).end);
  let prevEnd = anchorEnd;
  for (const id of order.slice(1)) {
    const b = by.get(id), length = dur(b);
    pending.delete(id);
    const others = [...by.values()].filter((x) => x.id !== id && !pending.has(x.id));
    const s = ms(b.start), ordered = !chained || chained.has(id);
    if (!((!ordered || s >= prevEnd) && s + length <= limit && isFree(s, s + length, { events, blocks: others, meals: false }))) {
      const t = greedyFinder(ordered ? prevEnd : anchorEnd, length, { events, blocks: others, meals, limit, window: meals ? WINDOW : [WINDOW[0], AWAKE_END] });
      if (t === null) { unplaced.push(id); by.delete(id); continue; }
      b.start = iso(t); b.end = iso(t + length); b.moved = true;
    }
    if (ordered) prevEnd = ms(b.end);
  }
  return { blocks: blocks.filter((b) => by.has(b.id)).map((b) => by.get(b.id)), unplaced };
}

// The related-item answer: move only the confirmed items by the same shift as the block that was moved,
// in time order, each after the one before; a clash sends an item to the next free time.
export function shiftConfirmed(blocks, pend, ok, events) {
  const find = (id) => blocks.find((b) => b.id === id);
  const out = new Map(blocks.map((b) => [b.id, b])), waiting = new Set(ok);
  for (const id of [...ok].sort((a, b) => ms(find(a).start) - ms(find(b).start))) {
    const b = out.get(id), length = dur(b);
    waiting.delete(id);
    const others = [...out.values()].filter((x) => x.id !== id && !waiting.has(x.id));
    let s = ms(b.start) + pend.delta;
    if (!isFree(s, s + length, { events, blocks: others, meals: false })) s = greedyFinder(s, length, { events, blocks: others, meals: false, window: [WINDOW[0], AWAKE_END] }) ?? s;
    out.set(id, { ...b, start: iso(s), end: iso(s + length), moved: true });
  }
  return blocks.map((b) => out.get(b.id));
}
