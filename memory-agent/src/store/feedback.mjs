// Provisional: what the user can say or tap is not decided; see docs/PREFERENCE.md
// Feedback taps, standing entries, history, forget, recovery and the planner-prompt index.
// Memory states what was said (counted, numbered statements). It never infers or advises.
// Multi-file changes write an operation journal first and are finished by `recover` if a step fails.
import { factLines, MemoryUnavailableError, ACCESS, DERIVE } from './memory-store.mjs';
import { canonicalOrder, tapsOf, earlierOf, expectedStanding, changeSince, changeTime, PROMOTE_AFTER, SHOWN_TAPS, FEEDBACK_KEEP } from './derive.mjs';
import { F, S, FILE_KINDS, DERIVED_KINDS, DERIVED_FACT_TYPES, validKey, stopKeyOf, reconstructFact, parseAccept, parseDecline, REASONS, WHY, ACTIVITIES, classifyFact, parseStanding, parseTap, dateStr, isoTime } from './facts.mjs';

export { REASONS, WHY, ACTIVITIES };
export { PROMOTE_AFTER, SHOWN_TAPS };
// File kinds (the store maps each kind to its fixed path; callers never pass a path).
export const ROLLING_DAILY_SHOWN = 7;
export const FEEDBACK_FILE = 'feedback';
export const PREFS_FILE = 'preferences';
export const HISTORY_FILE = 'history';

const WORDS = Object.values(REASONS).join('|');
const KEY_OF = Object.fromEntries(Object.entries(REASONS).map(([k, w]) => [w, k]));
const REASON_IN_LINE = new RegExp(`\\bas (${WORDS})\\b`);
const reasonOf = (line) => { const m = REASON_IN_LINE.exec(line); return m ? KEY_OF[m[1]] : null; };

const reasonSourceHit = (reason) => (s) =>
  s.startsWith(`- [P-${reason}]`) || s.startsWith(`- [C-${reason}]`) || s.startsWith(`- [H-${reason}]`) || s.startsWith(`- [E-${reason}]`)
  || (s.includes('type=feedback') && s.includes(`excerpt=${reason}`));

function createOrInsert(store, kind, fact, src) {
  return store.view(kind) === null ? store.create(kind, [fact], [src]) : store.insert(kind, fact, src);
}

/** Remove facts and sources by predicate over their stored lines. An emptied file is deleted. Verified by the store. */
function strip(store, kind, factPred, sourcePred) {
  const doc = store.read(kind);
  if (doc === null) return true;
  const facts = doc.facts.filter((f) => !factPred(`- ${f.text}`));
  const sources = doc.sources.filter((x) => !sourcePred(`- ${x.text}`));
  if (facts.length === doc.facts.length && sources.length === doc.sources.length) return true;
  return store.replaceFacts(kind, facts, sources);
}

/** What a stored feedback line records, whichever way the recommendation was answered. */
const outcomeOf = (line) => parseTap(line.slice(2)) ?? parseDecline(line.slice(2)) ?? parseAccept(line.slice(2));
const tapsFor = (store, reason) => tapsOf(store.read(FEEDBACK_FILE), reason);
const standingLine = (store, reason) => {
  const text = store.view(PREFS_FILE);
  if (text === null) return null;
  return factLines(text).find((l) => classifyFact(l.slice(2)) === 'standing' && parseStanding(l.slice(2)).reason === reason) ?? null;
};

/** Make the standing entry for a reason match the stored taps (>= 2 taps: one counted statement). Verified. */
function syncStanding(store, reason, at) {
  const taps = tapsFor(store, reason);
  // counts equal the taps; slots are the latest by time; after a change the sentence says it counts only taps since then
  const want = expectedStanding(store.read(FEEDBACK_FILE), reason, changeSince(store.read(PREFS_FILE), reason));
  const cur = standingLine(store, reason);
  // The source time is the newest tap's time, so the same taps give the same file whatever order they arrived in.
  const sat = want ? new Date(taps.at(-1).at).toISOString() : at;
  let ok = true;
  if (want === null) {
    if (cur !== null) ok = strip(store, PREFS_FILE, (l) => l === cur, (x) => x.startsWith(`- [P-${reason}]`));
  } else {
    const src = S.standing({ reason, at: sat });
    const doc = store.read(PREFS_FILE);
    const has = doc !== null && doc.facts.some((f) => f.text === want.text) && doc.sources.some((x) => x.text === src.text);
    if (!has) {
      ok = store.replaceFacts(PREFS_FILE,
        [...(doc?.facts ?? []).filter((f) => !(f.kind === 'standing' && f.reason === reason)), want],
        [...(doc?.sources ?? []).filter((x) => !x.text.startsWith(`[P-${reason}]`)), src]);
    }
  }
  if (ok && want !== null) ok = factLines(store.view(PREFS_FILE) ?? '').includes(`- ${want.text}`);
  return { ok, line: ok && want ? want.text : null };
}

