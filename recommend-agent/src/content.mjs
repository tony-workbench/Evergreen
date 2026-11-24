// What goes into a home session: which movements, how many sets and reps, how heavy the backpack is. Code builds it from the
// movement library (data/movements.json), the person's rules and what they did last time, and code checks anything a model
// proposes against the same library. A model may only name movements and numbers; every word the person reads about a
// movement comes from the library, so the same movement reads the same on every day.
//
// How a movement moves on (plan 4.2: more reps, then slower, then heavier, then the harder movement). A session "counts"
// when every set reached the top of the movement's range and the person didn't press "Too hard" on it: a history entry
// of such a session carries `tooHard: true` and never counts, whatever its numbers.
//   1. More reps: an item shows the movement's whole range, and the person climbs it.
//   2. Slower: after two sessions in a row that count, the next session carries `slow: true`: every rep's lowering phase
//      takes SLOW_EXTRA_SECONDS (2) seconds longer than the library's tempo. It stays until two slow sessions in a row
//      count; the history entry of a session done slow carries `slow: true`. A movement held for seconds skips it.
//   3. Heavier: once the slow step is behind it, a backpack movement gets LOAD_STEP_KG (1 kg) more after each session
//      that counts, up to LOAD_MAX_KG (12 kg). One session is enough for a kilogram (plan 5.C, the backpack).
//   4. Harder: the next movement up unlocks once the one before it has two sessions in a row that count (plan 5.C.1),
//      with its slow step behind it and, for a backpack movement, at least one heavier step taken. It never waits for
//      12 kg in the backpack.
// A movement the person left out or can't do is never a way up: the movement above it waits for the person's own "I can".
import library from '../data/movements.json' with { type: 'json' };
import { InputError } from './pytime.mjs';
import { readRules, ALWAYS_THERE } from './rules.mjs';
import { FOCUS, FOCUS_WORDS } from './homeweek.mjs';

export const MOVEMENTS = library.movements;
const BY_ID = new Map(MOVEMENTS.map((m) => [m.id, m]));
export const movementOf = (id) => BY_ID.get(id) ?? null;

export const MAIN_PATTERNS = ['lower_push', 'lower_pull', 'upper_push', 'upper_pull'];
export const WEEK_FLOOR_SETS = 4;          // every main pattern gets at least this many sets in a week
export const WEEK_TARGET_SETS = [8, 10];   // and aims for this many
export const MAX_NEW = 1;                  // at most one movement the person hasn't done yet, beyond each chain's first
export const SETUP_SECONDS = 30;           // getting into place for each movement
export const LOAD_STEP_KG = 1;             // one session that counts (after the slow step): one more litre of water
export const LOAD_MAX_KG = 12;             // what a backpack holds safely
export const SLOW_EXTRA_SECONDS = 2;       // the slow step: each rep's lowering phase takes this much longer
export const MAX_ITEMS = 5;
export const MIN_ITEMS = 4;                // a session holds 4 to 5 movements (plan 4.2), fewer only when no 4 fit (see fitTime)
export const MAX_SETS = 6;
export const MAX_PROPOSED_ITEMS = 8;       // a proposal longer than this is not read past it
export const MAX_SETS_ADDED = 24;          // a week adds at most this many sets while reaching for its floor and target
const IN_A_ROW = 2;                        // sessions in a row that count earn the next step
const REP_SECONDS = 3;                     // a rep of a movement with no tempo
const SECONDS_PER_MINUTE = 60;
const START_LOAD_KG = 2;                   // the backpack's start when the library names none
const REQUEST_MIN_MINUTES = 5;             // a session request outside these minutes is not read
const REQUEST_MAX_MINUTES = 120;
const PAIN_EASE_AT = 4;                    // pain at this or more last time: one set fewer
const UNCOUNTED_SETS = 99;                 // a pattern with no sets yet sorts as if it had plenty
const RANGE_LENGTH = 2;                    // a range is [low, high]
// Words that describe a feeling, not something the person can see or count. A movement's `pass` may use none of them.
export const FEELING_WORDS = ['feel', 'feeling', 'sense', 'burn', 'burning', 'ache', 'sore', 'warm', 'tight', 'pump', '感觉', '感受', '酸', '胀', '热'];
const ID = /^[a-z0-9_]{1,48}$/;

// The chains: each movement's root (the first one with no easier), so "the squat chain" is one thing.
const ROOT = new Map();
for (const m of MOVEMENTS) {
  let r = m;
  while (r.easier) r = BY_ID.get(r.easier);
  ROOT.set(m.id, r.id);
}
export const chainOf = (id) => ROOT.get(id) ?? null;

// The chains a session of each focus works, in order. A core chain is picked by turns so the week varies.
const CORE = ['dead_bug', 'bird_dog', 'kneeling_side_plank'];
const SLOTS = {
  full: ['sit_to_stand', 'wall_push_up', 'backpack_row', 'hip_hinge', 'core'],
  lower: ['sit_to_stand', 'hip_hinge', 'wall_split_squat', 'glute_bridge', 'core'],
  upper: ['wall_push_up', 'backpack_row', 'backpack_press', 'prone_arm_raise', 'core'],
  full_lower: ['sit_to_stand', 'hip_hinge', 'wall_split_squat', 'wall_push_up', 'backpack_row'],
  full_upper: ['wall_push_up', 'backpack_row', 'backpack_press', 'sit_to_stand', 'core'],
};
// The patterns each focus works, for the movements a model may choose from.
const FOCUS_PATTERNS = {
  full: [...MAIN_PATTERNS, 'core'], full_lower: [...MAIN_PATTERNS, 'core'], full_upper: [...MAIN_PATTERNS, 'core'],
  lower: ['lower_push', 'lower_pull', 'core'], upper: ['upper_push', 'upper_pull', 'core'],
};
// When a chain can't be used at all (no equipment for any of it, everything avoided), the next of these stands in.
const STAND_INS = {
  sit_to_stand: ['wall_split_squat', 'calf_raise'], hip_hinge: ['glute_bridge'], glute_bridge: ['hip_hinge'],
  wall_split_squat: ['sit_to_stand', 'calf_raise'], wall_push_up: ['backpack_press'], backpack_press: ['wall_push_up'],
  backpack_row: ['prone_arm_raise', 'backpack_curl'], prone_arm_raise: ['backpack_row', 'backpack_curl'],
};

