// The planner the phone calls: plan one sentence, or re-plan after a drag, an answer or a follow-up sentence.
// It only proposes. Nothing is saved here; the app shows the proposal and writes it after the person confirms.
import { MIN, H, D, MEALS, WINDOW, AWAKE_END, DAYS, iso, ms, dur, dayStart, ceilTo, minOfDay, isFree, greedyFinder, cascade, shiftConfirmed } from './core.mjs';
import { makeZone } from './time.mjs';
import { ACTIVITIES, normalizeActivity, read, clock } from './fitness.mjs';
import { fromIntent } from './intent.mjs';
import { fail } from './errors.mjs';

const RACE_RUNS = [[90, 45, 30], [75, 40, 30], [60, 30, 20], [45, 30, 20]];
const RACE_NAMES = [['Last long run', 'long_run'], ['Easy run', 'run'], ['Easy run', 'run']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const join = (xs) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
const overlap = (a, b) => ms(a.start) < ms(b.end) && ms(a.end) > ms(b.start);
const live = (blocks) => blocks.filter((b) => !b.cancelled && !b.allDay);
const dayOf = (b) => dayStart(ms(b.start));
const weekday = (t) => cap(DAYS[(new Date(t).getUTCDay() + 6) % 7]);
const at = (t) => clock(minOfDay(t));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- the world: the host's input in wall time ----
function world(input) {
  if (!input || typeof input !== 'object') throw fail('BadInput');
  const z = makeZone(input), nowMs = z.nowWall;
  const span = (x) => {
    const start = z.wall(x?.start), minutes = Number(x?.minutes);
    const end = z.wall(x?.end) ?? (start && minutes > 0 ? iso(ms(start) + minutes * MIN) : null);
    return start && end && ms(end) > ms(start) ? { start, end } : null;
  };
  const events = [], blocks = [];
  for (const e of Array.isArray(input.events) ? input.events : []) {
    const s = span(e);
    if (s) events.push({ id: String(e.id), title: String(e.title ?? 'Event'), ...s });
  }
  for (const x of Array.isArray(input.workouts) ? input.workouts : []) {
    const s = span(x);
    if (!s) continue;
    const activity = normalizeActivity(x.activity, x.title ?? '');
    if (!activity) throw fail('BadActivity', `A workout has an activity I do not know: ${String(x.activity).slice(0, 40)}.`);
    blocks.push({ id: String(x.id), title: String(x.title ?? ACTIVITIES[activity].title), activity, ...s, was: s, ...(x.group ? { group: String(x.group) } : {}), ...(x.sessionId ? { sessionId: String(x.sessionId) } : {}), ...(activity === 'rest' ? { allDay: true } : {}) });
  }
  // The person's usual times: memory rows of kind usual_slot, as { key, activity, weekday (0-6, Monday 0), hour, minutes }. The key is never read.
  const usual = [];
  for (const raw of Array.isArray(input.memory?.slots) ? input.memory.slots : []) {
    const ok = raw && Object.hasOwn(ACTIVITIES, raw.activity) && Number.isInteger(raw.weekday) && raw.weekday >= 0 && raw.weekday <= 6 && Number.isInteger(raw.hour) && raw.hour >= 0 && raw.hour <= 23;
    if (ok) usual.push({ activity: raw.activity, dow: raw.weekday, hour: raw.hour });
  }
  usual.sort((a, b) => a.hour - b.hour);
  const declined = (Array.isArray(input.memory?.declined) ? input.memory.declined : []).map(String);
  const today = dayStart(nowMs), p = Number(input.memory?.paceMinPerKm), pace = p >= 2 && p <= 20 ? p : null;
  const dayWord = (t) => { const n = (dayStart(t) - today) / D; return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 && n < 7 ? weekday(t) : `${weekday(t)} ${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()}`; };
  const onDay = (t) => (/^to/.test(dayWord(t)) ? dayWord(t) : `on ${dayWord(t)}`);
  return { z, nowMs, today, from: ceilTo(nowMs), events, blocks, usual, declined, pace, now: input.now, dayWord, onDay };
}

// Puts the earlier proposal back on top of the workouts, so a re-plan starts from what the person is looking at.
function restore(w, plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.proposed)) throw fail('BadPlan');
  const blocks = w.blocks.map((b) => ({ ...b }));
  for (const p of plan.proposed) {
    const start = w.z.wall(p?.start), end = w.z.wall(p?.end);
    if (!start || !end) continue;
    if (p.status === 'new') blocks.push({ id: String(p.id), title: String(p.title), activity: String(p.activity), start, end, isNew: true, reason: p.reason, ...(p.sessionId ? { sessionId: String(p.sessionId) } : {}), ...(p.activity === 'rest' ? { allDay: true } : {}) });
    else {
      const b = blocks.find((x) => x.id === String(p.id));
      if (b) Object.assign(b, { start, end, reason: p.reason, ...(p.status === 'cancelled' ? { cancelled: true } : {}) });
    }
  }
  const s = plan.state && typeof plan.state === 'object' ? plan.state : {};
  const st = { kind: s.kind ?? 'none', primary: s.primary ?? null, pending: s.pending ?? null, declined: [...new Set([...(s.declined ?? []), ...w.declined])], chain: s.chain ?? null, limit: s.limit ?? null, race: s.race ?? null, awaiting: s.awaiting ?? null };
  return { blocks, st };
}

