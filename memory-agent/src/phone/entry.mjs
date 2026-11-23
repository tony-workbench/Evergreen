// The phone entry: the functions Swift calls in JavaScriptCore. Each takes one JSON string and returns one JSON string;
// none throws. The host sets `globalThis.memoryIO` first: the store's io object (docs/PHONE.md).
//
//   memoryRoll({ root, user, snapshot, now, mode? })                  -> { ok, mode, day, wrote }
//   memoryForget({ root, user, what, ... })                           -> { ok }   what: stop | recommendation | day | type | key | derived | preference
//       what 'day' takes { day, snapshot }: with the snapshot the facts are rolled again without the day, so nothing is left empty
//   memoryRestore({ root, user, what, ... })                          -> { ok }   what: stop | type | derived (undoes that memoryForget)
//       what 'stop' takes { key }: a brief line's key (slot:running:sun:08, workouts_per_week, mix, recent_weeks, load, sleep, resting_hr)
//   memoryState({ root, user })                                       -> { ok, days, types, stoppedTypes, forgottenDays, forgottenKinds }
//   memoryPlannerText({ root, user, brief?, full? })                  -> { ok, text, words, ... }   the agent's table once it has a row, else the brief; brief: true, full: true
//   memoryBrief({ root, user })                                       -> { ok, lines: [{ group, id, key, text }], words, stopped: [{ key, label }], facts: [{ kind, text }] }
//
// The memory agent (src/agent/, docs/PHONE.md). The app makes the one model call of the day itself, between the first two:
//   memoryDailyRequest({ root, user, now, outcomes?, extras?, snapshot? }) -> { ok, day, alreadyDone, system, user, schema, evidence, neighbors }
//   memoryDailyApply({ root, user, now, day?, proposals })            -> { ok, day, alreadyDone, applied, rejected, review }
//   memoryTable({ root, user, now? })                                 -> { ok, day, rows, text, words, leftOut }
//   memoryReviewQueue({ root, user })                                 -> { ok, rows }
//   memoryDemoModel(what memoryDailyRequest returned)                 -> { proposals }   a rule-based stand-in for the model, for tests and demos
//   memoryConfirm / memoryReject({ root, user, now, memoryId | key }) -> { ok, memoryId, slot, state }
//   memoryRestore({ root, user, now, memoryId | key })                -> the same (no `what`: a memory; with `what`: as above)
// Every global returns a failure as { ok: false, error: { code, text } }. A completed memoryRoll keeps the day's facts as evidence;
// memoryForget and memoryRestore also reach the agent's memories (a forgotten day is deleted there too).
//
import {
  MemoryStore, forgetRecommendation, forgetFactType, forgetFactKey, forgetDerived, forget,
  restoreFactType, restoreDerived, suppressedTypes, DERIVED_FACT_TYPES, DERIVED_KINDS,
} from '../store/index.mjs';
import { rollDay } from '../memory/roll.mjs';
import { plannerText } from '../memory/planner-text.mjs';
import { briefText, stopKey, restoreKey } from '../memory/brief.mjs';
import * as agent from '../agent/daily.mjs';
import { fail } from '../agent/schema.mjs';
import { demoModel } from '../agent/demo-model.mjs';

const open = (a) => {
  const io = globalThis.memoryIO;
  if (!io) throw new Error('memoryIO is not set');
  return new MemoryStore(a.root, a.user, { io });
};

// Every failure of every global is { ok: false, error: { code, text } } and nothing else: `text` is one plain sentence.
const thrown = (e) => fail(e instanceof SyntaxError ? 'bad_arguments' : e && e.message === 'invalid user id' ? 'bad_user' : codeOf(e && e.name));
// The code for what the fact store and the roll say when they fail (an error's name, or a short message).
const codeOf = (said) => {
  const s = String(said ?? '');
  if (s === 'unknown what') return 'unknown_what';
  if (s === 'SyntaxError') return 'bad_arguments';
  if (s === 'PathEscapeError') return 'bad_path';
  if (s === 'MemoryUnavailableError' || s === 'UnrecoveredWriteError' || s.includes('not available')) return 'memory_unavailable';
  if (s.includes('too long')) return 'too_long';
  return 'failed';
};
// A result that failed, in the one error form. `none` is the code when the module gave no reason.
const shaped = (r, none = 'not_done') => {
  if (r === null || typeof r !== 'object' || r.ok !== false) return r;
  if (r.error !== null && typeof r.error === 'object') return { ok: false, error: r.error };
  return fail(r.error === undefined ? none : codeOf(r.error));
};

// Parses the arguments, opens the store, runs fn, and turns any failure into the error form.
const call = (argsJson, fn, none) => {
  try {
    const args = JSON.parse(argsJson);
    return JSON.stringify(shaped(fn(open(args), args), none));
  } catch (e) {
    return JSON.stringify(thrown(e));
  }
};

// The same for the memory agent's calls: fn gets { store, io, user } and the arguments; a failure is { ok: false, error: { code, text } }.
const agentCall = (argsJson, fn) => {
  try {
    const args = JSON.parse(argsJson);
    return JSON.stringify(fn({ store: open(args), io: globalThis.memoryIO, user: args.user }, args));
  } catch (e) {
    return JSON.stringify(thrown(e));
  }
};
const ctxOf = (store, a) => ({ store, io: globalThis.memoryIO, user: a.user });

