// Validator for the facts (the output). No dependencies.
// A fact is { id, group, text, numbers, window }.
// No message below contains any value from the input: fixed text, the field name and an array index only.

export const FACT_GROUPS = ['history', 'coverage', 'volume', 'past', 'load', 'regularity', 'mix', 'body', 'goal', 'feedback'];
export const WINDOW_PATTERN = /^(day|\d+d)( vs \d+d)?$/;
const KEYS = ['id', 'group', 'text', 'numbers', 'window'];

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function scalarOk(v) {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

function numbersOk(v, depth = 0) {
  if (scalarOk(v)) return true;
  if (depth >= 3) return false;
  if (Array.isArray(v)) return v.every((x) => numbersOk(x, depth + 1));
  if (isObj(v)) return Object.values(v).every((x) => numbersOk(x, depth + 1));
  return false;
}

// Sentence boundaries: a full stop (or ! or ?) that is not a decimal point. No whitespace is required after it.
// (A decimal point has a digit on both sides. Written without lookbehind, which older JavaScriptCore lacks.)
export function sentencesOf(text) {
  const t = String(text);
  const parts = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;
    const decimal = i > 0 && i < t.length - 1 && t[i - 1] >= '0' && t[i - 1] <= '9' && t[i + 1] >= '0' && t[i + 1] <= '9';
    if (decimal) continue;
    parts.push(t.slice(start, i));
    start = i + 1;
  }
  parts.push(t.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

// One sentence: ends with a period, no line break, no second sentence, at least one digit.
export function sentenceProblems(text) {
  const out = [];
  if (typeof text !== 'string' || !text.trim()) return ['text must be a non-empty string'];
  if (/[\r\n]/.test(text)) out.push('text must be a single line');
  if (!text.endsWith('.')) out.push('text must end with a period');
  const parts = sentencesOf(text);
  if (parts.length > 1) out.push('text must be one sentence');
  for (const part of parts) if (!/\d/.test(part)) out.push('a sentence has no number');
  if (/[!?]/.test(text)) out.push('text must not contain ! or ?');
  if (!/\d/.test(text)) out.push('text must contain a number');
  return out;
}

export function validateFacts(facts) {
  const errors = [];
  if (!Array.isArray(facts)) return { ok: false, errors: ['facts: must be an array'] };
  const ids = new Set();
  facts.forEach((f, i) => {
    const p = `facts[${i}]`;
    const bad = (path, msg) => errors.push(`${p}${path}: ${msg}`);
    if (!isObj(f)) return bad('', 'must be an object');
    for (const k of Object.keys(f)) if (!KEYS.includes(k)) bad('', 'unknown key');
    for (const k of KEYS) if (!(k in f)) bad(`.${k}`, 'missing');
    if (typeof f.id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(f.id)) bad('.id', 'must match [A-Za-z0-9_.-]+');
    else if (ids.has(f.id)) bad('.id', 'duplicate id');
    else ids.add(f.id);
    if (!FACT_GROUPS.includes(f.group)) bad('.group', `must be one of ${FACT_GROUPS.join(', ')}`);
    for (const m of sentenceProblems(f.text)) bad('.text', m);
    if (!isObj(f.numbers) || !Object.values(f.numbers).every((v) => numbersOk(v))) {
      bad('.numbers', 'must be an object of finite numbers, strings, booleans, null, or shallow arrays and objects of them');
    }
    if (typeof f.window !== 'string' || !WINDOW_PATTERN.test(f.window)) bad('.window', 'must look like day, 7d, 28d or "7d vs 28d"');
  });
  return { ok: errors.length === 0, errors };
}
