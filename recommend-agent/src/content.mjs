// What goes into a home session: which movements, how many sets and reps, how heavy the backpack is. Code builds it from the
// movement library (data/movements.json), the person's rules and what they did last time, and code checks anything a model
// proposes against the same library. A model may only name movements and numbers; every word the person reads about a
// movement comes from the library, so the same movement reads the same on every day.
import library from '../data/movements.json' with { type: 'json' };
import { InputError } from './pytime.mjs';
import { readRules, ALWAYS_THERE } from './rules.mjs';
import { FOCUS } from './homeweek.mjs';

export const MOVEMENTS = library.movements;
const BY_ID = new Map(MOVEMENTS.map((m) => [m.id, m]));
export const movementOf = (id) => BY_ID.get(id) ?? null;

export const MAIN_PATTERNS = ['lower_push', 'lower_pull', 'upper_push', 'upper_pull'];
export const WEEK_FLOOR_SETS = 4;          // every main pattern gets at least this many sets in a week
export const WEEK_TARGET_SETS = [8, 10];   // and aims for this many
export const MAX_NEW = 1;                  // at most one movement the person hasn't done yet, beyond each chain's first
export const SETUP_SECONDS = 30;           // getting into place for each movement
export const LOAD_STEP_KG = 1;             // all sets at the top of the range twice: one more litre of water next time
export const LOAD_MAX_KG = 12;             // what a backpack holds safely
export const MAX_ITEMS = 5;
export const MIN_ITEMS = 3;
// Words that describe a feeling, not something the person can see or count. A movement's `pass` may use none of them.
export const FEELING_WORDS = ['feel', 'feeling', 'sense', 'burn', 'burning', 'ache', 'sore', 'warm', 'tight', 'pump', '感觉', '感受', '酸', '胀', '热'];

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
    return { movementId: h.movementId, day: String(h.day ?? ''), sets: h.sets, load: Number.isFinite(h.load) ? h.load : null };
  }).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const owns = (rules, m) => m.equipment.every((e) => rules.equipment.includes(e) || ALWAYS_THERE.includes(e));
const top = (m) => (m.dose.reps ?? m.dose.seconds)[1];
const low = (m) => (m.dose.reps ?? m.dose.seconds)[0];

/** Done every set at the top of the range in each of the last two times: the next movement up (or more weight) is earned. */
export function mastered(history, id) {
  const m = movementOf(id);
  const times = history.filter((h) => h.movementId === id).slice(-2);
  return times.length === 2 && times.every((t) => t.sets.length >= m.dose.sets && t.sets.every((n) => n >= top(m)));
}

const doneBefore = (history, id) => history.some((h) => h.movementId === id);

/**
 * Why a movement can't be planned, or null. In order: not in the library, equipment the person doesn't have, on their avoid
 * list, marked "can't do", or not earned yet (its easier one isn't mastered and the person hasn't said they can do it).
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

// A chain's first usable movement needs nothing; later ones need the one before mastered, or the person's "I can".
function earned(rules, history, m) {
  if (m.entry || rules.movements[m.id] === 'can' || doneBefore(history, m.id)) return true;
  const before = m.easier && movementOf(m.easier);
  if (!before) return true;
  if (!owns(rules, before)) return earned(rules, history, before);   // the easier one can't be done here: this one starts the chain
  return mastered(history, before.id) && fullyLoaded(history, before);
}

// A backpack movement adds a kilogram at a time before the next movement up: it moves on only once it was done at the top
// of its range with the backpack as heavy as it gets.
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

const repSeconds = (m) => (m.tempo ? m.tempo.down + m.tempo.hold + m.tempo.up : 3);

const middle = ([lo, hi]) => (lo + hi) / 2;

/** Seconds one item takes: every set at the middle of its range on each side, the rests between sets, and getting set up. */
export function itemSeconds(item) {
  const m = movementOf(item.movementId);
  const work = item.reps ? middle(item.reps) * repSeconds(m) : middle(item.seconds);
  return item.sets * work * m.sides + Math.max(0, item.sets - 1) * item.rest + SETUP_SECONDS;
}

export const sessionMinutes = (items) => Math.ceil(items.reduce((sum, i) => sum + itemSeconds(i), 0) / 60);

function lastLoad(history, id) {
  const times = history.filter((h) => h.movementId === id && h.load !== null);
  return times.length ? times[times.length - 1].load : null;
}

