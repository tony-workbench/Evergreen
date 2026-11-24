// What goes into a home session: which movements, how many sets and reps, how heavy the backpack is. Code builds it from the
// movement library (data/movements.json), the person's rules and what they did last time, and code checks anything a model
// proposes against the same library. A model may only name movements and numbers; every word the person reads about a
// movement comes from the library, so the same movement reads the same on every day.
//
// How a movement moves on, one step at a time, each step earned by a session with every set at the top of its range:
//   1. More reps: an item shows the movement's whole range, and the person climbs it. All sets at the top: reps can't go up.
//   2. Slower: the next session carries `slow: true`: every rep's lowering phase takes SLOW_EXTRA_SECONDS (2) seconds longer
//      than the library's tempo. It comes once per movement, stays until every set reaches the top at the slower tempo, and
//      the history entry of a session done slow carries `slow: true`. A movement held for seconds (no tempo) skips it.
//   3. Heavier: a backpack movement gets LOAD_STEP_KG (1 kg) more after each session with every set at the top, up to
//      LOAD_MAX_KG (12 kg).
//   4. Harder: the next movement up unlocks once the one before it had every set at the top in each of its last two
//      sessions, with its slow step done and, for a backpack movement, 12 kg in the backpack.
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
export const LOAD_STEP_KG = 1;             // every set at the top of the range once (after the slow step): one more litre of water
export const LOAD_MAX_KG = 12;             // what a backpack holds safely
export const SLOW_EXTRA_SECONDS = 2;       // the slow step: each rep's lowering phase takes this much longer
export const MAX_ITEMS = 5;
export const MIN_ITEMS = 3;
export const MAX_SETS = 6;
export const MAX_PROPOSED_ITEMS = 8;       // a proposal longer than this is not read past it
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
  return raw.map((h) => {
    if (!h || typeof h.movementId !== 'string' || !Array.isArray(h.sets) || !h.sets.every((n) => Number.isFinite(n) && n >= 0)) throw new InputError('bad_content');
    return { movementId: h.movementId, day: String(h.day ?? ''), sets: h.sets, load: Number.isFinite(h.load) ? h.load : null, slow: h.slow === true };
  }).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const owns = (rules, m) => m.equipment.every((e) => rules.equipment.includes(e) || ALWAYS_THERE.includes(e));
const top = (m) => (m.dose.reps ?? m.dose.seconds)[1];
const timesOf = (history, id) => history.filter((h) => h.movementId === id);
const atTop = (m, t) => t.sets.length >= m.dose.sets && t.sets.every((n) => n >= top(m));
const toppedLastTime = (history, m) => { const last = timesOf(history, m.id).at(-1); return Boolean(last) && atTop(m, last); };

/** Done every set at the top of the range in each of the last two times. */
export function mastered(history, id) {
  const m = movementOf(id);
  const times = timesOf(history, id).slice(-2);
  return times.length === 2 && times.every((t) => atTop(m, t));
}

/** The slow step is behind this movement: it has no tempo to slow, or a session done slow had every set at the top. */
export const slowStepDone = (history, m) => !m.tempo || timesOf(history, m.id).some((t) => t.slow && atTop(m, t));

