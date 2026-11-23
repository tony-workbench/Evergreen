import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The core store (src/store/*.mjs) must load in JavaScriptCore on the phone: no Node module, no Node-only global.
// Everything Node lives in src/store/node/, used by tests and the demo only.

const NODE_GLOBALS = ['process', 'Buffer', '__dirname', '__filename', 'require', 'module', 'exports', 'setImmediate', 'clearImmediate', 'global'];

/** Strip comments and string/template contents (so a word inside text is not a global), keeping import specifiers visible. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => (m.includes('${') ? m : '``'));
}

// The store may import the engine's sentence templates (../facts/lint.mjs) and nothing else outside its own folder.
const okImport = (spec) => spec.startsWith('./') || spec === '../facts/lint.mjs';

/** What in a module breaks the portability rule: non-relative imports (node:, bare builtins) and Node-only globals. */
export function portabilityProblems(text) {
  const src = code(text);
  const problems = [];
  for (const m of src.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/g)) if (!okImport(m[2])) problems.push(`import ${m[2]}`);
  for (const m of src.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) if (!m[2].startsWith('./')) problems.push(`import ${m[2]}`);
  for (const m of src.matchAll(/\bimport\s*\(\s*(['"`])?([^'"`)]*)/g)) problems.push(`dynamic import ${m[2]}`);
  const noStrings = src.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
  for (const g of NODE_GLOBALS) {
    if (new RegExp(`(?<![.\\w$])${g}(?![\\w$])(?!\\s*:)`).test(noStrings)) problems.push(`global ${g}`);
  }
  return problems;
}

const CORE = new URL('../src/store/', import.meta.url);
const coreFiles = fs.readdirSync(CORE).filter((f) => f.endsWith('.mjs'));

test('the core store imports no Node module and uses no Node-only global', () => {
  assert.ok(coreFiles.includes('memory-store.mjs') && coreFiles.includes('facts.mjs') && !coreFiles.includes('io-node.mjs'));
  for (const f of coreFiles) assert.deepEqual(portabilityProblems(fs.readFileSync(new URL(f, CORE), 'utf8')), [], f);
});

test('only src/store/node/ touches Node, and the core cannot reach it', () => {
  const node = fs.readdirSync(new URL('node/', CORE)).filter((f) => f.endsWith('.mjs'));
  assert.deepEqual(node.sort(), ['io-node.mjs', 'node-store.mjs']);
  const all = node.flatMap((f) => portabilityProblems(fs.readFileSync(new URL(`node/${f}`, CORE), 'utf8')));
  assert.ok(all.includes('import node:fs') && all.includes('import node:crypto') && all.includes('global process'));
  // no core file imports anything from node/
  for (const f of coreFiles) assert.ok(!/from '\.\/node\//.test(fs.readFileSync(new URL(f, CORE), 'utf8')), f);
});

test('the scanner catches planted examples and leaves clean code alone', () => {
  const bad = {
    "import fs from 'node:fs';": 'import node:fs',
    "import { join } from 'node:path';": 'import node:path',
    "import crypto from 'crypto';": 'import crypto',
    "export { x } from 'fs';": 'import fs',
    "import 'node:process';": 'import node:process',
    "const m = await import('node:fs');": 'dynamic import node:fs',
    "const m = await import(name);": 'dynamic import name',
    "const p = process.platform;": 'global process',
    "const b = Buffer.from('x');": 'global Buffer',
    "const d = __dirname;": 'global __dirname',
    "const f = __filename;": 'global __filename',
    "const r = require('fs');": 'global require',
    "module.exports = {};": 'global module',
    "setImmediate(() => 0);": 'global setImmediate',
    "global.x = 1;": 'global global',
    "if (typeof process !== 'undefined') {}": 'global process',
    "const x = `${process.pid}`;": 'global process',
  };
  for (const [source, expected] of Object.entries(bad)) assert.ok(portabilityProblems(source).includes(expected), `missed: ${source} -> ${portabilityProblems(source)}`);
  const clean = [
    "import { F } from './facts.mjs';\nexport { x } from './y.mjs';",
    "// process.platform and require('fs') in a comment\nconst a = 1;",
    "/* Buffer */ const s = 'process Buffer __dirname';",
    "const o = { process: 1, exports: 2 }; o.process = 3; const t = `a ${o.exports}`;",
    "const globalThis_ok = globalThis; const processed = 1; const bufferSize = 2;",
  ];
  for (const source of clean) assert.deepEqual(portabilityProblems(source), [], source);
});
