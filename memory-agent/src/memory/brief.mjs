// The brief: the default text for the planner and for people. At most 8 plain bullet lines and 120 words, from workouts,
// sleep and heart rate only (nothing a tap said). Every number is a stored fact's number, rounded for reading:
// minutes and bpm to whole numbers, hours to one decimal, ratios to two; the stored facts keep the exact values.
//
// Each line that can lead to a recommendation has a key the person can stop (`stopKey`) and restore (`restoreKey`):
//   workouts_per_week, slot:<activity>:<weekday>:<hour> (slot:running:sun:08), mix, recent_weeks, load, sleep, resting_hr
// A stopped line is deleted and is not written again by any later roll until it is restored.
import { forgetFactType, forgetFactKey, restoreFactType, restoreFactKey, suppressedTypes, stopKeyOf } from '../store/index.mjs';
import { memoryFiles, DAILY_SHOWN } from './planner-text.mjs';

export const BRIEF_TARGET_WORDS = 90;
export const BRIEF_MAX_WORDS = 120;
export const BRIEF_MAX_LINES = 8;
export const SLOTS_IN_TEXT = 3;
export const MIX_SHOWN = 4;
export const WEEKS_SHOWN = 4;

const words = (text) => text.split(/\s+/).filter(Boolean).length;
const N = String.raw`(\d+(?:\.\d+)?)`;

/** A decimal string rounded half up to `places` decimals, without trailing zeros: ('8.75', 1) -> '8.8', ('49.00', 0) -> '49'. */
export function rounded(value, places) {
  const [whole, frac = ''] = String(value).split('.');
  const digits = `${whole}${frac.padEnd(places + 1, '0').slice(0, places + 1)}`;
  const n = Math.floor((Number(digits) + 5) / 10);
  if (places === 0) return String(n);
  const s = String(n).padStart(places + 1, '0');
  return `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, '');
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const clock = (hh) => { const h = Number(hh); return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`; };

// The store's type (or type and key) behind each brief key.
const TYPE_OF = { workouts_per_week: 'profile', mix: 'mix', load: 'load', recent_weeks: 'weekly' };
const METRICS = ['sleep', 'resting_hr'];
const LABELS = { workouts_per_week: 'Workouts per week', mix: 'Activity mix', recent_weeks: 'Recent weeks', load: 'Training load', sleep: 'Sleep', resting_hr: 'Resting heart rate' };
const SLOT = /^slot:([a-z_]+):(mon|tue|wed|thu|fri|sat|sun):(\d{2})$/;
const target = (key) => {
  if (typeof key !== 'string') return null;
  if (Object.hasOwn(TYPE_OF, key)) return { type: TYPE_OF[key] };
  if (METRICS.includes(key)) return { type: 'body', key };
  const m = SLOT.exec(key);
  return m ? { type: 'regularity', key: `${m[1]}.${m[2]}.${m[3]}` } : null;
};
const slotParts = (storeKey) => { const [activity, day, hour] = storeKey.split('.'); return { activity: cap(activity.replace(/_/g, ' ')), day, hour }; };
const slotLabel = (storeKey) => { const s = slotParts(storeKey); return `${s.activity}, ${DAY_NAMES[s.day]} ${clock(s.hour)}`; };

/** Stop one brief line by its key: the fact is deleted and stays out of every later roll. true when it is stopped. */
export function stopKey(store, key) {
  const t = target(key);
  if (t === null) return false;
  return t.key === undefined ? forgetFactType(store, t.type) : forgetFactKey(store, t.type, t.key);
}

/** Let a stopped line be written again; the next roll brings it back. */
export function restoreKey(store, key) {
  const t = target(key);
  if (t === null) return false;
  return t.key === undefined ? restoreFactType(store, t.type) : restoreFactKey(store, t.type, t.key);
}

