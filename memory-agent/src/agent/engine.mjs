// The memory agent's state and its guarded executor. Pure: no file access, no clock, no model. Every function takes the
// state object (one JSON file per person, see store.mjs) and changes it in place; the caller saves it afterwards.
//
// The confidence and the decision to ask the person come from the evidence (days of support, weeks seen), never from the model.
// A model proposes one operation per slot (ADD, NOOP, MERGE, SUPERSEDE, REVIEW); `applyDaily` checks each proposal and
// either drops it with a code, turns it into a REVIEW with a code, or executes it. Nothing the model writes is trusted:
// the row data comes from the evidence, and every number in a statement must be in the cited evidence.
import { lintWords } from '../facts/index.mjs';
import {
  CANDIDATE, SAVED, CONFIRMED, REJECTED, SUPERSEDED, INACTIVE, USABLE, OPEN, mayMove, OPS, GROUPS, KINDS, SLOT_RE, groupOf,
  MAX_PROPOSALS, MAX_STATEMENT, MIN_CONFIDENCE, STRONG_DAYS, ADD_DAYS, SLOT_WEEKS, SUPPORT_WINDOW, EXPIRE_DAYS, EVIDENCE_KEPT,
  VERSIONS_KEPT, SUPERSEDED_KEPT, EVENTS_KEPT, CODE_TEXT, fail,
} from './schema.mjs';
import { statementFor } from './statements.mjs';
import { PLACE_KIND, PLACE_STATEMENT } from './place.mjs';
import { factEvidence, outcomeEvidence, extraEvidence, allowedNumbers, numbersNotIn, addDays, isDay } from './evidence.mjs';

const REFS_KEPT = 40;
const REVIEW_ID_DIGITS = 4;    // rev_0001
const FORGET_REACH = 34;       // an aggregate computed up to this many days after a day may contain that day

export const freshState = (user) => ({ v: 1, user, seq: 0, off: false, evidence: {}, outcomes: {}, extras: {}, processed: {}, memories: [], reviews: [], events: [], stopped: {} });

const current = (m) => m.versions[m.versions.length - 1];
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const inSlot = (state, slot) => state.memories.filter((m) => m.slot === slot);
const usableIn = (state, slot) => inSlot(state, slot).find((m) => USABLE.includes(m.state)) ?? null;
const candidateIn = (state, slot) => inSlot(state, slot).find((m) => m.state === CANDIDATE) ?? null;
const byId = (state, id) => state.memories.find((m) => m.id === id) ?? null;

function log(state, e) {
  state.events.push({ n: state.events.length === 0 ? 1 : state.events[state.events.length - 1].n + 1, ...e });
  if (state.events.length > EVENTS_KEPT) state.events.splice(0, state.events.length - EVENTS_KEPT);
}
function move(state, m, to, actor, ctx, op) {
  if (!mayMove(m.state, to, actor)) return false;
  log(state, { day: ctx.day, at: ctx.at, actor, op, memoryId: m.id, slot: m.slot, from: m.state, to, version: current(m).n });
  m.state = to;
  return true;
}
const closeReviews = (state, memoryId) => { state.reviews = state.reviews.filter((r) => r.memoryId !== memoryId); };

// ---------- evidence ----------

/** Store the fact engine's facts of one completed day as that day's evidence, and drop evidence older than 35 days. */
export function recordFacts(state, day, facts, off = [], trim = true) {
  state.evidence[day] = factEvidence(facts, off);
  if (!trim) return;
  const oldest = addDays(day, -EVIDENCE_KEPT);
  for (const d of Object.keys(state.evidence)) if (d <= oldest) delete state.evidence[d];
  for (const id of Object.keys(state.outcomes)) if (state.outcomes[id].day <= oldest) delete state.outcomes[id];
}
/** Store outcomes. `reported` is the day whose evidence shows the outcome itself: the day it was first passed in (or its own day, if later). */
export function recordOutcomes(state, outcomes, day) {
  for (const o of outcomes) state.outcomes[o.sessionId] = { ...o, reported: state.outcomes[o.sessionId]?.reported ?? (o.day > day ? o.day : day) };
}