// ---- wording ----
function whenPhrase(w, s, hint, fellBack) {
  const word = w.dayWord(s), part = !fellBack && hint?.part && !hint.clockLabel ? hint.part : null;
  const evening = hint?.part === 'evening' && word === 'today' && !fellBack;
  const day = evening ? 'tonight' : part ? (word === 'today' ? `this ${part}` : word === 'tomorrow' ? `tomorrow ${part}` : `on ${word} ${part}`) : w.onDay(s);
  return [fellBack ? null : hint?.clockLabel ?? hint?.special, day].filter(Boolean).join(' ');
}
const range = (w, b) => (b.allDay ? w.dayWord(ms(b.start)) : `${w.dayWord(ms(b.start))}, ${at(ms(b.start))} to ${at(ms(b.end))}`);

// One sentence on why this slot: what was asked, and what is in the way just before it.
function explain(w, busy, s, length, hint, fellBack) {
  if (hint?.exact && !fellBack) return `Free ${whenPhrase(w, s, hint, false)}, as you asked.`;
  const head = `${fellBack ? 'Next' : 'First'} free ${length / MIN} minutes ${whenPhrase(w, s, hint, fellBack)}`;
  const before = [...w.events, ...live(busy)].find((x) => ms(x.end) === s);
  if (before) return `${head}; your ${before.title} ends at ${at(s)}.`;
  const meal = hint?.meals !== false && MEALS.find((m) => m[1] === minOfDay(s));
  return meal ? `${head}; kept clear of ${meal[2]}.` : `${head}.`;
}

// ---- finding a slot ----
// -> { s, why, note } or null. Order: the person's usual time (only when no time was asked for), the asked time, then the next free time.
function place(w, solver, busy, length, hint, activity) {
  const o = { events: w.events, blocks: busy };
  if (!hint.timed && !hint.past) {
    const mine = w.usual.filter((u) => u.activity === activity || (activity === 'long_run' && u.activity === 'run'));
    const first = hint.day ?? w.today, days = hint.day !== null ? hint.span : 7;
    for (let d = first; mine.length && d < first + days * D; d += D) for (const u of mine) {
      const s = d + u.hour * H;
      if (u.dow === (new Date(d).getUTCDay() + 6) % 7 && s >= w.from && isFree(s, s + length, { ...o, meals: false })) return { s, why: `Your usual ${weekday(s)} ${at(s)} time for a ${ACTIVITIES[activity].noun} is free.`, note: null };
    }
  }
  let s = null;
  if (hint.any && !hint.past) {
    const first = hint.day ?? w.today, limit = first + (hint.day !== null ? hint.span : 7) * D;
    const window = hint.timed ? [hint.lo, hint.hi + (hint.pad ? length / MIN : 0)] : WINDOW;
    s = solver.finder(Math.max(w.from, first), length, { ...o, window, limit, meals: hint.meals });
    if (s !== null) return { s, why: explain(w, busy, s, length, hint, false), note: null };
  }
  // An asked time that is taken: the next free time after it, then after that day's start, then any time.
  if (hint.timed && !hint.past) s = solver.finder(Math.max(w.from, (hint.day ?? w.today) + hint.lo * MIN), length, o);
  s ??= solver.finder(Math.max(w.from, hint.day ?? w.from), length, o) ?? solver.finder(w.from, length, o);
  if (s === null) return null;
  const note = hint.past ? 'That day has already passed, so I picked the next free time.' : hint.any ? 'Nothing fits at that time, so I picked the next free time.' : null;
  return { s, why: explain(w, busy, s, length, hint, hint.any), note };
}