// ---- What the person can use and has done --------------------------------------------------------------------------

function readHistory(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new InputError('bad_content');
  return raw.map(readEntry).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// One history entry: `slow` and `tooHard` are true only when the phone wrote true, as WorkoutLog.engineHistory does.
function readEntry(h) {
  if (!h || typeof h.movementId !== 'string' || !Array.isArray(h.sets) || !h.sets.every((n) => Number.isFinite(n) && n >= 0)) throw new InputError('bad_content');
  return { movementId: h.movementId, day: String(h.day ?? ''), sets: h.sets, load: Number.isFinite(h.load) ? h.load : null, slow: h.slow === true, tooHard: h.tooHard === true };
}

const owns = (rules, m) => m.equipment.every((e) => rules.equipment.includes(e) || ALWAYS_THERE.includes(e));
const top = (m) => (m.dose.reps ?? m.dose.seconds)[1];
const timesOf = (history, id) => history.filter((h) => h.movementId === id);
const atTop = (m, t) => t.sets.length >= m.dose.sets && t.sets.every((n) => n >= top(m));
/** A session that counts toward the next step: every set at the top, and "Too hard" not pressed. */
const counts = (m, t) => !t.tooHard && atTop(m, t);
const lastTwoCount = (m, times) => times.length >= IN_A_ROW && times.slice(-IN_A_ROW).every((t) => counts(m, t));
const countedLastTime = (history, m) => { const last = timesOf(history, m.id).at(-1); return Boolean(last) && counts(m, last); };

/** The last two sessions of this movement both count: every set at the top, "Too hard" not pressed. */
export function mastered(history, id) {
  return lastTwoCount(movementOf(id), timesOf(history, id));
}

// Where in a movement's own sessions the slow step was finished (the second of two slow sessions in a row that count), or -1.
function slowDoneAt(times, m) {
  for (let k = 1; k < times.length; k += 1) if (times[k - 1].slow && times[k].slow && counts(m, times[k - 1]) && counts(m, times[k])) return k;
  return -1;
}

/** The slow step is behind this movement: it has no tempo to slow, or two slow sessions in a row counted. */
export const slowStepDone = (history, m) => !m.tempo || slowDoneAt(timesOf(history, m.id), m) >= 0;

/** The next session of this movement is the slow step: two sessions in a row counted, or it is slow already and not done. */
export function nextIsSlow(history, m) {
  if (slowStepDone(history, m)) return false;
  const times = timesOf(history, m.id);
  return times.some((t) => t.slow) || lastTwoCount(m, times);
}

// The heavier step is behind a backpack movement: a session after the slow step carried more than the slow step did, or the
// slow step was already at what a backpack holds. A movement with no backpack has no heavier step.
function heavierStepDone(history, m) {
  if (!m.equipment.includes('backpack')) return true;
  const times = timesOf(history, m.id);
  const k = m.tempo ? slowDoneAt(times, m) : 0;
  if (k < 0 || !times.length) return false;
  const base = times[k].load ?? m.load ?? 0;
  return base >= LOAD_MAX_KG || times.slice(k + 1).some((t) => t.load !== null && t.load > base);
}

const doneBefore = (history, id) => history.some((h) => h.movementId === id);

/**
 * Why a movement can't be planned, or null. In order: not in the library, equipment the person doesn't have, on their avoid
 * list, marked "can't do", or not earned yet (its easier one isn't passed and the person hasn't said they can do it).
 */
export function blockOf(rules, history, id) {
  const m = movementOf(id);
  if (!m) return 'unknown_movement';
  if (!owns(rules, m)) return 'equipment_not_owned';
  if (rules.avoid.includes(id)) return 'avoided_movement';
  if (rules.movements[id] === 'cannot') return 'cannot_do';
  if (!earned(rules, history, m)) return 'gated_movement';
  return null;
}

// A chain's first usable movement needs nothing; later ones need the one before passed, or the person's "I can". When the
// one before needs equipment the person lacks, this one starts the chain, unless the library marks it `gated` (it needs
// balance, or is one many people can't do): a gated movement comes only after its easier one was really passed. When the
// one before is left out or marked "can't do", nothing above it is earned through it: its easier one stays in its place.
function earned(rules, history, m) {
  if (m.entry || rules.movements[m.id] === 'can' || doneBefore(history, m.id)) return true;
  const before = m.easier && movementOf(m.easier);
  if (!before) return true;
  if (excluded(rules, before)) return false;
  if (!owns(rules, before)) return !m.gated && earned(rules, history, before);
  return passed(history, before);
}

const excluded = (rules, m) => rules.avoid.includes(m.id) || rules.movements[m.id] === 'cannot';

// Two sessions in a row that count, after the slow step and, with a backpack, after at least one heavier step.
const passed = (history, m) => mastered(history, m.id) && slowStepDone(history, m) && heavierStepDone(history, m);

/** Can the person do any movement of this pattern now (owned, not avoided or "can't do", earned)? */
export const patternUsable = (rules, history, pattern) => MOVEMENTS.some((m) => m.pattern === pattern && blockOf(rules, history, m.id) === null);

/** Is it new to the person: not a chain's first, never done, not marked "can". */
const isNew = (rules, history, m) => !m.entry && !doneBefore(history, m.id) && rules.movements[m.id] !== 'can' && !(m.easier && !owns(rules, movementOf(m.easier)));

/**
 * The hardest movement in a chain the person can use now, or null. `person` is { rules, history } (a session request
 * serves); `allowNew` is false once the session has its one new movement.
 */
export function pickInChain(person, root, allowNew) {
  const { rules, history } = person;
  let pick = null;
  for (let m = movementOf(root); m; m = m.harder ? movementOf(m.harder) : null) {
    const block = blockOf(rules, history, m.id);
    if (block === 'equipment_not_owned') continue;
    if (block === 'gated_movement') break;
    // "Can't do" ends the chain: what comes after is harder. An avoided movement is only stepped over: the next one up
    // still needs its own "I can", or to have been done before (earned never passes through a movement left out).
    if (block === 'cannot_do') break;
    if (block) continue;
    if (isNew(rules, history, m) && !allowNew) break;
    pick = m;
    if (isNew(rules, history, m)) break;
  }
  return pick;
}

// ---- One session ---------------------------------------------------------------------------------------------------

const repSeconds = (m, slow) => (m.tempo ? m.tempo.down + m.tempo.hold + m.tempo.up + (slow ? SLOW_EXTRA_SECONDS : 0) : REP_SECONDS);

const topOf = ([, hi]) => hi;

/**
 * Seconds one item takes at worst: every set at the top of its range on each side (plan 4.2 counts reps x seconds per rep
 * + rests, and the top is the longest a session can run), the rests between sets, and getting set up.
 */
export function itemSeconds(item) {
  const m = movementOf(item.movementId);
  const work = item.reps ? topOf(item.reps) * repSeconds(m, item.slow === true) : topOf(item.seconds);
  return item.sets * work * m.sides + Math.max(0, item.sets - 1) * item.rest + SETUP_SECONDS;
}

export const sessionMinutes = (items) => Math.ceil(items.reduce((sum, i) => sum + itemSeconds(i), 0) / SECONDS_PER_MINUTE);

function lastLoad(history, id) {
  const times = history.filter((h) => h.movementId === id && h.load !== null);
  return times.length ? times[times.length - 1].load : null;
}

const LOAD_MIN_KG = 1;   // the lightest backpack load
const clampLoad = (kg) => Math.min(LOAD_MAX_KG, Math.max(LOAD_MIN_KG, kg));

// The backpack's kilograms: what the person set, else last time's, else the library's start. Last time counted (every set
// at the top, "Too hard" not pressed), with the slow step behind it: one more kilogram, up to what a backpack holds.
function loadFor(m, history, loads) {
  if (Number.isFinite(loads[m.id])) return clampLoad(loads[m.id]);
  const last = lastLoad(history, m.id);
  const up = last !== null && countedLastTime(history, m) && slowStepDone(history, m);
  return clampLoad((last ?? m.load ?? START_LOAD_KG) + (up ? LOAD_STEP_KG : 0));
}

// One movement dosed for the request's history and backpack loads, with `sets` sets.
function itemFor(req, m, sets) {
  const { history, loads } = req;
  const item = { movementId: m.id, sets, rest: m.rest, isNew: false };
  if (m.dose.reps) item.reps = [...m.dose.reps]; else item.seconds = [...m.dose.seconds];
  if (m.equipment.includes('backpack')) item.load = loadFor(m, history, loads);
  if (nextIsSlow(history, m)) item.slow = true;
  return item;
}

function readSessionRequest(a) {
  if (!a || typeof a !== 'object') throw new InputError('bad_content');
  const rules = readRules(a.rules ?? {});
  const focus = a.focus ?? 'full';
  if (!FOCUS.includes(focus)) throw new InputError('bad_content');
  const minutes = Number.isInteger(a.minutes) ? a.minutes : rules.session.max;
  if (minutes < REQUEST_MIN_MINUTES || minutes > REQUEST_MAX_MINUTES) throw new InputError('bad_content');
  const loads = a.loads && typeof a.loads === 'object' && !Array.isArray(a.loads) ? a.loads : {};
  return { rules, focus, minutes, loads, history: readHistory(a.history), turn: Number.isInteger(a.turn) ? a.turn : 0,
    easeOff: Number.isFinite(a.lastPain) && a.lastPain >= PAIN_EASE_AT, deload: a.deload === true, sessionId: typeof a.sessionId === 'string' ? a.sessionId : null };
}

// Pain at 4 or more last time, or a lighter week: one set fewer.
const EASE_SETS = 1;     // easing off drops this many sets
const sessionSets = (req, m) => (req.easeOff || req.deload ? Math.max(1, m.dose.sets - EASE_SETS) : m.dose.sets);
const sessionItem = (req, m) => ({ ...itemFor(req, m, sessionSets(req, m)), isNew: isNew(req.rules, req.history, m) });

// The movement for one slot: its own chain, or the first stand-in chain not used yet. `taken` is the session so far:
// { used: the chains it uses, items: its items }.
function pickForSlot(req, slot, taken) {
  const { used } = taken;
  for (const root of [slot, ...(STAND_INS[slot] ?? [])]) {
    if (used.has(root)) continue;
    const pick = pickInChain(req, root, allowsNew(taken.items));
    if (pick) { used.add(root); return pick; }
  }
  return null;
}

/** The items for one session, built by code: the focus's slots, then other chains up to MIN_ITEMS, fitted to the minutes. */
export function buildSession(req) {
  const slots = SLOTS[req.focus].map((s) => (s === 'core' ? CORE[req.turn % CORE.length] : s));
  const items = [];
  const used = new Set();
  for (const slot of slots) {
    const pick = pickForSlot(req, slot, { used, items });
    if (!pick || items.some((i) => i.movementId === pick.id)) continue;
    items.push(sessionItem(req, pick));
  }
  fillToFewest(req, items, used);
  fitTime(items, req.minutes);
  return items;
}

const allowsNew = (items) => items.filter((i) => i.isNew).length < MAX_NEW;

// The chains of the focus's patterns, main patterns first (in the focus's order), then core.
const chainsFor = (focus) => [...new Set(FOCUS_PATTERNS[focus].flatMap((p) => MOVEMENTS.filter((m) => m.pattern === p).map((m) => chainOf(m.id))))];

// Fewer than MIN_ITEMS after the slots (the equipment or the avoid list emptied some): any other chain of the focus's
// patterns the person can use goes in, so a session reaches four movements whenever the library allows it.
function fillToFewest(req, items, used) {
  for (const root of chainsFor(req.focus)) {
    if (items.length >= MIN_ITEMS) return;
    if (used.has(root)) continue;
    const pick = pickInChain(req, root, allowsNew(items));
    if (!pick) continue;
    used.add(root);
    items.push(sessionItem(req, pick));
  }
}

// Over the time: drop the last movement while more than MIN_ITEMS remain, then take sets off the longest. Only when every
// movement is down to one set and the session still runs over (a very short session: four movements of one set take about
// seven minutes) do movements below MIN_ITEMS go, the last first, so a session never runs past its minutes.
function fitTime(items, minutes) {
  dropOver(items, minutes, MIN_ITEMS);
  for (;;) {
    if (sessionMinutes(items) <= minutes) return;
    const longest = items.filter((i) => i.sets > 1).sort((a, b) => itemSeconds(b) - itemSeconds(a))[0];
    if (!longest) break;
    longest.sets -= 1;
  }
  dropOver(items, minutes, 1);
}

const dropOver = (items, minutes, fewest) => { while (sessionMinutes(items) > minutes && items.length > fewest) items.pop(); };

const contentOf = (req, items) => ({ sessionId: req.sessionId, focus: req.focus, minutes: sessionMinutes(items), items });

/**
 * workoutContent({ sessionId, focus, minutes?, rules, history?, loads?, turn?, lastPain?, deload? })
 *   -> { content: { sessionId, focus, minutes, items: [{ movementId, sets, reps | seconds, load?, rest, isNew, slow? }] } }
 */
export function workoutContent(a) {
  const req = readSessionRequest(a);
  return { content: contentOf(req, buildSession(req)) };
}

// ---- A week of sessions ---------------------------------------------------------------------------------------------

export const setsByPattern = (contents) => {
  const out = Object.fromEntries(MAIN_PATTERNS.map((p) => [p, 0]));
  for (const i of contents.flatMap((c) => c.items)) { const p = movementOf(i.movementId)?.pattern; if (p in out) out[p] += i.sets; }
  return out;
};

/**
 * weekContent({ sessions: [{ sessionId, focus }], rules, history?, loads?, deload? }) -> { contents, setsByPattern, target, note }
 * Each session as workoutContent builds it, then the week's sets per main pattern (plan 4.2 step 5): at least four, then
 * a set at a time toward eight while a session has the minutes for it, and never more than ten (a movement goes, or a set).
 * When the week can't reach eight, the note says how many sets it has.
 */
export function weekContent(a) {
  if (!a || !Array.isArray(a.sessions)) throw new InputError('bad_content');
  const reqs = a.sessions.map((s, turn) => readSessionRequest({ ...a, ...s, turn }));
  const contents = reqs.map((r) => contentOf(r, buildSession(r)));
  fillPatterns(contents, reqs);
  const sets = setsByPattern(contents);
  return { contents, setsByPattern: sets, target: WEEK_TARGET_SETS, note: weekNote(contents, reqs, sets) };
}

// A main pattern no session has gets a movement; then sets go where a pattern is below the floor, come off any pattern
// above the target's top, and go toward the target (not in a lighter week, whose sessions are one set short on purpose).
function fillPatterns(contents, reqs) {
  const week = { contents, reqs };
  for (const pattern of MAIN_PATTERNS) if (contents.length > 1 && setsByPattern(contents)[pattern] === 0) addItem(week, pattern);
  for (const pattern of MAIN_PATTERNS) raiseToFloor(week, pattern);
  for (const pattern of MAIN_PATTERNS) capPattern(contents, pattern);
  if (!reqs.some((r) => r.deload)) raiseToTarget(week);
}

// Sets of `pattern` added (or swapped in) one at a time until it has the floor's four, or nothing more works.
function raiseToFloor(week, pattern) {
  for (let guard = 0; guard < MAX_SETS_ADDED && setsByPattern(week.contents)[pattern] < WEEK_FLOOR_SETS; guard += 1) {
    if (!addSet(week, pattern, true)) return;
  }
}

// One set at a time to the pattern furthest below eight that a session has the minutes for, until none has.
function raiseToTarget(week) {
  for (let guard = 0; guard < MAX_SETS_ADDED; guard += 1) {
    const sets = setsByPattern(week.contents);
    const short = MAIN_PATTERNS.filter((p) => sets[p] > 0 && sets[p] < WEEK_TARGET_SETS[0]).sort((x, y) => sets[x] - sets[y]);
    if (!short.some((p) => addSet(week, p, false))) return;
  }
}

// Above ten sets of a pattern: a movement of it goes from a session that keeps four movements, when the pattern keeps
// eight; otherwise a set comes off its movement with the most sets.
function capPattern(contents, pattern) {
  for (let guard = 0; guard < MAX_SETS_ADDED; guard += 1) {
    const over = setsByPattern(contents)[pattern] - WEEK_TARGET_SETS[1];
    if (over <= 0 || !(dropItemOf(contents, pattern, over) || dropSetOf(contents, pattern))) return;
  }
}

function dropItemOf(contents, pattern, over) {
  const room = over + WEEK_TARGET_SETS[1] - WEEK_TARGET_SETS[0];
  const spot = contents.filter((c) => c.items.length > MIN_ITEMS)
    .flatMap((c) => c.items.filter((i) => patternOf(i) === pattern && i.sets <= room).map((i) => ({ c, i })))
    .sort((x, y) => y.i.sets - x.i.sets)[0];
  if (!spot) return false;
  spot.c.items = spot.c.items.filter((i) => i !== spot.i);
  spot.c.minutes = sessionMinutes(spot.c.items);
  return true;
}

// The set comes off the movement with the most sets, in the longest session when two have as many, so the week stays even.
function dropSetOf(contents, pattern) {
  const spot = contents.flatMap((c) => c.items.filter((i) => patternOf(i) === pattern && i.sets > 1).map((i) => ({ c, i })))
    .sort((x, y) => y.i.sets - x.i.sets || y.c.minutes - x.c.minutes)[0];
  if (!spot) return false;
  spot.i.sets -= 1;
  spot.c.minutes = sessionMinutes(spot.c.items);
  return true;
}

function weekNote(contents, reqs, sets) {
  if (!contents.length) return null;
  const none = MAIN_PATTERNS.filter((p) => sets[p] === 0 && !patternUsable(reqs[0].rules, reqs[0].history, p));
  const short = MAIN_PATTERNS.filter((p) => sets[p] < WEEK_TARGET_SETS[0] && !none.includes(p));
  const notes = [];
  if (short.length) notes.push(`This week has ${short.map((p) => `${sets[p]} sets of ${PATTERN_WORDS[p]}`).join(', ')}, below the ${WEEK_TARGET_SETS[0]} to ${WEEK_TARGET_SETS[1]} aimed for.`);
  if (none.length) notes.push(`No movement for ${none.map((p) => PATTERN_WORDS[p]).join(' or ')} fits your equipment and the movements you left out.`);
  return notes.length ? notes.join(' ') : null;
}

const patternOf = (item) => movementOf(item.movementId).pattern;
const withSets = (items, item, sets) => items.map((x) => (x === item ? { ...x, sets } : x));
const floorOf = (pattern) => (MAIN_PATTERNS.includes(pattern) ? WEEK_FLOOR_SETS : 0);

// One more set of `pattern` somewhere in the week: in the session with the most time left, or, with `swap` and when none
// has the time, in place of a set of the pattern furthest above the floor in the same session. Toward the target (no
// `swap`), a lighter session (pain last time) takes no extra set. `week` is { contents, reqs }. False when nothing works.
function addSet(week, pattern, swap) {
  const { contents, reqs } = week;
  const spots = contents.flatMap((c, k) => c.items.filter((i) => patternOf(i) === pattern && i.sets < MAX_SETS).map((i) => ({ c, k, i })))
    .filter(({ k }) => swap || !reqs[k].easeOff);
  const fits = spots.filter(({ c, k, i }) => sessionMinutes(withSets(c.items, i, i.sets + 1)) <= reqs[k].minutes)
    .sort((x, y) => x.c.minutes - y.c.minutes)[0];
  if (fits) { fits.i.sets += 1; fits.c.minutes = sessionMinutes(fits.c.items); return true; }
  return swap && spots.some((spot) => swapSet(week, spot));
}

// A set moves to `i` from another movement of the same session whose pattern stays at its floor, if the session still fits.
function swapSet({ contents, reqs }, { c, k, i }) {
  const sets = setsByPattern(contents);
  const donor = c.items.filter((d) => d !== i && d.sets > 1 && (sets[patternOf(d)] ?? 0) - 1 >= floorOf(patternOf(d)))
    .sort((a, b) => (sets[patternOf(b)] ?? UNCOUNTED_SETS) - (sets[patternOf(a)] ?? UNCOUNTED_SETS))[0];
  if (!donor) return false;
  const items = c.items.map((x) => (x === i ? { ...x, sets: x.sets + 1 } : x === donor ? { ...x, sets: x.sets - 1 } : x));
  if (sessionMinutes(items) > reqs[k].minutes) return false;
  i.sets += 1; donor.sets -= 1; c.minutes = sessionMinutes(c.items);
  return true;
}

// The chains that work each main pattern, in the order a week reaches for them when it has none of that pattern.
const PATTERN_ROOTS = {
  lower_push: ['sit_to_stand', 'wall_split_squat', 'calf_raise'], lower_pull: ['hip_hinge', 'glute_bridge'],
  upper_push: ['wall_push_up', 'backpack_press'], upper_pull: ['backpack_row', 'prone_arm_raise', 'backpack_curl'],
};

// A week whose sessions all lost the same pattern to the time limit (two short full-body sessions drop the hinge in both):
// put a movement of it into one session, after the others or in place of a movement of the pattern with the most sets,
// as long as that pattern keeps its floor and the session still fits. `week` is { contents, reqs }. False when nothing works.
function addItem(week, pattern) {
  const { contents, reqs } = week;
  const order = contents.map((c, k) => k).sort((x, y) => contents[x].minutes - contents[y].minutes);
  for (const k of order) {
    const item = itemOfPattern(contents[k], reqs[k], pattern);
    if (item && placeItem(week, k, item)) return true;
  }
  return false;
}

// A movement of `pattern` from a chain the session doesn't use yet, as code would dose it, or null.
function itemOfPattern(c, req, pattern) {
  const allowNew = c.items.filter((i) => i.isNew).length < MAX_NEW;
  const taken = new Set(c.items.map((i) => chainOf(i.movementId)));
  for (const root of PATTERN_ROOTS[pattern]) {
    if (taken.has(root)) continue;
    const pick = pickInChain(req, root, allowNew);
    if (pick) return sessionItem(req, pick);
  }
  return null;
}

// Session `k` of the week with `item` added, or swapped in for a movement whose pattern keeps its floor, trimmed of sets to fit.
function placeItem(week, k, item) {
  const { contents } = week;
  const [c, req] = [contents[k], week.reqs[k]];
  const counts = setsByPattern(contents);
  const swaps = c.items.filter((i) => counts[patternOf(i)] === undefined || counts[patternOf(i)] - i.sets >= WEEK_FLOOR_SETS)
    .sort((a, b) => (counts[patternOf(b)] ?? UNCOUNTED_SETS) - (counts[patternOf(a)] ?? UNCOUNTED_SETS));
  const tries = [[...c.items, item], ...swaps.map((out) => c.items.map((i) => (i === out ? item : i)))];
  for (const items of tries) {
    const fitted = trimToFit(items, item, req.minutes);
    if (!fitted) continue;
    c.items = fitted;
    c.minutes = sessionMinutes(fitted);
    return true;
  }
  return false;
}

// A copy of `items` with sets taken off the movements other than `keep` (never below one) until it fits, or null.
function trimToFit(items, keep, minutes) {
  if (items.length > MAX_ITEMS) return null;
  const fitted = items.map((i) => ({ ...i }));
  for (const i of fitted.filter((x) => x.movementId !== keep.movementId).sort((a, b) => b.sets - a.sets)) {
    while (i.sets > 1 && sessionMinutes(fitted) > minutes) i.sets -= 1;
  }
  return sessionMinutes(fitted) > minutes ? null : fitted;
}

export const PATTERN_WORDS = { lower_push: 'legs pushing', lower_pull: 'hips and the back of the legs', upper_push: 'upper-body pushing', upper_pull: 'upper-body pulling', core: 'the middle of the body', snack: 'short pieces' };

// ---- Checking content a model proposed -----------------------------------------------------------------------------

const validSets = (sets) => Number.isInteger(sets) && sets >= 1 && sets <= MAX_SETS;

/**
 * checkContent({ content, rules, history?, minutes?, focus?, week?, floor? }) -> { pass, violations: [{ code, text, movementId? }] }
 * Codes: unknown_movement, bad_dose, equipment_not_owned, avoided_movement, gated_movement, too_many_new, session_too_long,
 * item_count (with `focus`: fewer than four movements when four were possible, or more than five), sets_below_floor and
 * sets_above_target (with `week`, a list of the week's contents: a main pattern with fewer than four sets, when the person
 * can do any movement of it, or more than ten).
 */
export function checkContent(a) {
  if (!a || !a.content || !Array.isArray(a.content.items)) throw new InputError('bad_content');
  const rules = readRules(a.rules ?? {});
  const history = readHistory(a.history);
  const minutes = Number.isInteger(a.minutes) ? a.minutes : rules.session.max;
  const violations = [];
  const add = (code, text, movementId) => violations.push(movementId ? { code, text, movementId } : { code, text });
  const check = { rules, history, add };
  itemViolations(check, a.content.items);
  const length = sessionMinutes(timedItems(a.content.items));
  if (length > minutes) add('session_too_long', `The session takes about ${length} minutes; the person's sessions are at most ${minutes}.`);
  if (FOCUS.includes(a.focus)) countViolation(readSessionRequest({ ...a, minutes }), a.content.items.length, add);
  if (Array.isArray(a.week)) weekViolations(check, a.week, readFloor(a.floor));
  return { pass: violations.length === 0, violations };
}

// A session holds MIN_ITEMS to MAX_ITEMS movements; fewer only when code's own session for the same focus, rules, history
// and minutes can't reach MIN_ITEMS (too little equipment, too many movements left out, or too few minutes).
function countViolation(req, n, add) {
  const [lo, hi] = [fewestItems(req), MAX_ITEMS];
  if (n < lo || n > hi) add('item_count', `A session has ${lo} to ${hi} movements; this one has ${n}.`);
}

// `floor` ({ pattern: sets }) lowers a pattern's weekly floor below WEEK_FLOOR_SETS, never raises it: for a week whose own
// days can't reach four sets of a pattern, a model's week is held to what the rules' own week reaches.
function readFloor(raw) {
  const out = Object.fromEntries(MAIN_PATTERNS.map((p) => [p, WEEK_FLOOR_SETS]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const p of MAIN_PATTERNS) if (Number.isInteger(raw[p]) && raw[p] >= 0) out[p] = Math.min(WEEK_FLOOR_SETS, raw[p]);
  return out;
}

// `check` is { rules, history, add }: the person's rules and history, and where a violation goes.
function itemViolations(check, items) {
  const { rules, history, add } = check;
  let fresh = 0;
  for (const item of items) {
    const id = item && typeof item.movementId === 'string' ? item.movementId : null;
    const m = movementOf(id);
    if (!m) { add('unknown_movement', `${id && ID.test(id) ? id : 'A movement'} is not in the movement library.`, id && ID.test(id) ? id : undefined); continue; }
    if (!validSets(item.sets)) add('bad_dose', `${m.name} needs between 1 and ${MAX_SETS} sets.`, m.id);
    if (item.slow !== undefined && typeof item.slow !== 'boolean') add('bad_dose', `${m.name} is either slow or not.`, m.id);
    blockViolation(check, m);
    if (isNew(rules, history, m)) fresh += 1;
  }
  if (fresh > MAX_NEW) add('too_many_new', `The session has ${fresh} movements the person hasn't done yet; at most ${MAX_NEW}.`);
}

function blockViolation({ rules, history, add }, m) {
  const block = blockOf(rules, history, m.id);
  const before = m.easier && movementOf(m.easier);
  if (block === 'equipment_not_owned') add(block, `${m.name} needs ${m.equipment.join(' and ')}, which the person doesn't have.`, m.id);
  else if (block === 'avoided_movement' || block === 'cannot_do') add('avoided_movement', `${m.name} is on the person's list to leave out.`, m.id);
  else if (block === 'gated_movement') add(block, gateText(rules, m, before), m.id);
}

function gateText(rules, m, before) {
  if (excluded(rules, before)) return `${m.name} comes only with the person's own "I can": ${before.name}, the step before it, is left out.`;
  const heavier = before.equipment.includes('backpack') ? ' and one heavier backpack' : '';
  return `${m.name} comes only after ${before.name} has every set at the top of its range two sessions in a row, after its slower step${heavier}.`;
}

// The items that can be timed, with the library's rest and range where an item leaves them out.
function timedItems(items) {
  return items.filter((i) => movementOf(i?.movementId) && Number.isInteger(i.sets) && i.sets >= 1).map((i) => {
    const m = movementOf(i.movementId);
    return { ...i, rest: Number.isFinite(i.rest) ? i.rest : m.rest, reps: i.reps ?? m.dose.reps, seconds: i.seconds ?? m.dose.seconds };
  });
}

// A pattern no movement of which fits the person's rules (equipment, avoid list, "can't do") can't be asked of the week.
// Above ten sets of a pattern is too many in any week (plan 4.2 step 5: 8 to 10).
function weekViolations({ rules, history, add }, week, floor) {
  const sets = setsByPattern(week.filter((c) => c && Array.isArray(c.items)));
  for (const p of MAIN_PATTERNS) {
    if (sets[p] < floor[p] && patternUsable(rules, history, p)) add('sets_below_floor', `The week has ${sets[p]} sets of ${PATTERN_WORDS[p]}; at least ${floor[p]}.`);
    if (sets[p] > WEEK_TARGET_SETS[1]) add('sets_above_target', `The week has ${sets[p]} sets of ${PATTERN_WORDS[p]}; at most ${WEEK_TARGET_SETS[1]}.`);
  }
}

// ---- What a model may choose from, and its proposal made into content ---------------------------------------------

// Code's own session reaches MIN_ITEMS whenever the library, the equipment and the minutes allow (buildSession fills to it
// and drops below it only when even one set of each doesn't fit), so this is honest: fewer than four is refused when four were possible.
const fewestItems = (req) => Math.max(1, Math.min(MIN_ITEMS, buildSession(req).length));
const doseKey = (m) => (m.dose.reps ? 'reps' : 'seconds');

function choiceOf(req, m) {
  const fresh = isNew(req.rules, req.history, m);
  return { id: m.id, name: m.name, pattern: m.pattern, level: m.level, isNew: fresh, dose: { sets: sessionSets(req, m), [doseKey(m)]: [...m.dose[doseKey(m)]] } };
}

// Each chain of the focus's patterns: the hardest movement the person may do today and, when that one is new, the one below.
function choicesFor(req) {
  const roots = [...new Set(MOVEMENTS.filter((m) => FOCUS_PATTERNS[req.focus].includes(m.pattern)).map((m) => chainOf(m.id)))];
  const out = [];
  for (const root of roots) {
    const pick = pickInChain(req, root, true);
    if (!pick) continue;
    out.push(choiceOf(req, pick));
    const known = isNew(req.rules, req.history, pick) ? pickInChain(req, root, false) : null;
    if (known) out.push(choiceOf(req, known));
  }
  return out;
}

function briefLines(req, target) {
  const [lo, hi] = target.items;
  const lines = [
    `Choose ${lo} to ${hi} movements from the list for a ${FOCUS_WORDS[req.focus]} session, in the order to do them, and say why in one sentence.`,
    `The whole session, rests and getting set up included, takes at most ${target.minutes} minutes; code works out the time from the sets and reps.`,
    `At most ${MAX_NEW} of the movements may be one marked new.`,
    `Give each movement 1 to ${MAX_SETS} sets and, if you like, a range of reps or seconds inside its own; code sets the rest, the backpack's weight and the tempo.`,
    `Across the week every main pattern gets at least ${WEEK_FLOOR_SETS} sets, aiming for ${WEEK_TARGET_SETS[0]} to ${WEEK_TARGET_SETS[1]} and never more than ${WEEK_TARGET_SETS[1]}.`,
    'Answer with movement ids and numbers only: every word the person reads about a movement comes from the library.',
  ];
  if (req.deload || req.easeOff) lines.push('This session is lighter: the sets listed are already one fewer than usual.');
  return lines;
}

/**
 * contentBrief({ focus, rules, history?, loads?, minutes?, deload?, lastPain? }) -> { lines, choices, target }
 * The movements a model may choose from today (owned, not avoided, not "can't do", earned; a new one marked) and the
 * limits as plain sentences. No personal data and no calendar text.
 */
export function contentBrief(a) {
  const req = readSessionRequest(a);
  const target = { minutes: req.minutes, items: [fewestItems(req), MAX_ITEMS], maxNew: MAX_NEW, sets: [1, MAX_SETS], weekSets: { floor: WEEK_FLOOR_SETS, aim: WEEK_TARGET_SETS } };
  return { lines: briefLines(req, target), choices: choicesFor(req), target };
}

// A proposed range of reps or seconds: a whole-number pair inside the library's range, or the library's range when left out.
function doseOf(m, raw) {
  const key = doseKey(m);
  if (raw[key === 'reps' ? 'seconds' : 'reps'] !== undefined) return null;
  const range = m.dose[key];
  const v = raw[key] === undefined ? range : raw[key];
  const ok = Array.isArray(v) && v.length === RANGE_LENGTH && v.every(Number.isInteger) && v[0] <= v[1] && v[0] >= range[0] && v[1] <= range[1];
  return ok ? { [key]: [...v] } : null;
}

const rangeWords = (m) => `${m.dose[doseKey(m)].join(' to ')} ${doseKey(m)}`;

// One proposed item as content, or null with a violation: unknown or repeated movement, sets or range out of bounds.
// `reading` is { taken: the ids read so far, add: where a violation goes }.
function proposedItem(req, raw, reading) {
  const { taken, add } = reading;
  const id = raw && typeof raw === 'object' && typeof raw.movementId === 'string' ? raw.movementId : null;
  const m = movementOf(id);
  if (!m) { add('unknown_movement', 'A proposed movement is not in the movement library.', id && ID.test(id) ? id : undefined); return null; }
  if (taken.has(m.id)) { add('duplicate_movement', `${m.name} is in the proposal twice.`, m.id); return null; }
  const dose = doseOf(m, raw);
  if (!validSets(raw.sets) || !dose) { add('bad_dose', `${m.name} needs 1 to ${MAX_SETS} sets and at most ${rangeWords(m)}.`, m.id); return null; }
  taken.add(m.id);
  return { ...sessionItem(req, m), sets: raw.sets, ...dose };
}

function readProposal(req, proposal, add) {
  const list = proposal && typeof proposal === 'object' && Array.isArray(proposal.items) ? proposal.items : null;
  if (!list) { add('bad_proposal', 'The proposal has no list of movements.'); return []; }
  if (list.length > MAX_PROPOSED_ITEMS) { add('bad_proposal', `The proposal has ${list.length} movements; at most ${MAX_PROPOSED_ITEMS} are read.`); return []; }
  countViolation(req, list.length, add);
  const reading = { taken: new Set(), add };
  return list.map((raw) => proposedItem(req, raw, reading)).filter(Boolean);
}

// The week's contents with this session's in place of the one with the same id, or added.
const weekWith = (week, content) => (Array.isArray(week) ? [...week.filter((c) => !c || c.sessionId !== content.sessionId || content.sessionId === null), content] : undefined);

/**
 * proposedContent({ proposal: { items: [{ movementId, sets, reps?, seconds? }], reason? }, sessionId, focus, rules, history?,
 *   loads?, minutes?, week?, rulesWeek?, deload?, lastPain? }) -> { content, pass, violations: [{ code, text, movementId? }] }
 * `rulesWeek` is the week weekContent built for the same days: a pattern the rules' own week can't bring to four sets is
 * held to what it does reach, so a short week (one or two days at home) isn't refused for what no week of its days could do.
 * A model's proposal is untrusted: anything it gets wrong comes back as a violation, never a throw. Code fills rest, load,
 * isNew, slow and minutes as workoutContent would, then runs every checkContent check. `reason` never reaches the content.
 * Codes beyond checkContent's: bad_proposal, duplicate_movement; item_count counts the proposal's own list. Use `content`
 * only when `pass` is true.
 */
export function proposedContent(a) {
  const req = readSessionRequest(a);
  const violations = [];
  const add = (code, text, movementId) => violations.push(movementId ? { code, text, movementId } : { code, text });
  const content = contentOf(req, readProposal(req, a.proposal, add));
  const floor = Array.isArray(a.rulesWeek) ? setsByPattern(a.rulesWeek.filter((c) => c && Array.isArray(c.items))) : undefined;
  const checked = checkContent({ content, rules: a.rules ?? {}, history: a.history, minutes: req.minutes, week: weekWith(a.week, content), floor });
  const all = [...violations, ...checked.violations];
  return { content, pass: all.length === 0, violations: all };
}

/** movementLibrary({}) -> { movements } : the words for every movement, for the workout page. */
export const movementLibrary = () => ({ version: library.version, movements: MOVEMENTS });

/** For tests: a movement whose `pass` names a feeling rather than something seen or counted. */
export const feelingWordsIn = (text) => FEELING_WORDS.filter((w) => (/^[a-z]+$/.test(w) ? new RegExp(`\\b${w}\\b`, 'i').test(text) : text.includes(w)));

export { MOVEMENTS as LIBRARY };
