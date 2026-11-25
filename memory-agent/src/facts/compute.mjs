// Fact engine: computeFacts(snapshot, now) -> facts [{ id, group, text, numbers, window }].
// Pure and deterministic: no clock, no randomness, no network. Facts state numbers, ranks and windows only.
//
// Conventions (also in docs/CONTRACT.md):
//  - A day is the local calendar date written in the timestamp itself (its own offset), never UTC.
//  - "Today" is the local date of `now`. Records after `now` are ignored.
//  - A workout counts when it lasts 10 minutes or more; exact repeats (same activity, same start instant) count once.
//  - A day is "logged" when it has a daily summary or a workout. Averages use logged days only; missing days are not zeros.
import { parseTimestamp } from '../contract/time.mjs';
import { validateSnapshot } from '../contract/snapshot.mjs';
import { suppressionFilter } from './types.mjs';
import { lintFact } from './lint.mjs';
import { THIN_DAYS_NEEDED, MIN_WORKOUT_MINUTES, SPIKE_RATIO, MIN_BODY_READINGS, MIN_BASELINE_DAYS, ACTIVITY_ALLOWLIST, activityName, activityLabels } from './constants.mjs';

const DAY_MS = 86400000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayNum = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const dayIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const rnd = (x, d) => Number(x.toFixed(d));
const fx = (x, d) => rnd(x, d).toFixed(d);
// Minutes are exact in `numbers` (a sum is cleaned of float noise only); the sentence shows at most 2 decimals, trailing zeros trimmed.
// Durations are held as integer milliseconds, so sums are exact; minutes = milliseconds / 60000 with no rounding.
// A sentence shows 2 decimals (half rounded away from zero, done on integers), trailing zeros trimmed.
const MS_PER_MIN = 60000;
const mins = (x) => {
  const centi = Math.floor((Math.round(x * MS_PER_MIN) * 100 + MS_PER_MIN / 2) / MS_PER_MIN); // hundredths of a minute
  const whole = Math.floor(centi / 100);
  const frac = centi % 100;
  return frac === 0 ? String(whole) : `${whole}.${frac < 10 ? '0' : ''}${frac % 10 === 0 ? frac / 10 : frac}`;
};
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (a) => a.reduce((s, v) => s + v, 0);


// Median of integer milliseconds as an exact fraction of a minute (an even count averages the middle two without rounding).
function medianQ(ms) {
  const s = [...ms].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? Q(s[h], MS_PER_MIN) : Q(s[h - 1] + s[h], 2 * MS_PER_MIN);
}

function resolveNow(now, snapshot) {
  if (typeof now === 'string') {
    const p = parseTimestamp(now);
    if (!p) throw new Error('now must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
    return { str: now, ms: p.ms };
  }
  const ms = now instanceof Date ? now.getTime() : NaN;
  if (Number.isNaN(ms)) throw new Error('now must be an ISO 8601 timestamp with an offset and at most 3 fractional second digits');
  const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(snapshot.exportDate);
  const offMin = !m || m[1] === 'Z' ? 0 : (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]));
  // keep the milliseconds: 00:00:00.500 is not a midnight
  return { str: new Date(ms + offMin * 60000).toISOString().slice(0, 23) + (m ? m[1] : 'Z'), ms };
}

// Exact rational numbers on safe integers: { num, den } with den > 0. Comparisons cross-multiply; rounding is done on
// integers (half away from zero), only for display. No floating point decides a direction, a threshold or a digit.
const Q = (num, den = 1) => ({ num, den });
const qCmp = (a, b) => Math.sign(a.num * b.den - b.num * a.den);
const qDiv = (a, b) => Q(a.num * b.den, a.den * b.num);
const qScaled = (q, d) => Math.floor((2 * Math.abs(q.num) * 10 ** d + q.den) / (2 * q.den)); // |q| * 10^d, rounded
const fmtScaled = (s, d) => (d === 0 ? String(s) : `${Math.floor(s / 10 ** d)}.${String(s % 10 ** d).padStart(d, '0')}`);
const qFx = (q, d) => (q.num < 0 && qScaled(q, d) !== 0 ? '-' : '') + fmtScaled(qScaled(q, d), d);
const qNum = (q, d) => (Math.sign(q.num) * qScaled(q, d)) / 10 ** d;
// minutes with at most 2 decimals, trailing zeros trimmed
const qMins = (q) => {
  const centi = qScaled(q, 2);
  const frac = centi % 100;
  return frac === 0 ? String(Math.floor(centi / 100)) : `${Math.floor(centi / 100)}.${frac < 10 ? '0' : ''}${frac % 10 === 0 ? frac / 10 : frac}`;
};

