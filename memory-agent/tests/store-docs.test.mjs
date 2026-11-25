import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { F, FILE_KINDS } from '../src/store/index.mjs';

const DOC = fs.readFileSync(new URL('../docs/STORE.md', import.meta.url), 'utf8');

/** The examples in the doc, built by the constructors from the same inputs. If a template changes, the doc must follow. */
const EXAMPLES = {
  tap: F.tap({ recId: 'rec_00000001', activity: 'run', weekday: 3, hour: 7, reason: 'too_early' }),
  decline: F.decline({ recId: 'rec_00000001', activity: 'run', weekday: 3, hour: 7 }),
  earlier: F.earlier({ action: 'declined', reason: 'too_early', count: 12 }),
  accept: F.accept({ recId: 'rec_00000001', activity: 'run', weekday: 3, hour: 7 }),
  standing: F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 3, hour: 7 }, { weekday: 5, hour: 6 }] }),
  change: F.change({ reason: 'too_early', at: '2026-11-18T12:00:00.000Z', count: 2 }),
  history: F.history({ reason: 'too_early', count: 2, at: '2026-11-18T12:00:00.000Z', why: 'schedule_change' }),
  daily: F.daily({ date: '2026-10-01', items: [{ activity: 'Running', minutes: 40 }, { activity: 'Walking', minutes: 30 }] }),
  weekly: F.weekly({ weekStart: '2026-09-28', count: 3, minutes: 120 }),
  profile: F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19' }),
  mix: F.mix({ items: [{ activity: 'Running', count: 6 }, { activity: 'Walking', count: 4 }], asOf: '2026-11-18' }),
  coverage: F.coverage({ workoutDays: 5, windowDays: 28, endDate: '2026-11-17' }),
  thin: F.thin({ days: 9, endDate: '2026-11-17' }),
  today: F.computed({ id: 'volume.today', text: 'On 2026-11-17: 1 counted workout (10 minutes or more) and 45.94 workout minutes.' }),
};

test('the fact table in docs/STORE.md is exactly what the constructors produce, with each kind in its home file', () => {
  const rows = [...DOC.matchAll(/^\| (\w+) \| `(.+?)` \| (\w+) \|$/gm)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows.map((r) => r[0]), Object.keys(EXAMPLES));            // every kind, in order, nothing else
  for (const [kind, text, home] of rows) {
    assert.equal(text, EXAMPLES[kind].text, `the ${kind} example has drifted from the constructor`);
    assert.ok(FILE_KINDS[home].facts.includes(kind), `${kind} is not homed in ${home}`);
  }
});

// ---------- the preference code is separate from the derived-facts code ----------
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const SRC_DIR = new URL('../src/store/', import.meta.url);
/** Every file reachable through static imports from a module (relative imports only). */
function reachable(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = fs.readFileSync(new URL(file, SRC_DIR), 'utf8');
  for (const m of text.matchAll(/^(?:import|export)\b[^'"\n]*?(?:from\s+)?'(\.\/[^']+)'/gm)) reachable(m[1].slice(2), seen);   // includes bare `import './x'`
  return seen;
}

test('the derived-fact code (store, facts, validation, derive) does not import the preference module', () => {
  for (const entry of ['memory-store.mjs', 'facts.mjs', 'validate.mjs', 'derive.mjs']) {
    const files = [...reachable(entry)];
    assert.ok(!files.includes('feedback.mjs'), `${entry} reaches feedback.mjs: ${files}`);
  }
  assert.ok(reachable('feedback.mjs').has('memory-store.mjs'));            // the dependency points one way only
});

test('profile and rolling can be created, read, replaced and deleted with only the store and the constructors loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-sep-'));
  try {
    const script = `
      import { openNodeStore } from ${JSON.stringify(new URL('node/node-store.mjs', SRC_DIR).href)};
      import { F, S } from ${JSON.stringify(new URL('facts.mjs', SRC_DIR).href)};
      const s = openNodeStore(${JSON.stringify(dir)}, 'usr_00000001');
      const src = S.roll({ date: '2026-11-18', at: new Date('2026-11-18T12:00:00Z') });
      const ok = [
        s.create('profile', [F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19' })], [src]),
        s.create('rolling', [F.daily({ date: '2026-10-01', items: [{ activity: 'Running', minutes: 30 }] }), F.thin({ days: 9, endDate: '2026-11-17' })], [src]),
        s.insert('rolling', F.weekly({ weekStart: '2026-09-28', count: 3, minutes: 120 }), src),
        s.view('profile').includes('4-week average'),
        s.replaceFacts('rolling', [F.thin({ days: 9, endDate: '2026-11-17' })], [src]),
        s.view('rolling').includes('Days of data'),
        s.suppressType('daily'),
        s.create('profile', [F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19' })], [src]) === false,
        s.delete('rolling'),
      ];
      console.log(JSON.stringify(ok));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), [true, true, true, true, true, true, true, true, true]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the provisional notice is at the top of the preference code, its fact section and its doc section', () => {
  const note = 'Provisional: what the user can say or tap is not decided; see docs/PREFERENCE.md';
  assert.ok(fs.readFileSync(new URL('feedback.mjs', SRC_DIR), 'utf8').split('\n')[0].includes(note));
  assert.ok(fs.readFileSync(new URL('facts.mjs', SRC_DIR), 'utf8').includes(note));
  assert.ok(DOC.split('\n').slice(0, 6).join('\n').includes(note));
});

test('the doc shows the standing sentence after a change as the constructor renders it', () => {
  const since = F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 3, hour: 7 }, { weekday: 5, hour: 6 }], since: '2026-11-18T17:00:00.000Z' });
  assert.equal(since.text, 'Declined 2 suggestions as too early since 2026-11-18T17:00:00.000Z (Wed 07:00; Fri 06:00)');
  assert.ok(DOC.includes(`\`${since.text}\``), 'docs/STORE.md must show the "since" wording');
});
