// Standing entries are derived from the taps the store holds. This is the one place that says how.
import { F, REASONS, parseTap } from './facts.mjs';

export const PROMOTE_AFTER = 2;
export const SHOWN_TAPS = 5;
export const FEEDBACK_KEEP = 30;          // the feedback file keeps the latest 30 taps (and the latest 5 declines of each reason); older ones fold
const DERIVED_FACT_KINDS = Object.freeze(['standing', 'change', 'history']);
export const isDerivedFactKind = (k) => DERIVED_FACT_KINDS.includes(k);

/** Taps for one reason with their observation time (from the tap's source), oldest first; ties broken by recommendation id. */
export function tapsOf(doc, reason) {
  if (!doc) return [];
  const at = new Map(doc.sources.map((x) => [/^\[S(rec_[0-9a-f]+)\]/.exec(x.text)?.[1], Date.parse(/observed_at=(\S+?)(?:;|$)/.exec(x.text)[1])]));
  return doc.facts.map((f) => parseTap(f.text)).filter((t) => t && t.reason === reason)
    .map((t) => {
      if (!at.has(t.recId) || Number.isNaN(at.get(t.recId))) throw new TypeError('a tap has no valid observation time');   // never defaulted
      return { ...t, at: at.get(t.recId) };
    })
    .sort((a, b) => a.at - b.at || (a.recId < b.recId ? -1 : a.recId > b.recId ? 1 : 0));
}

/** The standing fact a reason must have given these taps (counts equal the taps, slots are the latest taps), or null. */
export function expectedStanding(doc, reason, since = null) {
  const taps = tapsOf(doc, reason);
  const count = taps.length + (earlierOf(doc).get(reason)?.count ?? 0);        // folded declines of this reason still count
  return count >= PROMOTE_AFTER && taps.length > 0 ? F.standing({ reason, count, slots: taps.slice(-SHOWN_TAPS), since }) : null;
}

/** The folded feedback of a document: code ('accept', 'none' or a reason) -> { fact, source, count, ids, times (id -> ms), at }. */
export function earlierOf(doc) {
  const out = new Map();
  for (const fact of doc?.facts.filter((f) => f.kind === 'earlier') ?? []) {
    const code = fact.key === 'earlier:accept' ? 'accept' : fact.key.slice('earlier:decline:'.length);
    const source = doc.sources.find((x) => x.text.startsWith(`[E-${code}] `));
    if (!source) continue;
    const rows = /; ids=(\S+)$/.exec(source.text)[1].split(',').map((x) => x.split('@'));      // every folded id, with its time
    out.set(code, {
      fact, source, count: Number(/^Earlier: (\d+) /.exec(fact.text)[1]),
      ids: rows.map((r) => r[0]), times: new Map(rows.map((r) => [r[0], Date.parse(r[1])])), at: Date.parse(/observed_at=(\S+?);/.exec(source.text)[1]),
    });
  }
  return out;
}

/**
 * The moment (ms) of the latest preference change for a reason, from the observation time of its change source, or null.
 * This is the boundary: declines observed at or before it were moved to history, and none may be recorded later.
 */
export function changeTime(prefs, reason) {
  if (!prefs) return null;
  const times = prefs.sources.filter((x) => x.text.startsWith(`[C-${reason}]`)).map((x) => Date.parse(/observed_at=(\S+?)(?:;|$)/.exec(x.text)[1]));
  return times.length ? Math.max(...times) : null;
}

/** The change moment as the UTC timestamp the standing sentence states ("since ..."), or null. */
export function changeSince(prefs, reason) {
  const t = changeTime(prefs, reason);
  return t === null ? null : new Date(t).toISOString();
}

/** Why a preferences document is not consistent with the feedback taps, or null. */
export function standingProblem(prefs, feedback) {
  for (const reason of Object.keys(REASONS)) {
    const want = expectedStanding(feedback, reason, changeSince(prefs, reason));
    const have = prefs.facts.filter((f) => f.kind === 'standing' && f.reason === reason);
    if (want === null ? have.length > 0 : have.length !== 1 || have[0].text !== want.text) return `the standing entry for ${reason} does not match the taps held`;
  }
  return null;
}

/** Why a history document is not consistent with the preferences (every history entry has its change fact), or null. */
export function historyProblem(history, prefs) {
  for (const h of history.facts) {
    const stamp = /changed on (\S+Z) /.exec(h.text)[1];
    const count = Number(/^Recorded (\d+) declines/.exec(h.text)[1]);
    // The change fact states what was moved at the change; forgetting a recommendation later can only lower the history count.
    // Each change has its own change fact, and it counts exactly the declines its history entry holds.
    const ok = (prefs?.facts ?? []).some((f) => f.kind === 'change' && f.reason === h.reason && f.text.startsWith(`At the change on ${stamp}: ${count} declines `));
    if (!ok) return 'a history entry has no matching change fact (same reason, moment and count)';
  }
  return null;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The one canonical order of a file, so the same facts always give the same bytes whatever order they arrived in.
 * Rolling: daily by date, weekly by week start, then the rest by type id and key. Every other kind: by type id and key.
 * Sources follow the order of the facts they belong to; sources that belong to no single fact come last, by text.
 */
export function canonicalOrder(kind, facts, sources) {
  const lead = kind === 'rolling' ? ['daily', 'weekly'] : [];
  const rank = (f) => { const i = lead.indexOf(f.kind); return i < 0 ? lead.length : i; };
  const fs = [...new Map(facts.map((f) => [f.text, f])).values()]
    .sort((a, b) => rank(a) - rank(b) || cmp(a.kind, b.kind) || cmp(a.key, b.key) || cmp(a.text, b.text));
  const owner = (x) => {
    const m = /^\[(S(rec_[0-9a-f]+)|([PCHE])-([a-z_]+)|S-roll)\]/.exec(x.text);
    if (!m || m[1] === 'S-roll') return Infinity;
    const i = m[2] ? fs.findIndex((f) => f.key === `tap:${m[2]}`)
      : m[3] === 'E' ? fs.findIndex((f) => f.key === (m[4] === 'accept' ? 'earlier:accept' : `earlier:decline:${m[4]}`))
      : fs.findIndex((f) => f.kind === { P: 'standing', C: 'change', H: 'history' }[m[3]] && f.reason === m[4]);
    return i < 0 ? Infinity : i;
  };
  const sx = [...new Map(sources.map((x) => [x.text, x])).values()]
    .sort((a, b) => cmp(owner(a), owner(b)) || cmp(a.text, b.text));
  return { facts: fs, sources: sx };
}
