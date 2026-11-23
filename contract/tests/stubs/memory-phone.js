// A stand-in for memory-agent/dist/memory-phone.js that follows contract/AGENTS.md. It exists so the week test can be
// tested without the real bundles. It is a plain script: it sets the eight globals and keeps its state through memoryIO.
(() => {
  const USABLE = ['saved', 'confirmed'];
  const HEALTH = { Running: 'run', Walking: 'walk', Hiking: 'walk', Yoga: 'yoga', Cycling: 'ride', Swimming: 'swim', Elliptical: 'elliptical', TraditionalStrengthTraining: 'strength', FunctionalStrengthTraining: 'strength' };
  const GROUP = { usual_slot: 'routine', weekly_volume: 'routine', mix: 'routine', load: 'load', sleep: 'body', resting_hr: 'body', response: 'response', gear: 'gear', goal: 'goal' };
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const fail = (code, text) => ({ ok: false, error: { code, text } });
  const hash = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / 864e5;
  const dayText = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
  // What identifies a memory: a new version of the same thing replaces the old row.
  const slotOf = (kind, data) => (kind === 'usual_slot' ? `usual_slot/${data.activity}/${data.weekday}/${data.hour}` : kind === 'gear' ? `gear/${data.item}` : kind === 'response' ? `response/${data.about}` : kind);

  const io = () => globalThis.memoryIO;
  const file = (a) => `${a.root}/${a.user}.json`;
  const load = (a) => { try { return JSON.parse(io().readFile(file(a))); } catch { return { rows: [], evidence: [], next: 1 }; } };
  const save = (a, state) => {
    try { io().mkdir(a.root); } catch { /* it is there */ }
    try { io().remove(file(a)); } catch { /* first write */ }
    io().writeFile(file(a), JSON.stringify(state));
  };
  const entry = (fn) => (argsJson) => {
    let a;
    try { a = JSON.parse(argsJson); } catch { return JSON.stringify(fail('BadJSON', 'The arguments are not JSON.')); }
    if (!a || typeof a.root !== 'string' || typeof a.user !== 'string') return JSON.stringify(fail('BadInput', 'The call needs root and user.'));
    try { return JSON.stringify(fn(a)); } catch { return JSON.stringify(fail('Failed', 'Memory could not do that.')); }
  };

  function evidenceOf(snapshot, today) {
    const first = today - 28, out = [];
    const workouts = (snapshot.workouts ?? []).filter((w) => { const d = dayNumber(w.start.slice(0, 10)); return d >= first && d < today && w.durationMin >= 10 && HEALTH[w.activityType]; });
    const groups = new Map();
    for (const w of workouts) {
      const d = dayNumber(w.start.slice(0, 10)), key = `${w.activityType}/${(d + 3) % 7}/${Number(w.start.slice(11, 13))}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ week: Math.floor((d - first) / 7), minutes: w.durationMin });
    }
    for (const [key, list] of [...groups].sort()) {
      const [type, weekday, hour] = key.split('/'), weeks = new Set(list.map((x) => x.week)).size;
      if (weeks < 3) continue;
      const usual = median(list.map((x) => x.minutes)), activity = type === 'Running' && usual >= 90 ? 'long_run' : HEALTH[type];
      const data = { activity, weekday: +weekday, hour: +hour, minutes: Math.min(240, Math.max(5, Math.round(usual / 5) * 5)), weeksSeen: weeks, weeksTotal: 4 };
      out.push({ id: `slot.${type}.${weekday}.${hour}`, text: `${type} on ${DAYS[weekday]} at ${hour}:00 in ${weeks} of the last 4 weeks.`, numbers: { hour: +hour, weeks }, kind: 'usual_slot', data });
    }
    if (workouts.length) {
      const data = { workoutsPerWeek: workouts.length / 4, minutesPerWeek: Math.round(workouts.reduce((s, w) => s + w.durationMin, 0) / 4) };
      out.push({ id: 'volume.28d', text: `${data.workoutsPerWeek} workouts and ${data.minutesPerWeek} minutes a week over the last 4 weeks.`, numbers: data, kind: 'weekly_volume', data });
    }
    const days = (snapshot.dailySummaries ?? []).filter((d) => dayNumber(d.date) >= first && dayNumber(d.date) < today);
    const pair = (read, places) => {
      const all = days.map(read).filter((x) => x > 0), last = days.filter((d) => dayNumber(d.date) >= today - 7).map(read).filter((x) => x > 0);
      return all.length >= 3 && last.length >= 3 ? [round(mean(last), places), round(mean(all), places)] : null;
    };
    const sleep = pair((d) => (d.sleepMinutes?.totalAsleep ?? 0) / 60, 2), hr = pair((d) => d.restingHeartRate ?? 0, 1);
    if (sleep) out.push({ id: 'body.sleep', text: `Sleep averaged ${sleep[0]} hours over 7 days and ${sleep[1]} hours over 28 days.`, numbers: { hours7d: sleep[0], hours28d: sleep[1] }, kind: 'sleep', data: { hours7d: sleep[0], hours28d: sleep[1] } });
    if (hr) out.push({ id: 'body.resting_hr', text: `Resting heart rate averaged ${hr[0]} bpm over 7 days and ${hr[1]} bpm over 28 days.`, numbers: { bpm7d: hr[0], bpm28d: hr[1] }, kind: 'resting_hr', data: { bpm7d: hr[0], bpm28d: hr[1] } });
    return out;
  }

  globalThis.memoryDailyRequest = entry((a) => {
    if (typeof a.now !== 'string' || !a.snapshot) return fail('BadInput', 'The call needs now and snapshot.');
    const today = dayNumber(a.now.slice(0, 10)), evidence = evidenceOf(a.snapshot, today);
    for (const o of a.outcomes ?? []) evidence.push({ id: `outcome.${o.sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`, text: `The planned ${o.activity} on ${o.day} was ${o.done ? 'done' : 'missed'}.`, numbers: { done: o.done } });
    const state = load(a);
    state.evidence = evidence.map((e) => e.id);
    save(a, state);
    return { ok: true, day: dayText(today - 1), evidence };
  });

  globalThis.memoryDailyApply = entry((a) => {
    const state = load(a), applied = [], refused = [];
    for (const c of a.proposals?.proposals ?? []) {
      if (!GROUP[c.kind]) { refused.push({ reason: 'The proposal is not one memory can make.' }); continue; }
      if (!Array.isArray(c.evidenceIds) || !c.evidenceIds.length || !c.evidenceIds.every((id) => state.evidence.includes(id))) { refused.push({ reason: 'The proposal names evidence that was not given.' }); continue; }
      const slot = slotOf(c.kind, c.data), key = `mem:${hash(slot)}`, old = state.rows.find((r) => r.key === key);
      if (old?.state === 'rejected') { refused.push({ reason: 'The person rejected this memory.' }); continue; }
      const row = { memoryId: `m-${state.next++}`, key, slot, group: GROUP[c.kind], kind: c.kind, statement: c.statement, data: c.data, state: old?.state ?? 'saved', confidence: 0.8, since: old?.since ?? a.day, updated: a.day };
      state.rows = [...state.rows.filter((r) => r.key !== key), row];
      applied.push(key);
    }
    save(a, state);
    return { ok: true, applied, refused };
  });

  // The stand-in for the model: it proposes every piece of evidence that can be a memory, word for word.
  globalThis.memoryDemoModel = (requestJson) => {
    let request;
    try { request = JSON.parse(requestJson); } catch { return JSON.stringify(fail('BadJSON', 'The arguments are not JSON.')); }
    return JSON.stringify({ proposals: (request?.evidence ?? []).filter((e) => e.kind).map((e) => ({ kind: e.kind, statement: e.text, data: e.data, evidenceIds: [e.id] })) });
  };

  globalThis.memoryTable = entry((a) => ({ ok: true, rows: load(a).rows.filter((r) => USABLE.includes(r.state)) }));
  globalThis.memoryReviewQueue = entry((a) => ({ ok: true, rows: load(a).rows.filter((r) => r.state === 'candidate') }));
  const setState = (to) => entry((a) => {
    const state = load(a), row = state.rows.find((r) => r.key === a.key);
    if (!row) return fail('UnknownKey', 'There is no memory with that key.');
    row.state = to;
    save(a, state);
    return { ok: true };
  });
  globalThis.memoryReject = setState('rejected');
  globalThis.memoryRestore = setState('saved');
  globalThis.memoryConfirm = setState('confirmed');
})();
