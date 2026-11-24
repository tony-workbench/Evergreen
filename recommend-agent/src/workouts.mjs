// The next 7 days of workouts from health history, shoe wear and memory, by rules alone:
// the usual week (last 4 weeks, memory slots set the hour) -> race taper -> readiness -> shoe rules -> weekly load limit -> calendar.
import {
  InputError, parseDT, parseDay, dayOf, hourOf, minuteOf, weekdayOf, dayISO, atDay, addUs, isoDT, clock,
  US_MIN, US_DAY, WEEKDAYS, WEEKDAY_NAMES,
} from './pytime.mjs';
import { pyRound, pySum, pyMean, pyMedian, pyFloat } from './pynum.mjs';
import { workoutIdeas } from './data.mjs';
import { readMemory, slotFor, activityOf, labelOf, readStopped, isStopped } from './memory.mjs';
import { readHistory } from './history.mjs';
import { condition } from './condition.mjs';
import { readRules, readDayKinds } from './rules.mjs';
import { homeContext, homeWeek, homeWeekView, readDayOffsets, offOf, FOCUS, FOCUS_WORDS } from './homeweek.mjs';

export const DAYS = 7;               // the week is 7 local days starting today
export const TODAY_LEAD_MIN = 60;    // a session today starts at least this long after now
export const TODAY_END_HOUR = 22;    // and ends by this hour; otherwise today has no session
export const LOAD_GROWTH = 1.10;     // at most 110% of the larger of last week and the 4-week average
export const ACWR_MAX = 1.30;        // and at most 1.3 times the 4-week weekly average
export const SLEEP_DROP_MIN = 30;    // 7-day sleep this far under the 28-day average: ease off
export const RHR_RISE = 3;           // 7-day resting heart rate this far over the 28-day average: ease off
export const TAPER_DAYS = 10;        // a race within this many days: taper
export const WORN_RUN_MAX_MIN = 45;  // worn-out shoes: longer runs move to the bike or elliptical
export const BREAK_IN_MIN = 30;
export const MIN_SESSION = 20;
export const LONG_RUN_MIN = 60;      // the longest run of the week is called long_run from this many minutes
export const HARD_EFFORT = 6;
export const EASY_EFFORT = 4;
export const NOUN = {
  Running: 'run', Cycling: 'bike ride', Elliptical: 'elliptical session', Walking: 'walk', Yoga: 'yoga',
  FunctionalStrengthTraining: 'strength session', TraditionalStrengthTraining: 'strength session',
};
const COUNT = [null, 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const nounOf = (activity) => NOUN[activity] ?? String(activity).toLowerCase();
// The word a person reads: an activity the list does not name goes by the memory row's label, else a plain name of its type.
const wordOf = (s) => NOUN[s.usualActivity ?? s.activityType] ?? s.label ?? labelOf(s.usualActivity ?? s.activityType);

/** Effort 1-10: the logged effort, else an estimate from average heart rate, else 5. */
export function effort(w) {
  if (w.effort) return Number(w.effort);
  const hr = w.avgHeartRate;
  return hr ? Math.max(1, Math.min(10, 1 + (hr - 90) / 10)) : 5;
}
export const intensityOf = (e) => (e >= HARD_EFFORT ? 'hard' : e <= EASY_EFFORT ? 'easy' : 'steady');

export function signals(ws, days, now) {
  const load = (rows) => pySum(rows.map((w) => effort(w) * w.durationMin));
  const load7 = load(ws.filter((w) => w.start.mic >= now.mic - 7 * US_DAY));
  const avg28 = load(ws.filter((w) => w.start.mic >= now.mic - 28 * US_DAY)) / 4;
  const cap = Math.min(LOAD_GROWTH * Math.max(load7, avg28), ACWR_MAX * avg28);
  const avg = (rows, key) => {
    const vals = rows.filter((r) => r[key]).map((r) => r[key]);
    return vals.length ? pyRound(pyMean(vals), 1) : null;
  };
  const today = dayOf(now);
  const d7 = days.filter((d) => d.date >= today - 7);
  const d28 = days.filter((d) => d.date >= today - 28);
  const sig = {
    load7: pyRound(load7), loadWeeklyAvg28: pyRound(avg28), loadRatio: avg28 ? pyRound(load7 / avg28, 2) : null,
    loadCap: pyRound(cap), sleep7Min: avg(d7, 'sleepMin'), sleep28Min: avg(d28, 'sleepMin'),
    rhr7: avg(d7, 'restingHeartRate'), rhr28: avg(d28, 'restingHeartRate'),
  };
  const tired = [];
  if (sig.sleep7Min && sig.sleep28Min && sig.sleep7Min < sig.sleep28Min - SLEEP_DROP_MIN) {
    tired.push(`sleep down ${pyRound(sig.sleep28Min - sig.sleep7Min)} min/night`);
  }
  if (sig.rhr7 && sig.rhr28 && sig.rhr7 > sig.rhr28 + RHR_RISE) tired.push(`resting HR up ${pyFloat(pyRound(sig.rhr7 - sig.rhr28, 1))} bpm`);
  sig.readiness = tired.length ? `ease off: ${tired.join(', ')}` : 'normal';
  return sig;
}

/** Which readiness signals say ease off: 'sleep', 'resting_hr'. */
export const tiredSignals = (sig) => [
  ...(sig.readiness.includes('sleep down') ? ['sleep'] : []), ...(sig.readiness.includes('resting HR up') ? ['resting_hr'] : []),
];

/** Per weekday (Mon=0), in first-seen order: the usual activity, minutes, start hour and effort over the last 4 weeks (days used in 2+ weeks). */
export function usualWeek(ws, now) {
  const byDay = new Map();
  for (const w of ws) {
    if (w.start.mic < now.mic - 28 * US_DAY) continue;
    const wd = weekdayOf(dayOf(w.start));
    if (!byDay.has(wd)) byDay.set(wd, []);
    byDay.get(wd).push(w);
  }
  const week = new Map();
  for (const [wd, rows] of byDay) {
    if (new Set(rows.map((r) => dayOf(r.start))).size < 2) continue;
    const counts = new Map();
    for (const r of rows) counts.set(r.activityType, (counts.get(r.activityType) ?? 0) + 1);
    let act = null;
    for (const [a, n] of counts) if (act === null || n > counts.get(act)) act = a;
    const same = rows.filter((r) => r.activityType === act);
    week.set(wd, {
      activityType: act, minutes: pyRound(pyMedian(same.map((r) => r.durationMin))), hour: pyRound(pyMedian(same.map((r) => hourOf(r.start)))),
      effort: pyMean(same.map(effort)), label: same[same.length - 1].label ?? '',
    });
  }
  return week;
}

export const NEW_HISTORY_DAYS = 14;   // with less history than this, a week has at most NEW_MAX_SESSIONS sessions
export const NEW_MAX_SESSIONS = 3;

const finite = (v) => (Number.isFinite(v) ? v : null);

/**
 * The most training sessions a week may have: the usual training days plus one, never more than 7.
 * When memory has a weekly volume, that number is the usual, whatever weekdays the usual slots sit on. Without one, the usual
 * is the larger of the slot weekdays and the weekdays the history shows. With neither, the most is 3.
 */
export function sessionLimit(ws, week, now, mem) {
  const perWeek = finite(mem?.first('weekly_volume')?.data?.workoutsPerWeek);
  if (perWeek !== null && perWeek >= 0) return Math.min(DAYS, Math.ceil(perWeek) + 1);
  if (mem?.slots.length) return Math.min(DAYS, Math.max(new Set(mem.slots.map((x) => x.weekday)).size, week.size) + 1);
  const first = ws.reduce((min, w) => Math.min(min, w.start.mic), Infinity);
  return ws.length && (now.mic - first) / US_DAY >= NEW_HISTORY_DAYS ? Math.min(DAYS, week.size + 1) : NEW_MAX_SESSIONS;
}

export const HIGH_LOAD_RATIO = 1.1;   // last 7 days above this share of the usual week: no more minutes than usual

/**
 * The most training minutes a week may have. After a heavier 7 days than usual (ratio above 1.1): the usual weekly minutes.
 * Otherwise: 1.1 times the usual, or the minutes of the person's own usual week when that is more, so that week always fits.
 * Never under one shortest session. Memory first, else the history. -> { usual, ratio, limit }, each null when not known.
 */
export function minutesBudget(ws, now, mem, week = new Map()) {
  const load = mem?.first('load')?.data;
  const last7 = finite(load?.minutes7d);
  let usual = finite(mem?.first('weekly_volume')?.data?.minutesPerWeek);
  if (!(usual > 0)) usual = last7 !== null && load?.ratioToUsual > 0 ? last7 / load.ratioToUsual : null;
  let ratio = usual !== null ? finite(load?.ratioToUsual) ?? (last7 !== null ? last7 / usual : null) : null;
  if (usual === null && ws.length) {
    const minutes = (days) => pySum(ws.filter((w) => w.start.mic >= now.mic - days * US_DAY).map((w) => w.durationMin));
    usual = minutes(28) / 4;
    ratio = usual > 0 ? minutes(7) / usual : null;
  }
  if (usual === null) return { usual: null, ratio: null, limit: null };
  const high = ratio !== null && ratio > HIGH_LOAD_RATIO;
  const sum = (rows) => rows.reduce((total, x) => total + (x.minutes ?? 0), 0);
  const usualWeekMinutes = Math.max(sum(mem?.slots ?? []), sum([...week.values()]));
  const limit = high ? pyRound(usual) : Math.max(pyRound(usual * LOAD_GROWTH), usualWeekMinutes);
  return { usual: pyRound(usual), ratio: ratio === null ? null : pyRound(ratio, 2), limit: Math.max(MIN_SESSION, limit) };
}

/** The weekday of the longest usual run, or null. */
export function longDay(week) {
  let best = null;
  for (const [wd, s] of week) if (s.activityType === 'Running' && (best === null || s.minutes > week.get(best).minutes)) best = wd;
  return best;
}

/** Reads the request: { now, history, shoes?, newPairArrives?, raceDate?, calendar?, memory?, stopped? }. */
export function parseRequest(a) {
  if (!a || typeof a !== 'object') throw new InputError('bad_request');
  const now = parseDT(a.now);
  const day = (v) => (v === undefined || v === null ? null : parseDay(String(v).slice(0, 10)));
  const shoes = a.shoes ? { boughtOn: day(a.shoes.boughtOn), startMiles: Number(a.shoes.startMiles ?? 0) } : null;
  if (shoes && (shoes.boughtOn === null || !Number.isFinite(shoes.startMiles))) throw new InputError('bad_shoes');
  const busy = (a.busy ?? a.calendar ?? []).map((b) => ({ start: parseDT(b.start), end: parseDT(b.end), title: typeof b.title === 'string' ? b.title : null }));
  const carry = Array.isArray(a.carry) ? a.carry.filter((f) => FOCUS.includes(f)) : [];
  return {
    now, shoes, newPairArrives: day(a.newPairArrives), raceDate: day(a.raceDate), busy, memory: a.memory ?? null, history: a.history ?? null, stopped: a.stopped ?? null,
    rules: readRules(a.rules), dayKinds: readDayKinds(a.dayKinds), carry, offsets: readDayOffsets(a.dayOffsets),
  };
}

const HOME_EFFORT = 5;   // a home strength session counts as steady

/** With rules: one strength session on every day at home, at its first free time, and nothing on rest or out days. */
function homeBuild(req, base) {
  const h = homeContext({ now: req.now, calendar: req.busy, rules: req.rules, dayKinds: req.dayKinds, carry: req.carry, offsets: req.offsets });
  const week = homeWeek(h);
  const minutes = req.rules.session.max;
  const sessions = week.days.filter((d) => d.focus !== null).map((d) => {
    const start = { mic: d.first, off: offOf(h, d.day) };
    return {
      date: d.day, activityType: 'TraditionalStrengthTraining', usualActivity: 'TraditionalStrengthTraining', minutes, effort: HOME_EFFORT,
      hour: hourOf(start), start, end: addUs(start, minutes * US_MIN), tags: [{ code: 'home_day', focus: d.focus }],
      fallbacks: d.fallbacks.map((mic) => ({ mic, off: start.off })),
    };
  });
  base.sig.plannedLoad = pyRound(pySum(sessions.map((s) => s.effort * s.minutes)));
  return { ...base, sessions, signals: base.sig, home: homeWeekView(h, week) };
}

/**
 * The week as sessions with the rules each one met (tags), before any wording.
 * `firstDay` is 0 for a week that starts today; the Python rules start tomorrow (1), which the golden tests use.
 */
export function build(req, firstDay = 0) {
  const { now } = req;
  const [ws, days] = readHistory(req.history, now);
  const historySource = 'phone';
  const sig = signals(ws, days, now);
  const mem = readMemory(req.memory);
  const stopped = readStopped(req.stopped, mem);
  const week = usualWeek(ws, now);
  const cond = req.shoes ? condition(ws, req.shoes, now) : null;
  const worn = Boolean(cond && cond.status === 'replace');
  const long = longDay(week);
  const hasBike = ws.some((w) => w.activityType === 'Cycling');
  const tired = tiredSignals(sig);
  if (req.rules) return homeBuild(req, { sig, condition: cond, memory: mem, memorySource: mem.given ? 'phone' : null, historySource, week, long });
  let eased = false;
  let brokenIn = 0;
  const sessions = [];
  for (let i = firstDay; i < firstDay + DAYS; i += 1) {
    const day = dayOf(now) + i;
    const wd = weekdayOf(day);
    if (req.raceDate !== null && day === req.raceDate) {
      sessions.push({ date: day, activityType: 'Running', usualActivity: 'Running', minutes: 0, hour: 8, tags: [{ code: 'race_day' }], race: true });
      continue;
    }
    if (req.raceDate !== null && day === req.raceDate - 1) continue; // rest the day before the race
    const usual = week.get(wd);
    if (!usual) continue;
    const slot = slotFor(mem, wd, usual.activityType);
    if (i === 0 && atDay(day, now.off, slot ? slot.hour : usual.hour).mic < now.mic + TODAY_LEAD_MIN * US_MIN) continue; // too late for today
    if (isStopped(stopped, activityOf(usual.activityType), wd, slot ? slot.hour : usual.hour)) continue; // the person stopped this usual time
    const s = {
      date: day, activityType: usual.activityType, usualActivity: usual.activityType, minutes: usual.minutes, effort: usual.effort,
      hour: slot ? slot.hour : usual.hour, tags: [], usual: usual.label, label: slot ? slot.label : null,
    };
    if (slot) {
      s.basedOn = [slot.key]; // the memory keys this session rests on, so the phone can stop them when the person says no
      s.tags.push({ code: 'memory_slot', hour: s.hour });
    }
    if (wd === long) s.tags.push({ code: 'long_run' });
    const daysToRace = req.raceDate !== null ? req.raceDate - day : null;
    if (daysToRace !== null && daysToRace > 0 && daysToRace <= TAPER_DAYS && s.activityType === 'Running') {
      s.minutes = Math.max(MIN_SESSION, pyRound(s.minutes * (wd === long ? 0.6 : 0.8)));
      s.tags.push({ code: 'taper', daysToRace });
    }
    // The first hard session is eased; in a week that starts today, so is any other hard one today or tomorrow.
    if (sig.readiness !== 'normal' && (!eased || (firstDay === 0 && i <= 1)) && s.effort >= HARD_EFFORT) {
      s.minutes = Math.max(MIN_SESSION, pyRound(s.minutes * 0.8));
      s.effort = Math.min(s.effort, EASY_EFFORT);
      s.tags.push({ code: 'ease_off', signals: tired });
      eased = true;
    }
    if (s.activityType === 'Running') {
      const arrived = req.newPairArrives !== null && day > req.newPairArrives;
      if (worn && !arrived && s.minutes > WORN_RUN_MAX_MIN) {
        s.activityType = hasBike ? 'Cycling' : 'Elliptical';
        s.tags.push({ code: 'worn_shoes_swap', percentLife: cond.percentLife, to: s.activityType });
      } else if (arrived && brokenIn < 2) {
        s.minutes = Math.min(s.minutes, BREAK_IN_MIN);
        s.effort = Math.min(s.effort, EASY_EFFORT);
        s.tags.push({ code: 'break_in' });
        brokenIn += 1;
      }
    }
    sessions.push(s);
  }

  // No more sessions than the week may have: the earliest ones stay. (The Python rules have no such limit.)
  if (firstDay === 0) {
    const limit = sessionLimit(ws, week, now, mem);
    let kept = 0;
    for (let i = 0; i < sessions.length; i += 1) {
      if (sessions[i].race) continue;
      kept += 1;
      if (kept > limit) { sessions.splice(i, 1); i -= 1; }
    }
  }

  // Weekly load limit: shrink every session but the long run in proportion until the week fits.
  const load = (rows) => pySum(rows.filter((s) => !s.race).map((s) => s.effort * s.minutes));
  const planned = load(sessions);
  if (planned > sig.loadCap && sig.loadCap > 0) {
    const flex = sessions.filter((s) => !s.race && !s.tags.some((t) => t.code === 'long_run'));
    const excess = planned - sig.loadCap;
    const flexLoad = load(flex) || 1;
    for (const s of flex) {
      const cut = s.minutes * Math.min(0.5, excess / flexLoad);
      if (cut >= 1) {
        s.minutes = Math.max(MIN_SESSION, pyRound(s.minutes - cut));
        s.tags.push({ code: 'load_trim' });
      }
    }
  }
  // A second pass, so the week never leaves here over the limit: take a minute at a time from the longest session that is
  // still above the shortest length, the long run last.
  if (sig.loadCap > 0) {
    for (;;) {
      if (load(sessions) <= sig.loadCap) break;
      const open = sessions.filter((s) => !s.race && s.minutes > MIN_SESSION);
      const flex = open.filter((s) => !s.tags.some((t) => t.code === 'long_run'));
      const pool = flex.length ? flex : open;
      if (!pool.length) break;
      let longest = pool[0];
      for (const s of pool) if (s.minutes > longest.minutes) longest = s;
      longest.minutes -= 1;
      if (!longest.tags.some((t) => t.code === 'load_trim')) longest.tags.push({ code: 'load_trim' });
    }
  }
  // And never more minutes than the week may have: the same trim, then the last sessions go. (Not in the Python rules.)
  if (firstDay === 0) {
    const { limit } = minutesBudget(ws, now, mem, week);
    const total = () => sessions.reduce((sum, s) => sum + (s.race ? 0 : s.minutes), 0);
    while (limit !== null && total() > limit) {
      const open = sessions.filter((s) => !s.race && s.minutes > MIN_SESSION);
      const flex = open.filter((s) => !s.tags.some((t) => t.code === 'long_run'));
      const pool = flex.length ? flex : open;
      if (pool.length) {
        let longest = pool[0];
        for (const s of pool) if (s.minutes > longest.minutes) longest = s;
        longest.minutes -= 1;
        if (!longest.tags.some((t) => t.code === 'load_trim')) longest.tags.push({ code: 'load_trim' });
      } else {
        const booked = sessions.filter((s) => !s.race);
        if (booked.length <= 1) break;
        const last = sessions.lastIndexOf(booked[booked.length - 1]);
        sessions.splice(last, 1);
      }
    }
  }
  sig.plannedLoad = pyRound(load(sessions));

  // Busy times: move a session to just after an overlapping event.
  for (const s of sessions) {
    const length = Math.max(s.minutes, 1) * US_MIN;
    let start = atDay(s.date, now.off, s.hour);
    let end = addUs(start, length);
    for (const b of req.busy) {
      if (b.start.mic < end.mic && start.mic < b.end.mic) {
        start = { mic: b.end.mic, off: now.off };
        end = addUs(start, length);
        s.tags.push({ code: 'calendar_moved', to: clock(hourOf(start), minuteOf(start)) });
      }
    }
    if (hourOf(end) >= 21 && !s.race) s.tags.push({ code: 'no_free_slot' });
    s.start = start;
    s.end = end;
  }
  // A session that a move or a swap put on a stopped usual time is left out as well.
  const before = sessions.length;
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const s = sessions[i];
    if (!s.race && isStopped(stopped, activityOf(s.activityType), weekdayOf(s.date), hourOf(s.start))) sessions.splice(i, 1);
  }
  if (sessions.length !== before) sig.plannedLoad = pyRound(load(sessions));
  // Today's session must still end by 22:00 after any move; if it cannot, today has none.
  const tooLate = sessions.findIndex((s) => !s.race && s.date === dayOf(now) && s.end.mic > atDay(s.date, now.off, TODAY_END_HOUR).mic);
  if (tooLate >= 0) {
    sessions.splice(tooLate, 1);
    sig.plannedLoad = pyRound(load(sessions));
  }
  return { sessions, signals: sig, condition: cond, memory: mem, memorySource: mem.given ? 'phone' : null, historySource, week, long };
}