/** Store what the app knows about gear and the goal. A list that is given replaces that kind; an unchanged item keeps the day it was first told. */
export function recordExtras(state, extras, day) {
  for (const kind of ['gear', 'goal']) {
    if (extras[kind] === undefined) continue;
    const next = {};
    for (const { id, ...rest } of extras[kind]) {
      const old = state.extras[id];
      const same = old && JSON.stringify({ ...old, day: 0 }) === JSON.stringify({ ...rest, day: 0 });
      next[id] = same ? old : { ...rest, day };
    }
    for (const id of Object.keys(state.extras)) if (id.startsWith(`${kind}.`)) delete state.extras[id];
    Object.assign(state.extras, next);
  }
}

/** All evidence of a day (the engine's facts, the outcomes, gear and the goal), or null when the day was never rolled. */
export function dayEvidence(state, day) {
  if (!Object.hasOwn(state.evidence, day)) return null;
  return [...state.evidence[day], ...outcomeEvidence(state.outcomes, day), ...extraEvidence(state.extras, day)];
}
const hashOf = (items, sha256) => sha256(JSON.stringify(items));
// What the model is shown: a stopped slot is left out, and so is an item that supports nothing else.
const shown = (state, items) => items.map((i) => ({ ...i, slots: i.slots.filter((s) => !state.stopped[s.slot]) })).filter((i) => i.slots.length > 0);

/** On how many of the last 28 days the evidence supported this slot. A 28-day count of outcomes repeats daily, so only the outcomes themselves count. */
export function supportDays(state, slot, day) {
  let n = 0;
  for (let k = 0; k < SUPPORT_WINDOW; k++) {
    if ((dayEvidence(state, addDays(day, -k)) ?? []).some((i) => !i.id.startsWith('outcomes.') && i.slots.some((s) => s.slot === slot))) n += 1;
  }
  return n;
}

/** Existing memories in the slots this evidence can touch, by exact slot key: [{ memoryId, slot, statement, state, version, updated }]. */
export function neighborsFor(state, items) {
  const slots = new Set(items.flatMap((i) => i.slots.map((s) => s.slot)));
  return state.memories.filter((m) => slots.has(m.slot) && m.state !== SUPERSEDED)
    .map((m) => ({ memoryId: m.id, slot: m.slot, statement: current(m).statement, state: m.state, version: current(m).n, updated: m.updated }));
}

/** What the request needs for one day: { ok, day, alreadyDone, evidence, neighbors } or an error. */
export function dailyEvidence(state, day, sha256) {
  if (state.off) return fail('memory_off');
  const all = dayEvidence(state, day);
  if (all === null) return fail('no_evidence');
  const items = shown(state, all);
  return {
    ok: true, day, alreadyDone: state.processed[day] === hashOf(all, sha256),
    evidence: items.map((i) => ({ id: i.id, text: i.text, numbers: i.numbers, window: i.window, slots: i.slots.map((s) => s.slot), supportDays: Math.max(...i.slots.map((s) => supportDays(state, s.slot, day))) })),
    neighbors: neighborsFor(state, items),
  };
}

// ---------- the guarded executor ----------

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function shapeOk(p) {
  if (!isObj(p) || !OPS.includes(p.op) || typeof p.slot !== 'string' || !KINDS.includes(p.kind)) return false;
  if (typeof p.statement !== 'string' || p.statement.length < 8 || p.statement.length > MAX_STATEMENT || /[|\r\n]/.test(p.statement)) return false;
  if (!Array.isArray(p.evidenceIds) || p.evidenceIds.length < 1 || p.evidenceIds.length > 6 || !p.evidenceIds.every((x) => typeof x === 'string')) return false;
  if (p.targetMemoryId !== undefined && p.targetMemoryId !== null && typeof p.targetMemoryId !== 'string') return false;
  if (p.op === 'ADD' && typeof p.targetMemoryId === 'string') return false;
  if (p.numbers !== undefined && !(isObj(p.numbers) && Object.values(p.numbers).every((v) => typeof v === 'number' && Number.isFinite(v)))) return false;
  return true;
}

/**
 * How sure the memory is, from the evidence alone: a usual slot by the share of weeks it was seen in, gear and goal 1
 * (the person told the app), anything else 0.5 on its first day of support, 0.75 on the second and 1 from the third.
 * A confidence the model sends is ignored.
 */
