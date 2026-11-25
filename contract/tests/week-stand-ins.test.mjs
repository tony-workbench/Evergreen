// The same week on the stand-in bundles in tests/stubs, which follow the contract. This checks the week test itself:
// here nothing may be skipped and everything must pass, and a stand-in that breaks a schema must be caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBundles, STUBS } from './host.mjs';
import { runWeek, persona, PERSONAS } from './week-scenario.mjs';

const run = async (paths, name) => {
  const host = loadBundles(paths), failed = [], skipped = [];
  await runWeek(host, persona(name), async (title, needs, fn) => {
    if (host.missing(needs).length) { skipped.push(title); return; }
    try { await fn(); } catch (e) { failed.push(`${title}: ${e.message}`); }
  });
  return { host, failed, skipped };
};

for (const name of PERSONAS) {
  test(`the week runs to the end for ${name} on the stand-ins`, async () => {
    const { failed, skipped } = await run(STUBS, name);
    assert.deepEqual(failed, []);
    assert.deepEqual(skipped, []);
  });
}

test('a bundle that is not built is named, and only its parts are skipped', async () => {
  const { host, failed, skipped } = await run({ ...STUBS, memory: '/nowhere/memory-phone.js' }, 'sam');
  assert.deepEqual(failed, []);
  assert.equal(skipped.length, 4, skipped.join('; '));
  assert.deepEqual(host.missing(['memoryTable', 'checkPlan']), ['the memory bundle is not built (/nowhere/memory-phone.js)']);
});

test('a present global that breaks a schema fails, and a missing global is named', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'contract-'));
  try {
    const broken = join(dir, 'calendar-phone.js');
    // The calendar stand-in, but with errors as bare names, "long run" with a space, and no calendarReplan.
    writeFileSync(broken, readFileSync(STUBS.calendar, 'utf8')
      .replace("const fail = (code, text) => ({ ok: false, error: { code, text } });", 'const fail = (code) => ({ ok: false, error: code });')
      .replace("activity: x.activity, title: x.title ?? TITLES[x.activity], start: local(s", "activity: x.activity.replace('_', ' '), title: TITLES[x.activity], start: local(s")
      .replace('globalThis.calendarReplan =', 'const unused ='));
    const { host, failed, skipped } = await run({ ...STUBS, calendar: broken }, 'jordan');
    assert.deepEqual(skipped, ['calendarReplan answers a drag with a result that fits the schema']);
    assert.deepEqual(host.missing(['calendarPlan', 'calendarReplan']), ['the calendar bundle does not set calendarReplan']);
    assert.equal(failed.length, 2);
    assert.match(failed[0], /every activity.*long_run: calendarPlan returned a value that does not fit calendar-result\.schema\.json: proposed\[0\]\.activity/s);
    assert.match(failed[1], /calendarPlan returned a value that does not fit error\.schema\.json: error: must be object/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