/** The next session of this movement is the slow step: topped at the usual tempo, or slow last time and not topped yet. */
export function nextIsSlow(history, m) {
  if (slowStepDone(history, m)) return false;
  const last = timesOf(history, m.id).at(-1);
  return Boolean(last) && (last.slow || atTop(m, last));
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
// balance, or is one many people can't do): a gated movement comes only after its easier one was really passed.
function earned(rules, history, m) {
  if (m.entry || rules.movements[m.id] === 'can' || doneBefore(history, m.id)) return true;
  const before = m.easier && movementOf(m.easier);
  if (!before) return true;
  if (!owns(rules, before)) return !m.gated && earned(rules, history, before);
  return passed(history, before);
}

// Every set at the top twice in a row, the slow step done, and a backpack movement as heavy as a backpack gets.
const passed = (history, m) => mastered(history, m.id) && slowStepDone(history, m) && fullyLoaded(history, m);
const fullyLoaded = (history, m) => !m.equipment.includes('backpack') || (lastLoad(history, m.id) ?? 0) >= LOAD_MAX_KG;

/** Can the person do any movement of this pattern now (owned, not avoided or "can't do", earned)? */
export const patternUsable = (rules, history, pattern) => MOVEMENTS.some((m) => m.pattern === pattern && blockOf(rules, history, m.id) === null);

/** Is it new to the person: not a chain's first, never done, not marked "can". */
const isNew = (rules, history, m) => !m.entry && !doneBefore(history, m.id) && rules.movements[m.id] !== 'can' && !(m.easier && !owns(rules, movementOf(m.easier)));

/** The hardest movement in a chain the person can use now, or null. `allowNew` is false once the session has its one new movement. */
export function pickInChain(rules, history, root, allowNew) {
  let pick = null;
  for (let m = movementOf(root); m; m = m.harder ? movementOf(m.harder) : null) {
    const block = blockOf(rules, history, m.id);
    if (block === 'equipment_not_owned') continue;
    if (block === 'gated_movement') break;
    // "Can't do" ends the chain: what comes after is harder. An avoided movement is only stepped over: the next one up
    // still needs its own "I can", or this one done at the top of its range before.
    if (block) { if (block === 'cannot_do') break; continue; }
    if (isNew(rules, history, m) && !allowNew) break;
    pick = m;
    if (isNew(rules, history, m)) break;
  }
  return pick;
}

// ---- One session ---------------------------------------------------------------------------------------------------

const repSeconds = (m, slow) => (m.tempo ? m.tempo.down + m.tempo.hold + m.tempo.up + (slow ? SLOW_EXTRA_SECONDS : 0) : 3);

const middle = ([lo, hi]) => (lo + hi) / 2;

/** Seconds one item takes: every set at the middle of its range on each side, the rests between sets, and getting set up. */
export function itemSeconds(item) {
  const m = movementOf(item.movementId);
  const work = item.reps ? middle(item.reps) * repSeconds(m, item.slow === true) : middle(item.seconds);
  return item.sets * work * m.sides + Math.max(0, item.sets - 1) * item.rest + SETUP_SECONDS;
}

export const sessionMinutes = (items) => Math.ceil(items.reduce((sum, i) => sum + itemSeconds(i), 0) / 60);

function lastLoad(history, id) {
  const times = history.filter((h) => h.movementId === id && h.load !== null);
  return times.length ? times[times.length - 1].load : null;
}

const clampLoad = (kg) => Math.min(LOAD_MAX_KG, Math.max(1, kg));

// The backpack's kilograms: what the person set, else last time's, else the library's start. Every set at the top last
// time, with the slow step behind it: one more kilogram, up to what a backpack holds.
function loadFor(m, history, loads) {
  if (Number.isFinite(loads[m.id])) return clampLoad(loads[m.id]);
  const last = lastLoad(history, m.id);
  const up = last !== null && toppedLastTime(history, m) && slowStepDone(history, m);
  return clampLoad((last ?? m.load ?? 2) + (up ? LOAD_STEP_KG : 0));
}

function itemFor(m, history, loads, sets) {
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
  if (minutes < 5 || minutes > 120) throw new InputError('bad_content');
  const loads = a.loads && typeof a.loads === 'object' && !Array.isArray(a.loads) ? a.loads : {};
  return { rules, focus, minutes, loads, history: readHistory(a.history), turn: Number.isInteger(a.turn) ? a.turn : 0,
    easeOff: Number.isFinite(a.lastPain) && a.lastPain >= 4, deload: a.deload === true, sessionId: typeof a.sessionId === 'string' ? a.sessionId : null };
}

// Pain at 4 or more last time, or a lighter week: one set fewer.
const sessionSets = (req, m) => (req.easeOff || req.deload ? Math.max(1, m.dose.sets - 1) : m.dose.sets);
const sessionItem = (req, m) => ({ ...itemFor(m, req.history, req.loads, sessionSets(req, m)), isNew: isNew(req.rules, req.history, m) });

// The movement for one slot: its own chain, or the first stand-in chain not used yet.
function pickForSlot(req, slot, used, allowNew) {
  for (const root of [slot, ...(STAND_INS[slot] ?? [])]) {
    if (used.has(root)) continue;
    const pick = pickInChain(req.rules, req.history, root, allowNew);
    if (pick) { used.add(root); return pick; }
  }
  return null;
}

/** The items for one session, built by code. Fits the session's minutes by dropping the last items, then sets. */
export function buildSession(req) {
  const slots = SLOTS[req.focus].map((s) => (s === 'core' ? CORE[req.turn % CORE.length] : s));
  const items = [];
  const used = new Set();
  for (const slot of slots) {
    const pick = pickForSlot(req, slot, used, items.filter((i) => i.isNew).length < MAX_NEW);
    if (!pick || items.some((i) => i.movementId === pick.id)) continue;
    items.push(sessionItem(req, pick));
  }
  fitTime(items, req.minutes);
  return items;
}

// Over the time: drop the last movement while more than the fewest remain, then take a set off the longest one.
function fitTime(items, minutes) {
  while (sessionMinutes(items) > minutes && items.length > MIN_ITEMS) items.pop();
  while (sessionMinutes(items) > minutes) {
    const longest = items.filter((i) => i.sets > 1).sort((a, b) => itemSeconds(b) - itemSeconds(a))[0];
    if (!longest) break;
    longest.sets -= 1;
  }
}

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
  for (const c of contents) for (const i of c.items) { const p = movementOf(i.movementId)?.pattern; if (p in out) out[p] += i.sets; }
  return out;
};