export function confidenceOf(kind, data, days) {
  if (kind === 'usual_slot') return Math.round((data.weeksSeen / data.weeksTotal) * 100) / 100;
  if (kind === 'gear' || kind === 'goal') return 1;
  return Math.max(0, Math.min(1, 0.25 + 0.25 * days));
}

function newMemory(state, p, support, st, ctx, supersedes = null) {
  state.seq += 1;
  const m = {
    id: `mem_${String(state.seq).padStart(4, '0')}`, slot: p.slot, kind: p.kind, state: st, since: ctx.day, updated: ctx.day, supersedes, supersededBy: null,
    versions: [{ n: 1, statement: p.statement, data: support.data, confidence: p.confidence, day: ctx.day, evidence: [{ day: ctx.day, ids: [...p.evidenceIds] }] }],
  };
  state.memories.push(m);
  return m;
}
function addRef(m, p, ctx) {
  const v = current(m);
  v.evidence = [...v.evidence.filter((r) => r.day !== ctx.day), { day: ctx.day, ids: [...p.evidenceIds] }].slice(-REFS_KEPT);
  if (ctx.day > m.updated) m.updated = ctx.day;
}
function newVersion(m, p, support, ctx) {
  m.versions.push({ n: current(m).n + 1, statement: p.statement, data: support.data, confidence: p.confidence, day: ctx.day, evidence: [{ day: ctx.day, ids: [...p.evidenceIds] }] });
  if (m.versions.length > VERSIONS_KEPT) m.versions.splice(0, m.versions.length - VERSIONS_KEPT);
  if (ctx.day > m.updated) m.updated = ctx.day;
}

// Without evidence for 35 days a memory is no longer used; superseded memories beyond the latest 3 of a slot are dropped.
function sweep(state, ctx) {
  const limit = addDays(ctx.day, -EXPIRE_DAYS);
  for (const m of state.memories) {
    if (OPEN.includes(m.state) && m.updated < limit && move(state, m, INACTIVE, 'system', ctx, 'EXPIRE')) closeReviews(state, m.id);
  }
  const old = new Map();
  for (const m of state.memories) if (m.state === SUPERSEDED) old.set(m.slot, [...(old.get(m.slot) ?? []), m.id]);
  const drop = new Set([...old.values()].flatMap((ids) => ids.slice(0, Math.max(0, ids.length - SUPERSEDED_KEPT))));
  if (drop.size > 0) removeMemories(state, drop);
}

/**
 * The evidence of a day contradicts the memory in a slot (a gym workout under "you train at home"): every open memory
 * there becomes inactive at once, as an expired one does, and its question is closed. A later day's evidence can ADD it again.
 */
export function retireSlot(state, slot, ctx) {
  let any = false;
  for (const m of inSlot(state, slot)) if (OPEN.includes(m.state) && move(state, m, INACTIVE, 'system', ctx, 'RETIRE')) { closeReviews(state, m.id); any = true; }
  return any;
}

/**
 * Apply the model's proposals for one day. Returns
 *   { ok, day, alreadyDone, applied: [{ index, op, slot, memoryId, version, guard? }], rejected: [{ index, code, text }], review: [...] }
 * `guard` is the code that turned the proposal into a REVIEW. Each (day, evidence) pair is applied once.
 */
export function applyDaily(state, { day, proposals, at, sha256 }) {
  if (state.off) return fail('memory_off');
  if (!isDay(day)) return fail('bad_arguments');
  const all = dayEvidence(state, day);
  if (all === null) return fail('no_evidence');
  const hash = hashOf(all, sha256);
  if (state.processed[day] === hash) return { ok: true, day, alreadyDone: true, applied: [], rejected: [], review: [] };
  const list = Array.isArray(proposals) ? proposals : isObj(proposals) ? proposals.proposals : null;
  if (!Array.isArray(list)) return fail('bad_proposals');
  const run = startRun(state, { day, at }, all);
  list.forEach((p, index) => applyProposal(run, p, index));
  state.processed[day] = hash;
  for (const d of Object.keys(state.processed)) if (d <= addDays(day, -EVIDENCE_KEPT)) delete state.processed[d];
  return { ok: true, day, alreadyDone: false, applied: run.applied, rejected: run.rejected, review: reviewQueue(state).filter((r) => run.asked.includes(r.memoryId)) };
}