function compare(valueQ, baseQ) {
  const c = qCmp(valueQ, baseQ);
  // "equal" only for exactly equal values; any other difference keeps its direction.
  return { dir: c === 0 ? 'equal' : c > 0 ? 'above' : 'below', ratio: baseQ.num > 0 ? qDiv(valueQ, baseQ) : null, zero: valueQ.num === 0 };
}
// A non-zero difference is shown rounded, or as "less than 0.1" (one unit of the last digit) when rounding would show zero.
const diffPhrase = (q, d, unit) => {
  const s = qScaled(q, d);
  return s === 0 ? `less than ${fmtScaled(1, d)}${unit}` : `${fmtScaled(s, d)}${unit}`;
};
// Comparison wording: state both numbers and the ratio. A percentage only when the value is not 0 and the ratio is
// between 0.1 and 10. A base of 0 has no ratio, and the sentence says so instead of dividing.
const ratioText = (r) => (r.num === 0 ? '0' : qScaled(r, 2) === 0 ? 'less than 0.01' : qFx(r, 2));
const pctAllowed = (c) => c.ratio !== null && !c.zero && c.ratio.num * 10 >= c.ratio.den && c.ratio.num <= 10 * c.ratio.den;
const pctQ = (c) => Q(Math.abs(c.ratio.num - c.ratio.den) * 100, c.ratio.den);
const pctTag = (c) => (c.dir === 'equal' ? 'equal' : `${diffPhrase(pctQ(c), 1, '%')} ${c.dir}`);
// kind: 'undefined' (base 0), 'zero' (value 0), 'ratio'.
const cmpKind = (c) => (c.ratio === null ? 'undefined' : c.zero ? 'zero' : 'ratio');
// `numbers` hold values rounded to 2 decimals (the sentence shows the same); `exact` holds the same averages and ratios as
// fractions { num, den } (in the unit of the shown value) when a reader needs them.
const qx = (q) => ({ num: q.num, den: q.den });
const cmpNumbers = (c, exactExtra = {}) => ({
  ratio: c.ratio === null ? null : qNum(c.ratio, 2),
  percent: pctAllowed(c) ? qNum(pctQ(c), 1) : null,
  direction: c.dir,
  exact: { ...(c.ratio === null ? {} : { ratio: qx(c.ratio) }), ...exactExtra },
});

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export const FORGOTTEN_ERROR = 'forgottenDays lists a malformed date';

// The one output boundary: every fact (the coverage fact included) is linted before it leaves, and an invalid line is
// never returned. The message names the fact id and the rule categories only, never the text.
export function computeFacts(snapshot, now, options = {}) {
  const facts = computeFactsUnlinted(snapshot, now, options);
  for (const f of facts) {
    const problems = lintFact(f.text, { id: f.id });
    if (problems.length > 0) throw new Error(`fact failed lint: ${f.id}: ${problems.join(', ')}`);
  }
  return facts;
}