// ---- journal: apply is idempotent, so it can be repeated until every step verifies ----

/** The history entries of a history document with the recommendation ids their sources list. */
function historyEntries(doc) {
  const out = [];
  for (const src of doc?.sources ?? []) {
    const m = /^\[H-([a-z_]+)\] type=chat; ref=history:[a-z_]+:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):([a-z_]+); observed_at=(\S+?); ids=(\S+)$/.exec(src.text);
    if (!m) continue;
    const fact = doc.facts.find((f) => f.kind === 'history' && f.reason === m[1] && f.text.endsWith(`changed on ${m[2]} (reason given: ${WHY[m[3]]})`));
    if (fact) out.push({ fact, src, reason: m[1], at: m[2], why: m[3], ids: m[5].split(','), count: Number(/^Recorded (\d+) /.exec(fact.text)[1]) });
  }
  return out;
}

/** The feedback document with the fold for `code` replaced by these { id, at } entries (none: the fold goes). */
function withFold(doc, code, entries) {
  const had = earlierOf(doc).get(code);
  const facts = doc.facts.filter((f) => f !== had?.fact);
  const sources = doc.sources.filter((x) => x !== had?.source);
  if (entries.length) {
    const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
    facts.push(F.earlier({ action: code === 'accept' ? 'accepted' : 'declined', reason: Object.hasOwn(REASONS, code) ? code : undefined, count: sorted.length }));
    sources.push(S.earlier({ code, ids: sorted, at: new Date(Math.max(...sorted.map((e) => e.at))) }));
  }
  return { facts, sources };
}
const foldEntries = (fold) => fold.ids.map((id) => ({ id, at: fold.times.get(id) }));

/** Write the history entry of ONE change (its own moment, reason and why). Idempotent: a retry finds its ids already there. */
function writeHistory(store, j) {
  const doc = store.read(HISTORY_FILE);
  const old = historyEntries(doc).find((e) => e.reason === j.reason && e.at === j.at && e.why === j.why);
  if (old) return true;
  const ids = [...j.ids].sort();                                                    // every id is kept
  const fact = F.history({ reason: j.reason, count: ids.length, at: j.at, why: j.why });
  const src = S.history({ reason: j.reason, changedAt: j.at, why: j.why, ids, at: j.at });
  if (doc === null) return store.create(HISTORY_FILE, [fact], [src]);
  return store.replaceFacts(HISTORY_FILE, [...doc.facts, fact], [...doc.sources, src]);
}

/** Each change fact counts exactly what its history entries hold: lower it (or drop it at zero) after an id is forgotten. */
function syncChangeFacts(store) {
  const doc = store.read(PREFS_FILE);
  if (doc === null) return true;
  const entries = historyEntries(store.read(HISTORY_FILE));
  let changed = false;
  const facts = [];
  for (const f of doc.facts) {
    if (f.kind !== 'change') { facts.push(f); continue; }
    const stamp = /^At the change on (\S+Z): /.exec(f.text)[1];
    const total = entries.filter((e) => e.reason === f.reason && e.at === stamp).reduce((n, e) => n + e.count, 0);
    if (total === Number(/: (\d+) declines/.exec(f.text)[1])) { facts.push(f); continue; }
    changed = true;
    if (total > 0) facts.push(F.change({ reason: f.reason, at: stamp, count: total }));
  }
  return !changed || store.replaceFacts(PREFS_FILE, facts, doc.sources);
}