// One day's run: the swept state, the day's evidence by id, the memories the model was shown, and what it did so far.
function startRun(state, ctx, all) {
  sweep(state, ctx);
  const evidence = Object.fromEntries(all.map((i) => [i.id, i]));
  const neighbors = new Set(neighborsFor(state, shown(state, all)).map((n) => n.memoryId));
  return { state, ctx, evidence, neighbors, seen: new Set(), applied: [], rejected: [], asked: [] };
}

// One proposal: dropped with a code, or executed (perhaps as a REVIEW) and recorded as applied.
function applyProposal(run, p, index) {
  const drop = slotDrop(run, p, index);
  if (drop) return dropProposal(run, p, { index, code: drop });
  const group = groupOf(p.slot);
  const cited = evidenceCheck(run, p, group);
  if (cited.drop) return dropProposal(run, p, { index, code: cited.drop });
  const aimed = targetCheck(run, p);
  if (aimed.drop) return dropProposal(run, p, { index, code: aimed.drop });
  const c = { group, support: cited.support, ...aimed };
  const g = guardOf(run, p, c);
  const m = execute(run, c, g);
  run.applied.push({ index, op: g.op, slot: m.slot, memoryId: m.id, version: current(m).n, ...(g.guard ? { guard: g.guard } : {}) });
}

function dropProposal(run, p, { index, code }) {
  const { day, at } = run.ctx;
  run.rejected.push({ index, code, text: CODE_TEXT[code] });
  log(run.state, { day, at, actor: 'system', op: 'DROP', slot: isObj(p) && typeof p.slot === 'string' && SLOT_RE.test(p.slot) ? p.slot : null, code });
}

// The first checks: the proposal's place in the list, its shape and its slot. A drop code, or null.
function slotDrop(run, p, index) {
  if (index >= MAX_PROPOSALS) return 'too_many';
  if (!shapeOk(p)) return 'bad_shape';
  if (!SLOT_RE.test(p.slot)) return 'bad_slot';
  if (!GROUPS.includes(groupOf(p.slot))) return 'slot_family';
  if (run.seen.has(p.slot)) return 'duplicate_slot';
  run.seen.add(p.slot);
  if (run.state.stopped[p.slot]) return 'slot_stopped';
  return null;
}

// What the proposal cites: ids in the day's evidence, an item backing its slot and kind, numbers and words from it.
// { drop } or { support }: the slot entry of the item that backs it.
function evidenceCheck(run, p, group) {
  const cited = p.evidenceIds.map((id) => run.evidence[id]);
  if (cited.some((c) => c === undefined)) return { drop: 'unknown_evidence' };
  const supporting = cited.filter((c) => c.slots.some((s) => s.slot === p.slot));
  if (supporting.length === 0) return { drop: 'slot_not_supported' };
  const support = (supporting.find((c) => c.window !== 'day') ?? supporting[0]).slots.find((s) => s.slot === p.slot);
  if (support.kind !== p.kind) return { drop: 'kind_mismatch' };
  const drop = statementDrop(p, cited, group);
  if (drop) return { drop };
  if (group !== 'response' && supporting.every((c) => c.window === 'day')) return { drop: 'raw_reading' };
  if (inSlot(run.state, p.slot).some((m) => m.state === REJECTED && norm(current(m).statement) === norm(p.statement))) return { drop: 'rejected_before' };
  return { support };
}

function statementDrop(p, cited, group) {
  const allowed = allowedNumbers(cited);
  if (numbersNotIn(p.statement, allowed).length > 0 || Object.values(p.numbers ?? {}).some((v) => v < 0 || !allowed.numbers.has(String(v)))) return 'number_not_in_evidence';
  // A goal may have no date, so its sentence may have no number; everything else the fact lint asks still holds.
  // Where the person trains has one fixed sentence, written by code (place.mjs); any other wording is dropped.
  if (p.kind === PLACE_KIND ? p.statement !== PLACE_STATEMENT : lintWords(p.statement).filter((x) => !(group === 'goal' && /number/.test(x))).length > 0) return 'not_a_fact';
  return null;
}

