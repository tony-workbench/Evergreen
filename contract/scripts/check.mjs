// Integration status at a glance: for each global of the three bundles, is it there and do its results fit the contract?
// Run: node scripts/check.mjs   (bundles elsewhere: EVERGREEN_MEMORY_BUNDLE, EVERGREEN_RECOMMEND_BUNDLE, EVERGREEN_CALENDAR_BUNDLE)
// It runs the week of tests/week-scenario.mjs for each person and exits 1 when anything is missing, skipped or wrong.
import { BUNDLES, loadBundles, bundlePaths } from '../tests/host.mjs';
import { runWeek, persona, PERSONAS } from '../tests/week-scenario.mjs';

const paths = bundlePaths(), globals = {}, steps = new Map();
let status;
for (const name of PERSONAS) {
  const host = loadBundles(paths);
  status = host.status;
  await runWeek(host, persona(name), async (title, needs, fn) => {
    const s = steps.get(title) ?? steps.set(title, { skipped: null, failed: [] }).get(title);
    const missing = host.missing(needs);
    if (missing.length) { s.skipped = missing.join('; '); return; }
    try { await fn(); } catch (e) { s.failed.push(`${name}: ${e.message.split('\n')[0]}`); }
  });
  for (const [g, l] of Object.entries(host.log)) {
    const all = globals[g] ??= { calls: 0, valid: 0, problems: [] };
    all.calls += l.calls; all.valid += l.valid;
    for (const p of l.problems) if (!all.problems.includes(p)) all.problems.push(p);
  }
}

const rows = [];
for (const [bundle, b] of Object.entries(BUNDLES)) {
  const st = status[bundle];
  for (const g of [...b.globals, ...b.others]) {
    const present = st.globals[g], l = globals[g];
    const valid = !present ? '-' : !l ? 'not in the week' : l.problems.length ? `NO (${l.valid}/${l.calls} calls)` : `yes (${l.calls} calls)`;
    rows.push([bundle, g, present ? 'yes' : st.built ? 'NO' : 'not built', valid]);
  }
}
const head = ['bundle', 'global', 'present?', 'output valid?'];
const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r) => r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd();
console.log([line(head), line(width.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n'));

console.log('\nBundles');
for (const [bundle, st] of Object.entries(status)) console.log(`  ${bundle}: ${st.loadError ? `did not load: ${st.loadError}` : st.built ? 'built' : 'not built'}  ${st.path}`);

console.log('\nThe week');
let bad = rows.some((r) => r[2] !== 'yes' || r[3].startsWith('NO') || r[3] === '-');
for (const [title, s] of steps) {
  const mark = s.skipped ? 'SKIP' : s.failed.length ? 'FAIL' : 'ok  ';
  if (mark !== 'ok  ') bad = true;
  console.log(`  ${mark}  ${title}${s.skipped ? `\n          missing: ${s.skipped}` : ''}${s.failed.map((f) => `\n          ${f}`).join('')}`);
}
const problems = Object.entries(globals).filter(([, l]) => l.problems.length);
if (problems.length) {
  console.log('\nValues that do not fit the contract');
  for (const [g, l] of problems) for (const p of l.problems) console.log(`  ${g}: ${p}`);
}
// The globals the week does not call: do they at least fail in the contract's Error form?
const probe = loadBundles(paths), names = [];
for (const b of Object.values(BUNDLES)) for (const g of b.others) if (probe.has(g) && probe.tryCall(g, '{', 'error').problem) names.push(g);
if (names.length) console.log(`\nNot in the week, and their failure is not { ok: false, error: { code, text } }: ${names.join(', ')}`);
const tally = [...steps.values()].reduce((n, s) => { n[s.skipped ? 'skipped' : s.failed.length ? 'failed' : 'passed']++; return n; }, { passed: 0, failed: 0, skipped: 0 });
console.log(`\nweek parts: ${tally.passed} passed, ${tally.failed} failed, ${tally.skipped} skipped`);
process.exit(bad ? 1 : 0);