/** What is stopped now, in the order of the brief: [{ key, label }]. */
export function stoppedKeys(store) {
  const sup = suppressedTypes(store);
  const out = [];
  const type = (key) => { if (sup.types.includes(TYPE_OF[key])) out.push({ key, label: LABELS[key] }); };
  type('workouts_per_week');
  const slots = sup.keys.filter((k) => k.type === 'regularity').map((k) => k.key).sort(bySlot);
  for (const k of slots) out.push({ key: `slot:${k.split('.').join(':')}`, label: slotLabel(k) });
  type('mix'); type('recent_weeks'); type('load');
  for (const m of METRICS) if (sup.keys.some((k) => k.type === 'body' && k.key === m)) out.push({ key: m, label: LABELS[m] });
  return out;
}

function bySlot(a, b) {
  const [x, y] = [a.split('.'), b.split('.')];
  const d = DAY_ORDER.indexOf(x[1]) - DAY_ORDER.indexOf(y[1]);
  if (d !== 0) return d;
  return x[2] !== y[2] ? (x[2] < y[2] ? -1 : 1) : x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0;
}

const THIN = /^Days of data: (\d+) /;
const PER_WEEK = new RegExp(`^4-week average: ${N} workouts per week `);
const WEEKLY = /^\[weekly\] Week of \d{4}-\d{2}-\d{2}: (\d+) workouts, /;
const SLOT_WEEKS = /, in (\d+) of the last 4 weeks\.$/;
const LOAD = new RegExp(`^The (minutes-based|effort-weighted) 7-day load is ${N} (?:effort-)?minutes, ratio (0|less than 0\\.01|\\d+(?:\\.\\d+)?) to the 28-day weekly average of `);
const SLEEP = new RegExp(`^Average sleep over the last 7 days: ${N} h .* the 28-day average of ${N} h `);
const HEART = new RegExp(`^Average resting heart rate over the last 7 days: ${N} bpm .* the 28-day average of ${N} bpm `);