// The memory the proposal acts on: a target must be a neighbor the model was shown, in the slot, and still open.
// { drop } or { usable, candidate, target }.
function targetCheck(run, p) {
  const usable = usableIn(run.state, p.slot);
  const candidate = candidateIn(run.state, p.slot);
  let target = null;
  if (typeof p.targetMemoryId === 'string') {
    target = byId(run.state, p.targetMemoryId);
    if (!run.neighbors.has(p.targetMemoryId) || target === null || target.slot !== p.slot) return { drop: 'target_not_neighbor' };
    if (!OPEN.includes(target.state)) return { drop: 'target_not_open' };
  } else if (p.op === 'NOOP' || p.op === 'MERGE' || p.op === 'SUPERSEDE') return { drop: 'target_missing' };
  if (p.op === 'ADD' && (usable || candidate)) return { drop: 'slot_occupied' };
  return { usable, candidate, target };
}

// Guards that ask the person instead of writing: { p (with code's confidence), op, guard }; a guard makes the op a REVIEW.
function guardOf(run, proposal, c) {
  const days = supportDays(run.state, proposal.slot, run.ctx.day);
  const p = { ...proposal, confidence: confidenceOf(proposal.kind, c.support.data, days) };          // code's number, not the model's
  const strong = (need) => (p.kind === 'usual_slot' ? c.support.data.weeksSeen >= SLOT_WEEKS : days >= need[c.group]);
  let guard = null;
  if (p.op === 'ADD' || ((p.op === 'MERGE' || p.op === 'SUPERSEDE') && c.target.state !== CANDIDATE)) {
    if (p.confidence < MIN_CONFIDENCE) guard = 'low_confidence';
    else if (!strong(p.op === 'ADD' ? ADD_DAYS : STRONG_DAYS)) guard = 'weak_evidence';
    else if (p.op !== 'ADD' && c.target.updated > run.ctx.day) guard = 'older_evidence';
  }
  return { p, op: guard ? 'REVIEW' : p.op, guard };
}

// Carries out the op and returns the memory it wrote.
function execute(run, c, g) {
  const { op, p } = g;
  if (op === 'ADD') return addMemory(run, p, c.support);
  if (op === 'NOOP') return corroborate(run, p, c.target);
  if (op === 'MERGE' || (op === 'SUPERSEDE' && c.target.state === CANDIDATE)) return merge(run, p, c);
  if (op === 'SUPERSEDE') return supersede(run, p, c);
  return review(run, g, c);
}

function addMemory(run, p, support) {
  const m = newMemory(run.state, p, support, SAVED, run.ctx);
  log(run.state, { day: run.ctx.day, at: run.ctx.at, actor: 'system', op: 'ADD', memoryId: m.id, slot: m.slot, from: null, to: SAVED, version: 1 });
  return m;
}

function corroborate(run, p, m) {
  addRef(m, p, run.ctx);
  current(m).confidence = p.confidence;
  log(run.state, { day: run.ctx.day, at: run.ctx.at, actor: 'system', op: 'CORROBORATE', memoryId: m.id, slot: m.slot, from: m.state, to: m.state, version: current(m).n });
  return m;
}

// The same memory, a new version; its state stays.
function merge(run, p, c) {
  const m = c.target;
  newVersion(m, p, c.support, run.ctx);
  log(run.state, { day: run.ctx.day, at: run.ctx.at, actor: 'system', op: 'MERGE', memoryId: m.id, slot: m.slot, from: m.state, to: m.state, version: current(m).n });
  return m;
}

// A new saved memory in place of the target, even when the old one was confirmed: the person confirmed the old wording.
function supersede(run, p, c) {
  const { state, ctx } = run;
  const { target } = c;
  const m = newMemory(state, p, c.support, SAVED, ctx, target.id);
  log(state, { day: ctx.day, at: ctx.at, actor: 'system', op: 'ADD', memoryId: m.id, slot: m.slot, from: null, to: SAVED, version: 1 });
  move(state, target, SUPERSEDED, 'system', ctx, 'SUPERSEDE');
  target.supersededBy = m.id;
  for (const r of state.reviews) if (r.targetMemoryId === target.id) r.targetMemoryId = m.id;
  return m;
}

