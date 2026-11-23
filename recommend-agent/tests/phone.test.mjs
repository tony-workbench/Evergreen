// The built bundle: it loads in a bare context, sets the six globals, never throws, and needs nothing from Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { buildPhone, OUT } from '../scripts/build-phone.mjs';
import { recommendWeek, bundleArgs } from './support/sample.mjs';
import { memoryFor } from './support/harness-memory.mjs';

const GLOBALS = ['recommendWeek', 'planContext', 'checkPlan', 'explainAction', 'checkWeek', 'planBrief'];
const bundle = await buildPhone();
const fresh = () => { const c = vm.createContext({}); vm.runInContext(bundle, c); return c; };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const words = (text) => text.split(/\s+/).filter(Boolean).length;

test('the bundle sets six functions in a context with no Node globals', () => {
  const c = fresh();
  for (const name of GLOBALS) assert.equal(typeof c[name], 'function', name);
  assert.deepEqual(Object.keys(c).sort(), [...GLOBALS].sort());
});

test('the committed bundle is the current build', () => {
  assert.equal(readFileSync(OUT, 'utf8'), bundle, 'run npm run build and commit dist/recommend-phone.js');
});

test('the bundle answers like the source', () => {
  const c = fresh();
  const input = { persona: 'jordan', now: '2026-11-20T09:00:00-08:00', shoes: { boughtOn: '2026-10-22', startMiles: 267 }, raceDate: '2026-11-29' };
  input.memory = memoryFor(input);
  const out = JSON.parse(c.recommendWeek(bundleArgs('recommendWeek', input)));
  assert.equal(out.ok, true);
  assert.deepEqual(out, JSON.parse(JSON.stringify({ ok: true, ...recommendWeek(input) })));
  assert.equal(c.recommendWeek(bundleArgs('recommendWeek', input)), c.recommendWeek(bundleArgs('recommendWeek', input)));
});

test('bad input never throws and comes back as { ok: false, error: { code, text } }', () => {
  const c = fresh();
  const bad = ['', 'not json', 'null', '[]', '{}', '{"now":"yesterday"}', '{"now":"2026-11-20T09:00:00"}', '{"now":"2026-11-20T09:00:00-08:00","persona":"nobody"}',
    '{"now":"2026-11-20T09:00:00-08:00","persona":"__proto__"}', '{"now":"2026-11-20T09:00:00-08:00","persona":"jordan","memory":{"rows":"x"}}',
    '{"plan":{},"context":{"now":"2026-11-20T09:00:00-08:00"}}', '{"now":"2026-11-20T09:00:00-08:00","persona":"jordan","raceDate":"2026-02-30","shoes":{"boughtOn":"2026-10-22"}}'];
  for (const name of GLOBALS) {
    for (const input of [...bad, undefined]) {
      const out = JSON.parse(c[name](input));
      if (out.ok) continue; // some of these are fine for some tools (an empty week to check, a context with no memory)
      assert.deepEqual(Object.keys(out), ['ok', 'error'], `${name} ${input}`);
      assert.equal(typeof out.error.code, 'string');
      assert.match(out.error.text, /^[A-Z].*\.$/);
    }
    assert.equal(JSON.parse(c[name]('not json')).error.code, 'bad_json');
  }
  assert.equal(JSON.parse(c.recommendWeek('{"now":"2026-11-20T09:00:00-08:00","persona":"nobody"}')).error.code, 'missing_history');
  assert.equal(JSON.parse(c.recommendWeek('{"now":"2026-11-20T09:00:00"}')).error.code, 'bad_datetime');
  assert.equal(JSON.parse(c.checkPlan('{"plan":{},"context":{"now":"2026-11-20T09:00:00-08:00"}}')).error.code, 'bad_plan');
  assert.equal(JSON.parse(c.planContext('{"now":"2026-11-20T09:00:00-08:00","memory":{"rows":"x"}}')).error.code, 'bad_memory');
});

test('the sources that go into the bundle use nothing a phone lacks', () => {
  const dir = new URL('../src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 9);
  const banned = [/from\s+['"]node:/, /\bprocess\./, /\brequire\s*\(/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bDate\.now\s*\(/, /new Date\(\s*\)/, /\bMath\.random\b/, /\bsetTimeout\b/, /\bimport\s*\(/];
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    for (const re of banned) assert.ok(!re.test(text), `${f} uses ${re}`);
  }
  for (const re of [/\bprocess\./, /\brequire\s*\(/, /\bfetch\s*\(/, /node:/, /Users\//]) assert.ok(!re.test(bundle), `the bundle has ${re}`);
  assert.doesNotMatch(bundle, /Fixed slot among/); // memory sentences are never parsed
});

test('the bundle holds no web address: no http or https, and nothing that reads as a domain', () => {
  assert.doesNotMatch(bundle, /https?:/i);
  assert.doesNotMatch(bundle, /\bwww\./i);
  const domains = bundle.match(/\b[a-z0-9][a-z0-9-]+\.(com|net|org|io|co|it|uk|de|fr|app|dev|ai|info|us|ca|me|tv|gov|edu)\b(?![\w(])/gi) ?? [];
  assert.deepEqual([...new Set(domains)], []);
  const data = new URL('../data/', import.meta.url);
  const files = readdirSync(data, { recursive: true }).filter((f) => f.endsWith('.json'));
  assert.deepEqual(files, ['workout_ideas/running.json']);
  for (const f of files) assert.doesNotMatch(readFileSync(new URL(f, data), 'utf8'), /https?:|www\.|"(url|imageUrl|imagePage|sourceHost)"/i, f);
});

test('nothing in the bundle is left from the demo: no sample person, no sponsor or provider, no stand-in data', () => {
  const banned = /demo|scenario|persona|hackathon|sponsor|harness|\b(jordan|alex|sam)\b|superlinked|\bsie\b|senso|singlestore|nimble|qwen|vercel|anthropic|openai|gemini|claude|catalog|fit notes|day.?pass|forecast/i;
  const hits = bundle.split('\n').filter((line) => banned.test(line)).map((line) => line.trim().slice(0, 120));
  assert.deepEqual(hits, []);
  assert.equal(typeof fresh().recommendShoes, 'undefined');
});

test('docs: the example in docs/PHONE.md runs, and both documents stay short', () => {
  const doc = read('../docs/PHONE.md');
  assert.ok(words(doc.replace(/```js[\s\S]*?```/g, '')) <= 350, `docs/PHONE.md has ${words(doc.replace(/```js[\s\S]*?```/g, ''))} words`);
  assert.ok(words(read('../README.md')) <= 200, `README.md has ${words(read('../README.md'))} words`);
  for (const name of GLOBALS) assert.ok(doc.includes(`\`${name}(`), name);
  const example = /```js\n([\s\S]*?)```/.exec(doc)[1];
  const c = fresh();
  const result = vm.runInContext(`(() => { ${example}; return JSON.stringify(result); })()`, c);
  assert.deepEqual(JSON.parse(result), {
    maxMinutes: 55, line: 'The whole week can hold about 55 minutes at a steady effort; hard minutes count for more, easy ones for less.',
    pass: true, start: '2026-11-24T18:00:00-08:00', minutes: 30,
    why: 'Your usual Tuesday 6 PM run. It is your longest run of the week. Kept shorter because your race is 5 days away. It comes from a habit in your memory: a run on Tuesdays around 6 PM, seen in 4 of the last 4 weeks.',
  });
});
