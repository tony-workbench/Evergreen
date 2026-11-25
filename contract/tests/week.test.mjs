// The week in the life, over the three built bundles in one JavaScript context. A part whose bundle is not built or
// lacks a global is skipped and says exactly what is missing; a global that is there and returns a value that breaks
// its schema fails. With EVERGREEN_STRICT=1 (the final gate) a missing bundle or global is a failure, never a skip.
// Bundles elsewhere: EVERGREEN_MEMORY_BUNDLE, EVERGREEN_RECOMMEND_BUNDLE, EVERGREEN_CALENDAR_BUNDLE.
import test, { after } from 'node:test';
import { loadBundles, bundlePaths } from './host.mjs';
import { runWeek, persona, PERSONAS } from './week-scenario.mjs';

const strict = process.env.EVERGREEN_STRICT === '1';
const count = { passed: 0, failed: 0, skipped: 0 };

for (const name of PERSONAS) {
  test(`a week in the life of ${name}`, async (t) => {
    const host = loadBundles(bundlePaths());
    await runWeek(host, persona(name), async (title, needs, fn) => {
      const missing = host.missing(needs);
      if (missing.length && !strict) { count.skipped++; await t.test(title, { skip: `missing: ${missing.join('; ')}` }, () => {}); return; }
      await t.test(title, async () => {
        try {
          if (missing.length) throw new Error(`strict mode: this part cannot run. Missing: ${missing.join('; ')}`);
          await fn();
          count.passed++;
        } catch (e) { count.failed++; throw e; }
      });
    });
  });
}

after(() => { console.log(`week test${strict ? ' (strict)' : ''}: ${count.passed} passed, ${count.failed} failed, ${count.skipped} skipped`); });