const FORGET = {
  stop: (s, a) => stopKey(s, a.key),
  recommendation: (s, a) => forgetRecommendation(s, a.recId),
  day: (s, a) => forgetFactKey(s, 'daily', a.date ?? a.day),
  type: (s, a) => forgetFactType(s, a.type),
  key: (s, a) => forgetFactKey(s, a.type, a.key),
  derived: (s, a) => forgetDerived(s, a.kind),
  preference: (s, a) => forget(s, 'preferences', a.prefix),
};
const RESTORE = {
  stop: (s, a) => restoreKey(s, a.key),
  type: (s, a) => restoreFactType(s, a.type),
  derived: (s, a) => restoreDerived(s, a.kind),
};

globalThis.memoryRoll = (argsJson) => call(argsJson, (store, a) => {
  const rolled = rollDay({ store, snapshot: a.snapshot, now: a.now, mode: a.mode });
  // The agent's evidence for the day that ended. A failure here leaves the roll as it is: the day then has no evidence.
  if (rolled.ok && rolled.mode === 'completed') { try { agent.recordDay(ctxOf(store, a), a); } catch (e) { /* no evidence for this day */ } }
  return rolled.ok ? rolled : fail('roll_failed');
});
globalThis.memoryForget = (argsJson) => call(argsJson, (store, a) => {
  if (!Object.hasOwn(FORGET, a.what)) return fail('unknown_what');
  const facts = FORGET[a.what](store, a) === true;
  // Forgetting a day with the snapshot: the facts are rolled again here, so the brief and the table are whole straight away.
  if (facts && a.what === 'day' && a.snapshot !== undefined) {
    const now = a.now ?? agent.rollTime(ctxOf(store, a), a.snapshot);
    if (now) rollDay({ store, snapshot: { ...a.snapshot, exportDate: now }, now, mode: 'completed' });
  }
  // A stop also rejects the agent's memory of that line (a table row's key works here too); a forgotten day is deleted there as well.
  const ok = a.what === 'stop' ? (agent.onForget(ctxOf(store, a), a) === true || facts) : facts && agent.onForget(ctxOf(store, a), a) === true;
  return { ok };
});
globalThis.memoryRestore = (argsJson) => {
  let what;
  try { what = JSON.parse(argsJson).what; } catch (e) { what = undefined; }
  if (what === undefined) return agentCall(argsJson, (ctx, a) => agent.restore(ctx, a));      // a memory, by memoryId or key
  return call(argsJson, (store, a) => {
    if (!Object.hasOwn(RESTORE, a.what)) return fail('unknown_what');
    const facts = RESTORE[a.what](store, a) === true;
    const mine = agent.onRestore(ctxOf(store, a), a) === true;
    return { ok: a.what === 'stop' ? facts || mine : facts };
  });
};
globalThis.memoryDailyRequest = (argsJson) => agentCall(argsJson, (ctx, a) => agent.dailyRequest(ctx, a));
globalThis.memoryDailyApply = (argsJson) => agentCall(argsJson, (ctx, a) => agent.dailyApply(ctx, a));
globalThis.memoryTable = (argsJson) => agentCall(argsJson, (ctx, a) => agent.table(ctx, a));
globalThis.memoryReviewQueue = (argsJson) => agentCall(argsJson, (ctx) => agent.reviews(ctx));
globalThis.memoryDemoModel = (argsJson) => { try { return JSON.stringify(demoModel(JSON.parse(argsJson))); } catch (e) { return JSON.stringify(fail('bad_arguments')); } };
globalThis.memoryConfirm = (argsJson) => agentCall(argsJson, (ctx, a) => agent.confirm(ctx, a));
globalThis.memoryReject = (argsJson) => agentCall(argsJson, (ctx, a) => agent.reject(ctx, a));
// What the person can forget and what is forgotten now: dates and type names only, never a fact's text.
globalThis.memoryState = (argsJson) => call(argsJson, (store) => {
  const off = suppressedTypes(store);
  return {
    ok: true,
    days: (store.read('rolling')?.facts ?? []).filter((f) => f.kind === 'daily').map((f) => f.key.replace(/^daily:/, '')).sort(),
    types: Object.keys(DERIVED_FACT_TYPES),
    stoppedTypes: off.types,
    forgottenDays: off.days,
    forgottenKinds: DERIVED_KINDS.filter((k) => store.kindSuppressed(k)),
  };
});
// The text the planner reads: the agent's table once it has a row, the brief before that or with brief: true,
// the long text with full: true.
globalThis.memoryPlannerText = (argsJson) => call(argsJson, (store, a) => {
  if (a.full === true) return plannerText(store);
  if (a.brief !== true) {
    const t = agent.table(ctxOf(store, a), { now: a.now });
    if (t.ok && t.rows.length > 0) return { ok: true, text: t.text, words: t.words, source: 'table' };
  }
  const b = briefText(store);
  return b.ok ? { ok: true, text: b.text, words: b.words, targetMet: b.targetMet } : b;
});
// The same brief for a screen: one line per fact with the key that stops it, what is stopped, and the stored sentences to send on.
globalThis.memoryBrief = (argsJson) => call(argsJson, (store) => {
  const b = briefText(store);
  return b.ok ? { ok: true, lines: b.lines, words: b.words, stopped: b.stopped, facts: b.facts } : b;
});