// ---- related items ----
// Linked for sure: workouts the app gave the same `group` (a break-in run for new shoes, a session with a booked pass).
// A hint only: a strength session that now lands on the day of a long run or the day before it. Both are asked, never assumed.
function related(before, after, id, declined) {
  const me0 = before.find((b) => b.id === id), me1 = after.find((b) => b.id === id), out = [];
  const near = (a, b) => { const hard = a.activity === 'strength' ? [a, b] : [b, a], gap = (dayOf(hard[1]) - dayOf(hard[0])) / D; return gap === 0 || gap === 1; };
  for (const b of live(after)) {
    if (b.id === id || declined.includes(b.id)) continue;
    const pair = (me1.activity === 'strength' && b.activity === 'long_run') || (me1.activity === 'long_run' && b.activity === 'strength');
    if (me1.group && b.group === me1.group) out.push({ id: b.id, linked: true });
    else if (pair && near(me1, b) && !near(me0, b)) out.push({ id: b.id, linked: false });
  }
  return out.sort((a, b) => ms(after.find((x) => x.id === a.id).start) - ms(after.find((x) => x.id === b.id).start));
}

function question(blocks, pend) {
  const title = (id) => blocks.find((b) => b.id === id)?.title ?? 'that workout', items = pend.items;
  const names = join([title(pend.blockId), ...items.map(title)]);
  const text = pend.linked ? `${names} are part of the same plan. Move them together?` : `${title(pend.blockId)} now lands next to ${join(items.map(title))}. Move them together?`;
  const answers = items.length === 1
    ? [{ id: 'all', label: `Yes, move ${title(items[0])} too` }, { id: 'none', label: 'No, just this one' }]
    : [{ id: 'all', label: 'Move all' }, { id: `only:${items[0]}`, label: `Only ${title(items[0])}` }, { id: 'none', label: 'No, just this one' }];
  return { text, answers };
}

// ---- changes ----
// After one block changed: blocks it now covers move to the next free time after it, and the steps that follow it in a
// race plan keep their order. Everything else stays where it is.
function settle(w, st, blocks, id, notes) {
  const me = blocks.find((b) => b.id === id), chain = st.chain ?? [], i = chain.indexOf(id);
  const exists = (x) => blocks.some((b) => b.id === x && !b.cancelled);
  const followers = i >= 0 ? chain.slice(i + 1).filter(exists) : [];
  const clash = live(blocks).filter((b) => b.id !== id && !followers.includes(b.id) && overlap(b, me)).sort((a, b) => ms(a.start) - ms(b.start)).map((b) => b.id);
  if (!followers.length && !clash.length) return blocks;
  const r = cascade(live(blocks), [id, ...clash, ...followers], { events: w.events, limit: i >= 0 && st.limit ? ms(st.limit) : Infinity, chained: new Set(followers) });
  const placed = new Map(r.blocks.map((b) => [b.id, b]));
  if (r.unplaced.length) notes.push(`There is no room for ${join(r.unplaced.map((x) => blocks.find((b) => b.id === x).title))} after this change.`);
  return blocks.filter((b) => !(r.unplaced.includes(b.id) && b.isNew)).map((b) => {
    const p = placed.get(b.id);
    if (!p?.moved) return b;
    const { moved, ...rest } = p;
    return { ...rest, reason: followers.includes(b.id) ? `Moved to stay after ${me.title}.` : `Moved to make room for ${me.title}.` };
  });
}

