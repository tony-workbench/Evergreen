// The scripted recommendation model: a fixed function that stands in for the model call, so the week test gives the same
// result every time. (The memory model's stand-in is the memory bundle's own memoryDemoModel.)
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const p2 = (n) => String(n).padStart(2, '0');

export const weekdayOf = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
export const offsetText = (minutes) => `${minutes < 0 ? '-' : '+'}${p2(Math.floor(Math.abs(minutes) / 60))}:${p2(Math.abs(minutes) % 60)}`;
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const usable = (rows) => rows.filter((r) => r.state === 'saved' || r.state === 'confirmed');

/**
 * What in a plan is outside the plan window: 7 local days starting on the day of `now`; a session today starts at least
 * 60 minutes after `now` and ends by 22:00. -> one sentence per problem.
 */
export function windowProblems(plan, now) {
  const today = now.slice(0, 10), last = addDays(today, 6), out = [];
  for (const s of plan.sessions) {
    if (s.day < today || s.day > last) out.push(`session ${s.id} is on ${s.day}, outside the 7 days from ${today} to ${last}`);
    if (s.start.slice(0, 10) !== s.day) out.push(`session ${s.id} starts on ${s.start.slice(0, 10)} but says ${s.day}`);
    if (s.day !== today || s.activity === 'rest') continue;
    if (Date.parse(s.start) < Date.parse(now) + 60 * 60000) out.push(`session ${s.id} starts at ${s.start.slice(11, 16)}, less than 60 minutes after now (${now.slice(11, 16)})`);
    const end = Number(s.start.slice(11, 13)) * 60 + Number(s.start.slice(14, 16)) + s.minutes;
    if (end > 22 * 60) out.push(`session ${s.id} today ends after 22:00`);
  }
  return out;
}

/** The recommendation model: one session at each usual time of the week (after a calendar event when one is in the way), based on that row's key and, when the table has one, the weekly volume row's key. It keeps the week within maxMinutes and maxSessions from planContext. */
export function scriptedRecommendModel({ rows, days, tzOffsetMinutes, calendar = [], now = null, maxMinutes = null, maxSessions = null }) {
  const sessions = [], volume = usable(rows).find((r) => r.kind === 'weekly_volume');
  for (const row of usable(rows).filter((r) => r.kind === 'usual_slot')) {
    const d = row.data, day = days.find((x) => weekdayOf(x) === d.weekday);
    if (!day) continue;
    const usual = `${day}T${p2(d.hour)}:00:00${offsetText(tzOffsetMinutes)}`;
    const busy = calendar.find((e) => Date.parse(usual) < Date.parse(e.end) && Date.parse(usual) + d.minutes * 60000 > Date.parse(e.start));
    const start = busy ? busy.end : usual;
    if (now && windowProblems({ sessions: [{ id: 'x', day, start, minutes: d.minutes }] }, now).length) continue; // too late for today
    sessions.push({
      id: `s-${day}-${d.activity}-${p2(d.hour)}00`, day, start, minutes: d.minutes, activity: d.activity,
      intensity: d.activity === 'strength' || d.activity === 'long_run' ? 'steady' : 'easy',
      reason: `You usually do this on ${WEEKDAY_NAMES[d.weekday]} at ${p2(d.hour)}:00.`, basedOn: volume ? [row.key, volume.key] : [row.key],
    });
  }
  sessions.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  // Fit the week's limits, as a model is told to: drop the last sessions over maxSessions, then shorten all evenly
  // (to whole 5 minutes, never under 10) and drop the last one while the week is still over maxMinutes.
  if (typeof maxSessions === 'number') sessions.splice(Math.max(0, maxSessions));
  const total = () => sessions.reduce((sum, s) => sum + s.minutes, 0);
  if (typeof maxMinutes === 'number' && total() > maxMinutes) {
    const scale = maxMinutes / total();
    for (const s of sessions) s.minutes = Math.max(10, Math.floor((s.minutes * scale) / 5) * 5);
    while (sessions.length && total() > maxMinutes) sessions.pop();
  }
  return { sessions, summary: sessions.length ? `${sessions.length} sessions at your usual times.` : 'No usual times yet, so nothing is planned.' };
}