// The lines of the brief from the stored facts. Each: { group, id, key, text }; `usual` holds the single text line for the slots.
function build(files) {
  const profile = files.profile ?? [];
  const rolling = files.rolling ?? [];
  const thin = rolling.find((f) => f.kind === 'thin');
  if (thin) {
    const days = Number(THIN.exec(thin.text)[1]);
    const text = `${days} day${days === 1 ? '' : 's'} of data${days < 14 ? ', fewer than 14' : ''}.`;
    return { lines: [{ group: 'routine', id: 'thin', key: null, text }], usual: null };
  }
  const lines = [];
  const add = (group, id, key, text) => lines.push({ group, id, key, text });
  const find = (list, key) => list.find((f) => f.key === key);

  const perWeek = find(profile, 'profile');
  if (perWeek) add('routine', 'workouts_per_week', 'workouts_per_week', `Workouts: ${rounded(PER_WEEK.exec(perWeek.text)[1], 1)} a week (4-week average).`);

  const slots = profile.map((f) => ({ key: f.kind === 'regularity' ? stopKeyOf(f) : null, weeks: SLOT_WEEKS.exec(f.text)?.[1] }))
    .filter((s) => s.key !== null).sort((a, b) => bySlot(a.key, b.key));
  for (const s of slots) {
    const p = slotParts(s.key);
    add('routine', 'usual_time', `slot:${s.key.split('.').join(':')}`, `${p.activity} ${cap(p.day)} ${clock(p.hour)} (${s.weeks} of the last 4 weeks).`);
  }
  let usual = null;
  if (slots.length > 0) {
    const shown = slots.slice(0, SLOTS_IN_TEXT);
    const weeks = [...new Set(shown.map((s) => s.weeks))].sort();
    const items = shown.map((s, i) => {
      const p = slotParts(s.key);
      const same = i > 0 && slotParts(shown[i - 1].key).activity === p.activity;
      return `${same ? '' : `${p.activity} `}${cap(p.day)} ${clock(p.hour)}`;
    });
    usual = `Usual times: ${items.join(', ')} (${weeks.join(' or ')} of the last 4 weeks).`;
  }

  const mix = find(profile, 'mix');
  if (mix) {
    const items = [...mix.items].sort((a, b) => b.count - a.count || (a.activity < b.activity ? -1 : 1));
    const rest = items.slice(MIX_SHOWN);
    const more = rest.length === 0 ? '' : `, ${rest.reduce((n, i) => n + i.count, 0)} in ${rest.length} other type${rest.length === 1 ? '' : 's'}`;
    add('routine', 'mix', 'mix', `Mix over 4 weeks: ${items.slice(0, MIX_SHOWN).map((i) => `${i.activity} ${i.count}`).join(', ')}${more}.`);
  }

  const weeks = rolling.filter((f) => f.kind === 'weekly').slice(-WEEKS_SHOWN).map((f) => WEEKLY.exec(f.text)[1]);
  if (weeks.length > 0) add('routine', 'recent_weeks', 'recent_weeks', `Last ${weeks.length} fully logged week${weeks.length === 1 ? '' : 's'}: ${weeks.join(', ')} workouts.`);

  const load = LOAD.exec(find(profile, 'computed:load.ratio')?.text ?? '');
  if (load) {
    const ratio = load[3].startsWith('less') ? load[3] : rounded(load[3], 2);
    add('body', 'load', 'load', `Load: ${rounded(load[2], 0)} ${load[1] === 'minutes-based' ? 'min' : 'effort-min'} in the last 7 days, ${ratio}× the 28-day weekly average.`);
  }
  const sleep = SLEEP.exec(find(profile, 'computed:body.sleep')?.text ?? '');
  if (sleep) add('body', 'sleep', 'sleep', `Average sleep: ${rounded(sleep[1], 1)} h a night over 7 days (28-day average ${rounded(sleep[2], 1)} h).`);
  const heart = HEART.exec(find(profile, 'computed:body.resting_hr')?.text ?? '');
  if (heart) add('body', 'resting_hr', 'resting_hr', `Resting heart rate: ${rounded(heart[1], 0)} bpm over 7 days (28-day average ${rounded(heart[2], 0)} bpm).`);
  return { lines, usual };
}

/**
 * { ok: true, text, words, targetMet, lines, stopped, facts } or { ok: false, error } (no text). Same store state, same result.
 *   text     the bullets, one per line; the fixed slots share one line (the first 3)
 *   lines    [{ group: 'routine' | 'body', id, key, text }]: the same facts for a screen, one line per fixed slot; key is what stopKey takes
 *   stopped  [{ key, label }]: what the person stopped, for a restore control
 *   facts    [{ kind, text }]: the stored sentences behind the brief (profile and rolling, the latest 7 daily lines); a stopped key is not among them
 */
export function briefText(store) {
  try {
    const read = memoryFiles(store);
    if (!read.ok) return read;
    const { lines, usual } = build(read.files);
    const bullets = [];
    for (const l of lines) {
      if (l.id !== 'usual_time') bullets.push(l.text);
      else if (usual !== null && !bullets.includes(usual)) bullets.push(usual);
    }
    const text = bullets.map((b) => `- ${b}`).join('\n');
    if (bullets.length > BRIEF_MAX_LINES || words(text) > BRIEF_MAX_WORDS) return { ok: false, error: 'memory brief is too long' };
    const rolling = read.files.rolling ?? [];
    const daily = rolling.filter((f) => f.kind === 'daily');
    const facts = [...(read.files.profile ?? []), ...rolling.filter((f) => f.kind !== 'daily'), ...daily.slice(-DAILY_SHOWN)].map((f) => ({ kind: f.kind, text: f.text }));
    return { ok: true, text, words: words(text), targetMet: words(text) <= BRIEF_TARGET_WORDS, lines, stopped: stoppedKeys(store), facts };
  } catch (e) {
    return { ok: false, error: String(e && e.name ? e.name : 'Error') };
  }
}