const TIRED_WORDS = { sleep: 'you have been sleeping less than usual', resting_hr: 'your resting heart rate is higher than usual' };
const tiredWords = (list) => list.map((k) => TIRED_WORDS[k]).filter(Boolean).join(' and ') || 'your body needs a lighter day';

// A rule as a sentence of its own, or as the part after "Your usual Tuesday run, ...".
function wording(tag, s) {
  const weekday = WEEKDAY_NAMES[weekdayOf(s.date)];
  const noun = wordOf(s);
  const machine = tag.to === 'Cycling' ? 'bike' : 'elliptical';
  switch (tag.code) {
    case 'usual': return { whole: `Your usual ${weekday} ${noun}.` };
    case 'memory_slot': return { whole: `Your usual ${weekday} ${clock(tag.hour)} ${noun}.` };
    case 'long_run': return { part: 'the longest of your week', whole: 'It is your longest run of the week.' };
    case 'taper': return { part: `kept shorter because your race is ${plural(tag.daysToRace, 'day')} away` };
    case 'ease_off': return { part: `kept short and easy because ${tiredWords(tag.signals ?? [])}` };
    case 'worn_shoes_swap': return { part: `moved to the ${machine} because your running shoes are nearly worn out`, whole: `Your running shoes are nearly worn out, so this one moves to the ${machine}.` };
    case 'break_in': return { whole: 'A short, easy run to break in your new shoes.' };
    case 'load_trim': return { part: 'kept short so this week stays close to your normal' };
    case 'calendar_moved': return { part: `moved to ${tag.to} because your calendar is busy before that` };
    case 'no_free_slot': return { whole: 'It ends late because the rest of that day is full, so skip it if that is too late.' };
    case 'race_day': return { whole: 'Race day. Rest and fuel.' };
    case 'home_day': return { whole: `${weekday} is a day at home, so it has a ${FOCUS_WORDS[tag.focus] ?? 'full-body'} strength session.` };
    default: return { whole: '' };
  }
}

