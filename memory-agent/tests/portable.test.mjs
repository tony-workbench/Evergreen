// src/contract and src/facts must run in iOS JavaScriptCore: no Node modules, no Node-only globals, imports only
// between the two folders. This test scans their source and fails on anything Node-specific.
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const folders = ['src/contract', 'src/facts'].map((f) => join(root, f));

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// Node-only globals and syntax (an exact word or call, so ordinary identifiers such as `path` are not flagged).
const NODE_ONLY = [
  [/\bnode:/, 'node: module'],
  [/\bprocess\b\s*[.[]/, 'process'],
  [/\bBuffer\b/, 'Buffer'],
  [/\brequire\s*\(/, 'require'],
  [/\b(module|exports)\s*\./, 'CommonJS module/exports'],
  [/__dirname|__filename/, '__dirname/__filename'],
  [/\bURL(SearchParams)?\b/, 'URL'],
  [/\bTextEncoder\b|\bTextDecoder\b/, 'TextEncoder/TextDecoder'],
  [/\bfetch\s*\(/, 'fetch'],
  [/\bset(Immediate|Timeout|Interval)\s*\(/, 'timers'],
  [/\bconsole\s*\./, 'console'],
  [/\bstructuredClone\b/, 'structuredClone'],
  [/\b(performance|crypto)\s*\./, 'performance/crypto'],
  [/\b(atob|btoa)\s*\(/, 'atob/btoa'],
  [/\bimport\.meta\b/, 'import.meta'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/\b(globalThis|global)\.(process|Buffer|require)\b/, 'global Node object'],
];

export function problemsIn(code) {
  const out = [];
  const src = stripComments(code);
  for (const [re, name] of NODE_ONLY) if (re.test(src)) out.push(name);
  return out;
}

function files(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => join(dir, f));
}

test('src/contract and src/facts import only each other and use no Node-only module or global', () => {
  const all = folders.flatMap(files);
  assert.ok(all.length >= 8, 'found the source files');
  for (const file of all) {
    const code = readFileSync(file, 'utf8');
    const name = relative(root, file);
    assert.deepEqual(problemsIn(code), [], name);
    // every import / re-export specifier is relative and lands inside the two folders
    const specs = [...code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${name} imports ${spec}`);
      const target = resolve(file, '..', spec);
      assert.ok(folders.some((f) => target === f || target.startsWith(f + sep)), `${name} imports outside contract/facts: ${spec}`);
    }
    assert.ok(!/(^|\n)\s*import\s+['"]/.test(code), `${name} has a bare side-effect import`);
  }
});

test('the scanner itself catches Node-only code', () => {
  const bad = {
    "import fs from 'node:fs';": 'node: module',
    'const x = process.env.A;': 'process',
    'const b = Buffer.from("a");': 'Buffer',
    'const r = require("fs");': 'require',
    'module.exports = 1;': 'CommonJS module/exports',
    'const u = new URL("http://a");': 'URL',
    'console.log(1);': 'console',
    'setTimeout(f, 1);': 'timers',
    'const d = __dirname;': '__dirname/__filename',
    'const m = import.meta.url;': 'import.meta',
    'const t = new TextEncoder();': 'TextEncoder/TextDecoder',
    'await import("x");': 'dynamic import',
  };
  for (const [code, name] of Object.entries(bad)) assert.ok(problemsIn(code).includes(name), code);
  // ordinary code and comments are not flagged
  assert.deepEqual(problemsIn('const path = 1; // uses process and Buffer in a comment\n/* require("x") */ const a = path + 1;'), []);
});