function applyMove(w, st, blocks, id, s, why, notes) {
  const me = blocks.find((b) => b.id === id), delta = s - ms(me.start);
  const again = st.pending?.blockId === id ? st.pending : null;
  if (st.pending && !again) st.declined = [...new Set([...st.declined, st.pending.blockId, ...st.pending.items])];
  st.pending = null;
  const moved = blocks.map((b) => (b.id === id ? { ...b, start: iso(s), end: iso(s + dur(b)), reason: why } : b));
  const next = settle(w, st, moved, id, notes);
  const settled = new Set(next.filter((b) => b.id !== id && b.start !== moved.find((x) => x.id === b.id).start).map((b) => b.id));
  const rel = again ? again.items.map((x) => ({ id: x, linked: again.linked })) : related(blocks, next, id, st.declined).filter((r) => !settled.has(r.id));
  if (rel.length && (delta || again)) st.pending = { blockId: id, delta: delta + (again?.delta ?? 0), items: rel.map((r) => r.id), linked: rel.every((r) => r.linked) };
  st.primary = id;
  return next;
}

function doAdd(w, st, blocks, intent, solver, notes) {
  const n = blocks.filter((b) => /^new-\d+$/.test(b.id)).reduce((m, b) => Math.max(m, +b.id.slice(4)), 0) + 1, id = `new-${n}`;
  if (intent.activity === 'rest') {
    const day = Math.max(intent.hint.day ?? w.today, w.today), same = live(blocks).filter((b) => dayOf(b) === day);
    if (same.length) notes.push(`You still have ${join(same.map((b) => b.title))} that day; say "skip" to drop it.`);
    st.primary = id;
    return { blocks: [...blocks, { id, title: intent.title ?? 'Rest day', activity: 'rest', start: iso(day), end: iso(day + D), allDay: true, isNew: true, reason: 'A full day with no workout.', ...(intent.sessionId ? { sessionId: intent.sessionId } : {}) }], message: `Rest day ${w.dayWord(day)}.` };
  }
  const found = place(w, solver, blocks, intent.minutes * MIN, intent.hint, intent.activity);
  if (!found) return { blocks, message: 'I could not find free time in the next 30 days.' };
  if (found.note) notes.push(found.note);
  const b = { id, title: intent.title, activity: intent.activity, start: iso(found.s), end: iso(found.s + intent.minutes * MIN), isNew: true, reason: found.why, ...(intent.sessionId ? { sessionId: intent.sessionId } : {}) };
  st.primary = id;
  return { blocks: [...blocks, b], message: `${b.title} ${range(w, b)}.` };
}

function doMove(w, st, blocks, intent, solver, notes) {
  const me = blocks.find((b) => b.id === intent.target), length = dur(me), others = blocks.filter((b) => b.id !== me.id);
  const o = { events: w.events, blocks: others }, s0 = ms(me.start), day = Math.max(dayOf(me), w.today), hint = { ...intent.hint };
  const open = (s) => s >= w.from && isFree(s, s + length, { ...o, meals: false });
  let s = null, why = null;
  if (intent.relative) {
    const want = s0 + intent.relative * MIN, size = Math.abs(intent.relative);
    const how = `${size % 1440 ? plural(size, 'minute') : plural(size / 1440, 'day')} ${intent.relative > 0 ? 'later' : 'earlier'}`;
    if (open(want)) { s = want; why = `${cap(how)}, as you asked.`; }
    else { s = solver.finder(Math.max(want, w.from), length, o); why = s === null ? null : `${cap(how)} is taken, so this is the next free time after it.`; }
  } else if (intent.soft) {
    const lo = minOfDay(s0), window = intent.soft === 'later' ? [Math.max(lo + 60, 540), WINDOW[1]] : [Math.max(WINDOW[0], lo - 180), lo];
    s = solver.finder(Math.max(w.from, day), length, { ...o, window, limit: day + D });
    if (s !== null) why = `First free ${length / MIN} minutes ${intent.soft} ${w.onDay(s)}.`;
    else {
      s = intent.soft === 'later' ? solver.finder(Math.max(ms(me.end), w.from), length, o) : null;
      if (s !== null) { why = `Next free ${length / MIN} minutes ${w.onDay(s)}.`; notes.push('Nothing later fits that day, so I picked the next free time.'); }
    }
  } else if (hint.any) {
    if (hint.day === null) { hint.day = day; hint.span = 1; }
    const same = hint.day + minOfDay(s0) * MIN;
    if (!hint.timed && hint.span === 1 && same !== s0 && open(same)) { s = same; why = `Same time ${w.onDay(s)}; that time is free.`; }
    else {
      const found = place({ ...w, usual: [] }, solver, others, length, hint, me.activity);
      if (found) { s = found.s; why = found.why; if (found.note) notes.push(found.note); }
    }
  } else {
    s = solver.finder(Math.max(ms(me.end), w.from), length, o);
    if (s !== null) why = `Next free ${length / MIN} minutes after the old time.`;
  }
  if (s === null) return { blocks, message: `I could not find another time for ${me.title}.` };
  if (s === s0) return { blocks, message: `${me.title} is already at that time.` };
  const next = applyMove(w, st, blocks, me.id, s, why, notes), now = next.find((b) => b.id === me.id);
  return { blocks: next, message: `${me.title} moves to ${range(w, now)}.` };
}