/** The reasons of a session: [{ code, text }], one per rule it met, or the single reason `usual`. Each text is a whole sentence. */
export function sessionReasons(s) {
  const tags = s.tags.length ? s.tags : [{ code: 'usual' }];
  const weekday = WEEKDAY_NAMES[weekdayOf(s.date)];
  const noun = wordOf(s);
  return tags.map((t, i) => {
    const w = wording(t, s);
    const text = i === 0 && w.part ? `Your usual ${weekday} ${noun}, ${w.part}.` : w.whole ?? `${w.part.slice(0, 1).toUpperCase()}${w.part.slice(1)}.`;
    return { code: t.code, text };
  });
}
const sentence = (reasons) => [...new Set(reasons.map((r) => r.text))].join(' ');

const SAFE_KINDS = ['strides', 'shakeout', 'mobility', 'drills', 'walk'];
const DEFAULT_MIN = { strides: 6, shakeout: 15, mobility: 10, drills: 10, walk: 15 };
const ADDON_EFFORT = 3.0;
const MAX_SUGGESTIONS = 2;

function phases(req, plan, firstDay) {
  const ph = new Set(['any']);
  const first = dayOf(req.now) + firstDay;
  if (req.raceDate !== null && req.raceDate - first > 0 && req.raceDate - first <= TAPER_DAYS) { ph.add('taper'); ph.add('race week'); }
  if (plan.condition && plan.condition.status === 'replace') ph.add('worn shoes');
  if (req.newPairArrives !== null) ph.add('new shoes');
  return ph;
}

