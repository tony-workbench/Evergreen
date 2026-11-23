// The test host: loads the phone bundles into one JavaScript context, as the app does, and checks every value they return.
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate, validateAs, explain } from '../src/validate.mjs';

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));

/** The three bundles: where each is built, the variable that points somewhere else, the globals the week uses, and the others it sets. */
export const BUNDLES = {
  memory: { path: at('../../memory-agent/dist/memory-phone.js'), env: 'EVERGREEN_MEMORY_BUNDLE', globals: ['memoryDailyRequest', 'memoryDailyApply', 'memoryDemoModel', 'memoryTable', 'memoryReject', 'memoryRestore', 'memoryConfirm', 'memoryReviewQueue'], others: ['memoryForget', 'memoryRoll', 'memoryState', 'memoryPlannerText', 'memoryBrief'] },
  recommend: { path: at('../../recommend-agent/dist/recommend-phone.js'), env: 'EVERGREEN_RECOMMEND_BUNDLE', globals: ['recommendWeek', 'planContext', 'checkPlan', 'explainAction'], others: ['planBrief', 'checkWeek'] },
  calendar: { path: at('../../calendar-planner/dist/calendar-phone.js'), env: 'EVERGREEN_CALENDAR_BUNDLE', globals: ['calendarPlan', 'calendarReplan', 'calendarIntentSchema'], others: [] },
};
export const STUBS = { memory: at('./stubs/memory-phone.js'), recommend: at('./stubs/recommend-phone.js'), calendar: at('./stubs/calendar-phone.js') };
export const bundlePaths = () => Object.fromEntries(Object.entries(BUNDLES).map(([name, b]) => [name, process.env[b.env] || b.path]));

// The in-memory file system the memory bundle writes through (memory-agent/docs/PHONE.md). Nothing touches the disk.
export function makeMemoryIO() {
  const fs = new Map();
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const get = (p) => fs.get(p) ?? fail('ENOENT');
  const put = (p, x) => (fs.has(p) ? fail('EEXIST') : fs.set(p, { isFile: !x.dir, isDirectory: !!x.dir, isSymbolicLink: false, dev: 1, ino: fs.size + 1, ...x }));
  put('/', { dir: 1 });
  return {
    platform: 'posix',
    readFile: (p) => get(p).text,
    writeFile: (p, text) => { put(p, { text }); },
    fsyncFile() {}, fsyncDir() {},
    rename: (a, b) => { fs.set(b, get(a)); fs.delete(a); },
    remove: (p) => { fs.delete(p); },
    mkdir: (p) => { put(p, { dir: 1 }); },
    lstat: get,
    realpath: (p) => (get(p), p),
    readdir: (p) => [...fs.keys()].filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).map((k) => ({ name: k.slice(p.length + 1), ...fs.get(k) })),
    sha256: (text) => createHash('sha256').update(text).digest('hex'),
  };
}

const contractError = (message) => Object.assign(new Error(message), { name: 'ContractError' });

/**
 * Loads the bundles at `paths` ({ memory, recommend, calendar }) into one fresh context.
 * -> { status, has, missing, call, tryCall, log }
 *   status[bundle]: { path, built, loadError, globals: { name: present } }
 *   call(name, args, schema): the parsed result, checked against the schema; throws a ContractError when it does not fit
 *   log[name]: { calls, valid, problems: [text] } for the status table
 */
export function loadBundles(paths = bundlePaths()) {
  const context = vm.createContext({ memoryIO: makeMemoryIO(), console: { log() {}, warn() {}, error() {}, info() {}, debug() {} } });
  const status = {}, log = {};
  for (const [name, bundle] of Object.entries(BUNDLES)) {
    const path = paths[name], built = Boolean(path) && existsSync(path);
    let loadError = null;
    if (built) {
      try { vm.runInContext(readFileSync(path, 'utf8'), context, { filename: path }); } catch (e) { loadError = `${e?.name ?? 'Error'}: ${e?.message ?? e}`; }
    }
    status[name] = { path, built, loadError, globals: Object.fromEntries([...bundle.globals, ...bundle.others].map((g) => [g, typeof context[g] === 'function'])) };
  }
  const has = (name) => typeof context[name] === 'function';

  /** What is missing for a step that needs these globals: bundles not built, and globals a built bundle does not set. */
  const missing = (names) => {
    const out = [];
    for (const [bundle, b] of Object.entries(BUNDLES)) {
      const lacks = names.filter((n) => b.globals.includes(n) && !has(n));
      if (!lacks.length) continue;
      if (!status[bundle].built) out.push(`the ${bundle} bundle is not built (${status[bundle].path})`);
      else if (status[bundle].loadError) out.push(`the ${bundle} bundle did not load (${status[bundle].loadError})`);
      else out.push(`the ${bundle} bundle does not set ${lacks.join(', ')}`);
    }
    return out;
  };

  const note = (name, problem) => {
    log[name] ??= { calls: 0, valid: 0, problems: [] };
    log[name].calls++;
    if (problem) { if (!log[name].problems.includes(problem)) log[name].problems.push(problem); } else log[name].valid++;
  };

  /** Calls a global and returns { value } or { problem }: it threw, did not return JSON, or the value does not fit the schema. */
  function tryCall(name, args, schema) {
    let text, value;
    const input = typeof args === 'string' ? args : JSON.stringify(args);
    try { text = context[name](input); } catch (e) { return { problem: `${name} threw ${e?.name ?? 'an error'} instead of returning an error value` }; }
    if (typeof text !== 'string') return { problem: `${name} returned ${typeof text}, not a JSON string` };
    try { value = JSON.parse(text); } catch { return { problem: `${name} returned text that is not JSON` }; }
    if (schema) {
      // A contract schema by name, or { name, schema } for a result the contract describes only in its Calls table.
      const label = typeof schema === 'string' ? `${schema}.schema.json` : schema.name;
      const r = typeof schema === 'string' ? validateAs(schema, value) : validate(schema.schema, value);
      if (!r.ok) {
        const failed = value && value.ok === false;
        return { value, problem: failed && schema !== 'error' ? `${name} failed with ${JSON.stringify(value.error)}${validateAs('error', value).ok ? '' : ', which does not fit error.schema.json'}` : `${name} returned a value that does not fit ${label}: ${explain(r).join('; ')}` };
      }
    }
    return { value };
  }

  function call(name, args, schema) {
    if (!has(name)) throw contractError(`${name} is not set`);
    const r = tryCall(name, args, schema);
    note(name, r.problem);
    if (r.problem) throw contractError(r.problem);
    return r.value;
  }

  return { status, has, missing, call, tryCall, note, log };
}