function doResize(w, st, blocks, intent, solver, notes) {
  const me = blocks.find((b) => b.id === intent.target), old = dur(me) / MIN;
  const minutes = Math.min(240, Math.max(10, Math.round((intent.minutes ?? old + intent.delta) / 5) * 5));
  if (minutes === old) return { blocks, message: `${me.title} is already ${old} minutes.` };
  const length = minutes * MIN, others = blocks.filter((b) => b.id !== me.id), day = dayOf(me);
  let s = ms(me.start), why = `Now ${minutes} minutes instead of ${old}; same start.`;
  if (!isFree(s, s + length, { events: w.events, meals: false })) {
    s = solver.finder(Math.max(w.from, day), length, { events: w.events, blocks: others, limit: day + D });
    if (s === null) return { blocks, message: `There is no room to make ${me.title} ${minutes} minutes ${w.onDay(day)}.` };
    why = `Now ${minutes} minutes instead of ${old}; moved to ${at(s)} so it fits.`;
  }
  const sized = blocks.map((b) => (b.id === me.id ? { ...b, start: iso(s), end: iso(s + length), reason: why } : b));
  st.primary = me.id;
  return { blocks: settle(w, st, sized, me.id, notes), message: `${me.title} ${w.dayWord(s)} is now ${minutes} minutes.` };
}

function doCancel(w, st, blocks, intent) {
  const me = blocks.find((b) => b.id === intent.target);
  st.primary = null;
  if (st.pending && (st.pending.blockId === me.id || st.pending.items.includes(me.id))) st.pending = null;
  if (me.isNew) return { blocks: blocks.filter((b) => b.id !== me.id), message: `Okay, ${me.title} is off the plan.` };
  const next = blocks.map((b) => (b.id === me.id ? { ...b, start: b.was.start, end: b.was.end, cancelled: true, reason: 'Skipped; nothing else moves.' } : b));
  return { blocks: next, message: `${me.title} ${w.dayWord(ms(me.was.start))} is skipped.` };
}

// Race back-planning with the deadline machinery: a last long run, two easy runs, each on its own day, then a rest day.
function doRace(w, st, blocks, intent, solver, notes) {
  const keep = blocks.filter((b) => !/^race-/.test(b.id));
  if (intent.day === null) {
    st.awaiting = 'race';
    return { blocks: keep, message: 'When is your race?', ask: { text: 'When is your race?', answers: [] } };
  }
  const race = intent.day, rest = race - D, name = `${weekday(race)} ${MONTHS[new Date(race).getUTCMonth()]} ${new Date(race).getUTCDate()}`;
  Object.assign(st, { awaiting: null, pending: null, chain: [], limit: iso(rest), race: iso(race), primary: null });
  const plan = { deadline: rest, from: race - 8 * D, variants: RACE_RUNS, apart: true };
  const placed = rest > w.from ? solver.steps(plan, { events: w.events, blocks: live(keep), now: iso(w.nowMs) }) : [];
  const out = [...keep];
  for (const [i, p] of placed.entries()) {
    const days = (race - dayStart(p.s)) / D, [title, activity] = RACE_NAMES[i];
    out.push({ id: `race-${i + 1}`, title, activity, start: iso(p.s), end: iso(p.s + p.minutes * MIN), isNew: true, reason: `${i ? 'Easy run to stay fresh' : 'Last long run'}, ${plural(days, 'day')} before the race.` });
    st.chain.push(`race-${i + 1}`);
  }
  if (rest >= w.today) out.push({ id: 'race-rest', title: 'Rest day', activity: 'rest', start: iso(rest), end: iso(race), allDay: true, isNew: true, reason: `Rest the day before the race on ${name}.` });
  if (placed.length < RACE_NAMES.length) notes.push(placed.length ? `Only ${placed.length} of ${RACE_NAMES.length} runs fit before the race.` : 'There is no time left for a run before the race.');
  else if (placed.some((p, i) => p.minutes !== RACE_RUNS[0][i])) notes.push('Time is tight, so I shortened the runs.');
  return { blocks: out, message: `Race on ${name}: ${plural(placed.length, 'run')}${rest >= w.today ? ' and a rest day the day before' : ''}.` };
}