function why(idea, req) {
  const out = req.raceDate !== null ? req.raceDate - dayOf(req.now) : null;
  const lead = {
    taper: out !== null ? `Your race is ${out} days out` : "You're tapering",
    'race week': out !== null ? `Race week: your race is ${out} days out` : 'Race week',
    'new shoes': req.newPairArrives !== null ? `Your new pair arrives ${WEEKDAYS[weekdayOf(req.newPairArrives)]}` : 'New shoes',
    'worn shoes': 'Your shoes are worn out', any: 'An easy add-on',
  }[idea.phase];
  const when = idea.when.slice(0, 1).toLowerCase() + idea.when.slice(1).replace(/\.+$/, '');
  return `${lead}; ${idea.source} suggests it ${when}. Optional, and it fits in your week.`;
}

/** Optional extras from the bundled expert ideas, filtered by rules, at most two, never booked. */
export function suggestions(req, plan, ids, firstDay = 0) {
  const sig = plan.signals;
  let headroom = sig.loadCap - sig.plannedLoad;
  const ph = phases(req, plan, firstDay);
  const worn = Boolean(plan.condition && plan.condition.status === 'replace');
  const runs = plan.sessions.map((s, i) => [ids[i], s]).filter(([, s]) => s.activityType === 'Running' && !s.race);
  const rank = (x) => (x.phase === 'any' ? 2 : 0) + (x.kind === 'mobility' ? 1 : 0);
  const ideas = workoutIdeas().map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x);
  const out = [];
  const used = new Set();
  for (const idea of ideas) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const { kind } = idea;
    if (!SAFE_KINDS.includes(kind) || idea.intensity === 'hard' || !ph.has(idea.phase) || used.has(kind)) continue;
    const minutes = Math.trunc(idea.minutes || DEFAULT_MIN[kind]);
    if (minutes > 30 || ADDON_EFFORT * minutes > headroom) continue;
    let attach = null;
    if (['strides', 'shakeout', 'drills'].includes(kind)) {
      let ok = runs.filter(([, s]) => !(worn && req.newPairArrives !== null && s.date <= req.newPairArrives) && !(worn && req.newPairArrives === null));
      if (kind === 'shakeout' && req.raceDate !== null) ok = ok.filter(([, s]) => s.date === req.raceDate - 2);
      if (!ok.length) continue;
      attach = kind === 'strides' ? ok[ok.length - 1] : ok[0];
    }
    out.push({
      id: idea.id, title: idea.title, kind, activityType: idea.activityType, minutes,
      when: attach ? `after your ${WEEKDAYS[weekdayOf(attach[1].date)]} run` : idea.when, attachTo: attach ? attach[0] : null,
      why: why(idea, req), source: { title: idea.sourceTitle, name: idea.source }, quote: idea.quote, optional: true,
    });
    used.add(kind);
    headroom -= ADDON_EFFORT * minutes;
  }
  return out;
}

