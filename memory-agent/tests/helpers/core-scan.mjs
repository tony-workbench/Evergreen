// Scans source text for what must not appear in the pure core: node: or bare-module imports and Node-only globals.
// Comments and string literals are ignored, so a word in a comment or an error message is not a finding.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FORBIDDEN_GLOBALS = [
  'process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename', 'setImmediate', 'clearImmediate',
  'TextEncoder', 'TextDecoder', 'structuredClone', 'fetch', 'crypto', 'global',
];

// Replaces comments and string/template text with spaces; template expressions ${...} stay as code.
export function stripNonCode(src, keepStrings = false) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' || keepStrings ? ch : ' ');
  function template() {
    out += ' '; i += 1; // the opening backtick
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { out += keepStrings ? src.slice(i, i + 2) : '  '; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        out += '  '; i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (src[i] === '{') { depth += 1; out += src[i]; i += 1; } else if (src[i] === '}') { depth -= 1; out += depth === 0 ? ' ' : src[i]; i += 1; } else if (src[i] === '`') template();
          else if (src[i] === '\'' || src[i] === '"') string(src[i]);
          else { out += src[i]; i += 1; }
        }
        continue;
      }
      out += blank(src[i]); i += 1;
    }
    out += ' '; i += 1;
  }
  function string(q) {
    out += keepStrings ? q : ' '; i += 1;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { out += keepStrings ? src.slice(i, i + 2) : '  '; i += 2; continue; }
      out += blank(src[i]); i += 1;
    }
    out += keepStrings ? q : ' '; i += 1;
  }
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { out += ' '; i += 1; } } else if (c === '/' && src[i + 1] === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i += 1; }
      out += '  '; i += 2;
    } else if (c === '\'' || c === '"') string(c);
    else if (c === '`') template();
    else { out += c; i += 1; }
  }
  return out;
}

export function scanCore(src) {
  const hits = [];
  // module specifiers must be relative
  for (const m of stripNonCode(src, true).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"]+)\1/g)) {
    if (!m[2].startsWith('./') && !m[2].startsWith('../')) hits.push(`import of ${m[2]}`);
  }
  const code = stripNonCode(src);
  for (const g of FORBIDDEN_GLOBALS) {
    if (new RegExp(`(?<![\\w$.])${g}(?![\\w$])`).test(code)) hits.push(`global ${g}`);
  }
  if (/\bimport\s*\(/.test(code) && !hits.some((h) => h.startsWith('import of'))) hits.push('dynamic import');
  return [...new Set(hits)];
}

export function scanDir(dir) {
  const out = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    for (const h of scanCore(readFileSync(join(dir, name), 'utf8'))) out.push(`${name}: ${h}`);
  }
  return out;
}
