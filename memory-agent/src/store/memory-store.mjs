// MemoryStore: Markdown files, one folder per user. Every write is read back and verified.
// Behaviour follows the Dock memory file commands (create, insert, str_replace, delete, view).
import * as path from './paths.mjs';        // portable path helpers: no Node module is imported by the core
import { validateDocument, parseDocument, validateForgotten, validateJournal } from './validate.mjs';
import { standingProblem, historyProblem, isDerivedFactKind, canonicalOrder } from './derive.mjs';
import { FILE_KINDS, DERIVED_KINDS, DERIVED_FACT_TYPES, validKey, stopKeyOf, USER_ID, REC_ID, isFact, isSource } from './facts.mjs';

const USER_RE = new RegExp(USER_ID);
const SOURCES = '## Sources';

export class PathEscapeError extends Error {
  constructor(msg = "path escapes the user's memory folder") {
    super(msg);
    this.name = 'PathEscapeError';
    this.code = 'PATH_ESCAPE';
  }
}

/** Memory cannot be read or written safely (unrecoverable journal, damaged forgotten.json). Fail closed. */
export class MemoryUnavailableError extends Error {
  constructor(msg) {
    super(`memory unavailable: ${msg}`);
    this.name = 'MemoryUnavailableError';
    this.code = 'MEMORY_UNAVAILABLE';
  }
}

export class UnrecoveredWriteError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'UnrecoveredWriteError';
    this.code = 'UNRECOVERED';
  }
}

// Durability: a plain fsync may not flush the device's own cache on some systems; that is accepted (docs/STORE.md).
/**
 * The only directory-sync errors that are tolerated, in one place. ENOTSUP and EOPNOTSUPP are the platform saying it does not
 * support syncing a directory. Windows cannot fsync a directory at all (opening one fails with EISDIR, EPERM or EINVAL), so
 * on the platforms listed in DIR_SYNC_UNSUPPORTED_PLATFORMS those codes are tolerated too. Any other error (EACCES, EIO, ENOSPC,
 * EINVAL on a platform that supports it, ...) fails the operation: a write or forget is never reported done without durability.
 */
export const DIR_SYNC_TOLERATED = Object.freeze(['ENOTSUP', 'EOPNOTSUPP']);
export const DIR_SYNC_UNSUPPORTED_PLATFORMS = Object.freeze({ win32: Object.freeze(['EINVAL', 'EPERM', 'EISDIR']) });
export function toleratedDirSyncError(code, platform = 'posix') {
  return DIR_SYNC_TOLERATED.includes(code) || (DIR_SYNC_UNSUPPORTED_PLATFORMS[platform] ?? []).includes(code);
}
/** Temporary files are named <target>.memtmp (store-owned, one per target) and swept on construction, in recover and before a forget completes. */
export const TEMP_SUFFIX = '.memtmp';
const FORGOTTEN = 'forgotten.json';
const JOURNAL = 'journal.json';
/** The suppression entry for one key. A forgotten daily key is a forgotten DAY (`day:2026-10-01`); others are `key:type:key`. */
const keyEntry = (typeId, key) => (typeId === 'daily' ? `day:${key}` : `key:${typeId}:${key}`);
const kindKey = (kind) => `derived-kind:${kind}`;
/** Internal switch for code in this package that owns the journal; not exported from index.mjs. */
export const ACCESS = Symbol('journal access');
/** Internal switch for the store's own recompute (standing, change and history facts). Not exported from index.mjs. */
export const DERIVE = Symbol('derive');

export function section(text, name) {
  const lines = text.split('\n');
  const start = lines.indexOf(`## ${name}`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('## ')) { end = i; break; }
  return lines.slice(start + 1, end).join('\n');
}

export function factLines(text) {
  return section(text, 'Current facts').split('\n').filter((l) => l.startsWith('- '));
}

export class MemoryStore {
  #io;
  #user;
  #id;
  #allow = 0;
  #derive = 0;