/** Remove one recommendation id from wherever it is kept (a line, a fold, a history entry) and suppress it. Idempotent. */
function removeOutcome(store, id) {
  if (!store.suppress([id], true)) return false;
  let doc = store.read(FEEDBACK_FILE);
  const line = doc?.facts.find((f) => f.kind !== 'earlier' && f.key === `tap:${id}`);
  if (line && !strip(store, FEEDBACK_FILE, (l) => l === `- ${line.text}`, (x) => x.startsWith(`- [S${id}] `))) return false;
  doc = line ? store.read(FEEDBACK_FILE) : doc;
  for (const [code, fold] of doc ? earlierOf(doc) : []) {
    if (!fold.ids.includes(id)) continue;
    const next = withFold(doc, code, foldEntries(fold).filter((e) => e.id !== id));
    if (!store.replaceFacts(FEEDBACK_FILE, next.facts, next.sources)) return false;
    break;
  }
  const hist = store.read(HISTORY_FILE);
  const e = historyEntries(hist).find((x) => x.ids.includes(id));
  if (e) {
    const ids = e.ids.filter((x) => x !== id);
    const rest = { facts: hist.facts.filter((f) => f !== e.fact), sources: hist.sources.filter((x) => x !== e.src) };
    if (ids.length) {
      rest.facts.push(F.history({ reason: e.reason, count: ids.length, at: e.at, why: e.why }));
      rest.sources.push(S.history({ reason: e.reason, changedAt: e.at, why: e.why, ids, at: new Date(Date.parse(/observed_at=(\S+?);/.exec(e.src.text)[1])) }));
    }
    if (!store.replaceFacts(HISTORY_FILE, rest.facts, rest.sources)) return false;
  }
  return syncChangeFacts(store);                           // the change fact follows the history count, in the same journaled op
}

function applyJournal(store, j) {
  if (j.op === 'change_preference') {
    if (!writeHistory(store, j)) return false;
    if (!store.suppress(j.ids)) return false;
    // Only the declines that were observed at or before the change (the ids listed in the journal) move to history.
    const moved = new Set(j.ids);
    if (!strip(store, FEEDBACK_FILE, (l) => moved.has(parseTap(l.slice(2))?.recId),
      (s) => j.ids.some((id) => s.startsWith(`- [S${id}] `)))) return false;
    // The folded declines of this reason that were observed at or before the change move too; later ones stay folded.
    const fdoc = store.read(FEEDBACK_FILE);
    const fold = earlierOf(fdoc).get(j.reason);
    if (fold && fold.ids.some((id) => moved.has(id))) {
      const next = withFold(fdoc, j.reason, foldEntries(fold).filter((e) => !moved.has(e.id)));
      if (!store.replaceFacts(FEEDBACK_FILE, next.facts, next.sources)) return false;
    }
    // This change's own fact: its moment and the number of declines it moved.
    const change = F.change({ reason: j.reason, at: j.at, count: j.count });
    const csrc = S.change({ reason: j.reason, at: j.at });
    // One write, always: the current standing entry and its source leave (even when an identical change fact is
    // already there, e.g. the same change said twice), and the change fact and its source are present.
    const doc = store.read(PREFS_FILE);
    const facts = [...(doc?.facts ?? []).filter((f) => !(f.kind === 'standing' && f.reason === j.reason)), change];
    const sources = [...(doc?.sources ?? []).filter((x) => !x.text.startsWith(`[P-${j.reason}]`) && !x.text.startsWith(`[C-${j.reason}]`)), csrc];
    const same = doc !== null && doc.facts.length === new Set(facts.map((f) => f.text)).size
      && facts.every((f) => doc.facts.some((d) => d.text === f.text)) && doc.sources.length === sources.length
      && sources.every((x) => doc.sources.some((d) => d.text === x.text));
    return same || store.replaceFacts(PREFS_FILE, facts, sources);
  }
  if (j.op === 'forget_fact_type') return applyForgetFact(store, j.typeId, null);
  if (j.op === 'forget_fact_key') return applyForgetFact(store, j.typeId, j.key);
  if (j.op === 'forget_derived') return store.suppressKind(j.kind) && store.delete(j.kind) && store.view(j.kind) === null;
  if (j.op === 'forget_recommendation') return removeOutcome(store, j.id);
  if (j.op === 'forget_fold') {
    if (!store.suppress(j.ids, true)) return false;
    const fdoc = store.read(FEEDBACK_FILE);
    if (fdoc === null || !earlierOf(fdoc).has(j.code)) return true;
    const next = withFold(fdoc, j.code, []);
    return store.replaceFacts(FEEDBACK_FILE, next.facts, next.sources);
  }
  if (j.op === 'forget_taps') {
    if (!store.suppress(j.ids, true)) return false;
    const ids = new Set(j.ids);
    if (!strip(store, FEEDBACK_FILE, (l) => ids.has(outcomeOf(l)?.recId), (s) => j.ids.some((id) => s.startsWith(`- [S${id}] `)))) return false;
    return j.reasons.every((r) => syncStanding(store, r, j.at).ok);
  }
  if (j.op === 'forget_reason') return purgeReason(store, j.reason);
  return false;
}