/** An expert source behind a rule the session met (taper, worn shoes, break-in), when the bundled ideas hold one. */
export function citations(s) {
  const codes = s.tags.map((t) => t.code);
  const want = [...(codes.includes('taper') ? ['taper'] : []), ...(codes.includes('worn_shoes_swap') ? ['worn shoes'] : []), ...(codes.includes('break_in') ? ['new shoes'] : [])];
  const out = [];
  for (const phase of want) {
    const hit = workoutIdeas().find((i) => i.phase === phase || (phase === 'worn shoes' && i.kind === 'cross-training'));
    if (hit) out.push({ source: `${hit.sourceTitle} (${hit.source})`, passage: hit.quote });
  }
  return out;
}

/** The week's summary as [{ code, text }]. */
export function summaryReasons(plan) {
  const sig = plan.signals;
  const out = [];
  if (plan.home) {
    const n = plan.home.trainingDays;
    out.push({ code: 'home_week', text: plan.home.note ?? `This week has ${plural(n, 'day')} at home with time to train, so ${plural(n, 'strength session')}.` });
    return out;
  }
  if (!plan.sessions.length) out.push({ code: 'no_history', text: 'Nothing is planned yet because there is not enough recent history to see your usual week.' });
  else if (sig.loadRatio === null) out.push({ code: 'load_unknown', text: 'This week follows your usual pattern.' });
  else if (sig.loadRatio < 0.9) {
    const trimmed = plan.sessions.some((s) => s.tags.some((t) => t.code === 'load_trim'));
    out.push({ code: 'load_light', text: trimmed ? 'Last week was lighter than usual, so this week builds back up gently.' : 'A lighter week than usual, so there is room to build.' });
  }
  else if (sig.loadRatio > 1.1) out.push({ code: 'load_heavy', text: 'A heavier week than usual, so this week stays close to your normal.' });
  else out.push({ code: 'load_normal', text: 'Last week was close to your normal, so this week keeps your usual pattern.' });
  const tired = tiredSignals(sig);
  if (tired.length) out.push({ code: 'readiness_ease', text: `Take it easier for now, because ${tiredWords(tired)}.` });
  const swaps = plan.sessions.filter((s) => s.tags.some((t) => t.code === 'worn_shoes_swap')).length;
  if (swaps) out.push({ code: 'worn_shoes', text: `${swaps === 1 ? 'One long run moves' : `${COUNT[swaps] ?? 'Several'} long runs move`} off the road while your shoes are worn out.` });
  return out;
}

