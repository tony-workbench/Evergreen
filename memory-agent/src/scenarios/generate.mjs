// Seeded generator of synthetic health snapshots with planted events.
// generateScenario(kind, seed, options) -> { snapshot, now, planted }. Same arguments, same output.
// No clock, no network, no real data.

export const SCENARIO_KINDS = ['steady', 'thin', 'spike', 'missed_week', 'comeback', 'duplicates', 'missing_days', 'tz_change'];

const DAY_MS = 86400000;
const WORKOUT_WEEKDAYS = [1, 3, 5, 6]; // Mon, Wed, Fri, Sat
const ACTIVITY_BY_WEEKDAY = { 1: 'Running', 3: 'FunctionalStrengthTraining', 5: 'Running', 6: 'Cycling' };

function hashSeed(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayNum = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const dayIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;

// Local wall-clock string "YYYY-MM-DDTHH:MM:SS+hh:mm" for a day number and minute-of-day (may spill into the next day).
function stamp(day, minuteOfDay, offset) {
  const ms = day * DAY_MS + minuteOfDay * 60000;
  return new Date(ms).toISOString().slice(0, 19) + offset;
}

/**
 * kind: one of SCENARIO_KINDS.
 * options: { days (history length, default 60), endDate ('YYYY-MM-DD', default 2026-11-18), offset ('-08:00') }
 */
export function generateScenario(kind, seed = 1, options = {}) {
  if (!SCENARIO_KINDS.includes(kind)) throw new Error('unknown scenario kind');
  const rand = mulberry32(hashSeed(`${kind}:${seed}`));
  const days = options.days ?? (kind === 'thin' ? 14 : 60);
  const endDate = options.endDate ?? '2026-11-18';
  const offset = options.offset ?? '-08:00';
  const end = dayNum(endDate);
  const start = end - days + 1;
  const planted = [];

  // tz_change: from this day on, timestamps carry a different offset.
  const changeDay = end - 10;
  const offsetAfter = '-05:00';
  const offsetOf = (d) => (kind === 'tz_change' && d >= changeDay ? offsetAfter : offset);

  // Which days have no workouts on purpose
  const noWorkout = new Set();
  if (kind === 'missed_week') for (let k = 0; k <= 6; k++) noWorkout.add(end - k);
  if (kind === 'comeback') for (let k = 7; k <= 20; k++) noWorkout.add(end - k);
  const missing = new Set();
  if (kind === 'missing_days') {
    const pool = [];
    for (let k = 1; k <= 27 && end - k >= start; k++) pool.push(end - k);
    while (missing.size < Math.min(6, pool.length)) missing.add(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }

  const summaries = [];
  const workouts = [];
  const workoutDay = []; // day of each workout, to plant duplicates
  for (let d = start; d <= end; d++) {
    if (missing.has(d)) {
      rand(); rand(); rand(); rand(); // keep the stream aligned
      continue;
    }
    summaries.push({
      date: dayIso(d),
      steps: Math.round(7000 + rand() * 3000),
      restingHeartRate: Math.round(54 + rand() * 4),
      sleepMinutes: { totalAsleep: Math.round(420 + rand() * 60) },
    });
    const wd = new Date(d * DAY_MS).getUTCDay();
    const noise = rand();
    const minuteNoise = rand();
    if (!WORKOUT_WEEKDAYS.includes(wd) || noWorkout.has(d)) continue;
    const duration = r2(40 + (noise - 0.5) * 8); // 38 to 42 minutes
    const startMin = 7 * 60 + Math.round(minuteNoise * 10);
    workouts.push(makeWorkout(ACTIVITY_BY_WEEKDAY[wd], d, startMin, duration, offsetOf(d), rand));
    workoutDay.push(d);
  }

  let spike = null;
  if (kind === 'spike') {
    const i = workoutDay.indexOf(end);
    const spikeMinutes = r2(120 + rand() * 6); // about 3x a normal workout
    spike = makeWorkout('Running', end, 7 * 60, spikeMinutes, offsetOf(end), rand);
    if (i >= 0) {
      workouts.splice(i, 1, spike);
    } else {
      workouts.push(spike);
    }
  }

  if (kind === 'missing_days') planted.push({ type: 'missing_days', dates: [...missing].sort().map(dayIso) });

  if (kind === 'tz_change') {
    // An evening workout just before the offset changes: local date is changeDay - 1, but the UTC date is changeDay.
    const late = makeWorkout('Yoga', changeDay - 1, 23 * 60 + 15, 30, offset, rand);
    workouts.push(late);
    planted.push({
      type: 'tz_change',
      changeDate: dayIso(changeDay),
      offsetBefore: offset,
      offsetAfter,
      lateWorkout: { start: late.start, localDate: dayIso(changeDay - 1), minutes: 30 },
    });
  }

  workouts.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  // Planted ground truth is read back from the generated workouts, never from the intended plan.
  const dateOf = (w) => w.start.slice(0, 10);
  if (kind === 'spike') {
    const earlier = workouts.filter((w) => w !== spike && dateOf(w) < dateOf(spike));
    const previous = earlier.reduce((m, w) => Math.max(m, w.durationMin), 0);
    planted.push({ type: 'spike', date: dateOf(spike), minutes: spike.durationMin, previousHighestMinutes: previous, multiple: previous > 0 ? r2(spike.durationMin / previous) : null });
  }
  if (kind === 'missed_week') {
    const before = workouts.filter((w) => dateOf(w) < dayIso(end - 6)).map(dateOf).pop() ?? null;
    planted.push({ type: 'missed_week', start: dayIso(end - 6), end: dayIso(end), lastWorkoutBefore: before });
  }
  if (kind === 'comeback') {
    // The longest stretch between two consecutive workout dates is the gap.
    const dates = [...new Set(workouts.map(dateOf))];
    let best = null;
    for (let i = 1; i < dates.length; i++) {
      const diff = dayNum(dates[i]) - dayNum(dates[i - 1]);
      if (!best || diff > best.diff) best = { diff, lastBeforeGap: dates[i - 1], resumedOn: dates[i] };
    }
    if (best) {
      planted.push({ type: 'comeback', lastWorkoutBeforeGap: best.lastBeforeGap, gapStart: dayIso(dayNum(best.lastBeforeGap) + 1), gapEnd: dayIso(dayNum(best.resumedOn) - 1), gapDays: best.diff - 1, resumedOn: best.resumedOn });
    }
  }

  if (kind === 'duplicates') {
    const indices = [];
    const out = [];
    workouts.forEach((w, i) => {
      out.push(w);
      if (i % 4 === 1) {
        out.push({ ...w, heartRate: { ...w.heartRate } });
        indices.push(out.length - 1);
      }
    });
    workouts.length = 0;
    workouts.push(...out);
    planted.push({ type: 'duplicates', indices });
  }
  if (kind === 'thin') planted.push({ type: 'thin', days });

  const now = `${dayIso(end)}T21:00:00${offsetOf(end)}`;
  const snapshot = {
    exportDate: now,
    persona: { key: `synthetic_${kind}`, name: 'Synthetic', description: `Generated ${kind} scenario, seed ${seed}` },
    dailySummaries: summaries,
    workouts,
  };
  return { snapshot, now, planted };
}

function makeWorkout(activityType, day, startMin, duration, offset, rand) {
  const avg = Math.round(125 + rand() * 30);
  return {
    activityType,
    start: stamp(day, startMin, offset),
    end: stamp(day, startMin + Math.round(duration), offset),
    durationMin: duration,
    indoor: false,
    activeEnergyKcal: r2(duration * 9.5),
    heartRate: { avg, min: avg - 30, max: avg + 30 },
  };
}