/** A forget is complete only when no temporary file of this user remains (a stop mid-write can leave old facts in one). */
function finishForget(store) {
  store.sweepTemps();
  return store.tempFiles().length === 0;
}

/**
 * Forget a derived fact type (key = null) or one key of it, in every derived file: the suppression is written first,
 * then the lines go. Idempotent. A mix line keeps its other activities; a line with nothing left is removed.
 */
function applyForgetFact(store, typeId, key) {
  if (!(key === null ? store.suppressType(typeId) : store.suppressKey(typeId, key))) return false;
  const dropKey = (f) => {
    if (key === null) return f.kind === typeId ? null : f;
    if (typeId === 'daily') {
      // A forgotten day: its daily line goes, and so does every aggregate whose window covers it (weekly, coverage, profile,
      // mix, days of data) unless that aggregate already left the day out. The next roll recomputes them with the day excluded.
      if (f.kind === 'daily') return f.key === `daily:${key}` ? null : f;
      return f.range && key >= f.range[0] && key <= f.range[1] && !f.excludedDays.includes(key) ? null : f;
    }
    if (f.kind !== typeId) return f;
    if (typeId === 'regularity' || typeId === 'body') return stopKeyOf(f) === key ? null : f;
    if (typeId === 'mix') {
      const items = f.items.filter((i) => i.activity !== key);
      return items.length === f.items.length ? f : items.length ? F.mix({ items, asOf: f.asOf, excludedCount: f.excludedCount }) : null;   // a rebuilt mix keeps its forgotten-days count
    }
    return f.key === `${typeId}:${key}` ? null : f;
  };
  for (const kind of DERIVED_KINDS) {
    const doc = store.read(kind);
    if (doc === null) continue;
    const facts = doc.facts.map(dropKey).filter(Boolean);
    if (facts.length === doc.facts.length && facts.every((f, i) => f === doc.facts[i])) continue;
    if (!store.replaceFacts(kind, facts, doc.sources)) return false;
  }
  return DERIVED_KINDS.every((kind) => {
    const doc = store.read(kind);
    return doc === null || doc.facts.every((f) => dropKey(f) === f);
  });
}

/** Standing entries always match the stored taps, even if the process stopped between a tap and its promotion. */
function resyncStanding(store) {
  return Object.keys(REASONS).every((r) => syncStanding(store, r, new Date(0).toISOString()).ok);
}

/** Finish any half-done multi-file operation. Returns {ok, applied}. */
export function recover(store) {
  return store[ACCESS](() => store[DERIVE](() => {
    store.sweepTemps();
    const j = store.readJournal();
    if (j === null) return { ok: resyncStanding(store) && foldOld(store), applied: null };
    if (j === false) return { ok: false, applied: null };
    let done = false;
    try { done = applyJournal(store, j); } catch (e) { if (!(e instanceof TypeError)) throw e; }   // a journal no constructor accepts cannot be finished
    if (!done) return { ok: false, applied: null };
    return store.clearJournal() && resyncStanding(store) && foldOld(store) ? { ok: true, applied: j } : { ok: false, applied: null };
  }));
}

function runOp(store, j) {
  if (!store.writeJournal(j)) return false;
  return store[ACCESS](() => applyJournal(store, j) && store.clearJournal() && resyncStanding(store));
}

// ---- public operations ----

/**
 * Keep the feedback file bounded: the latest FEEDBACK_KEEP outcomes (and the latest few declines of each reason, which the
 * standing entry shows) stay as lines; older ones fold into one count per action and reason, their recommendation ids
 * kept in the fold's source (every one, with its time, sorted by id). Idempotent.
 */