// REVIEW: a candidate the table never shows, and a question for the person. The memory in use is not touched.
function review(run, g, c) {
  const { state, ctx } = run;
  const m = reviewCandidate(run, g.p, c);
  const reason = g.guard ?? 'model_unsure';
  const open = state.reviews.find((r) => r.memoryId === m.id);
  if (open) Object.assign(open, { reason, day: ctx.day, targetMemoryId: c.usable?.id ?? null });
  else { state.seq += 1; state.reviews.push({ id: `rev_${String(state.seq).padStart(REVIEW_ID_DIGITS, '0')}`, memoryId: m.id, targetMemoryId: c.usable?.id ?? null, reason, day: ctx.day }); }
  log(state, { day: ctx.day, at: ctx.at, actor: 'system', op: 'REVIEW', memoryId: m.id, slot: m.slot, from: null, to: CANDIDATE, version: current(m).n, code: g.guard });
  run.asked.push(m.id);
  return m;
}

// The slot's open candidate, with this wording as a new reference or a new version, or a new candidate.
function reviewCandidate(run, p, c) {
  const m = c.candidate;
  if (!m) return newMemory(run.state, p, c.support, CANDIDATE, run.ctx);
  if (norm(current(m).statement) === norm(p.statement)) addRef(m, p, run.ctx); else newVersion(m, p, c.support, run.ctx);
  return m;
}

// ---------- what the person can do ----------

const REASON_TEXT = { model_unsure: 'The model was not sure.' };

/** Open questions for the person ("Is this right?"): confirm with confirmMemory, say no with rejectMemory. */
export function reviewQueue(state) {
  return state.reviews.map((r) => {
    const m = byId(state, r.memoryId);
    const target = r.targetMemoryId ? byId(state, r.targetMemoryId) : null;
    return {
      reviewId: r.id, memoryId: m.id, key: m.slot, slot: m.slot, group: groupOf(m.slot), kind: m.kind, statement: current(m).statement, data: current(m).data,
      question: 'Is this right?', reason: { code: r.reason, text: CODE_TEXT[r.reason] ?? REASON_TEXT[r.reason] }, day: r.day,
      targetMemoryId: target ? target.id : null, targetStatement: target ? current(target).statement : null,
    };
  });
}

const find = (state, a) => {
  if (!isObj(a)) return undefined;
  if (typeof a.memoryId === 'string') return byId(state, a.memoryId);
  if (typeof a.key === 'string' && SLOT_RE.test(a.key) && GROUPS.includes(groupOf(a.key))) return usableIn(state, a.key) ?? candidateIn(state, a.key);
  return undefined;
};
const done = (m) => ({ ok: true, memoryId: m.id, slot: m.slot, state: m.state });

/** The person says a memory is right: candidate or saved becomes confirmed; a confirmed candidate replaces the memory it questioned. */
export function confirmMemory(state, a, ctx) {
  const m = find(state, a);
  if (m === undefined) return fail('bad_arguments');
  if (m === null) return fail('not_found');
  if (m.state === CONFIRMED) return done(m);
  const old = m.state === CANDIDATE ? usableIn(state, m.slot) : null;
  if (!move(state, m, CONFIRMED, 'user', ctx, 'CONFIRM')) return fail('not_allowed');
  if (old) { move(state, old, SUPERSEDED, 'user', ctx, 'SUPERSEDE'); old.supersededBy = m.id; m.supersedes = old.id; m.since = ctx.day; }
  closeReviews(state, m.id);
  return done(m);
}

/** Stop slots: the memory in each becomes rejected and nothing is written to the slot until it is restored. */
export function stopSlots(state, slots, ctx) {
  for (const slot of slots) {
    const kept = usableIn(state, slot) ?? candidateIn(state, slot);
    for (const m of inSlot(state, slot)) if (OPEN.includes(m.state) && move(state, m, REJECTED, 'user', ctx, 'REJECT')) closeReviews(state, m.id);
    if (!state.stopped[slot]) state.stopped[slot] = { day: ctx.day, memoryId: kept ? kept.id : null };
  }
  return slots.length > 0;
}