function doDrag(w, st, blocks, change, notes) {
  const me = blocks.find((b) => b.id === String(change.id ?? change.blockId)), raw = ms(w.z.wall(change.start) ?? '');
  if (!me || me.cancelled) return { blocks, message: 'That item is not part of this plan.' };
  if (!Number.isFinite(raw)) throw fail('BadChange');
  if (me.allDay) {
    const day = dayStart(raw);
    return { blocks: blocks.map((b) => (b.id === me.id ? { ...b, start: iso(day), end: iso(day + D), reason: 'Moved by you.' } : b)), message: `${me.title} moves to ${w.dayWord(day)}.` };
  }
  const length = dur(me), want = Math.round(raw / (15 * MIN)) * 15 * MIN;
  const inChain = (st.chain ?? []).includes(me.id), limit = inChain && st.limit ? ms(st.limit) : Infinity;
  if (want + length > limit) return { blocks, message: `${me.title} has to end before the rest day.` };
  let s = want, why = 'Moved by you.';
  if (!isFree(s, s + length, { events: w.events, meals: false })) {
    const hit = w.events.find((e) => s < ms(e.end) && s + length > ms(e.start));
    s = greedyFinder(want, length, { events: w.events, meals: false, window: [WINDOW[0], AWAKE_END], limit: Math.min(limit, want + 30 * D) });
    if (s === null) return { blocks, message: `There is no free time there for ${me.title}.` };
    why = `${hit.title} is at that time, so this is the next free time after it.`;
  }
  const next = applyMove(w, st, blocks, me.id, s, why, notes), now = next.find((b) => b.id === me.id);
  return { blocks: next, message: `${me.title} moves to ${range(w, now)}.` };
}

function doAnswer(w, st, blocks, change) {
  const pend = st.pending, id = String(change.answerId ?? change.id ?? '');
  if (!pend) return { blocks, message: 'There is no open question.' };
  const ok = id === 'all' ? pend.items : pend.items.filter((x) => id === `only:${x}`);
  if (!ok.length && id !== 'none') throw fail('BadChange');
  st.pending = null;
  st.declined = [...new Set([...st.declined, ...(ok.length ? pend.items.filter((x) => !ok.includes(x)) : [pend.blockId, ...pend.items])])];
  if (!ok.length) return { blocks, message: 'Okay, I left the other workouts where they are.' };
  const me = blocks.find((b) => b.id === pend.blockId), rest = blocks.filter((b) => b.cancelled || b.allDay);
  const shifted = shiftConfirmed(live(blocks), pend, ok, w.events).map(({ moved, ...b }) => (moved ? { ...b, reason: `Moved together with ${me.title}, as you confirmed.` } : b));
  const by = new Map([...shifted, ...rest].map((b) => [b.id, b]));
  return { blocks: blocks.map((b) => by.get(b.id)), message: `${join(ok.map((x) => by.get(x).title))} ${ok.length > 1 ? 'move' : 'moves'} too.` };
}

// ---- the result the app gets ----
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function statusOf(b) {
  if (b.isNew) return 'new';
  if (b.cancelled) return 'cancelled';
  if (dur(b) !== ms(b.was.end) - ms(b.was.start)) return 'resized';
  return b.start !== b.was.start ? 'moved' : null;
}