export const actionId = (s) => `wk-${dayISO(s.date)}-${s.activityType.toLowerCase()}`;
const p2 = (n) => String(n).padStart(2, '0');

/** A planned session in the shared shape, or null when the shared activity list has no name for it. */
export function toSession(s, reasons) {
  const base = activityOf(s.activityType);
  if (s.race || base === null) return null;
  // long_run: the week's longest run, and only when it is at least an hour; a shorter one stays a run.
  const activity = base === 'run' && s.minutes >= LONG_RUN_MIN && s.tags.some((t) => t.code === 'long_run') ? 'long_run' : base;
  return {
    id: `ses-${dayISO(s.date)}-${activity}-${p2(hourOf(s.start))}${p2(minuteOf(s.start))}`, day: dayISO(s.date),
    start: isoDT({ mic: Math.floor(s.start.mic / 1e6) * 1e6, off: s.start.off }), // whole seconds, as the shared session shape asks
    minutes: s.minutes, activity, intensity: intensityOf(s.effort), reason: sentence(reasons), basedOn: s.basedOn ?? [],
  };
}

/**
 * The week by rules alone. `sessions` is the plan in the shared shape; `reasons` holds each session's reasons by id as
 * [{ code, text }]; `actions` is the same week in the shape the app's calendar code reads.
 */