/**
 * The person says "stop using this" ({ memoryId } or { key }): the memory becomes rejected and its slot is stopped.
 * Saying no to a question about a memory in use rejects only the proposed change; the same statement is not proposed again.
 */
export function rejectMemory(state, a, ctx) {
  const m = find(state, a);
  if (m === undefined) return fail('bad_arguments');
  if (m === null) {
    if (typeof a.memoryId === 'string') return fail('not_found');
    stopSlots(state, [a.key], ctx);                                // a key with no memory yet: the slot is stopped all the same
    return { ok: true, memoryId: null, slot: a.key, state: REJECTED };
  }
  if (m.state === REJECTED) return done(m);
  if (!mayMove(m.state, REJECTED, 'user')) return fail('not_allowed');
  if (m.state === CANDIDATE && usableIn(state, m.slot)) { move(state, m, REJECTED, 'user', ctx, 'REJECT'); closeReviews(state, m.id); return done(m); }
  if (m.state === INACTIVE) { move(state, m, REJECTED, 'user', ctx, 'REJECT'); state.stopped[m.slot] = { day: ctx.day, memoryId: m.id }; return done(m); }
  stopSlots(state, [m.slot], ctx);
  state.stopped[m.slot].memoryId = m.id;
  return done(m);
}

/** Undo a stop ({ memoryId } or { key }): the slot can be written again and its rejected memory is saved (not confirmed). */
export function restoreMemory(state, a, ctx) {
  if (!isObj(a)) return fail('bad_arguments');
  let m = typeof a.memoryId === 'string' ? byId(state, a.memoryId) : null;
  const slot = m ? m.slot : typeof a.key === 'string' ? a.key : null;
  if (slot === null) return fail(typeof a.memoryId === 'string' ? 'not_found' : 'bad_arguments');
  const stop = state.stopped[slot];
  if (!m && stop && stop.memoryId) m = byId(state, stop.memoryId);
  if (!stop && !(m && m.state === REJECTED)) return fail('not_found');
  if (m && m.state === REJECTED) {
    if (usableIn(state, slot)) return fail('slot_occupied');
    move(state, m, SAVED, 'user', ctx, 'RESTORE');
  }
  delete state.stopped[slot];
  return m ? done(m) : { ok: true, memoryId: null, slot, state: null };
}
export function restoreSlots(state, slots, ctx) {
  let any = false;
  for (const slot of slots) if (state.stopped[slot] && restoreMemory(state, { key: slot }, ctx).ok) any = true;
  return any;
}

// ---------- forgetting: real deletion ----------

function removeMemories(state, ids) {
  state.memories = state.memories.filter((m) => !ids.has(m.id));
  state.reviews = state.reviews.filter((r) => !ids.has(r.memoryId)).map((r) => (ids.has(r.targetMemoryId) ? { ...r, targetMemoryId: null } : r));
  state.events = state.events.filter((e) => !ids.has(e.memoryId));
  for (const m of state.memories) {
    if (ids.has(m.supersedes)) m.supersedes = null;
    if (ids.has(m.supersededBy)) {
      m.supersededBy = null;
      if (m.state === SUPERSEDED && !usableIn(state, m.slot)) m.state = SAVED;     // its successor is gone: the earlier memory stands again
    }
  }
  for (const s of Object.values(state.stopped)) if (ids.has(s.memoryId)) s.memoryId = null;
}

/**
 * Forget one day when the app gave no snapshot, so nothing can be recomputed. Deleted: that day's evidence and outcomes; every aggregate computed on that day or within 34 days after it
 * (it may contain the day); every memory version left with no evidence; every memory left with no version, with its events.
 * The app rolls the day again afterwards, which gives new evidence without the forgotten day.
 */