function finish(w, st, blocks, kind, done, notes, replaces) {
  const proposed = [];
  for (const b of blocks) {
    const status = statusOf(b);
    if (status) proposed.push({ id: b.id, ...(b.sessionId ? { sessionId: b.sessionId } : {}), activity: b.activity, title: b.title, start: w.z.local(b.start), end: w.z.local(b.end), minutes: b.allDay ? 0 : dur(b) / MIN, status, reason: b.reason ?? 'Changed in this plan.' });
  }
  proposed.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1));
  const ask = st.pending ? question(blocks, st.pending) : done.ask ?? null;
  const message = [done.message, ...notes].filter(Boolean).join(' ');
  const state = { kind, primary: st.primary, pending: st.pending, declined: st.declined, chain: st.chain, limit: st.limit, race: st.race, awaiting: st.awaiting };
  const out = { ok: true, kind: ask ? 'question' : kind, message, proposed, ...(ask ? { question: ask } : {}), undoToken: `u-${hash(JSON.stringify([w.now, kind, proposed, ask]))}`, ...(replaces ? { replaces } : {}), state };
  const changed = new Set(proposed.map((p) => p.id));
  return { out, check: { blocks, events: w.events, deadline: st.limit ? ms(st.limit) : null, chain: st.chain ?? [], changed } };
}

function apply(w, st, blocks, intent, solver, notes) {
  switch (intent.kind) {
    case 'add': return doAdd(w, st, blocks, intent, solver, notes);
    case 'move': return doMove(w, st, blocks, intent, solver, notes);
    case 'resize': return doResize(w, st, blocks, intent, solver, notes);
    case 'cancel': return doCancel(w, st, blocks, intent);
    case 'race': return doRace(w, st, blocks, intent, solver, notes);
    default: return { blocks, message: intent.message };
  }
}
const reader = (w, st, blocks) => ({ nowMs: w.nowMs, blocks, primary: st.primary, awaiting: st.awaiting, onDay: w.onDay });
// A structured intent from the agent when there is one, else the rules reader on the sentence. Both feed the same planning code.
function understand(w, st, blocks, source, notes) {
  if (source.intent !== undefined && source.intent !== null) {
    const got = fromIntent(source.intent, { nowMs: w.nowMs, blocks, pace: w.pace, usual: w.usual });
    notes.push(...got.notes);
    return got.intent;
  }
  return read(source.text, reader(w, st, blocks));
}

export function planWith(input, solver) {
  const w = world(input);
  if (typeof input.request !== 'string' && (input.intent === undefined || input.intent === null)) throw fail('BadRequest');
  const st = { kind: 'none', primary: null, pending: null, declined: w.declined, chain: null, limit: null, race: null, awaiting: null }, early = [], notes = [];
  const intent = understand(w, st, w.blocks, { intent: input.intent, text: input.request }, early);
  const done = apply(w, st, w.blocks, intent, solver, notes);
  return finish(w, st, done.blocks, intent.kind, done, [...notes, ...early], null);
}

// change: { type: 'drag', id, start } | { type: 'answer', answerId } | { type: 'text', text } | { type: 'text', intent }
export function replanWith(input, solver) {
  const w = world(input), { blocks, st } = restore(w, input.plan), change = input.change, notes = [];
  if (!change || typeof change !== 'object') throw fail('BadChange');
  const isNew = (id) => blocks.some((b) => b.id === id && b.isNew), keeps = st.kind === 'add' || st.kind === 'race';
  let done, kind = st.kind;
  if (change.type === 'drag') {
    done = doDrag(w, st, blocks, change, notes);
    kind = keeps && isNew(String(change.id ?? change.blockId)) ? st.kind : 'move';
  } else if (change.type === 'answer') done = doAnswer(w, st, blocks, change);
  else if (change.type === 'text' && (typeof change.text === 'string' || (change.intent !== undefined && change.intent !== null))) {
    const intent = understand(w, st, blocks, change, notes);
    if (st.pending && intent.kind !== 'none' && intent.kind !== 'move') { st.declined = [...new Set([...st.declined, st.pending.blockId, ...st.pending.items])]; st.pending = null; }
    kind = intent.kind === 'none' || (keeps && intent.target && isNew(intent.target)) ? st.kind : intent.kind;
    done = apply(w, st, blocks, intent, solver, notes);
    if (intent.kind === 'none') { const r = finish(w, st, done.blocks, kind, done, notes, input.plan.undoToken ?? null); r.out.kind = 'none'; return r; }
  } else throw fail('BadChange');
  return finish(w, st, done.blocks, kind, done, notes, input.plan.undoToken ?? null);
}
