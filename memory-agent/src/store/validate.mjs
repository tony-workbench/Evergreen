// Storage boundary. A document is accepted only when every line fits a template from facts.mjs.
// There is no word list: text that is not a known template is refused, whatever it says.
import { FILE_KINDS, DERIVED_KINDS, DERIVED_FACT_TYPES, validKey, REASONS, WHY, reconstructFact, reconstructSource, DAYS, REC_ID } from './facts.mjs';

export const TIERS = Object.freeze(['pinned', 'hot', 'cold']);

/**
 * Parse a stored document. Every line must be re-rendered exactly by a constructor, belong to this file kind,
 * and be unique. Returns { error } or { facts, sources } (the trusted objects).
 */
export function parseDocument(text, kindName) {
  const err = (error) => ({ error });
  if (typeof text !== 'string' || !text.endsWith('\n')) return err('document must end with a newline');
  const lines = text.slice(0, -1).split('\n');
  const k = Object.hasOwn(FILE_KINDS, kindName) ? FILE_KINDS[kindName] : null;
  if (!k || lines[0] !== `<!-- idx: tier=${k.tier}; summary=${k.summary} -->` || lines[1] !== `# ${k.title}`) {
    return err('header, summary or title does not match this file kind');
  }
  if (lines[2] !== '## Current facts') return err('missing Current facts');
  const facts = [];
  const sources = [];
  let i = 3;
  for (; i < lines.length && lines[i] !== '## Sources'; i++) {
    const f = lines[i].startsWith('- ') ? reconstructFact(lines[i].slice(2)) : null;
    if (!f) return err('a fact line is not produced by any constructor');
    if (!k.facts.includes(f.kind)) return err(`a ${f.kind} fact does not belong in this file`);
    facts.push(f);
  }
  if (lines[i] !== '## Sources') return err('missing Sources');
  for (i++; i < lines.length; i++) {
    const x = lines[i].startsWith('- ') ? reconstructSource(lines[i].slice(2)) : null;
    if (!x) return err('a source line is not produced by any constructor');
    sources.push(x);
  }
  if (new Set(facts.map((f) => f.text)).size !== facts.length) return err('duplicate fact');
  if (new Set(sources.map((x) => x.text)).size !== sources.length) return err('duplicate source');
  // One value per thing: one coverage per window, one daily line per date, one weekly line per week, one profile
  // average, one mix, one tap per recommendation id, one standing entry per reason. Conflicts are refused.
  const keys = facts.map((f) => f.key);
  if (new Set(keys).size !== keys.length) return err('two facts state the same thing (conflicting values for one key)');
  if (kindName === 'history') {
    // Each history entry has exactly one source that lists the recommendation ids it aggregated, one id per declined recommendation.
    const bySrc = new Map();
    for (const x of sources) {
      const m = /^\[H-([a-z_]+)\] type=chat; ref=history:[a-z_]+:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):([a-z_]+); observed_at=\S+?; ids=(\S+)$/.exec(x.text);
      if (!m) return err('a source in the history file is not a history source');
      const k = `${m[1]}|${m[2]}|${m[3]}`;
      if (bySrc.has(k)) return err('two sources for one history entry');
      bySrc.set(k, m[4].split(',').length);
    }
    for (const f of facts) {
      const m = /^Recorded (\d+) declines as [a-z ]+; changed on (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \(reason given: ([a-z ]+)\)$/.exec(f.text);
      const why = Object.keys(WHY).find((w) => WHY[w] === m[3]);
      const k = `${f.reason}|${m[2]}|${why}`;
      if (!bySrc.has(k)) return err('a history entry has no source listing its recommendation ids');
      if (bySrc.get(k) !== Number(m[1])) return err('a history entry counts a different number of declines than its source lists');
      bySrc.delete(k);
    }
    if (bySrc.size) return err('a history source has no entry');
  }
  if (kindName === 'feedback') {
    // Exactly one source per outcome: same recommendation id and reason, with a valid observation time (a source that
    // does not parse is already refused above). Missing, repeated, mismatched and orphan sources are refused.
    // Folded ("Earlier") facts have one source each, listing the recommendation ids they hold (sorted, unique).
    const bySource = new Map();
    const folds = new Map();
    for (const x of sources) {
      const e = /^\[E-([a-z_]+)\] type=feedback; ref=\S+; observed_at=\S+?; ids=(\S+)$/.exec(x.text);
      if (e) {
        if (folds.has(e[1])) return err('two sources for one fold');
        folds.set(e[1], e[2].split(',').map((r) => r.split('@')[0]));
        continue;
      }
      const m = /^\[S(rec_[0-9a-f]+)\] type=feedback; ref=recommendation:\S+; observed_at=\S+?(?:; excerpt=(\w+))?$/.exec(x.text);
      if (!m) return err('a source in the feedback file is not a tap source');
      if (bySource.has(m[1])) return err('two sources for one tap');
      bySource.set(m[1], m[2] ?? '');      // '' = no reason (an accept, or a decline without one)
    }
    const folded = new Set();
    for (const f of facts) {
      if (f.kind === 'earlier') {
        const code = f.key === 'earlier:accept' ? 'accept' : f.key.slice('earlier:decline:'.length);
        const ids = folds.get(code);
        if (!ids) return err('a fold has no source listing its recommendation ids');
        const count = Number(/^Earlier: (\d+) /.exec(f.text)[1]);
        if (ids.length !== count) return err('a fold counts a different number of outcomes than its source lists');
        for (const id of ids) { if (folded.has(id)) return err('a recommendation id is folded twice'); folded.add(id); }
        folds.delete(code);
        continue;
      }
      const id = f.key.slice(4);
      if (!bySource.has(id)) return err('a tap has no source (no observation time)');
      if (bySource.get(id) !== (f.reason ?? '')) return err('a tap source names another reason than its tap');
      if (folded.has(id)) return err('a recommendation id is both kept and folded');
      bySource.delete(id);
    }
    if (bySource.size) return err('a source has no tap');
    if (folds.size) return err('a fold source has no fold');
    for (const f of facts) if (f.kind !== 'earlier' && folded.has(f.key.slice(4))) return err('a recommendation id is both kept and folded');
  }
  return { facts, sources };
}

