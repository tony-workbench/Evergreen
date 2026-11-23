import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore as CoreStore, F, S } from '../src/store/index.mjs';
import { makeNodeIO } from '../src/store/node/io-node.mjs';

/** The core store needs an io object; tests get Node's (hooks, fsImpl and platform configure it). */
export class MemoryStore extends CoreStore {
  constructor(root, user, opts = {}) {
    super(root, user, { ...opts, io: opts.io ?? makeNodeIO(opts.fsImpl, opts.platform) });
  }
}

export function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-store-'));
}
export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
export const NOW = new Date('2026-11-18T12:00:00Z');
export const ROLL_SRC = () => S.roll({ date: '2026-11-18', at: NOW });
export const cov = (n, windowDays = 28) => F.coverage({ workoutDays: n, windowDays, endDate: '2026-11-17' });
/** Valid ids: R(1) = rec_00000001, U(1) = usr_00000001. */
export const R = (n) => `rec_${String(n).padStart(8, '0')}`;
export const U = (n) => `usr_${String(n).padStart(8, '0')}`;

/** Pinned rolling-style files with plausible sizes, so the prompt-size test has content. */
export function seedProfile(store) {
  store.create('profile',
    [F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19' }),
      F.mix({ items: [{ activity: 'Running', count: 6 }, { activity: 'Walking', count: 4 }, { activity: 'Strength training', count: 2 }], asOf: '2026-11-18' })],
    [ROLL_SRC()]);
  const rolling = [];
  for (let d = 1; d <= 28; d++) rolling.push(F.daily({ date: `2026-10-${String(d).padStart(2, '0')}`, items: [{ activity: 'Running', minutes: 40 }] }));
  for (let w = 0; w < 12; w++) rolling.push(F.weekly({ weekStart: new Date(Date.UTC(2026, 8, 7 + 7 * w)).toISOString().slice(0, 10), count: 3, minutes: 120 }));
  store.create('rolling', rolling, [ROLL_SRC()]);
}

/** Store options that record every file-system call (and run it for real), to check the order of syncs, renames and deletes. */
export function recording(extra = {}) {
  const calls = [];
  const real = { writeFile: (p, t) => fs.writeFileSync(p, t), rename: fs.renameSync, remove: (p) => fs.rmSync(p, { force: true }),
    fsyncFile: (p) => { const fd = fs.openSync(p, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } },
    fsyncDir: (d) => { const fd = fs.openSync(d, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } };
  const opts = {};
  for (const name of Object.keys(real)) {
    opts[name] = (...args) => { calls.push([name, ...args]); return (extra[name] ?? real[name])(...args); };
  }
  /** The calls with paths made relative to the user folder, as "name path" strings. */
  const log = (dir) => calls.map(([name, ...args]) => [name, ...(name === 'writeFile' ? [args[0]] : args)]).map(([name, ...paths]) => `${name} ${paths.map((p) => path.relative(dir, p) || '.').join(' ')}`);
  return { opts, calls, log };
}