export function recommendWeek(args, firstDay = 0) {
  const req = parseRequest(args);
  const plan = build(req, firstDay);
  const ids = plan.sessions.map(actionId);
  const createdAt = isoDT(req.now);
  const sessions = [];
  const reasonsById = {};
  const notes = [];
  const actions = plan.sessions.map((s, i) => {
    const reasons = sessionReasons(s);
    const session = toSession(s, reasons);
    if (session) { sessions.push(session); reasonsById[session.id] = reasons; }
    if (s.race) notes.push({ day: dayISO(s.date), code: 'race_day', text: reasons[0].text });
    return {
      id: ids[i], kind: s.race ? 'note' : 'addWorkout', sessionId: session ? session.id : null,
      title: s.race ? 'Race day' : `Planned a ${s.minutes}-minute ${nounOf(s.activityType)}`, planItemId: ids[i],
      after: s.race ? null : { start: isoDT(s.start), end: isoDT(s.end), activityType: s.activityType },
      reason: sentence(reasons), reasons, points: s.race ? null : 10, createdAt,
      rules: s.tags.map((t) => t.code), basedOn: s.basedOn ?? [], intensity: s.race ? null : intensityOf(s.effort), evidence: citations(s),
    };
  });
  const summary = summaryReasons(plan);
  return {
    sessions, reasons: reasonsById, notes, summary: sentence(summary), summaryReasons: summary, signals: plan.signals,
    actions, suggestions: suggestions(req, plan, ids, firstDay), memoryUsed: [...new Set(sessions.flatMap((x) => x.basedOn))],
    memorySource: plan.memorySource, historySource: plan.historySource, live: false, source: 'rules', condition: plan.condition,
    ...(plan.home ? { homeWeek: plan.home } : {}),
  };
}