export function validateDocument(text, kindName) {
  return parseDocument(text, kindName).error ?? null;
}

export function validateForgotten(text) {
  let o;
  try { o = JSON.parse(text); } catch { return 'not JSON'; }
  if (!Array.isArray(o)) return 'must be a JSON array';
  // Entries: sha256 hex (ids and kinds), or a plain fact-type id (type:daily) fact-type key (key:weekly:2026-09-28), or a forgotten day (day:2026-10-01). Never content.
  const known = (h) => {
    if (typeof h !== 'string') return false;
    if (/^[0-9a-f]{64}$/.test(h)) return true;
    const t = /^type:([a-z]+)$/.exec(h);
    if (t) return Object.hasOwn(DERIVED_FACT_TYPES, t[1]);
    const d = /^day:(.+)$/.exec(h);
    if (d) return validKey('daily', d[1]);
    const k = /^key:([a-z]+):(.+)$/.exec(h);
    return k !== null && k[1] !== 'daily' && validKey(k[1], k[2]);
  };
  if (!o.every(known)) return 'entries must be sha256 hex, a fact type id, a fact type key or a forgotten day';
  if (new Set(o).size !== o.length) return 'duplicate entry';
  return null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = new RegExp(REC_ID);
const okReason = (r) => typeof r === 'string' && Object.hasOwn(REASONS, r);
const okIds = (a) => Array.isArray(a) && a.length <= 10000000 && a.every((x) => typeof x === 'string' && ID.test(x));
const okSlots = (a) => Array.isArray(a) && a.length >= 1 && a.length <= 5 && a.every((s) => s && Number.isInteger(s.weekday) && s.weekday >= 1 && s.weekday <= DAYS.length && Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23);

/** The operation journal: what a multi-file change is going to do, so it can be finished after a failure. */
export function validateJournal(text) {
  let o;
  try { o = JSON.parse(text); } catch { return 'not JSON'; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'bad shape';
  const keys = Object.keys(o).sort().join();
  if (typeof o.at !== 'string' || !ISO.test(o.at)) return 'bad time';
  if (o.op === 'forget_recommendation') {
    return keys === 'at,id,op' && typeof o.id === 'string' && ID.test(o.id) ? null : 'bad forget_recommendation';
  }
  if (o.op === 'forget_fold') {
    return keys === 'at,code,ids,op' && typeof o.code === 'string' && (o.code === 'accept' || o.code === 'none' || okReason(o.code)) && okIds(o.ids) ? null : 'bad forget_fold';
  }
  if (o.op === 'forget_fact_type') {
    return keys === 'at,op,typeId' && typeof o.typeId === 'string' && Object.hasOwn(DERIVED_FACT_TYPES, o.typeId) ? null : 'bad forget_fact_type';
  }
  if (o.op === 'forget_fact_key') {
    return keys === 'at,key,op,typeId' && typeof o.typeId === 'string' && validKey(o.typeId, o.key) ? null : 'bad forget_fact_key';
  }
  if (o.op === 'forget_derived') {
    return keys === 'at,kind,op' && DERIVED_KINDS.includes(o.kind) ? null : 'bad forget_derived';
  }
  if (o.op === 'forget_reason') {
    return keys === 'at,op,reason' && okReason(o.reason) ? null : 'bad forget_reason';
  }
  if (o.op === 'forget_taps') {
    return keys === 'at,ids,op,reasons' && okIds(o.ids) && Array.isArray(o.reasons) && o.reasons.every(okReason) ? null : 'bad forget_taps';
  }
  if (o.op === 'change_preference') {
    const ok = keys === 'at,count,ids,op,reason,why' && okReason(o.reason) && Object.hasOwn(WHY, o.why)
      && /\.\d{3}Z$/.test(o.at) && Number.isInteger(o.count) && o.count >= 2 && okIds(o.ids) && o.ids.length === o.count;
    return ok ? null : 'bad change_preference';
  }
  return 'unknown operation';
}
