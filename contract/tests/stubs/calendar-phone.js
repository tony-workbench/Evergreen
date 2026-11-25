// A stand-in for calendar-planner/dist/calendar-phone.js that follows contract/AGENTS.md, for testing the week test.
// It only adds: an `add` intent goes to the first free time on its day at or after `after`; a drag moves a block.
(() => {
  const TITLES = { run: 'Run', long_run: 'Long run', walk: 'Walk', strength: 'Strength', yoga: 'Yoga', ride: 'Ride', swim: 'Swim', elliptical: 'Elliptical', stretch: 'Stretch', rest: 'Rest day', other: 'Workout' };
  const MIN = 60000, p2 = (n) => String(n).padStart(2, '0');
  const fail = (code, text) => ({ ok: false, error: { code, text } });
  const entry = (fn) => (argsJson) => {
    let a;
    try { a = JSON.parse(argsJson); } catch { return JSON.stringify(fail('BadJSON', 'The arguments are not JSON.')); }
    try { return JSON.stringify(fn(a ?? {})); } catch { return JSON.stringify(fail('BadInput', 'The arguments are not what this call takes.')); }
  };
  const local = (t, offset) => { const d = new Date(t + offset * MIN).toISOString().slice(0, 19), o = Math.abs(offset); return `${d}${offset < 0 ? '-' : '+'}${p2(Math.floor(o / 60))}:${p2(o % 60)}`; };
  const result = (kind, message, proposed) => ({ ok: true, kind, message, proposed, undoToken: `u-${proposed.map((p) => p.id + p.start).join('|') || 'none'}`, state: { kind } });

  globalThis.calendarPlan = entry((a) => {
    const x = a.intent;
    if (!x) return result('none', 'I can only read an intent.', []);
    if (x.kind !== 'add' || !TITLES[x.activity]) return fail('BadActivity', 'I do not know that activity.');
    const link = x.sessionId ? { sessionId: x.sessionId } : {};
    const offset = a.tzOffsetMinutes, day = Date.parse(`${x.day}T00:00:00Z`) - offset * MIN;
    if (x.activity === 'rest') return result('add', 'Rest day added.', [{ id: `new-${x.day}-rest`, activity: 'rest', title: TITLES.rest, start: local(day, offset), end: local(day + 1440 * MIN, offset), minutes: 0, status: 'new', reason: 'A full day with no workout.', ...link }]);
    const busy = [...(a.events ?? []), ...(a.workouts ?? [])].map((e) => [Date.parse(e.start), Date.parse(e.end)]);
    const [h, m] = (x.after ?? '06:00').split(':').map(Number), length = (x.minutes ?? 30) * MIN;
    for (let s = Math.max(day + (h * 60 + m) * MIN, Math.ceil(Date.parse(a.now) / (15 * MIN)) * 15 * MIN); s + length <= day + 22 * 60 * MIN; s += 15 * MIN) {
      if (busy.some(([from, to]) => s < to && s + length > from)) continue;
      const moved = s !== day + (h * 60 + m) * MIN;
      return result('add', `${x.title ?? TITLES[x.activity]} added.`, [{ id: `new-${x.day}-${x.activity}`, activity: x.activity, title: x.title ?? TITLES[x.activity], start: local(s, offset), end: local(s + length, offset), minutes: length / MIN, status: 'new', reason: moved ? 'The first free time after the one you asked for.' : 'The time you asked for is free.', ...link }]);
    }
    return fail('NoRoom', 'There is no free time for that on that day.');
  });

  globalThis.calendarReplan = entry((a) => {
    const block = a.plan?.proposed?.find((p) => p.id === a.change?.id);
    if (a.change?.type !== 'drag' || !block) return fail('BadChange', 'I can only move a block that is on screen.');
    const s = Date.parse(a.change.start), end = s + block.minutes * MIN;
    return { ...result('add', `${block.title} moved.`, [{ ...block, start: local(s, a.tzOffsetMinutes), end: local(end, a.tzOffsetMinutes), reason: 'Moved by you.' }]), replaces: a.plan.undoToken };
  });

  const text = { type: 'string' };
  globalThis.calendarIntentSchema = () => JSON.stringify({
    type: 'object', additionalProperties: false, required: ['kind'],
    properties: {
      kind: { type: 'string', enum: ['add', 'move', 'resize', 'cancel', 'race'] }, activity: { type: 'string', enum: Object.keys(TITLES) }, title: text, minutes: { type: 'integer', minimum: 5, maximum: 240 },
      sessionId: text, targetWorkoutId: text, day: text, after: text, exact: { type: 'boolean' }, before: text, partOfDay: { type: 'string', enum: ['morning', 'afternoon', 'evening'] }, raceDate: text, distanceKm: { type: 'number' },
    },
  });
})();