function foldOld(store) {
  const doc = store.read(FEEDBACK_FILE);
  if (doc === null) return true;
  const when = new Map(doc.sources.map((x) => [/^\[S(rec_[0-9a-f]+)\]/.exec(x.text)?.[1], Date.parse(/observed_at=(\S+?)(?:;|$)/.exec(x.text)[1])]));
  const entries = doc.facts.filter((f) => f.kind !== 'earlier').map((f) => ({ fact: f, id: f.key.slice(4), at: when.get(f.key.slice(4)), code: f.kind === 'accept' ? 'accept' : f.reason ?? 'none' }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (entries.length <= FEEDBACK_KEEP) return true;
  const kept = new Set(entries.slice(-FEEDBACK_KEEP));
  for (const r of Object.keys(REASONS)) for (const e of entries.filter((x) => x.fact.kind === 'tap' && x.code === r).slice(-SHOWN_TAPS)) kept.add(e);
  const old = entries.filter((e) => !kept.has(e));
  if (old.length === 0) return true;
  let out = { facts: doc.facts.filter((f) => !old.some((e) => e.fact === f)), sources: doc.sources.filter((x) => !old.some((e) => x.text.startsWith(`[S${e.id}] `))) };
  for (const code of new Set(old.map((e) => e.code))) {
    const had = earlierOf(doc).get(code);
    const entries = [...(had ? foldEntries(had) : []), ...old.filter((e) => e.code === code).map((e) => ({ id: e.id, at: e.at }))];
    out = withFold({ facts: out.facts, sources: out.sources }, code, entries);
  }
  return store.replaceFacts(FEEDBACK_FILE, out.facts, out.sources);
}

function recordFeedbackImpl(store, { recId, activity, weekday, hour, action, reason, now } = {}) {
  const no = (why, extra = {}) => ({ written: false, promoted: null, why, ...extra });
  // One tap is an accept, or a decline. A decline may come with one of the five reasons (a second tap) or without one;
  // only an absent reason means "none": an empty or unknown reason is refused. Nothing is guessed.
  if (action !== 'accepted' && action !== 'declined') return no('action must be accepted or declined');
  const absent = reason === undefined || reason === null;
  if (action === 'accepted' && !absent) return no('an accepted recommendation takes no reason');
  if (action === 'declined' && !absent && !Object.hasOwn(REASONS, reason)) return no('the reason must be one of the five, or absent');
  let fact; let src; let at;
  try {
    at = isoTime(now);
    if (action === 'accepted' || absent) {
      fact = (action === 'accepted' ? F.accept : F.decline)({ recId, activity, weekday, hour });
      src = S.accept({ recId, at });                    // a source with no reason, for an accept and for a decline without one
    } else {
      fact = F.tap({ recId, activity, weekday, hour, reason });
      src = S.tap({ recId, reason, at });
    }
  } catch (e) { return no(e.message); }
  if (!recover(store).ok) return no('recovery pending');
  if (store.isSuppressed(recId)) return no('this recommendation id was forgotten or already moved to history', { suppressed: true });
  const doc = store.read(FEEDBACK_FILE);
  let seen = doc === null ? undefined : doc.facts.find((f) => f.key === `tap:${recId}`);   // one outcome per recommendation id
  const foldedIn = doc === null ? undefined : [...earlierOf(doc)].find(([, e]) => e.ids.includes(recId))?.[0];
  if (!seen && foldedIn !== undefined) seen = { reason: Object.hasOwn(REASONS, foldedIn) ? foldedIn : undefined };   // answered before, now folded
  if (!seen) {
    // The fold is a boundary too: an outcome not newer than the newest folded one would make the kept latest 30 depend on arrival order.
    const folded = [...earlierOf(doc).values()].flatMap((e) => [...e.times.values()]);
    if (folded.length && Date.parse(at) <= Math.max(...folded)) return no('refused: observed at or before the newest folded outcome');
  }
  if (!seen && action === 'declined' && !absent) {
    // The change is a boundary in time: a (delayed) decline observed at or before the latest change of its reason is refused.
    const ct = changeTime(store.read(PREFS_FILE), reason);
    if (ct !== null && Date.parse(at) <= ct) return no('refused: observed at or before the latest change of this preference');
  }
  let written = true;
  if (!seen) written = createOrInsert(store, FEEDBACK_FILE, fact, src);
  if (!written) return no(store.lastError ?? 'write failed');
  const out = { written: true, promoted: null };
  if (seen) out.duplicate = true;
  if (!foldOld(store)) out.foldFailed = true;               // also on a duplicate: a retry finishes a fold that failed
  const declinedReason = seen ? seen.reason : action === 'declined' && !absent ? reason : undefined;   // only reasoned declines can promote
  if (declinedReason !== undefined) {
    // Only declines of one reason are counted. Recomputed and verified on every call, so a retry also repairs a failed promotion.
    const sync = syncStanding(store, declinedReason, at);
    out.promoted = sync.line;
    if (!sync.ok) out.promotionFailed = true;
  }
  return out;
}

/** The user changed their mind about a standing entry: it moves to history with the date and why. */
function changePreferenceImpl(store, { reason, why, now } = {}) {
  let at;
  try {
    if (!Object.hasOwn(REASONS, reason) || !Object.hasOwn(WHY, why)) return false;
    at = new Date(isoTime(now)).toISOString();         // the change's own moment, to the millisecond
  } catch { return false; }
  const rec = recover(store);
  if (!rec.ok) return false;
  const a = rec.applied;
  if (a && a.op === 'change_preference' && a.reason === reason && a.at === at && a.why === why) return true;
  const cur = standingLine(store, reason);
  const latest = changeTime(store.read(PREFS_FILE), reason);
  if (cur && latest !== null && Date.parse(at) <= latest) {              // changes are applied in time order
    store.lastError = 'refused: this change is not later than the latest change of this preference';
    return false;
  }
  if (!cur) {
    // Said twice: when nothing is left to move and this very change is already recorded, the action is done.
    const doc = store.read(PREFS_FILE);
    return doc !== null && doc.facts.some((f) => f.kind === 'change' && f.reason === reason && f.text.includes(` on ${at}:`));
  }
  // The change's own time is the boundary: the declines observed at or before it are the ones that move to history.
  const cut = Date.parse(at);
  const moved = tapsFor(store, reason).filter((t) => t.at <= cut);
  const fold = earlierOf(store.read(FEEDBACK_FILE)).get(reason);
  // Folded declines are split at the change time too (a fold keeps each id's exact time, to the millisecond).
  const movedFold = (fold?.ids ?? []).filter((id) => fold.times.get(id) <= cut);
  const ids = [...new Set([...movedFold, ...moved.map((t) => t.recId)])].sort();
  if (ids.length < PROMOTE_AFTER) return false;
  return runOp(store, { op: 'change_preference', reason, why, at, count: ids.length, ids });
}

/** Remove everything stored about one reason (history, feedback, preferences last so a retry still finds it). */
function purgeReason(store, reason) {
  const isReason = (l) => reasonOf(l) === reason;
  const src = reasonSourceHit(reason);
  const fold = earlierOf(store.read(FEEDBACK_FILE)).get(reason);
  const moved = historyEntries(store.read(HISTORY_FILE)).filter((e) => e.reason === reason).flatMap((e) => e.ids);
  if (!store.suppress([...tapsFor(store, reason).map((t) => t.recId), ...(fold?.ids ?? []), ...moved], true)) return false;
  if (!strip(store, HISTORY_FILE, isReason, src)) return false;
  if (!strip(store, FEEDBACK_FILE, isReason, src)) return false;
  if (!strip(store, PREFS_FILE, isReason, src)) return false;
  return [HISTORY_FILE, FEEDBACK_FILE, PREFS_FILE].every((rel) => {
    const t = store.view(rel);
    if (t === null) return true;
    const sources = t.split('## Sources\n')[1] ?? '';
    return !factLines(t).some(isReason) && !sources.split('\n').some((l) => l.startsWith('- ') && src(l));
  });
}

/**
 * Forget a fact. A standing preference, change or history entry deletes every fact and source about that
 * reason in feedback/, preferences/ and history/. A single tap is removed and the standing entry recounted.
 * The ids of forgotten taps are kept only as sha256 hashes in forgotten.json, so a replay is ignored.
 */
function forgetImpl(store, rel, prefix) {
  if (typeof prefix !== 'string' || prefix.trim() === '' || /[\r\n]/.test(prefix)) return false;
  if (!Object.hasOwn(FILE_KINDS, rel)) return false;
  if (DERIVED_KINDS.includes(rel)) {
    // Derived files are recomputed from the health snapshot, so one line cannot stay forgotten. Use forgetDerived.
    store.lastError = `refused: ${rel} facts are recomputed from the health snapshot; use forgetFactType or forgetFactKey to stop summarising it, or forgetDerived('${rel}') to remove the whole file`;
    return false;
  }
  const rec = recover(store);
  if (!rec.ok) return false;
  const text = store.view(rel);
  const hits = text === null ? [] : factLines(text).filter((l) => l.startsWith(`- ${prefix}`));
  if (hits.length === 0) return rec.applied !== null && rec.applied.op !== 'change_preference';
  const at = new Date().toISOString();
  if (rel === FEEDBACK_FILE) {
    const outcomes = hits.map(outcomeOf).filter(Boolean);   // declines (with or without a reason) and accepts
    const reasons = [...new Set(outcomes.map((t) => t.reason).filter(Boolean))];
    if (outcomes.length && !runOp(store, { op: 'forget_taps', ids: outcomes.map((t) => t.recId), reasons, at })) return false;
    for (const l of hits.filter((x) => x.startsWith('- Earlier: '))) {                // a whole fold: its count, its ids and its source (journaled)
      const found = [...earlierOf(store.read(FEEDBACK_FILE)).entries()].find(([, x]) => `- ${x.fact.text}` === l);
      if (found && !runOp(store, { op: 'forget_fold', code: found[0], ids: [...found[1].ids].sort(), at })) return false;
    }
    const rest = hits.filter((l) => !outcomeOf(l) && !l.startsWith('- Earlier: '));
    if (rest.length && !strip(store, rel, (l) => rest.includes(l), () => false)) return false;
  } else if (rel === PREFS_FILE || rel === HISTORY_FILE) {
    const reasons = [...new Set(hits.map(reasonOf).filter(Boolean))];
    for (const r of reasons) if (!runOp(store, { op: 'forget_reason', reason: r, at })) return false;
    const rest = hits.filter((l) => !reasonOf(l));
    if (rest.length && !strip(store, rel, (l) => rest.includes(l), () => false)) return false;
  } else if (!strip(store, rel, (l) => hits.includes(l), () => false)) {
    return false;
  }
  const after = store.view(rel);
  return (after === null || !factLines(after).some((l) => l.startsWith(`- ${prefix}`))) && finishForget(store);
}

/**
 * Forget a whole derived file (profile or rolling). The suppression is recorded first, in the same validated
 * forgotten file (a hash naming only the kind), so no recompute or insert can write it again until restoreDerived.
 */
function forgetDerivedImpl(store, kind) {
  if (!DERIVED_KINDS.includes(kind) || !recover(store).ok) return false;
  return runOp(store, { op: 'forget_derived', kind, at: new Date().toISOString() }) && finishForget(store);
}

/** Allow a forgotten derived file to be written again (the next recompute recreates it). */
function restoreDerivedImpl(store, kind) {
  return DERIVED_KINDS.includes(kind) && recover(store).ok && store.unsuppressKind(kind);
}

/**
 * Planner prompt text. Every line is a template with a number: file headers and summaries are generated from
 * the file ("## path (N facts)", "- path: N facts"), never from stored text. Pinned files are printed in full,
 * other files only as a count line, after the pinned ones. If a pending journal cannot be recovered this throws:
 * no memory text is returned while memory may still hold a forgotten or half-moved fact.
 */
export function memoryIndex(store) {
  if (!recover(store).ok) throw new MemoryUnavailableError('an operation journal could not be recovered');
  const pinned = [];
  const cold = [];
  for (const rel of store.paths()) {
    const name = Object.keys(FILE_KINDS).find((n) => FILE_KINDS[n].path === rel);
    const kind = FILE_KINDS[name];
    // Printed in the canonical order, so the text does not depend on the order the file was written in.
    let facts = canonicalOrder(name, store.read(name).facts, []).facts;
    const total = facts.length;
    let note = '';
    if (name === 'rolling') {
      // The compact rolling view: all weekly lines, the latest 7 daily lines, and how many earlier daily lines are not shown.
      const daily = facts.filter((f) => f.kind === 'daily');
      const omitted = Math.max(0, daily.length - ROLLING_DAILY_SHOWN);
      const hide = new Set(daily.slice(0, omitted));
      facts = facts.filter((f) => !hide.has(f));
      if (omitted) note = `\n- ${rel}: ${omitted} earlier daily lines not shown`;
    }
    const lines = facts.map((f) => `- ${f.text}`);
    if (kind.tier === 'pinned') pinned.push(`## ${rel} (${total} facts)${note}\n${lines.join('\n')}`);
    else cold.push(`- ${rel}: ${total} facts`);
  }
  const parts = [...pinned];
  if (cold.length) parts.push([`## Other memory files (${cold.length} files)`, ...cold].join('\n'));
  return parts.join('\n');
}

export function recordFeedback(store, opts = {}) { return store[DERIVE](() => recordFeedbackImpl(store, opts)); }

export function changePreference(store, opts = {}) { return store[DERIVE](() => changePreferenceImpl(store, opts)); }

export function forget(store, rel, prefix) { return store[DERIVE](() => forgetImpl(store, rel, prefix)); }

export function forgetDerived(store, kind) { return store[DERIVE](() => forgetDerivedImpl(store, kind)); }

export function restoreDerived(store, kind) { return store[DERIVE](() => restoreDerivedImpl(store, kind)); }

/**
 * Stop summarising one kind of fact: delete every line of that fact type in every derived file and suppress the type,
 * so no create, insert, replaceFacts or recompute writes it again until restoreFactType. Journaled; reads are blocked
 * until it verifies. typeId comes from DERIVED_FACT_TYPES.
 */
export function forgetFactType(store, typeId) {
  if (typeof typeId !== 'string' || !Object.hasOwn(DERIVED_FACT_TYPES, typeId) || !recover(store).ok) return false;
  return runOp(store, { op: 'forget_fact_type', typeId, at: new Date().toISOString() }) && finishForget(store);
}

/** The same for one line of a keyed type: daily by date, weekly by week start, mix by activity, regularity by fixed slot, body by metric. */
export function forgetFactKey(store, typeId, key) {
  return store[DERIVE](() => {                                  // the store's own rebuild of a stored line (a mix) may rely on its count
    if (!validKey(typeId, key) || !recover(store).ok) return false;
    return runOp(store, { op: 'forget_fact_key', typeId, key, at: new Date().toISOString() }) && finishForget(store);
  });
}

/** Allow a forgotten fact type to be written again. */
export function restoreFactType(store, typeId) {
  return typeof typeId === 'string' && Object.hasOwn(DERIVED_FACT_TYPES, typeId) && recover(store).ok && store.unsuppressType(typeId);
}

/** Allow a forgotten key to be written again. */
export function restoreFactKey(store, typeId, key) {
  return validKey(typeId, key) && recover(store).ok && store.unsuppressKey(typeId, key);
}

/** What the daily roll and the fact engine must skip: { types: [type ids], keys: [{ type, key }] }. */
export function suppressedTypes(store) {
  if (!recover(store).ok) throw new MemoryUnavailableError('an operation journal could not be recovered');
  return store.suppressedFacts();
}

/**
 * Forget what was recorded for one recommendation id, whether it was accepted or declined, also when a change has
 * already moved the decline into a history entry: the entry loses one from its count (and goes with its source at zero).
 */
export function forgetRecommendation(store, recId) {
  return store[DERIVE](() => {
    if (typeof recId !== 'string') return false;
    const rec = recover(store);
    if (!rec.ok) return false;
    const doc = store.read(FEEDBACK_FILE);
    const present = doc?.facts.some((f) => f.kind !== 'earlier' && f.key === `tap:${recId}`)
      || [...earlierOf(doc).values()].some((x) => x.ids.includes(recId))
      || historyEntries(store.read(HISTORY_FILE)).some((e) => e.ids.includes(recId));
    if (!present) return rec.applied?.op === 'forget_recommendation' && rec.applied.id === recId;   // a retry that recovery just finished
    // Journaled: the line, the fold and the history entry are all rewritten, so a stop in the middle is finished before any read.
    return runOp(store, { op: 'forget_recommendation', id: recId, at: new Date().toISOString() }) && finishForget(store);
  });
}