  /**
   * @param {string} root  folder that holds one sub-folder per user
   * @param {string} user  user id: usr_ followed by 8 to 32 lowercase hex characters
   * @param {object} opts  `io` (required): the host's io object (contract in node/io-node.mjs). The test hooks writeFile,
   *   fsyncFile, rename, remove and fsyncDir override single methods of it.
   */
  constructor(root, user, opts = {}) {
    if (typeof user !== 'string' || !USER_RE.test(user)) throw new PathEscapeError('invalid user id');
    // Every file-system call and the hash go through this one object (docs/STORE.md, "Running on the phone").
    const hooks = Object.fromEntries(['writeFile', 'fsyncFile', 'rename', 'remove', 'fsyncDir'].filter((k) => opts[k]).map((k) => [k, opts[k]]));
    if (!opts.io || typeof opts.io.readFile !== 'function') throw new TypeError('MemoryStore needs an io object (see node/io-node.mjs for the contract)');
    if (!path.isAbsolute(root)) throw new TypeError('the root must be an absolute path');
    this.#io = { ...opts.io, ...hooks };
    this.#makeDirs(root);
    this.root = this.#io.realpath(root);
    this.dir = path.join(this.root, user);
    try {
      if (this.#io.lstat(this.dir).isSymbolicLink) throw new PathEscapeError('user folder is a symlink');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.#makeDirs(this.dir);                       // the user folder's own entry survives a power loss
    this.realDir = this.#io.realpath(this.dir);
    if (this.realDir !== path.join(this.root, user) || path.basename(this.realDir) !== user) {
      throw new PathEscapeError('user folder is not directly under the root, or its name is not exactly the id');
    }
    this.#user = user;
    const own = this.#io.lstat(this.dir);
    this.#id = `${own.dev}:${own.ino}`;
    this.lastStatus = 'ok';   // 'ok' | 'failed' | 'unrecovered'
    this.lastError = null;
    this.sweepTemps();
  }

  /** Flush a directory. Only the documented "not supported" errors are tolerated (see toleratedDirSyncError). */
  #syncDir(d) {
    try { this.#io.fsyncDir(d); } catch (e) { if (!toleratedDirSyncError(e.code, this.#io.platform)) throw e; }
  }

  #lstat(p) {
    try { return this.#io.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }

  /** Create a directory and every missing ancestor one level at a time, syncing the parent of each directory created. */
  #makeDirs(dir) {
    const missing = [];
    for (let d = dir; ; d = path.dirname(d)) {
      if (this.#lstat(d)) break;
      missing.unshift(d);
      if (path.dirname(d) === d) break;
    }
    for (const d of missing) {
      this.#io.mkdir(d);
      this.#syncDir(path.dirname(d));
    }
  }

  /** The text of a file, null when absent (ENOENT, and only that), or undefined when it exists but cannot be read. */
  #readState(p) {
    try { return this.#io.readFile(p); } catch (e) { return e.code === 'ENOENT' ? null : undefined; }
  }

  /** Absolute path inside the user's folder, or throws PathEscapeError (../, absolute, symlink). */
  path(rel) {
    this.#checkDir();
    if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || rel.includes('\\')) throw new PathEscapeError();
    if (path.isAbsolute(rel)) throw new PathEscapeError();
    const parts = rel.split('/');
    if (parts.some((p) => p === '..' || p === '' || p === '.')) throw new PathEscapeError();
    let cur = this.realDir;
    for (const part of parts) {
      cur = path.join(cur, part);
      let st;
      st = this.#lstat(cur);
      if (st === null) continue;
      if (st.isSymbolicLink) throw new PathEscapeError('symlink in the memory folder');
    }
    return cur;
  }

  /**
   * Checked before every read, write and delete: the user folder is still a real directory (not a symlink),
   * directly under the root, with exactly the expected name. Node cannot anchor to a directory descriptor, so a swap
   * between this check and the following call is a known limit (see docs/STORE.md).
   */
  #checkDir() {
    let st;
    try { st = this.#io.lstat(this.dir); } catch { throw new PathEscapeError('user folder is missing'); }
    if (st.isSymbolicLink || !st.isDirectory) throw new PathEscapeError('user folder is not a real directory');
    if (`${st.dev}:${st.ino}` !== this.#id) throw new PathEscapeError('user folder was replaced');
    if (path.basename(this.dir) !== this.#user || path.dirname(this.dir) !== this.root) throw new PathEscapeError('user folder moved');
    if (this.#io.realpath(this.dir) !== this.realDir || this.#io.realpath(path.dirname(this.dir)) !== this.root) {
      throw new PathEscapeError('user folder or root was replaced');
    }
  }

  #rel(kind) {
    if (typeof kind !== 'string' || !Object.hasOwn(FILE_KINDS, kind)) throw new TypeError('unknown file kind');
    return FILE_KINDS[kind].path;
  }

  #readStrict(rel) {
    const p = this.path(rel);
    try { return this.#io.readFile(p); } catch (e) {
      if (e.code === 'ENOENT') return null;
      if (e instanceof PathEscapeError) throw e;
      if (e.code === 'ELOOP') throw new PathEscapeError('symlink in the memory folder');
      throw new MemoryUnavailableError(`${rel} cannot be read`);
    }
  }

  /** Fail closed: a damaged forgotten.json, or a journal that has not been recovered, blocks every read and write. */
  #guard() {
    this.#hashes();
    this.#checkDir();
    if (this.#allow === 0 && this.#lstat(this.path(JOURNAL)) !== null) throw new MemoryUnavailableError('an operation journal is waiting to be recovered');
  }

  /** Run fn with journal access (recovery and operations that own the journal). Internal: reached through the ACCESS symbol. */
  [ACCESS](fn) {
    this.#allow++;
    try { return fn(); } finally { this.#allow--; }
  }

  /** Run fn as the store's own recompute: only then may standing, change and history facts be written (and read while out of step). */
  [DERIVE](fn) {
    this.#derive++;
    try { return fn(); } finally { this.#derive--; }
  }

  /** Text of a memory file. The whole file is validated against the templates on every read; an invalid file throws. */
  view(kind) {
    return this.#load(kind)?.text ?? null;
  }

  /** The trusted fact and source objects of a file ({facts, sources}), or null when the file does not exist. */
  read(kind) {
    return this.#load(kind);
  }

  #load(kind, check = this.#derive === 0) {
    this.#guard();
    const text = this.#readStrict(this.#rel(kind));
    if (text === null) return null;
    const doc = parseDocument(text, kind);
    if (doc.error) throw new MemoryUnavailableError(`${FILE_KINDS[kind].path} is not valid (${doc.error})`);
    // Outside the store's own recompute, derived facts must agree with the taps the store holds.
    if (check && kind === 'preferences') {
      const problem = standingProblem(doc, this.#load('feedback', false));
      if (problem) throw new MemoryUnavailableError(`${FILE_KINDS[kind].path} is not consistent (${problem})`);
    }
    if (check && kind === 'history') {
      const problem = historyProblem(doc, this.#load('preferences', false));
      if (problem) throw new MemoryUnavailableError(`${FILE_KINDS[kind].path} is not consistent (${problem})`);
    }
    return { text, facts: doc.facts, sources: doc.sources };
  }

  /**
   * Validate, write to a temp file, read it back, rename over the target, read back again.
   * False means nothing changed. UnrecoveredWriteError means the target could not be restored.
   */
  /** Delete a file and make the deletion durable: remove, then fsync the containing directory. Nothing to do if it is not there. */
  #removeDurable(p, always = false) {
    if (this.#lstat(p) === null) {
      // Already gone. A retry after a failed directory sync must still make the earlier removal durable (only for explicit deletes).
      if (always && this.#lstat(path.dirname(p)) !== null) this.#syncDir(path.dirname(p));
      return;
    }
    this.#io.remove(p);
    this.#syncDir(path.dirname(p));
  }

  /** Create the directory (and any missing parents under the user folder), fsyncing each parent so the new entry survives a power loss. */
  #ensureDir(dir) {
    const missing = [];
    for (let d = dir; d !== this.realDir && d.startsWith(`${this.realDir}/`); d = path.dirname(d)) {
      if (this.#lstat(d) !== null) break;
      missing.unshift(d);
    }
    for (const d of missing) {
      this.#io.mkdir(d);
      this.#syncDir(path.dirname(d));
    }
  }

  #write(kind, text) { return this.#put(this.#rel(kind), text, (t) => validateDocument(t, kind)); }

  #put(rel, text, check) {
    this.#guard();
    const p = this.path(rel);
    const bad = check(text);
    if (bad) { this.lastError = `rejected: ${bad}`; this.lastStatus = 'failed'; return false; }
    // Only ENOENT means "absent". A file that exists but cannot be read is never overwritten: nothing is written.
    const before = this.#readState(p);
    if (before === undefined) { this.lastError = `${rel} exists but cannot be read`; this.lastStatus = 'failed'; throw new MemoryUnavailableError(`${rel} cannot be read`); }
    this.#checkDir();
    const tmp = `${p}${TEMP_SUFFIX}`;
    // The one write path: temp file, fsync it, check it, rename, fsync the directory, check the target.
    const put = (content) => {
      this.#removeDurable(tmp);                       // a leftover from a dead process
      this.#io.writeFile(tmp, content);
      this.#io.fsyncFile(tmp);
      if (this.#readState(tmp) !== content) throw new Error('read-back mismatch (temp file)');
      this.#checkDir();
      this.#io.rename(tmp, p);
      this.#syncDir(path.dirname(p));
      if (this.#readState(p) !== content) throw new Error('read-back mismatch');
    };
    try {
      this.#ensureDir(path.dirname(p));
      put(text);
      this.lastError = null; this.lastStatus = 'ok';
      return true;
    } catch (e) {
      this.lastError = `write failed: ${e.message}`;
    }
    try { this.#removeDurable(tmp); } catch { /* the sweep removes it later */ }
    if (this.#readState(p) !== before) {
      try { if (before === null) this.#removeDurable(p); else put(before); } catch { /* checked below */ }
      try { this.#removeDurable(tmp); } catch { /* the sweep removes it later */ }
      if (this.#readState(p) !== before) {
        this.lastStatus = 'unrecovered';
        throw new UnrecoveredWriteError(`could not restore ${rel} after a failed write`);
      }
    }
    this.lastStatus = 'failed';
    return false;
  }

  /** The one write path for memory files: objects in, canonical text out, verified. */
  #commit(kind, facts, sources) {
    if (!Object.hasOwn(FILE_KINDS, kind) || !Array.isArray(facts) || !Array.isArray(sources)) return false;
    if (!facts.every(isFact) || !sources.every(isSource)) return false;
    if (this.#derive === 0 && facts.some((f) => isDerivedFactKind(f.kind))) {
      this.lastError = 'rejected: standing, change and history facts are derived by the store, callers cannot write them';
      return false;
    }
    if (DERIVED_KINDS.includes(kind) && this.kindSuppressed(kind)) { this.lastError = 'rejected: this derived file was forgotten'; return false; }
    // Every write passes here, so a forgotten recommendation id cannot come back through any public method.
    const gone = this.#hashes();
    const ids = [...facts.filter((f) => f.kind === 'tap' || f.kind === 'accept' || f.kind === 'decline').map((f) => f.key.slice(4)),
      ...sources.map((x) => /^\[S(rec_[0-9a-f]+)\]/.exec(x.text)?.[1]).filter(Boolean)];
    for (const f of facts) {
      const keyed = Object.hasOwn(DERIVED_FACT_TYPES, f.kind) ? DERIVED_FACT_TYPES[f.kind].keyed : null;
      const hit = gone.includes(`type:${f.kind}`)
        || (f.kind === 'daily' && gone.includes(`day:${f.key.slice(6)}`))          // a forgotten day
        || (keyed === 'date' && f.kind !== 'daily' && gone.includes(`key:${f.kind}:${f.key.slice(f.kind.length + 1)}`))
        || (keyed === 'activity' && f.activities.some((a) => gone.includes(`key:${f.kind}:${a}`)))
        || ((keyed === 'slot' || keyed === 'metric') && stopKeyOf(f) !== null && gone.includes(`key:${f.kind}:${stopKeyOf(f)}`));
      if (hit) { this.lastError = `rejected: ${f.kind} facts (or this key) were forgotten and are suppressed`; return false; }
    }
    if (ids.some((id) => gone.includes(this.#io.sha256(id)))) { this.lastError = 'rejected: a forgotten recommendation id'; return false; }
    // Ids listed inside a fold or history source must not be forgotten ones (moved-to-history ids are suppressed but not forgotten).
    for (const x of sources) {
      const list = /; ids=(\S+)$/.exec(x.text)?.[1];
      if (list && list.split(',').some((r) => gone.includes(this.#io.sha256(`forgotten:${r.split('@')[0]}`)))) {
        this.lastError = 'rejected: a forgotten recommendation id in a fold or history source';
        return false;
      }
    }
    // A new aggregate over dates (weekly, coverage, profile, mix) may not cover a forgotten day unless its computation excluded it.
    const days = gone.filter((h) => h.startsWith('day:')).map((h) => h.slice(4));
    if (days.length || facts.some((f) => f.range && f.excludedCount > 0)) {
      const have = new Set((this.#load(kind, false)?.facts ?? []).map((f) => f.text));
      for (const f of facts) {
        if (!f.range || have.has(f.text) || this.#derive > 0) continue;
        // A caller's new aggregate that says days were left out must name them, and each must be a day that is actually forgotten.
        if (f.excludedCount > 0 && f.excludedDays.length === 0) { this.lastError = `rejected: this ${f.kind} fact claims left-out days without naming them`; return false; }
        const stray = f.excludedDays.find((d) => !days.includes(d));
        if (stray) { this.lastError = `rejected: this ${f.kind} fact leaves out ${stray}, which is not a forgotten day`; return false; }
      }
      for (const f of facts) {
        if (!f.range || have.has(f.text)) continue;
        const inside = days.filter((d) => d >= f.range[0] && d <= f.range[1]);
        // A caller's new aggregate must list the actual days it left out. Only the store's own rebuild of a stored line (which keeps just
        // a count) may rely on the count, and then it must leave out at least as many days as are forgotten.
        const missing = f.excludedDays.length ? inside.filter((d) => !f.excludedDays.includes(d)) : (this.#derive > 0 && inside.length <= f.excludedCount ? [] : inside);
        const hit = missing[0];
        if (hit) { this.lastError = `rejected: this ${f.kind} fact covers the forgotten day ${hit} without excluding it`; return false; }
      }
    }
    const k = FILE_KINDS[kind];
    const ordered = canonicalOrder(kind, facts, sources);       // every file is written in one canonical order
    return this.#write(kind, `<!-- idx: tier=${k.tier}; summary=${k.summary} -->\n# ${k.title}\n## Current facts\n`
      + ordered.facts.map((x) => `- ${x.text}\n`).join('') + `${SOURCES}\n` + ordered.sources.map((x) => `- ${x.text}\n`).join(''));
  }

  /** facts and sources must be objects made by the constructors in facts.mjs; raw text is refused. */
  create(kind, facts, sources) {
    if (!Object.hasOwn(FILE_KINDS, kind) || !Array.isArray(facts) || !Array.isArray(sources)) return false;
    if (!facts.every(isFact) || !sources.every(isSource)) return false;
    if (this.view(kind) !== null) return false;
    return this.#commit(kind, facts, sources);
  }

  /** Add a fact and its source in one verified write. A duplicate fact is ignored (true, nothing written). */
  insert(kind, fact, src) {
    if (!isFact(fact) || !isSource(src)) return false;
    const doc = this.read(kind);
    if (doc === null) return false;
    if (doc.facts.some((f) => f.text === fact.text)) return true;
    return this.#commit(kind, [...doc.facts, fact], [...doc.sources, src]);
  }

  /** Replace one existing fact by a new fact object; the source (if given) is added in the same write. */
  strReplace(kind, oldText, fact, src) {
    if (typeof oldText !== 'string' || oldText === '' || !isFact(fact) || (src !== undefined && !isSource(src))) return false;
    const doc = this.read(kind);
    if (doc === null || !doc.facts.some((f) => f.text === oldText)) return false;
    return this.#commit(kind, doc.facts.map((f) => (f.text === oldText ? fact : f)), src ? [...doc.sources, src] : doc.sources);
  }

  /** Replace the whole file with these fact and source objects. An empty fact list deletes the file. */
  replaceFacts(kind, facts, sources = []) {
    if (!Object.hasOwn(FILE_KINDS, kind) || !Array.isArray(facts) || !Array.isArray(sources)) return false;
    if (!facts.every(isFact) || !sources.every(isSource)) return false;
    if (facts.length === 0) return this.delete(kind);
    return this.#commit(kind, facts, sources);
  }

  /** Delete a memory file (works even on a file that is no longer valid, so it can be cleared). */
  delete(kind) {
    this.#guard();
    this.#readStrict(this.#rel(kind));            // a file that exists but cannot be read is not deleted blind
    return this.#remove(this.#rel(kind));
  }

  #remove(rel) {
    const p = this.path(rel);
    this.#checkDir();
    try { this.#removeDurable(p, true); } catch { return false; }
    return this.#lstat(p) === null;
  }

  /** forgotten.json: sha256 hex of ids that were forgotten or moved to history, and of derived kinds that were forgotten. */
  #hashes() {
    const t = this.#readStrict(FORGOTTEN);
    if (t === null) return [];
    if (validateForgotten(t) !== null) throw new MemoryUnavailableError('forgotten.json is damaged');
    return JSON.parse(t);
  }
  #store(hashes) { return this.#put(FORGOTTEN, `${JSON.stringify([...new Set(hashes)].sort())}\n`, validateForgotten); }

  isSuppressed(id) { return typeof id === 'string' && this.#hashes().includes(this.#io.sha256(id)); }
  /** Suppress recommendation ids. `forgotten` also marks them forgotten, so they cannot be written back into a fold or history source. */
  suppress(ids, forgotten = false) {
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string' && new RegExp(REC_ID).test(x))) return false;
    const have = this.#hashes();
    const merged = [...new Set([...have, ...ids.flatMap((x) => (forgotten ? [this.#io.sha256(x), this.#io.sha256(`forgotten:${x}`)] : [this.#io.sha256(x)]))])];
    return merged.length === have.length ? true : this.#store(merged);
  }

  /** A derived kind (profile, rolling) that was forgotten is not written again until it is restored. */
  kindSuppressed(kind) { return this.#hashes().includes(this.#io.sha256(kindKey(kind))); }
  suppressKind(kind) {
    if (!DERIVED_KINDS.includes(kind)) return false;
    const have = this.#hashes();
    return have.includes(this.#io.sha256(kindKey(kind))) ? true : this.#store([...have, this.#io.sha256(kindKey(kind))]);
  }
  unsuppressKind(kind) {
    if (!DERIVED_KINDS.includes(kind)) return false;
    const have = this.#hashes();
    return have.includes(this.#io.sha256(kindKey(kind))) ? this.#store(have.filter((h) => h !== this.#io.sha256(kindKey(kind)))) : true;
  }

  /** Suppression of a derived fact type, or of one key of a keyed type. Plain ids and keys in forgotten.json, never content. */
  typeSuppressed(typeId) { return this.#hashes().includes(`type:${typeId}`); }
  keySuppressed(typeId, key) { return this.#hashes().includes(keyEntry(typeId, key)); }
  #mark(entry, on) {
    const have = this.#hashes();
    if (have.includes(entry) === on) return true;
    return this.#store(on ? [...have, entry] : have.filter((h) => h !== entry));
  }
  suppressType(typeId) { return Object.hasOwn(DERIVED_FACT_TYPES, typeId) && this.#mark(`type:${typeId}`, true); }
  unsuppressType(typeId) { return Object.hasOwn(DERIVED_FACT_TYPES, typeId) && this.#mark(`type:${typeId}`, false); }
  suppressKey(typeId, key) { return validKey(typeId, key) && this.#mark(keyEntry(typeId, key), true); }
  unsuppressKey(typeId, key) { return validKey(typeId, key) && this.#mark(keyEntry(typeId, key), false); }
  /** What is suppressed, for the roll and the fact engine to skip: type ids, keys and forgotten days only. */
  suppressedFacts() {
    const types = [];
    const keys = [];
    const days = [];
    for (const h of this.#hashes()) {
      const t = /^type:(.+)$/.exec(h);
      const k = /^key:([a-z]+):(.+)$/.exec(h);
      const d = /^day:(.+)$/.exec(h);
      if (t) types.push(t[1]); else if (k) keys.push({ type: k[1], key: k[2] }); else if (d) days.push(d[1]);
    }
    return { types: types.sort(), keys: keys.sort((a, b) => (a.type + a.key < b.type + b.key ? -1 : 1)), days: days.sort() };
  }

  /** Operation journal for multi-file changes. null = none, false = present but unreadable. */
  readJournal() {
    this.#hashes();
    let t;
    try { t = this.#readStrict(JOURNAL); } catch { return false; }
    if (t === null) return null;
    return validateJournal(t) === null ? JSON.parse(t) : false;
  }
  writeJournal(op) { return this[ACCESS](() => this.#put(JOURNAL, `${JSON.stringify(op)}\n`, validateJournal)); }
  clearJournal() { this.#hashes(); return this.#remove(JOURNAL); }

  /** Paths (relative) of leftover temporary files under the user folder. */
  tempFiles() {
    this.#checkDir();
    const out = [];
    const walk = (dir, prefix) => {
      for (const e of this.#io.readdir(dir)) {
        if (e.name.endsWith(TEMP_SUFFIX)) out.push(`${prefix}${e.name}`);
        else if (e.isDirectory && !e.isSymbolicLink) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      }
    };
    walk(this.realDir, '');
    return out.sort();
  }

  /**
   * Remove every leftover temporary file. Each one must be a regular file (or a symlink, which is only unlinked,
   * never followed) inside the user's folder; a directory with a temp name makes the store unavailable.
   */
  sweepTemps() {
    let removed = 0;
    for (const rel of this.tempFiles()) {
      const p = path.join(this.realDir, ...rel.split('/'));
      const st = this.#io.lstat(p);
      if (st.isDirectory) throw new MemoryUnavailableError(`${rel} is a directory with a temporary file name`);
      try { this.#removeDurable(p); } catch { throw new MemoryUnavailableError(`${rel} could not be removed`); }
      removed++;
    }
    return removed;
  }

  /** Sorted paths of the memory files that exist (only the fixed per-kind paths; stray files are never listed). */
  paths() {
    this.#guard();
    return Object.values(FILE_KINDS).map((k) => k.path).filter((rel) => {
      try { return this.#lstat(this.path(rel))?.isFile === true; } catch (e) { if (e instanceof PathEscapeError) throw e; return false; }
    }).sort();
  }

  /** Read a file by its fixed path (as listed by paths()). */
  viewPath(rel) {
    const k = Object.keys(FILE_KINDS).find((n) => FILE_KINDS[n].path === rel);
    if (!k) throw new TypeError('not a memory file path');
    return this.view(k);
  }
}