export function forgetDay(state, day) {
  const last = addDays(day, FORGET_REACH);
  delete state.evidence[day];
  delete state.processed[day];
  for (const d of Object.keys(state.evidence)) if (d > day && d <= last) state.evidence[d] = [];
  for (const id of Object.keys(state.outcomes)) if (state.outcomes[id].day === day) delete state.outcomes[id];
  const live = new Set(Object.keys(state.outcomes).map((id) => `outcome.${id.replace(/[^A-Za-z0-9_-]/g, '_')}`));
  const gone = new Set();
  for (const m of state.memories) {
    for (const v of m.versions) {
      v.evidence = v.evidence.map((r) => (r.day < day || r.day > last ? r : { day: r.day, ids: r.day === day ? [] : r.ids.filter((id) => live.has(id)) })).filter((r) => r.ids.length > 0);
    }
    m.versions = m.versions.filter((v) => v.evidence.length > 0);
    if (m.versions.length === 0) gone.add(m.id);
    else m.updated = current(m).evidence.reduce((a, r) => (r.day > a ? r.day : a), '');
  }
  removeMemories(state, gone);
  return true;
}

/**
 * Forget one day when the app gave the snapshot: `days` are the later evidence days the caller has just recomputed without
 * the forgotten day. That day's evidence and outcomes are deleted. A memory keeps every version that still has evidence;
 * when the recomputed evidence no longer carries its numbers, the stale version is replaced by one written by code from
 * the evidence (a short sentence per kind, statements.mjs, and the fact's data). A memory whose slot the latest evidence no longer supports is deleted.
 */
export function forgetDayRecomputed(state, day, days) {
  delete state.evidence[day];
  delete state.processed[day];
  for (const d of days) delete state.processed[d];
  for (const id of Object.keys(state.outcomes)) if (state.outcomes[id].day === day) delete state.outcomes[id];
  const affected = new Set(days);
  const last = days.length > 0 ? days[days.length - 1] : null;
  const gone = new Set();
  for (const m of state.memories) {
    const supporting = (d, ids) => (dayEvidence(state, d) ?? []).filter((i) => ids.includes(i.id) && i.slots.some((s) => s.slot === m.slot));
    const hadLast = current(m).evidence.some((r) => r.day === last);
    let touched = false;
    for (const v of m.versions) {
      v.evidence = v.evidence.filter((r) => r.day !== day).map((r) => {
        if (!affected.has(r.day)) return r;
        touched = true;
        return { day: r.day, ids: supporting(r.day, r.ids).map((i) => i.id) };
      }).filter((r) => r.ids.length > 0);
    }
    m.versions = m.versions.filter((v) => v.evidence.length > 0);
    if (m.versions.length === 0 || (hadLast && !current(m).evidence.some((r) => r.day === last))) { gone.add(m.id); continue; }
    const v = current(m);
    const ref = v.evidence.reduce((a, r) => (r.day > a.day ? r : a));
    if (touched && affected.has(ref.day)) {
      const items = supporting(ref.day, ref.ids);
      const item = items.find((i) => i.window !== 'day') ?? items[0];
      const data = item.slots.find((s) => s.slot === m.slot).data;
      if (numbersNotIn(v.statement, allowedNumbers(items)).length > 0 || JSON.stringify(data) !== JSON.stringify(v.data)) {
        m.versions[m.versions.length - 1] = { n: v.n + 1, statement: statementFor(item) ?? item.text, data, confidence: v.confidence, day: ref.day, evidence: [{ day: ref.day, ids: [item.id] }] };
      }
    }
    m.updated = current(m).evidence.reduce((a, r) => (r.day > a ? r.day : a), '');
  }
  removeMemories(state, gone);
  return true;
}

/** Forget every memory and all evidence of the slots chosen by `match` (a stopped fact type): deleted, not rejected. */
export function forgetSlots(state, match) {
  for (const d of Object.keys(state.evidence)) state.evidence[d] = state.evidence[d].filter((i) => !i.slots.every((s) => match(s.slot)));
  removeMemories(state, new Set(state.memories.filter((m) => match(m.slot)).map((m) => m.id)));
  return true;
}

/** Forget everything computed: evidence, outcomes, memories, questions and the log. Only the stopped slot keys remain. */
export function wipe(state) {
  Object.assign(state, { ...freshState(state.user), seq: state.seq, off: state.off, stopped: Object.fromEntries(Object.keys(state.stopped).map((k) => [k, { day: state.stopped[k].day, memoryId: null }])) });
  return true;
}