function computeFactsUnlinted(snapshot, now, options = {}) {
  // The engine never produces a fact from an invalid snapshot (conflicting summaries or efforts, bad timestamps, readings
  // with too many decimals): the contract validation runs first and its fixed-text errors are thrown.
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) throw new Error(`snapshot failed validation: ${validation.errors.join('; ')}`);
  // Facts of a suppressed type or key are computed (other facts may use the same data) but never written.
  const isSuppressed = suppressionFilter(options && options.suppressed);
  const { str: nowStr, ms: nowMs } = resolveNow(now, snapshot);
  // Forgotten days: local dates treated as UNLOGGED in everything. Their workouts and summaries are ignored, so no total,
  // mix, average or gap can restate them, and the day is never a zero.
  const forgottenList = options && options.forgottenDays !== undefined ? options.forgottenDays : [];
  if (!Array.isArray(forgottenList)) throw new Error(FORGOTTEN_ERROR);
  const forgot = new Set(
    forgottenList.map((d) => {
      if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(FORGOTTEN_ERROR);
      const n = dayNum(d);
      if (dayIso(n) !== d) throw new Error(FORGOTTEN_ERROR);
      return n;
    }),
  );
  // Day modes. 'completed' (the midnight roll; `now` is exactly a local 00:00): the facts describe the day that has just
  // ended, the day before `now`, and every comparison uses complete days. 'in_progress' (a refresh during the day): `now` is inside a day that is not
  // finished; that day gets raw counts only ("so far today") and no comparison, rank or percentage; every other
  // fact uses the completed days before it.
  const requested = options && options.dayMode !== undefined ? options.dayMode : 'auto';
  if (requested !== 'auto' && requested !== 'completed' && requested !== 'in_progress') throw new Error('dayMode must be auto, completed or in_progress');
  const nowDate = dayNum(nowStr);
  const atMidnight = /^\d{4}-\d{2}-\d{2}T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(nowStr);
  // 'auto' (default): exactly a local midnight is the roll of the day that just ended; any other `now` is inside an
  // unfinished day. An explicit 'completed' is only possible at a local midnight, because anything else would treat an
  // unfinished day as complete.
  const mode = requested === 'auto' ? (atMidnight ? 'completed' : 'in_progress') : requested;
  if (mode === 'completed' && !atMidnight) throw new Error('dayMode completed needs now to be a local midnight');
  const liveDay = mode === 'in_progress' ? nowDate : null; // the unfinished day, if any
  const today = nowDate - 1; // the last completed day: every window ends here (the day that just ended, in both modes)

  // A workout that has not ended by now is ignored everywhere (volume, logged days, every fact).
  const ended = (w) => {
    const s = parseTimestamp(w.start);
    const e = parseTimestamp(w.end);
    return s !== null && e !== null && s.ms <= nowMs && e.ms <= nowMs && dayNum(w.start) <= (liveDay ?? today);
  };
  // Records are put in a total order, repeats (same raw activity and instant) are removed, and only then are
  // logged days and counted workouts derived, so one workout never adds two local dates.
  // Order: instant, raw activity, duration (longest first, so the longest repeat is kept), then the timestamp strings.
  const durMs = (w) => (Number.isFinite(w.durationMin) && w.durationMin >= 0 ? Math.round(w.durationMin * MS_PER_MIN) : 0);
  const ordered = (snapshot.workouts || [])
    .filter(ended)
    .map((w) => ({ raw: w.activityType, type: ACTIVITY_ALLOWLIST.includes(w.activityType) ? w.activityType : 'Other', ms: parseTimestamp(w.start).ms, day: dayNum(w.start), hour: Number(w.start.slice(11, 13)), dur: durMs(w), rawMs: w.durationMin * MS_PER_MIN, min: durMs(w) / MS_PER_MIN, effort: Number.isFinite(w.effort) && w.effort >= 1 && w.effort <= 10 ? Math.round(w.effort * 100) : null, start: w.start, end: w.end }))
    .sort((a, b) => a.ms - b.ms || cmp(a.raw, b.raw) || b.dur - a.dur || b.rawMs - a.rawMs || cmp(a.start, b.start) || cmp(a.end, b.end) || (a.effort ?? -1) - (b.effort ?? -1));
  // A workout is one identity (activity and instant) however many records or offsets describe it. If ANY record of an
  // identity falls on a forgotten local date, the whole identity is forgotten.
  const forgottenIdentities = new Set();
  for (const w of snapshot.workouts || []) {
    const p = parseTimestamp(w.start);
    if (p !== null && forgot.has(dayNum(w.start))) forgottenIdentities.add(`${w.activityType}|${p.ms}`);
  }
  const seen = new Set();
  const uniqueAll = ordered.filter((w) => {
    const key = `${w.raw}|${w.ms}`;
    if (forgottenIdentities.has(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Records of the unfinished day are kept apart: they feed only the "so far today" fact.
  const unique = uniqueAll.filter((w) => w.day <= today);
  const liveRecords = uniqueAll.filter((w) => w.day === liveDay);
  // Every ended workout record makes its day "logged", whatever its length; only 10 minutes or more count for volume.
  const loggedWorkoutDays = unique.map((w) => w.day);
  // Counted or short is decided on the unrounded duration; sums use the rounded integer milliseconds.
  const isCounted = (w) => w.rawMs >= MIN_WORKOUT_MINUTES * MS_PER_MIN;
  const workouts = unique.filter(isCounted);
  // Short workouts (under 10 minutes) are not counted, but they are real records: they are stated, never hidden.
  const shortByDay = new Map();
  for (const w of unique) if (!isCounted(w)) shortByDay.set(w.day, (shortByDay.get(w.day) || 0) + 1);
  const byDay = new Map();
  for (const w of workouts) {
    if (!byDay.has(w.day)) byDay.set(w.day, []);
    byDay.get(w.day).push(w);
  }

  // One summary per date. validateSnapshot rejects conflicting duplicates; if they get here anyway, the smallest
  // canonical form wins, so input order never changes the result.
  // Look-back rule: if the snapshot was exported later than `now` (a look-back), a summary of the last day the facts
  // describe, or of any later day, may have been updated after `now` (summaries carry no timestamp), so only summaries
  // dated before that day are used.
  const exportMs = parseTimestamp(snapshot.exportDate)?.ms ?? NaN;
  const lookBack = exportMs > nowMs;
  const summaries = new Map();
  for (const s of [...(snapshot.dailySummaries || [])].sort((x, y) => cmp(stable(x), stable(y)))) {
    const d = dayNum(s.date);
    if (d <= today && !forgot.has(d) && !(lookBack && d >= today) && !summaries.has(d)) summaries.set(d, s);
  }
  const liveSummary = liveDay !== null && !lookBack && !forgot.has(liveDay) && (snapshot.dailySummaries || []).some((s) => dayNum(s.date) === liveDay);
  const logged = new Set([...summaries.keys(), ...loggedWorkoutDays]);
  const nLogged = logged.size;

  const facts = [];
  const add = (id, group, window, text, numbers) => {
    if (!isSuppressed(id)) facts.push({ id, group, text, numbers, window });
  };

  if (nLogged < THIN_DAYS_NEEDED) {
    // counts only; the window is the span of days from the first to the last logged date (0d with no data)
    const spanDays = nLogged === 0 ? 0 : Math.max(...logged) - Math.min(...logged) + 1;
    add('history.thin', 'history', `${spanDays}d`, `${pl(nLogged, 'day')} of data; fewer than ${THIN_DAYS_NEEDED}.`, {
      daysOfData: nLogged,
      daysNeeded: THIN_DAYS_NEEDED,
      spanDays,
    });
    return facts;
  }

  const first = Math.min(...logged);
  const spanBack = today - first; // days between the first logged day and today
  // Helpers over "k days before today" (k = 0 is today).
  const dayMs = (d) => sum((byDay.get(d) || []).map((w) => w.dur));
  const dayMin = (d) => dayMs(d) / MS_PER_MIN;
  const days = (a, b) => {
    const out = [];
    for (let k = b; k >= a; k--) out.push(today - k);
    return out; // oldest first
  };
  const minutesIn = (a, b) => sum(days(a, b).map(dayMs)) / MS_PER_MIN; // exact integer milliseconds, divided once
  const countIn = (a, b) => sum(days(a, b).map((d) => (byDay.get(d) || []).length));
  const shortIn = (a, b) => sum(days(a, b).map((d) => shortByDay.get(d) || 0));
  const shortNote = (n) => (n > 0 ? `, ${n} under ${MIN_WORKOUT_MINUTES} minutes not counted` : '');
  const loggedIn = (a, b) => days(a, b).filter((d) => logged.has(d)).length;
  const loggedToday = logged.has(today);

  // (Coverage of the 28-day load average is stated together with the load fact, only when that average is written.)
  const l28 = loggedIn(0, 27);
  const l7 = loggedIn(0, 6);

  // Volume: only what was recorded. An unlogged day is unknown, never zero.
  const D = dayIso(today);
  const todayMin = dayMin(today);
  const todayCount = countIn(0, 0);
  if (mode === 'completed') {
    if (loggedToday) {
      add('volume.today', 'volume', 'day', `On ${D}: ${pl(todayCount, 'counted workout')} (${MIN_WORKOUT_MINUTES} minutes or more) and ${mins(todayMin)} workout minutes${shortNote(shortIn(0, 0))}.`, {
        date: D,
        workouts: todayCount,
        minutes: todayMin,
        shortWorkouts: shortIn(0, 0),
      });
    } else {
      add('volume.today_unlogged', 'volume', 'day', `${D} has no data: 0 of 1 days logged.`, { date: D, loggedDays: 0, windowDays: 1 });
    }
  } else {
    // A refresh during the day: raw counts only, and no comparison, rank or percentage involving this day.
    const live = dayIso(liveDay);
    const liveCounted = liveRecords.filter(isCounted);
    const liveShort = liveRecords.length - liveCounted.length;
    const liveMin = sum(liveCounted.map((w) => w.dur)) / MS_PER_MIN;
    if (liveSummary || liveRecords.length > 0) {
      add('volume.today_so_far', 'volume', 'day', `So far today (${live}): ${pl(liveCounted.length, 'counted workout')} (${MIN_WORKOUT_MINUTES} minutes or more) and ${mins(liveMin)} workout minutes, day not finished${shortNote(liveShort)}.`, {
        date: live,
        workouts: liveCounted.length,
        minutes: liveMin,
        shortWorkouts: liveShort,
        dayFinished: false,
      });
    } else {
      add('volume.today_unlogged', 'volume', 'day', `${live} has no data so far: 0 of 1 days logged.`, { date: live, loggedDays: 0, windowDays: 1 });
    }
  }
  const m7 = minutesIn(0, 6);
  const c7 = countIn(0, 6);
  add('volume.week', 'volume', '7d', `Counted in the last 7 days (${dayIso(today - 6)} to ${dayIso(today)}; workouts of ${MIN_WORKOUT_MINUTES} minutes or more): ${pl(c7, 'workout')} and ${mins(m7)} workout minutes on ${pl(l7, 'logged day')} (${pl(7 - l7, 'unlogged day')})${shortNote(shortIn(0, 6))}.`, {
    from: dayIso(today - 6),
    to: dayIso(today),
    workouts: c7,
    minutes: m7,
    loggedDays: l7,
    unloggedDays: 7 - l7,
    shortWorkouts: shortIn(0, 6),
  });
  const m28 = minutesIn(0, 27);
  const c28 = countIn(0, 27);
  add('volume.28d', 'volume', '28d', `Counted in the last 28 days (${dayIso(today - 27)} to ${dayIso(today)}; workouts of ${MIN_WORKOUT_MINUTES} minutes or more): ${pl(c28, 'workout')} and ${mins(m28)} workout minutes on ${pl(l28, 'logged day')} (${pl(28 - l28, 'unlogged day')})${shortNote(shortIn(0, 27))}.`, {
    from: dayIso(today - 27),
    to: dayIso(today),
    workouts: c28,
    minutes: m28,
    loggedDays: l28,
    unloggedDays: 28 - l28,
    shortWorkouts: shortIn(0, 27),
  });

  // Against own past: today against the previous 28 days (today excluded). Only when today is logged.
  const lPrev = loggedIn(1, 28);
  if (mode === 'completed' && loggedToday && lPrev >= MIN_BASELINE_DAYS) {
    const sumPrev = sum(days(1, 28).map(dayMs));
    const avgQ = Q(sumPrev, lPrev * MS_PER_MIN); // minutes per logged day
    const c = compare(Q(dayMs(today)), Q(sumPrev, lPrev));
    const lead = `${mins(todayMin)} workout minutes on ${D}`;
    const counts = pl(lPrev, 'logged day');
    const kind = cmpKind(c);
    const text =
      kind === 'undefined'
        ? `${lead}; the daily average over the previous 28 days is ${qFx(avgQ, 2)} minutes, so the ratio is not defined (${counts}).`
        : kind === 'zero'
          ? `${lead}; the daily average over the previous 28 days is ${qFx(avgQ, 2)} minutes (ratio 0, ${counts}).`
          : `${lead}, ratio ${ratioText(c.ratio)} to the daily average of ${qFx(avgQ, 2)} minutes over the previous 28 days (${counts}${pctAllowed(c) ? `, ${pctTag(c)}` : ''}).`;
    add('past.today_vs_avg', 'past', 'day vs 28d', text, {
      minutes: todayMin,
      averageMinutesPerDay: qNum(avgQ, 2),
      ...cmpNumbers(c, { averageMinutesPerDay: qx(avgQ) }),
      loggedDays: lPrev,
    });

    const prevMax = Math.max(...days(1, 28).map(dayMs));
    if (prevMax > 0 && dayMs(today) >= SPIKE_RATIO * prevMax) {
      const ratio = Q(dayMs(today), prevMax);
      add('past.today_vs_highest', 'past', 'day vs 28d', `The workout minutes on ${D} (${mins(todayMin)}) are ${qFx(ratio, 2)}x the highest recorded day of the previous 28 days (${mins(prevMax / MS_PER_MIN)}).`, {
        minutes: todayMin,
        highestPreviousDayMinutes: prevMax / MS_PER_MIN,
        ratio: qNum(ratio, 2),
        exact: { ratio: qx(ratio) },
        threshold: SPIKE_RATIO,
      });
    }
  }

  // Rank of today among the logged days of the last 28 days (1 = highest)
  if (mode === 'completed' && loggedToday && dayMin(today) > 0) {
    const pool = days(0, 27).filter((d) => logged.has(d));
    const rank = 1 + pool.filter((d) => dayMin(d) > dayMin(today)).length;
    add('past.today_rank', 'past', '28d', `The workout minutes on ${D} (${mins(todayMin)}) rank ${rank} of ${pl(pool.length, 'logged day')} in the last 28 days, where 1 is the highest.`, {
      minutes: todayMin,
      rank,
      of: pool.length,
    });
  }

  // Comparisons of this week need every day of the week logged; otherwise one fact says so, with the counts.
  const weekComplete = l7 === 7;
  const lBase = loggedIn(7, 34);
  const baseOk = lBase >= MIN_BASELINE_DAYS;
  // The "not stated" sentence is written only if at least one comparison it speaks of is not suppressed.
  const comparisonIds = ['past.week_vs_avg', 'past.week_rank', 'load.ratio', 'goal.workouts_per_week', ...(snapshot.target ? ['goal.target_progress'] : [])];
  if (!weekComplete && comparisonIds.some((id) => !isSuppressed(id))) {
    add('past.week_comparisons_skipped', 'past', '7d', `Comparisons of the last 7 days with earlier weeks or a target are not stated: only ${l7} of 7 days are logged.`, {
      loggedDays: l7,
      windowDays: 7,
    });
  }
  if (weekComplete && baseOk) {
    const sumBase = sum(days(7, 34).map(dayMs));
    const weekMs = sum(days(0, 6).map(dayMs));
    const baseWeekQ = Q(sumBase * 7, lBase * MS_PER_MIN); // minutes per week
    const c = compare(Q(weekMs), Q(sumBase * 7, lBase));
    const lead = `${mins(m7)} workout minutes in the last 7 days`;
    const counts = `${pl(lBase, 'logged day')} before this week`;
    const kind = cmpKind(c);
    const text =
      kind === 'undefined'
        ? `${lead}; the 4-week average is ${qFx(baseWeekQ, 2)} minutes per week, so the ratio is not defined (${counts}).`
        : kind === 'zero'
          ? `${lead}; the 4-week average is ${qFx(baseWeekQ, 2)} minutes per week (ratio 0, ${counts}).`
          : `${lead}, ratio ${ratioText(c.ratio)} to the 4-week average of ${qFx(baseWeekQ, 2)} minutes per week (${counts}${pctAllowed(c) ? `, ${pctTag(c)}` : ''}).`;
    add('past.week_vs_avg', 'past', '7d vs 28d', text, {
      minutes: m7,
      averageMinutesPerWeek: qNum(baseWeekQ, 2),
      ...cmpNumbers(c, { averageMinutesPerWeek: qx(baseWeekQ) }),
      loggedDays: lBase,
    });
  }

  // Rank of this week among complete 7-day weeks (every day logged) of the last 12 weeks
  const weeks = [];
  for (let j = 0; j < 12 && 7 * j + 6 <= spanBack; j++) {
    if (loggedIn(7 * j, 7 * j + 6) === 7) weeks.push({ j, m: minutesIn(7 * j, 7 * j + 6) });
  }
  if (weeks.length >= 2 && weeks[0].j === 0) {
    const rank = 1 + weeks.filter((w) => w.m > weeks[0].m).length;
    add('past.week_rank', 'past', '84d', `This week's workout minutes (${mins(m7)}) rank ${rank} of ${pl(weeks.length, 'complete 7-day week')} in the last 12 weeks, where 1 is the highest.`, {
      minutes: m7,
      rank,
      of: weeks.length,
    });
  }

  // Load: 7-day load divided by the 28-day weekly average. Effort-weighted (effort x minutes) only when every
  // counted workout of the last 28 days has an effort score; otherwise minutes only, and the fact says which.
  if (weekComplete && l28 >= MIN_BASELINE_DAYS) {
    const w28 = workouts.filter((w) => today - w.day <= 27);
    const useEffort = w28.length > 0 && w28.every((w) => w.effort !== null);
    // Integer weights: milliseconds, or milliseconds x effort in hundredths (effort has at most 2 decimals).
    const unitDen = useEffort ? MS_PER_MIN * 100 : MS_PER_MIN;
    const load = (w) => (useEffort ? w.effort * w.dur : w.dur);
    const L7 = sum(w28.filter((w) => today - w.day <= 6).map(load));
    const L28 = sum(w28.map(load));
    if (L28 > 0) {
      const c = compare(Q(L7), Q(L28 * 7, l28));
      const unit = useEffort ? 'effort-minutes' : 'minutes';
      add('load.ratio', 'load', '7d vs 28d', `The ${useEffort ? 'effort-weighted' : 'minutes-based'} 7-day load is ${qMins(Q(L7, unitDen))} ${unit}, ratio ${ratioText(c.ratio)} to the 28-day weekly average of ${qFx(Q(L28 * 7, l28 * unitDen), 2)} ${unit} (${pl(l28, 'logged day')}${pctAllowed(c) ? `, ${pctTag(c)}` : ''}).`, {
        basis: useEffort ? 'effort' : 'minutes',
        load7: L7 / unitDen,
        averagePerWeek28: qNum(Q(L28 * 7, l28 * unitDen), 2),
        ...cmpNumbers(c, { averagePerWeek28: qx(Q(L28 * 7, l28 * unitDen)) }),
        loggedDays: l28,
      });
      // The coverage sentence speaks of the load average, so it is written only with it.
      if (!isSuppressed('coverage.28d')) facts.unshift({
        id: 'coverage.28d',
        group: 'coverage',
        text: `Data was logged on ${l28} of the last 28 days, so the 28-day load average uses ${pl(l28, 'day')}.`,
        numbers: { loggedDays: l28, windowDays: 28 },
        window: '28d',
      });
    }
  }

  // Regularity
  const inWindow = workouts.filter((w) => today - w.day <= 27);
  const lastDay = inWindow.length ? Math.max(...inWindow.map((w) => w.day)) : null; // latest local date, last 28 days only
  if (lastDay !== null) {
    const ago = today - lastDay;
    add('regularity.days_since_last', 'regularity', '28d', `Days since the last counted workout (${MIN_WORKOUT_MINUTES} minutes or more) as of ${dayIso(today)}: ${ago} (${dayIso(lastDay)}); ${pl(c28, 'counted workout')} in the last 28 days.`, {
      asOf: dayIso(today),
      daysSinceLast: ago,
      lastWorkoutDate: dayIso(lastDay),
      workouts28: c28,
    });
  } else {
    add('regularity.days_since_last', 'regularity', '28d', `No counted workout in the last 28 days as of ${dayIso(today)}: 0 workouts.`, {
      asOf: dayIso(today),
      daysSinceLast: null,
      lastWorkoutDate: null,
      workouts28: 0,
    });
  }

  const gapLen = Math.min(27, spanBack) + 1;
  // Longest run of consecutive LOGGED days without a counted workout. An unlogged day ends a run and is never counted.
  let run = 0;
  let gap = 0;
  let unlogged = 0;
  for (const d of days(0, gapLen - 1)) {
    if (!logged.has(d)) {
      unlogged++;
      run = 0;
    } else if (byDay.has(d)) run = 0;
    else gap = Math.max(gap, ++run);
  }
  add('regularity.longest_gap', 'regularity', `${gapLen}d`, `Longest stretch of logged days without a counted workout (${MIN_WORKOUT_MINUTES} minutes or more) in the last ${gapLen} days: ${pl(gap, 'day')} (${pl(unlogged, 'unlogged day')} in the window).`, {
    gapDays: gap,
    windowDays: gapLen,
    unloggedDays: unlogged,
  });

  const perWeek = [];
  const perWeekLogged = [];
  for (let j = 0; j < 4 && 7 * j + 6 <= spanBack; j++) {
    perWeek.push(countIn(7 * j, 7 * j + 6));
    perWeekLogged.push(loggedIn(7 * j, 7 * j + 6));
  }
  add('regularity.per_week', 'regularity', `${perWeek.length * 7}d`, // the days the blocks cover
     `Counted workouts (${MIN_WORKOUT_MINUTES} minutes or more) in each of the last ${perWeek.length} weeks (7-day blocks, most recent first): ${perWeek.join(', ')}; logged days in those weeks: ${perWeekLogged.join(', ')}.`, {
    perWeek,
    loggedDays: perWeekLogged,
  });

  const slots = new Map();
  for (const w of workouts) {
    const k = today - w.day;
    if (k > 27) continue;
    const key = JSON.stringify([w.raw, new Date(w.day * DAY_MS).getUTCDay(), w.hour]); // original activity, before the output label
    if (!slots.has(key)) slots.set(key, new Set());
    slots.get(key).add(Math.floor(k / 7));
  }
  const fixed = [...slots.entries()]
    .filter(([, set]) => set.size >= 3)
    .map(([key, set]) => {
      const [raw, wd, hour] = JSON.parse(key);
      return { type: raw, wd, hour, weeks: set.size };
    })
    .filter((s) => ACTIVITY_ALLOWLIST.includes(s.type) && s.type !== 'Other') // an unrecognised activity never gets a slot
    .sort((a, b) => a.wd - b.wd || a.hour - b.hour || cmp(a.type, b.type));
  if (fixed.length === 0) {
    add('regularity.slots_none', 'regularity', '28d', 'Fixed slots among recognised activities (same activity, weekday and hour in 3 of the last 4 weeks) found: 0.', { slots: 0 });
  }
  for (const s of fixed) {
    const hh = String(s.hour).padStart(2, '0');
    add(`regularity.slot.${s.type}.${WEEKDAYS[s.wd]}.${hh}`, 'regularity', '28d', `Fixed slot among recognised activities: ${activityLabels([s.type])[s.type]} on ${WEEKDAYS[s.wd]} between ${hh}:00 and ${s.hour === 23 ? '00:00 the next day' : `${String(s.hour + 1).padStart(2, '0')}:00`}, in ${s.weeks} of the last 4 weeks.`, {
      activityType: s.type,
      weekday: WEEKDAYS[s.wd],
      hour: s.hour,
      hourEnd: (s.hour + 1) % 24,
      endsNextDay: s.hour === 23,
      weeks: s.weeks,
    });
  }

  // Mix (last 28 days)
  const w28 = workouts.filter((w) => today - w.day <= 27);
  if (w28.length === 0) {
    add('mix.count', 'mix', '28d', `No counted workouts (${MIN_WORKOUT_MINUTES} minutes or more) by activity in the last 28 days (0 workouts).`, { byActivity: {}, total: 0 });
  } else {
    const byType = new Map();
    for (const w of w28) {
      if (!byType.has(w.type)) byType.set(w.type, []);
      byType.get(w.type).push(w);
    }
    const order = [...byType.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
    const label = activityLabels(order.map(([t]) => t));
    add('mix.count', 'mix', '28d', `Counted workouts (${MIN_WORKOUT_MINUTES} minutes or more) by activity in the last 28 days: ${order.map(([t, a]) => `${label[t]} ${a.length}`).join(', ')}.`, {
      byActivity: Object.fromEntries(order.map(([t, a]) => [t, a.length])),
      total: w28.length,
    });
    add('mix.median_length', 'mix', '28d', `Median length of counted workouts (${MIN_WORKOUT_MINUTES} minutes or more) by activity in the last 28 days: ${order.map(([t, a]) => `${label[t]} ${qMins(medianQ(a.map((w) => w.dur)))} min`).join(', ')}.`, {
      medianMinutesByActivity: Object.fromEntries(order.map(([t, a]) => [t, qNum(medianQ(a.map((w) => w.dur)), 2)])), // 2 decimals, like the sentence
      exact: { medianMinutesByActivity: Object.fromEntries(order.map(([t, a]) => [t, qx(medianQ(a.map((w) => w.dur)))])) }, // fractions of a minute
    });
    const band = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
    const bands = { morning: 0, afternoon: 0, evening: 0 };
    for (const w of w28) bands[band(w.hour)]++;
    add('mix.start_bands', 'mix', '28d', `Counted workout starts (${MIN_WORKOUT_MINUTES} minutes or more) in the last 28 days: morning ${bands.morning}, afternoon ${bands.afternoon}, evening ${bands.evening} (morning is before 12:00, evening from 17:00).`, bands);
  }

  // Body: 7 days against the 28-day average (daily summary values; no per-workout or sample data).
  // Readings are scaled to integers (at most 6 decimals, checked by validateSnapshot) and compared exactly.
  const series = (pick, a, b) =>
    days(a, b)
      .map((d) => (summaries.has(d) ? pick(summaries.get(d)) : undefined))
      .filter((v) => Number.isFinite(v))
      .map((v) => Math.round(v * 1e6));
  const body = (id, label, unit, pick, d, U) => {
    const s7 = series(pick, 0, 6);
    const s28 = series(pick, 0, 27);
    if (s7.length < MIN_BODY_READINGS || s28.length < MIN_BODY_READINGS) return;
    const n7 = s7.length;
    const n28 = s28.length;
    const sum7 = sum(s7);
    const sum28 = sum(s28);
    const a7 = Q(sum7, n7 * U);
    const a28 = Q(sum28, n28 * U);
    const D = sum7 * n28 - sum28 * n7; // sign of (average7 - average28)
    const diff = Q(D, n7 * n28 * U);
    const dir = D === 0 ? 'equal' : D > 0 ? 'above' : 'below';
    const noun = id === 'body.sleep' ? 'nights' : 'days with a reading';
    const text = `${label} over the last 7 days: ${qFx(a7, d)} ${unit} (from ${n7} ${noun}), ${
      dir === 'equal' ? 'equal to' : `${diffPhrase(diff, d, ` ${unit}`)} ${dir}`
    } the 28-day average of ${qFx(a28, d)} ${unit} (from ${n28} ${noun}).`;
    add(id, 'body', '7d vs 28d', text, {
      average7: qNum(a7, d),
      average28: qNum(a28, d),
      difference: qNum(diff, d),
      direction: dir,
      exact: { average7: qx(a7), average28: qx(a28), difference: qx(diff) },
      logged7: n7,
      logged28: n28,
    });
  };
  body('body.sleep', 'Average sleep', 'h', (s) => (s.sleepMinutes ? s.sleepMinutes.totalAsleep : undefined), 2, 60 * 1e6); // minutes -> hours
  body('body.resting_hr', 'Average resting heart rate', 'bpm', (s) => s.restingHeartRate, 2, 1e6);

  // Goal: workouts per week against the person's baseline, and progress to a planner-given target
  if (weekComplete && baseOk) {
    const cnt = countIn(7, 34);
    const baseQ = Q(cnt * 7, lBase); // counted workouts per week
    const ratio = cnt > 0 ? Q(c7 * lBase, cnt * 7) : null;
    add('goal.workouts_per_week', 'goal', '7d vs 28d', `${pl(c7, 'counted workout')} (${MIN_WORKOUT_MINUTES} minutes or more) in the last 7 days; the baseline is ${qFx(baseQ, 2)} counted workouts per week over the 28 days before this week (${pl(lBase, 'logged day')})${ratio === null ? '' : `, a ratio of ${qFx(ratio, 2)}`}.`, {
      workouts7: c7,
      baselineWorkoutsPerWeek: qNum(baseQ, 2),
      ratio: ratio === null ? null : qNum(ratio, 2),
      exact: { baselineWorkoutsPerWeek: qx(baseQ), ...(ratio === null ? {} : { ratio: qx(ratio) }) },
      loggedDays: lBase,
    });
  }
  // The target has at most 2 decimals (checked by validateSnapshot): held in hundredths.
  const targetCenti = snapshot.target && Number.isFinite(snapshot.target.workoutsPerWeek) ? Math.round(snapshot.target.workoutsPerWeek * 100) : 0;
  if (weekComplete && targetCenti > 0) {
    const ratio = Q(c7 * 100, targetCenti);
    const pctOk = c7 !== 0 && ratio.num * 10 >= ratio.den && ratio.num <= 10 * ratio.den; // the same percentage rule as every comparison
    const pct = Q(c7 * 10000, targetCenti);
    add('goal.target_progress', 'goal', '7d', `Progress to the target of ${targetCenti / 100} workouts per week: ${pl(c7, 'counted workout')} (${MIN_WORKOUT_MINUTES} minutes or more) in the last 7 days, ratio ${ratioText(ratio)} to the target${pctOk ? ` (${qFx(pct, 1)}% of the target)` : ''}.`, {
      target: targetCenti / 100,
      workouts7: c7,
      ratio: qNum(ratio, 2),
      exact: { ratio: qx(ratio) },
      percentOfTarget: pctOk ? qNum(pct, 1) : null,
    });
  }

  return facts;
}
