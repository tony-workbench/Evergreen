// A stand-in for recommend-agent/dist/recommend-phone.js that follows contract/AGENTS.md, for testing the week test.
(() => {
  const ACTIVITIES = ['run', 'long_run', 'walk', 'strength', 'yoga', 'ride', 'swim', 'elliptical', 'stretch', 'rest', 'other'];
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const p2 = (n) => String(n).padStart(2, '0');
  const fail = (code, text) => ({ ok: false, error: { code, text } });
  const usable = (rows) => (rows ?? []).filter((r) => r.state === 'saved' || r.state === 'confirmed');
  const weekdayOf = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const entry = (fn) => (argsJson) => {
    let a;
    try { a = JSON.parse(argsJson); } catch { return JSON.stringify(fail('BadJSON', 'The arguments are not JSON.')); }
    try { return JSON.stringify(fn(a ?? {})); } catch { return JSON.stringify(fail('BadInput', 'The arguments are not what this call takes.')); }
  };
  const daysFrom = (now) => { const t = Date.parse(`${now.slice(0, 10)}T00:00:00Z`); return [0, 1, 2, 3, 4, 5, 6].map((n) => new Date(t + n * 864e5).toISOString().slice(0, 10)); };

  // The context: { now, memory: { rows }, calendar: [{ start, end, title }], history }.
  const keysOf = (context) => usable(context?.memory?.rows).map((r) => r.key);
  const busyAt = (context, start, minutes) => (context?.calendar ?? []).find((b) => Date.parse(start) < Date.parse(b.end) && Date.parse(start) + minutes * 60000 > Date.parse(b.start));

  // Today only from 60 minutes after now, and done by 22:00.
  const tooLate = (now, start, minutes) => start.slice(0, 10) === now.slice(0, 10) && (Date.parse(start) < Date.parse(now) + 3600000 || Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16)) + minutes > 1320);

  // The week's limits: one session more than the usual times, and the usual minutes.
  const limitsOf = (context) => { const slots = usable(context?.memory?.rows).filter((x) => x.kind === 'usual_slot'); return { maxSessions: slots.length + 1, maxMinutes: slots.reduce((sum, x) => sum + x.data.minutes, 0) }; };
  const isStopped = (context, activity, weekday, hour) => (context?.stopped ?? []).some((x) => x.activity === activity && x.weekday === weekday && x.hour === hour);
  globalThis.planContext = entry((a) => (typeof a.now === 'string' ? { ok: true, days: daysFrom(a.now), memoryKeys: keysOf(a), ...limitsOf(a) } : fail('BadInput', 'The context needs now.')));
  globalThis.planBrief = entry((a) => { const l = limitsOf(a.context); return { ok: true, lines: [`At most ${l.maxSessions} training sessions this week.`, `At most ${l.maxMinutes} minutes of training this week.`] }; });

  globalThis.checkPlan = entry((a) => {
    const keys = new Set(keysOf(a.context)), days = daysFrom(a.context.now), violations = [], seen = new Set();
    for (const s of a.plan.sessions) {
      const say = (code, text) => violations.push({ code, text, sessionId: String(s.id) });
      if (seen.has(s.id)) say('duplicate_session', 'Two sessions have the same id.');
      seen.add(s.id);
      if (!ACTIVITIES.includes(s.activity)) say('unknown_activity', 'A session has an activity that is not on the list.');
      if (!days.includes(s.day) || String(s.start).slice(0, 10) !== s.day || tooLate(a.context.now, s.start, s.minutes)) say('outside_window', 'A session is outside the 7 days from today, or too close to now.');
      if (busyAt(a.context, s.start, s.minutes)) say('calendar_conflict', 'A session overlaps something on the calendar.');
      if (isStopped(a.context, s.activity, weekdayOf(s.day), Number(String(s.start).slice(11, 13)))) say('stopped_slot', 'A session is at a usual time the person stopped.');
      for (const key of s.basedOn ?? []) if (!keys.has(key)) say('unknown_memory_key', 'A session is based on a memory that is not in the table.');
    }
    const limits = limitsOf(a.context), training = a.plan.sessions.filter((x) => x.activity !== 'rest'), total = training.reduce((sum, x) => sum + x.minutes, 0);
    if (training.length > limits.maxSessions) violations.push({ code: 'too_many_sessions', text: `This week has ${training.length} sessions, and ${limits.maxSessions} is the most that fits.` });
    if (total > limits.maxMinutes) violations.push({ code: 'too_many_minutes', text: `This week adds up to ${total} minutes, and ${limits.maxMinutes} is the most that fits.` });
    return { ok: true, pass: violations.length === 0, violations };
  });

  globalThis.recommendWeek = entry((a) => {
    const offset = a.now.slice(-6), days = daysFrom(a.now), sessions = [];
    for (const row of usable(a.memory?.rows).filter((x) => x.kind === 'usual_slot')) {
      const d = row.data, day = days.find((x) => weekdayOf(x) === d.weekday);
      if (isStopped(a, d.activity, d.weekday, d.hour)) continue;
      let start = `${day}T${p2(d.hour)}:00:00${offset}`;
      const busy = busyAt(a, start, d.minutes);
      if (busy) start = busy.end;
      if (tooLate(a.now, start, d.minutes)) continue;
      sessions.push({ id: `wk-${day}-${d.activity}-${p2(d.hour)}`, day, start, minutes: d.minutes, activity: d.activity, intensity: 'easy', reason: `Your usual ${DAYS[d.weekday]} time${busy ? ', after what is on your calendar' : ''}.`, basedOn: [row.key] });
    }
    sessions.sort((x, y) => (x.start < y.start ? -1 : 1));
    return { ok: true, sessions, summary: `${sessions.length} sessions at your usual times.` };
  });

  globalThis.checkWeek = entry(() => ({ ok: true, conflicts: [] }));
  globalThis.explainAction = entry((a) => (a.action ? { ok: true, text: a.action.reason, basedOn: a.action.basedOn } : fail('BadInput', 'The call needs a session.')));
})();