function itemFor(m, history, loads, sets) {
  const item = { movementId: m.id, sets, rest: m.rest, isNew: false };
  if (m.dose.reps) item.reps = [...m.dose.reps]; else item.seconds = [...m.dose.seconds];
  if (m.equipment.includes('backpack')) {
    const set = Number.isFinite(loads[m.id]) ? loads[m.id] : null;
    const last = lastLoad(history, m.id);
    let load = set ?? last ?? m.load ?? 2;
    // Every set at the top of the range twice and nothing harder taken: one more kilogram, up to what a backpack holds.
    if (set === null && last !== null && mastered(history, m.id)) load += LOAD_STEP_KG;
    item.load = Math.min(LOAD_MAX_KG, Math.max(1, load));
  }
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

/** The items for one session, built by code. Fits the session's minutes by dropping the last items, then sets. */
export function buildSession(req) {
  const { rules, history, focus, loads } = req;
  const slots = SLOTS[focus].map((s) => (s === 'core' ? CORE[req.turn % CORE.length] : s));
  const items = [];
  let newOnes = 0;
  const used = new Set();
  for (const slot of slots) {
    let pick = null;
    for (const root of [slot, ...(STAND_INS[slot] ?? [])]) {
      if (used.has(root)) continue;
      pick = pickInChain(rules, history, root, newOnes < MAX_NEW);
      if (pick) { used.add(root); break; }
    }
    if (!pick || items.some((i) => i.movementId === pick.id)) continue;
    const fresh = isNew(rules, history, pick);
    if (fresh) newOnes += 1;
    let sets = pick.dose.sets;
    if (req.easeOff || req.deload) sets = Math.max(1, sets - 1);   // pain at 4 or more last time, or a lighter week: one set fewer
    items.push({ ...itemFor(pick, history, loads, sets), isNew: fresh });
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
 *   -> { content: { sessionId, focus, minutes, items: [{ movementId, sets, reps | seconds, load?, rest, isNew }] } }
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
  for (const pattern of MAIN_PATTERNS) if (contents.length > 1 && setsByPattern(contents)[pattern] === 0) addItem(contents, reqs, pattern);
  for (const pattern of MAIN_PATTERNS) {
    let guard = 0;
    while (setsByPattern(contents)[pattern] < WEEK_FLOOR_SETS && guard++ < 8) {
      if (!addSet(contents, reqs, pattern)) break;
    }
  }
  const sets = setsByPattern(contents);
  const history = reqs[0]?.history ?? [];
  const none = MAIN_PATTERNS.filter((p) => contents.length > 0 && sets[p] === 0 && reqs[0] && !patternUsable(reqs[0].rules, history, p));
  const short = MAIN_PATTERNS.filter((p) => contents.length > 0 && sets[p] < WEEK_TARGET_SETS[0] && !none.includes(p));
  const notes = [];
  if (short.length) notes.push(`This week has ${short.map((p) => `${sets[p]} sets of ${PATTERN_WORDS[p]}`).join(', ')}, below the ${WEEK_TARGET_SETS[0]} to ${WEEK_TARGET_SETS[1]} aimed for.`);
  if (none.length) notes.push(`No movement for ${none.map((p) => PATTERN_WORDS[p]).join(' or ')} fits your equipment and the movements you left out.`);
  const note = notes.length ? notes.join(' ') : null;
  return { contents, setsByPattern: sets, target: WEEK_TARGET_SETS, note };
}

const patternOf = (item) => movementOf(item.movementId).pattern;
const withSets = (items, item, sets) => items.map((x) => (x === item ? { ...x, sets } : x));

// One more set of `pattern` somewhere in the week: in the session with the most time left, or, when none has the time,
// in place of a set of the pattern furthest above the floor in the same session. False when neither works.
function addSet(contents, reqs, pattern) {
  const spots = contents.flatMap((c, k) => c.items.filter((i) => patternOf(i) === pattern && i.sets < 6).map((i) => ({ c, k, i })));
  const fits = spots.filter(({ c, k, i }) => sessionMinutes(withSets(c.items, i, i.sets + 1)) <= reqs[k].minutes)
    .sort((x, y) => x.c.minutes - y.c.minutes)[0];
  if (fits) { fits.i.sets += 1; fits.c.minutes = sessionMinutes(fits.c.items); return true; }
  const sets = setsByPattern(contents);
  for (const { c, k, i } of spots) {
    const donor = c.items.filter((d) => d !== i && d.sets > 1 && (sets[patternOf(d)] ?? 0) - 1 >= (MAIN_PATTERNS.includes(patternOf(d)) ? WEEK_FLOOR_SETS : 0))
      .sort((a, b) => (sets[patternOf(b)] ?? 99) - (sets[patternOf(a)] ?? 99))[0];
    if (!donor) continue;
    const items = c.items.map((x) => (x === i ? { ...x, sets: x.sets + 1 } : x === donor ? { ...x, sets: x.sets - 1 } : x));
    if (sessionMinutes(items) > reqs[k].minutes) continue;
    i.sets += 1; donor.sets -= 1; c.minutes = sessionMinutes(c.items);
    return true;
  }
  return false;
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
    const c = contents[k];
    const req = reqs[k];
    const newOnes = c.items.filter((i) => i.isNew).length;
    const taken = new Set(c.items.map((i) => chainOf(i.movementId)));
    let pick = null;
    for (const root of PATTERN_ROOTS[pattern]) {
      if (taken.has(root)) continue;
      pick = pickInChain(req.rules, req.history, root, newOnes < MAX_NEW);
      if (pick) break;
    }
    if (!pick) continue;
    const sets = req.easeOff || req.deload ? Math.max(1, pick.dose.sets - 1) : pick.dose.sets;
    const item = { ...itemFor(pick, req.history, req.loads, sets), isNew: isNew(req.rules, req.history, pick) };
    const tries = [[...c.items, item]];
    const counts = setsByPattern(contents);
    const swaps = c.items.filter((i) => !MAIN_PATTERNS.includes(patternOf(i)) || counts[patternOf(i)] - i.sets >= WEEK_FLOOR_SETS)
      .sort((a, b) => (counts[patternOf(b)] ?? 99) - (counts[patternOf(a)] ?? 99));
    for (const out of swaps) tries.push(c.items.map((i) => (i === out ? item : i)));
    for (const items of tries) {
      const fitted = items.map((i) => ({ ...i }));
      if (fitted.length > MAX_ITEMS) continue;
      if (sessionMinutes(fitted) > req.minutes) {
        // Take sets off the other movements (never below one) until it fits.
        for (const i of fitted.filter((x) => x.movementId !== item.movementId).sort((a, b) => b.sets - a.sets)) {
          while (i.sets > 1 && sessionMinutes(fitted) > req.minutes) i.sets -= 1;
        }
      }
      if (sessionMinutes(fitted) > req.minutes) continue;
      c.items = fitted;
      c.minutes = sessionMinutes(fitted);
      return true;
    }
  }
  return false;
}

export const PATTERN_WORDS = { lower_push: 'legs pushing', lower_pull: 'hips and the back of the legs', upper_push: 'upper-body pushing', upper_pull: 'upper-body pulling', core: 'the middle of the body', snack: 'short pieces' };

// ---- Checking content a model proposed -----------------------------------------------------------------------------

/**
 * checkContent({ content, rules, history?, minutes?, week? }) -> { pass, violations: [{ code, text, movementId? }] }
 * Codes: unknown_movement, equipment_not_owned, avoided_movement, gated_movement, too_many_new, session_too_long,
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
  let fresh = 0;
  for (const item of a.content.items) {
    const m = movementOf(item.movementId);
    if (!m) { add('unknown_movement', `${item.movementId} is not in the movement library.`, item.movementId); continue; }
    if (!Number.isInteger(item.sets) || item.sets < 1 || item.sets > 6) add('bad_dose', `${m.name} needs between 1 and 6 sets.`, m.id);
    const block = blockOf(rules, history, m.id);
    if (block === 'equipment_not_owned') add(block, `${m.name} needs ${m.equipment.join(' and ')}, which the person doesn't have.`, m.id);
    else if (block === 'avoided_movement' || block === 'cannot_do') add('avoided_movement', `${m.name} is on the person's list to leave out.`, m.id);
    else if (block === 'gated_movement') add(block, `${m.name} comes only after ${movementOf(m.easier).name} is done at the top of its range twice${movementOf(m.easier).equipment.includes('backpack') ? `, with ${LOAD_MAX_KG} litres of water in the backpack` : ''}.`, m.id);
    if (isNew(rules, history, m)) fresh += 1;
  }
  if (fresh > MAX_NEW) add('too_many_new', `The session has ${fresh} movements the person hasn't done yet; at most ${MAX_NEW}.`);
  const valid = a.content.items.filter((i) => movementOf(i.movementId) && Number.isInteger(i.sets) && i.sets >= 1);
  const length = sessionMinutes(valid.map((i) => ({ ...i, rest: Number.isFinite(i.rest) ? i.rest : movementOf(i.movementId).rest,
    reps: i.reps ?? movementOf(i.movementId).dose.reps, seconds: i.seconds ?? movementOf(i.movementId).dose.seconds })));
  if (length > minutes) add('session_too_long', `The session takes about ${length} minutes; the person's sessions are at most ${minutes}.`);
  if (Array.isArray(a.week)) {
    const sets = setsByPattern(a.week.filter((c) => c && Array.isArray(c.items)));
    // A pattern no movement of which fits the person's rules (equipment, avoid list, "can't do") can't be asked of the week.
    for (const p of MAIN_PATTERNS) if (sets[p] < WEEK_FLOOR_SETS && patternUsable(rules, history, p)) add('sets_below_floor', `The week has ${sets[p]} sets of ${PATTERN_WORDS[p]}; at least ${WEEK_FLOOR_SETS}.`);
  }
  return { pass: violations.length === 0, violations };
}

/** movementLibrary({}) -> { movements } : the words for every movement, for the workout page. */
export const movementLibrary = () => ({ version: library.version, movements: MOVEMENTS });

/** For tests: a movement whose `pass` names a feeling rather than something seen or counted. */
export const feelingWordsIn = (text) => FEELING_WORDS.filter((w) => (/^[a-z]+$/.test(w) ? new RegExp(`\\b${w}\\b`, 'i').test(text) : text.includes(w)));

export { MOVEMENTS as LIBRARY };