/**
 * weekContent({ sessions: [{ sessionId, focus }], rules, history?, loads?, deload? }) -> { contents, setsByPattern, target, note }
 * Each session as workoutContent builds it, then a set added where a main pattern has fewer than four in the week, as long
 * as the session still fits. When the week can't reach the target, the note says how many sets it has.
 */
export function weekContent(a) {
  if (!a || !Array.isArray(a.sessions)) throw new InputError('bad_content');
  const reqs = a.sessions.map((s, turn) => readSessionRequest({ ...a, ...s, turn }));
  const contents = reqs.map((r) => contentOf(r, buildSession(r)));
  fillPatterns(contents, reqs);
  const sets = setsByPattern(contents);
  return { contents, setsByPattern: sets, target: WEEK_TARGET_SETS, note: weekNote(contents, reqs, sets) };
}

// A main pattern no session has gets a movement; then sets go where a pattern is below the floor.
function fillPatterns(contents, reqs) {
  for (const pattern of MAIN_PATTERNS) if (contents.length > 1 && setsByPattern(contents)[pattern] === 0) addItem(contents, reqs, pattern);
  for (const pattern of MAIN_PATTERNS) {
    for (let guard = 0; guard < 8 && setsByPattern(contents)[pattern] < WEEK_FLOOR_SETS; guard += 1) {
      if (!addSet(contents, reqs, pattern)) break;
    }
  }
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

// One more set of `pattern` somewhere in the week: in the session with the most time left, or, when none has the time,
// in place of a set of the pattern furthest above the floor in the same session. False when neither works.
function addSet(contents, reqs, pattern) {
  const spots = contents.flatMap((c, k) => c.items.filter((i) => patternOf(i) === pattern && i.sets < MAX_SETS).map((i) => ({ c, k, i })));
  const fits = spots.filter(({ c, k, i }) => sessionMinutes(withSets(c.items, i, i.sets + 1)) <= reqs[k].minutes)
    .sort((x, y) => x.c.minutes - y.c.minutes)[0];
  if (fits) { fits.i.sets += 1; fits.c.minutes = sessionMinutes(fits.c.items); return true; }
  return spots.some((spot) => swapSet(contents, reqs, spot));
}

// A set moves to `i` from another movement of the same session whose pattern stays at its floor, if the session still fits.
function swapSet(contents, reqs, { c, k, i }) {
  const sets = setsByPattern(contents);
  const donor = c.items.filter((d) => d !== i && d.sets > 1 && (sets[patternOf(d)] ?? 0) - 1 >= floorOf(patternOf(d)))
    .sort((a, b) => (sets[patternOf(b)] ?? 99) - (sets[patternOf(a)] ?? 99))[0];
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
// as long as that pattern keeps its floor and the session still fits. False when nothing works.
function addItem(contents, reqs, pattern) {
  const order = contents.map((c, k) => k).sort((x, y) => contents[x].minutes - contents[y].minutes);
  for (const k of order) {
    const item = itemOfPattern(contents[k], reqs[k], pattern);
    if (item && placeItem(contents, k, reqs[k], item)) return true;
  }
  return false;
}

// A movement of `pattern` from a chain the session doesn't use yet, as code would dose it, or null.
function itemOfPattern(c, req, pattern) {
  const allowNew = c.items.filter((i) => i.isNew).length < MAX_NEW;
  const taken = new Set(c.items.map((i) => chainOf(i.movementId)));
  for (const root of PATTERN_ROOTS[pattern]) {
    if (taken.has(root)) continue;
    const pick = pickInChain(req.rules, req.history, root, allowNew);
    if (pick) return sessionItem(req, pick);
  }
  return null;
}

// The session with `item` added, or swapped in for a movement whose pattern keeps its floor, trimmed of sets to fit.
function placeItem(contents, k, req, item) {
  const c = contents[k];
  const counts = setsByPattern(contents);
  const swaps = c.items.filter((i) => counts[patternOf(i)] === undefined || counts[patternOf(i)] - i.sets >= WEEK_FLOOR_SETS)
    .sort((a, b) => (counts[patternOf(b)] ?? 99) - (counts[patternOf(a)] ?? 99));
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
 * checkContent({ content, rules, history?, minutes?, week?, floor? }) -> { pass, violations: [{ code, text, movementId? }] }
 * Codes: unknown_movement, bad_dose, equipment_not_owned, avoided_movement, gated_movement, too_many_new, session_too_long,
 * sets_below_floor (with `week`, a list of the week's contents: a main pattern with fewer than four sets, when the person
 * can do any movement of it).
 */
export function checkContent(a) {
  if (!a || !a.content || !Array.isArray(a.content.items)) throw new InputError('bad_content');
  const rules = readRules(a.rules ?? {});
  const history = readHistory(a.history);
  const minutes = Number.isInteger(a.minutes) ? a.minutes : rules.session.max;
  const violations = [];
  const add = (code, text, movementId) => violations.push(movementId ? { code, text, movementId } : { code, text });
  itemViolations(a.content.items, rules, history, add);
  const length = sessionMinutes(timedItems(a.content.items));
  if (length > minutes) add('session_too_long', `The session takes about ${length} minutes; the person's sessions are at most ${minutes}.`);
  if (Array.isArray(a.week)) weekViolations(a.week, rules, history, add, readFloor(a.floor));
  return { pass: violations.length === 0, violations };
}

// `floor` ({ pattern: sets }) lowers a pattern's weekly floor below WEEK_FLOOR_SETS, never raises it: for a week whose own
// days can't reach four sets of a pattern, a model's week is held to what the rules' own week reaches.
function readFloor(raw) {
  const out = Object.fromEntries(MAIN_PATTERNS.map((p) => [p, WEEK_FLOOR_SETS]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const p of MAIN_PATTERNS) if (Number.isInteger(raw[p]) && raw[p] >= 0) out[p] = Math.min(WEEK_FLOOR_SETS, raw[p]);
  return out;
}

function itemViolations(items, rules, history, add) {
  let fresh = 0;
  for (const item of items) {
    const id = item && typeof item.movementId === 'string' ? item.movementId : null;
    const m = movementOf(id);
    if (!m) { add('unknown_movement', `${id && ID.test(id) ? id : 'A movement'} is not in the movement library.`, id && ID.test(id) ? id : undefined); continue; }
    if (!validSets(item.sets)) add('bad_dose', `${m.name} needs between 1 and ${MAX_SETS} sets.`, m.id);
    if (item.slow !== undefined && typeof item.slow !== 'boolean') add('bad_dose', `${m.name} is either slow or not.`, m.id);
    blockViolation(rules, history, m, add);
    if (isNew(rules, history, m)) fresh += 1;
  }
  if (fresh > MAX_NEW) add('too_many_new', `The session has ${fresh} movements the person hasn't done yet; at most ${MAX_NEW}.`);
}

function blockViolation(rules, history, m, add) {
  const block = blockOf(rules, history, m.id);
  const before = m.easier && movementOf(m.easier);
  if (block === 'equipment_not_owned') add(block, `${m.name} needs ${m.equipment.join(' and ')}, which the person doesn't have.`, m.id);
  else if (block === 'avoided_movement' || block === 'cannot_do') add('avoided_movement', `${m.name} is on the person's list to leave out.`, m.id);
  else if (block === 'gated_movement') add(block, `${m.name} comes only after ${before.name} is done at the top of its range twice${before.equipment.includes('backpack') ? `, with ${LOAD_MAX_KG} litres of water in the backpack` : ''}.`, m.id);
}

// The items that can be timed, with the library's rest and range where an item leaves them out.
function timedItems(items) {
  return items.filter((i) => movementOf(i?.movementId) && Number.isInteger(i.sets) && i.sets >= 1).map((i) => {
    const m = movementOf(i.movementId);
    return { ...i, rest: Number.isFinite(i.rest) ? i.rest : m.rest, reps: i.reps ?? m.dose.reps, seconds: i.seconds ?? m.dose.seconds };
  });
}

// A pattern no movement of which fits the person's rules (equipment, avoid list, "can't do") can't be asked of the week.
function weekViolations(week, rules, history, add, floor) {
  const sets = setsByPattern(week.filter((c) => c && Array.isArray(c.items)));
  for (const p of MAIN_PATTERNS) {
    if (sets[p] < floor[p] && patternUsable(rules, history, p)) add('sets_below_floor', `The week has ${sets[p]} sets of ${PATTERN_WORDS[p]}; at least ${floor[p]}.`);
  }
}

// ---- What a model may choose from, and its proposal made into content ---------------------------------------------

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
    const pick = pickInChain(req.rules, req.history, root, true);
    if (!pick) continue;
    out.push(choiceOf(req, pick));
    const known = isNew(req.rules, req.history, pick) ? pickInChain(req.rules, req.history, root, false) : null;
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
    `Across the week every main pattern gets at least ${WEEK_FLOOR_SETS} sets, aiming for ${WEEK_TARGET_SETS[0]} to ${WEEK_TARGET_SETS[1]}.`,
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
  const ok = Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] <= v[1] && v[0] >= range[0] && v[1] <= range[1];
  return ok ? { [key]: [...v] } : null;
}

const rangeWords = (m) => `${m.dose[doseKey(m)].join(' to ')} ${doseKey(m)}`;

// One proposed item as content, or null with a violation: unknown or repeated movement, sets or range out of bounds.
function proposedItem(req, raw, taken, add) {
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
  const [lo, hi] = [fewestItems(req), MAX_ITEMS];
  if (list.length < lo || list.length > hi) add('item_count', `A session has ${lo} to ${hi} movements; the proposal has ${list.length}.`);
  const taken = new Set();
  return list.map((raw) => proposedItem(req, raw, taken, add)).filter(Boolean);
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
 * Codes beyond checkContent's: bad_proposal, item_count, duplicate_movement. Use `content` only when `pass` is true.
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
