import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  recordFeedback, changePreference, forget, forgetFactKey, forgetFactType, forgetRecommendation, forgetDerived,
  restoreDerived, restoreFactType, recover, memoryIndex, MemoryUnavailableError, TEMP_SUFFIX,
} from '../src/store/index.mjs';
import { makeMemoryIO } from './memory-io.mjs';
import { MemoryStore, tempRoot, cleanup, seedProfile, R, U } from './store-helpers.mjs';

const T = (h, m = 0) => new Date(`2026-11-18T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
const fb = (s, id, o) => recordFeedback(s, { recId: R(id), activity: 'run', weekday: 3, hour: 7, now: T(9, id), ...o });

/** The whole store flow through the public API: facts, feedback, change, every kind of forgetting, recovery, index. */
function scenario(root, opts) {
  const s = new MemoryStore(root, U(1), opts);
  seedProfile(s);
  fb(s, 1, { action: 'declined', reason: 'too_early' }); fb(s, 2, { action: 'declined', reason: 'too_early' });
  fb(s, 3, { action: 'declined', reason: 'too_long' }); fb(s, 4, { action: 'accepted' }); fb(s, 5, { action: 'declined', reason: 'too_long' });
  const first = memoryIndex(s);
  changePreference(s, { reason: 'too_early', wasTrueUntil: '2026-11-18', why: 'other', now: T(12) });
  fb(s, 6, { action: 'declined', reason: 'too_early', now: T(13) }); fb(s, 7, { action: 'declined', reason: 'too_early', now: T(14) });
  forgetRecommendation(s, R(4));
  forgetFactKey(s, 'daily', '2026-10-05');
  forgetFactType(s, 'weekly');
  forgetDerived(s, 'profile');
  const mid = memoryIndex(s);
  restoreFactType(s, 'weekly'); restoreDerived(s, 'profile');
  forget(s, 'preferences', 'Declined 2 suggestions as too long');
  recover(s);
  return { first, mid, index: memoryIndex(s), store: s };
}

test('the whole store flow runs on a fake in-memory io and never touches the real disk', (t) => {
  const root = '/phone-only-root/memory';
  assert.equal(fs.existsSync('/phone-only-root'), false);
  const mem = makeMemoryIO();
  const phone = scenario(root, { io: mem.io });
  assert.equal(fs.existsSync('/phone-only-root'), false, 'the store touched the real disk');
  // the same flow on the real disk gives exactly the same planner text and the same files
  const base = tempRoot();
  t.after(() => cleanup(base));
  const disk = scenario(base, {});
  assert.equal(phone.first, disk.first);
  assert.equal(phone.mid, disk.mid);
  assert.equal(phone.index, disk.index);
  const onDisk = {};
  for (const n of fs.readdirSync(path.join(base, U(1)), { recursive: true })) {
    const f = path.join(base, U(1), String(n));
    if (fs.statSync(f).isFile()) onDisk[String(n)] = fs.readFileSync(f, 'utf8');
  }
  const inMemory = mem.dump(`${root}/${U(1)}`);
  assert.deepEqual(Object.keys(inMemory).sort(), Object.keys(onDisk).sort());
  for (const k of Object.keys(onDisk)) assert.equal(inMemory[k], onDisk[k], k);
  assert.ok(phone.index.length > 100);
  // every method of the io contract was needed by the flow, so the contract in docs/STORE.md is exactly what the store uses
  assert.deepEqual([...mem.used].sort(), ['fsyncDir', 'fsyncFile', 'lstat', 'mkdir', 'readFile', 'readdir', 'realpath', 'remove', 'rename', 'sha256', 'writeFile']);
});

test('a host io can fail: a write that dies mid-flow is recovered and leftovers are swept, all in memory', () => {
  const root = '/phone-only-root-2/memory';
  const mem = makeMemoryIO();
  let writes = 0;
  let down = false;
  const io = { ...mem.io, writeFile: (p, t) => { if (down && ++writes >= 2) throw Object.assign(new Error('power'), { code: 'EIO' }); return mem.io.writeFile(p, t); } };
  const s = new MemoryStore(root, U(1), { io });
  fb(s, 1, { action: 'declined', reason: 'too_early' }); fb(s, 2, { action: 'declined', reason: 'too_early' });
  down = true;
  assert.equal(forget(s, 'preferences', 'Declined 2 suggestions as too early'), false);        // stopped after the journal and the suppression
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);
  down = false;
  assert.ok(!memoryIndex(s).includes('too early'));
  mem.plant(`${root}/${U(1)}/feedback/recommendations.md${TEMP_SUFFIX}`, 'old facts');
  assert.equal(new MemoryStore(root, U(1), { io: mem.io }).tempFiles().length, 0);                // a restart sweeps it
  assert.equal(fs.existsSync('/phone-only-root-2'), false);
});
