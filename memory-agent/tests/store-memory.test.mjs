import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PathEscapeError, UnrecoveredWriteError, MemoryUnavailableError, TEMP_SUFFIX, DIR_SYNC_TOLERATED, DIR_SYNC_UNSUPPORTED_PLATFORMS, toleratedDirSyncError, F, S, FILE_KINDS,
  REASONS, WHY, ACTIVITIES, ROLL_ACTIVITIES, DAYS, DERIVED_KINDS, validateDocument, reconstructFact,
} from '../src/store/index.mjs';
import { ACCESS, DERIVE } from '../src/store/memory-store.mjs';
import { MemoryStore, tempRoot, cleanup, cov, ROLL_SRC, NOW, R, U } from './store-helpers.mjs';

const PROFILE = 'health/rolling.md';
const D = (n, m = 30) => F.daily({ date: `2026-10-${String(n).padStart(2, '0')}`, items: [{ activity: 'Running', minutes: m }] });
const mk = (t, user = U(1), opts) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  return { root, s: new MemoryStore(root, user, opts) };
};
const create = (s, kind = 'rolling') => s.create(kind, [D(1), D(2)], [ROLL_SRC()]);
const SRC = () => ROLL_SRC();
// The store's temp files end in TEMP_SUFFIX (not .tmp).
const leftovers = (s) => fs.readdirSync(s.dir, { recursive: true }).filter((n) => String(n).endsWith(TEMP_SUFFIX));

test('store never uses the real home folder', (t) => {
  const { root, s } = mk(t);
  assert.ok(root.startsWith(os.tmpdir()) || root.startsWith(fs.realpathSync(os.tmpdir())));
  assert.ok(s.dir.startsWith(fs.realpathSync(root)));
});

test('create writes the exact Markdown format at the fixed path and reads back', (t) => {
  const { s } = mk(t);
  assert.equal(create(s), true);
  assert.equal(fs.readFileSync(path.join(s.dir, PROFILE), 'utf8'), s.view('rolling'));
  assert.equal(s.view('rolling'),
    '<!-- idx: tier=pinned; summary=Rolling workout summaries: daily 28 days, weekly 12 weeks -->\n# Rolling summaries\n## Current facts\n- [daily] 2026-10-01: Running 30 min\n- [daily] 2026-10-02: Running 30 min\n## Sources\n- [S-roll] type=health_snapshot; ref=daily_roll:2026-11-18; observed_at=2026-11-18T12:00:00.000Z\n');
});

test('no caller supplies a path: only file kinds are accepted', (t) => {
  const { s } = mk(t);
  for (const bad of ['health/rolling.md', '../x.md', '/etc/passwd', 'a.md', 'secret', '', '__proto__', 'toString', undefined]) {
    assert.equal(s.create(bad, [cov(1)], [SRC()]), false, String(bad));
    assert.throws(() => s.view(bad), TypeError, String(bad));
    assert.throws(() => s.delete(bad), TypeError);
  }
  assert.deepEqual(s.paths(), []);
  assert.deepEqual(Object.keys(FILE_KINDS).sort(), ['feedback', 'history', 'preferences', 'profile', 'rolling']);
});

test('create refuses to overwrite and view of a missing file is null', (t) => {
  const { s } = mk(t);
  assert.equal(s.view('feedback'), null);
  assert.equal(create(s), true);
  assert.equal(create(s), false);
});

test('create rejects raw text instead of a fact object', (t) => {
  const { s } = mk(t);
  assert.equal(s.create('feedback', ['Workouts logged on 1 of 28 days'], []), false);
  assert.equal(s.view('feedback'), null);
});

test('insert adds the fact before Sources and the source at the end', (t) => {
  const { s } = mk(t);
  create(s);
  assert.equal(s.insert('rolling', D(3), SRC()), true);
  assert.ok(s.view('rolling').includes('- [daily] 2026-10-02: Running 30 min\n- [daily] 2026-10-03: Running 30 min\n## Sources\n'));
});

test('insert into a missing file fails', (t) => {
  const { s } = mk(t);
  assert.equal(s.insert('feedback', cov(1), SRC()), false);
});

test('duplicate fact is ignored: one live copy, no extra source', (t) => {
  const { s } = mk(t);
  create(s);
  const before = s.view('rolling');
  assert.equal(s.insert('rolling', D(1), SRC()), true);
  assert.equal(s.view('rolling'), before);
});

test('create de-duplicates repeated facts in its own list', (t) => {
  const { s } = mk(t);
  s.create('rolling', [D(7), D(7)], [SRC()]);
  assert.equal(s.view('rolling').split('- [daily] 2026-10-07: Running 30 min\n').length, 2);
});

test('strReplace replaces once; a missing text fails; raw text is refused', (t) => {
  const { s } = mk(t);
  create(s);
  assert.equal(s.strReplace('rolling', '[daily] 2026-10-01: Running 30 min', D(1, 45)), true);
  assert.ok(s.view('rolling').includes('- [daily] 2026-10-01: Running 45 min\n'));
  assert.equal(s.strReplace('rolling', 'not there', cov(5)), false);
  assert.equal(s.strReplace('feedback', 'a', cov(5)), false);
  assert.equal(s.strReplace('rolling', '', cov(5)), false);
  assert.equal(s.strReplace('rolling', '[daily] 2026-10-02: Running 30 min', 'Workouts logged on 9 of 28 days'), false);
});

test('delete removes the file; deleting a missing file is fine', (t) => {
  const { s } = mk(t);
  create(s);
  assert.equal(s.delete('rolling'), true);
  assert.equal(s.view('rolling'), null);
  assert.equal(s.delete('rolling'), true);
});

test('paths lists only the fixed per-kind files, never stray files', (t) => {
  const { s } = mk(t);
  create(s, 'rolling'); s.create('profile', [F.profile({ perWeek: 2, asOf: '2026-11-18', validUntil: '2026-11-19' })], [SRC()]);
  fs.writeFileSync(path.join(s.dir, 'note.txt'), 'x');
  fs.writeFileSync(path.join(s.dir, 'stray.md'), 'x');
  fs.mkdirSync(path.join(s.dir, 'other'));
  fs.writeFileSync(path.join(s.dir, 'other', 'x.md'), 'x');
  assert.deepEqual(s.paths(), ['about-user/profile.md', 'health/rolling.md']);
});

test('users are isolated', (t) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  const a = new MemoryStore(root, U(1));
  const b = new MemoryStore(root, U(2));
  create(a);
  assert.deepEqual(b.paths(), []);
  assert.equal(b.view('rolling'), null);
});

test('internal paths that leave the folder are refused', (t) => {
  const { s, root } = mk(t);
  for (const bad of ['../x.md', 'a/../../x.md', '/etc/passwd', path.join(s.dir, 'x.md'), '', 'a//b.md', './a.md', 'a\\..\\b.md', 'a\0b.md']) {
    assert.throws(() => s.path(bad), PathEscapeError, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(path.join(root, 'out.md')), false);
});

test('user ids must be usr_ plus 8 to 32 lowercase hex and the folder is exactly that id', (t) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  const bad = ['..', '.', '../x', 'a/b', '', '/abs', 'a\\b', 'alice', 'Alice', 'usr_ABCDEF12', 'usr_deadbee', `usr_${'a'.repeat(33)}`,
    'usr_deadbeeg', 'USR_deadbeef', ' usr_deadbeef', 'usr_deadbeef ', 'usr_deadbeef/', 'usr_deadbeef\n', 42, null, undefined];
  for (const b of bad) assert.throws(() => new MemoryStore(root, b), PathEscapeError, String(b));
  for (const good of ['usr_deadbeef', `usr_${'0'.repeat(32)}`, 'usr_0123456789abcdef']) {
    const s = new MemoryStore(root, good);
    assert.equal(path.basename(s.realDir), good);
  }
  assert.deepEqual(fs.readdirSync(root).sort(), ['usr_0123456789abcdef', `usr_${'0'.repeat(32)}`, 'usr_deadbeef'].sort());
});

test('a symlinked folder or file that points outside is refused', (t) => {
  const { s, root } = mk(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(outside, 'health'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'health', 'rolling.md'), 'top secret');
  fs.symlinkSync(path.join(outside, 'health'), path.join(s.dir, 'health'));
  assert.throws(() => s.view('rolling'), PathEscapeError);
  assert.throws(() => create(s), PathEscapeError);
  assert.throws(() => s.delete('rolling'), PathEscapeError);
  assert.equal(fs.readFileSync(path.join(outside, 'health', 'rolling.md'), 'utf8'), 'top secret');
  fs.rmSync(path.join(s.dir, 'health'));
  fs.mkdirSync(path.join(s.dir, 'health'));
  fs.symlinkSync(path.join(outside, 'health', 'rolling.md'), path.join(s.dir, PROFILE));
  assert.throws(() => s.view('rolling'), PathEscapeError);
  assert.throws(() => s.delete('rolling'), PathEscapeError);
  fs.rmSync(path.join(s.dir, PROFILE));
  fs.symlinkSync(path.join(outside, 'missing.md'), path.join(s.dir, PROFILE));
  assert.throws(() => s.view('rolling'), PathEscapeError);
  assert.equal(fs.readFileSync(path.join(outside, 'health', 'rolling.md'), 'utf8'), 'top secret');
});

test('a symlink to another user is refused', (t) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  const a = new MemoryStore(root, U(1));
  const b = new MemoryStore(root, U(2));
  create(b);
  fs.symlinkSync(path.join(b.dir, 'health'), path.join(a.dir, 'health'));
  assert.throws(() => a.view('rolling'), PathEscapeError);
});

test('a symlink anywhere in the memory folder is refused, even one that stays inside it', (t) => {
  const { s } = mk(t);
  create(s);
  fs.renameSync(path.join(s.dir, 'health'), path.join(s.dir, 'real'));
  fs.symlinkSync(path.join(s.dir, 'real'), path.join(s.dir, 'health'));
  assert.throws(() => s.view('rolling'), PathEscapeError);
  assert.throws(() => s.delete('rolling'), PathEscapeError);
  fs.rmSync(path.join(s.dir, 'health'));
  fs.renameSync(path.join(s.dir, 'real'), path.join(s.dir, 'health'));
  assert.ok(s.view('rolling'));
  fs.renameSync(path.join(s.dir, 'health/rolling.md'), path.join(s.dir, 'health/p2.md'));
  fs.symlinkSync(path.join(s.dir, 'health/p2.md'), path.join(s.dir, 'health/rolling.md'));
  assert.throws(() => s.view('rolling'), PathEscapeError);          // a file symlink inside the folder
});

test('the user folder is checked before every operation: swapped for a symlink after construction, everything refuses', (t) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  const a = new MemoryStore(root, U(1));
  const b = new MemoryStore(root, U(2));
  create(a); create(b);
  const hold = path.join(root, 'moved-away');
  fs.renameSync(a.dir, hold);
  fs.symlinkSync(b.dir, a.dir);                       // another user's memory, reached through the first user's name
  const ops = {
    view: () => a.view('rolling'), read: () => a.read('rolling'), viewPath: () => a.viewPath('health/rolling.md'),
    paths: () => a.paths(), create: () => a.create('rolling', [cov(1)], [SRC()]), insert: () => a.insert('rolling', D(3), SRC()),
    strReplace: () => a.strReplace('rolling', '[daily] 2026-10-01: Running 30 min', D(1, 45)),
    replaceFacts: () => a.replaceFacts('rolling', [cov(1)], [SRC()]), delete: () => a.delete('rolling'),
    isSuppressed: () => a.isSuppressed(R(1)), suppress: () => a.suppress([R(1)]), kindSuppressed: () => a.kindSuppressed('rolling'),
    suppressKind: () => a.suppressKind('rolling'), unsuppressKind: () => a.unsuppressKind('rolling'),
    readJournal: () => a.readJournal(), writeJournal: () => a.writeJournal({ op: 'forget_reason', reason: 'too_early', at: NOW.toISOString() }),
    clearJournal: () => a.clearJournal(), path: () => a.path('health/rolling.md'),
  };
  for (const [name, op] of Object.entries(ops)) assert.throws(op, PathEscapeError, name);
  assert.ok(b.view('rolling').includes('[daily] 2026-10-01: Running 30'));   // b untouched
  assert.deepEqual(fs.readdirSync(b.dir).sort(), ['health']);
  // a real directory with the wrong identity (replaced by a copy) is also refused
  fs.rmSync(a.dir);
  fs.mkdirSync(a.dir);
  assert.throws(() => a.view('rolling'), PathEscapeError);            // a different directory under the same name (identity changed)
});

test('a user folder that is a symlink is refused', (t) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  const b = new MemoryStore(root, U(2));
  create(b);
  fs.symlinkSync(b.dir, path.join(root, U(3)));
  assert.throws(() => new MemoryStore(root, U(3)), PathEscapeError);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-out-'));
  t.after(() => cleanup(outside));
  fs.symlinkSync(outside, path.join(root, U(4)));
  assert.throws(() => new MemoryStore(root, U(4)), PathEscapeError);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('failed first write leaves no file and a retry can create it', (t) => {
  let fail = true;
  const { s } = mk(t, U(1), {
    writeFile: (p, text) => { if (fail) { fs.writeFileSync(p, 'partial'); throw new Error('disk full'); } fs.writeFileSync(p, text); },
  });
  assert.equal(create(s), false);
  assert.match(s.lastError, /disk full/);
  assert.equal(s.view('rolling'), null);
  fail = false;
  assert.equal(create(s), true);
});

test('a writer that silently does nothing is caught', (t) => {
  const { s } = mk(t, U(1), { writeFile: () => {} });
  assert.equal(create(s), false);
  assert.equal(s.view('rolling'), null);
});

test('a failed write leaves the old bytes and no temp file behind', (t) => {
  let corrupt = false;
  const { s } = mk(t, U(1), { writeFile: (p, x) => fs.writeFileSync(p, corrupt ? x.slice(0, 5) : x) });
  create(s);
  const before = s.view('rolling');
  corrupt = true;
  assert.equal(s.insert('rolling', D(3), SRC()), false);
  assert.match(s.lastError, /read-back/);
  assert.equal(s.lastStatus, 'failed');
  assert.equal(s.view('rolling'), before);
  assert.deepEqual(leftovers(s), []);
  corrupt = false;
  assert.equal(s.insert('rolling', D(3), SRC()), true);   // retry works
  assert.equal(s.lastError, null);
});

test('a bad result after the rename is restored and verified', (t) => {
  let n = 0;
  const { s } = mk(t, U(1), { rename: (a, b) => { fs.renameSync(a, b); if (++n === 2) fs.writeFileSync(b, 'garbage'); } });
  create(s);
  const before = s.view('rolling');
  assert.equal(s.insert('rolling', D(3), SRC()), false);
  assert.equal(s.view('rolling'), before);
  assert.deepEqual(leftovers(s), []);
});

test('when recovery itself fails the state is distinct: unrecovered', (t) => {
  let on = false;
  const { s } = mk(t, U(1), { rename: (a, b) => { fs.renameSync(a, b); if (on) fs.writeFileSync(b, 'garbage'); } });
  create(s);
  on = true;
  assert.throws(() => s.insert('rolling', D(3), SRC()), UnrecoveredWriteError);
  assert.equal(s.lastStatus, 'unrecovered');
});

test('storage boundary: raw text, plain objects and forged objects are refused', (t) => {
  const { s } = mk(t);
  const adversarial = [
    'Heart rate 180 bpm', 'Run 3 times tomorrow', 'You will improve by 5%', 'You should rest 2 days',
    'Heart rate samples: 88, 90, 91, 93, 95, 97, 99, 101', 'Route points 41.3, 2.1', 'Great work, 5 workouts',
    `Declined run suggested for Wed 07:00 as too early (recommendation ${R(1)}) and heart rate 150`,
  ];
  assert.equal(create(s), true);
  const before = s.view('rolling');
  for (const text of adversarial) {
    const forged = { cls: 'fact', kind: 'coverage', text };
    for (const f of [text, { text }, forged, Object.freeze({ ...forged })]) {
      assert.equal(s.create('rolling', [f], [SRC()]), false, text);
      assert.equal(s.insert('rolling', f, SRC()), false, text);
      assert.equal(s.strReplace('rolling', '[daily] 2026-10-01: Running 30 min', f), false, text);
      assert.equal(s.replaceFacts('rolling', [f], [SRC()]), false, text);
    }
  }
  assert.equal(s.view('rolling'), before);
  assert.equal(s.view('profile'), null);
  assert.equal(s.rewrite, undefined);        // no way to write caller-supplied text
  assert.equal(s.withAccess, undefined);     // the journal gate is not a public switch
  assert.equal(s._put, undefined);
});

test('constructors refuse values outside the closed sets', () => {
  const bad = [
    () => F.tap({ recId: R(1), activity: 'run; heart rate 180', weekday: 3, hour: 7, reason: 'too_early' }),
    () => F.tap({ recId: R(1), activity: 'run', weekday: 3, hour: 7, reason: 'because' }),
    () => F.daily({ date: '2026-10-01', items: [{ activity: 'Skydiving', minutes: 5 }] }),
    () => F.daily({ date: '2026-10-01', items: [{ activity: 'Running', minutes: 99999 }] }),
    () => F.daily({ date: '2026-13-01', items: [{ activity: 'Running', minutes: 5 }] }),
    () => F.weekly({ weekStart: '2026-09-28', count: -1, minutes: 5 }),
    () => F.profile({ perWeek: 'a lot', asOf: '2026-11-18', validUntil: '2026-11-19' }),
    () => F.mix({ items: [{ activity: 'Running', count: 1.5 }], asOf: '2026-11-18' }),
    () => F.coverage({ workoutDays: '5', windowDays: 28 }),
    () => F.change({ reason: 'too_early', date: 'yesterday', why: 'other' }),
    () => F.history({ reason: 'too_early', count: 2, at: '2026-11-18T12:00:00.000Z', why: 'because I said so' }),
    () => F.history({ reason: 'too_early', count: 0, at: '2026-11-18T12:00:00.000Z', why: 'other' }),
    () => S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: [], at: NOW }),
    () => S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: [R(1), R(1)], at: NOW }),      // not unique
    () => S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: ['heart_rate_180'], at: NOW }),
    () => S.tap({ recId: 'r 1', reason: 'too_early', at: NOW }),
    () => S.roll({ date: '2026-11-18', at: 'noon' }),
  ];
  for (const b of bad) assert.throws(b, TypeError);
});

test('recommendation ids must be rec_ plus 8 to 32 lowercase hex', () => {
  const tap = (id) => F.tap({ recId: id, activity: 'run', weekday: 3, hour: 7, reason: 'too_early' });
  for (const bad of ['heart_rate_180', 'rec_heart_rate_180', 'r1', 'rec_ABCDEF12', 'rec_1234567', `rec_${'a'.repeat(33)}`, 'rec_0000000g', 'rec-00000001', ' rec_00000001', 'rec_00000001\n', '', null, 5]) {
    assert.throws(() => tap(bad), TypeError, String(bad));
    assert.throws(() => S.tap({ recId: bad, reason: 'too_early', at: NOW }), TypeError, String(bad));
  }
  for (const good of ['rec_00000001', 'rec_deadbeef', `rec_${'f'.repeat(32)}`]) assert.match(tap(good).text, /\(recommendation rec_/);
});

test('the 4-week average is a whole number of workouts over 4 weeks: quarters only, rendered exactly, never rounded', () => {
  const p = (perWeek) => F.profile({ perWeek, asOf: '2026-11-18', validUntil: '2026-11-19' }).text;
  assert.match(p(1.25), /^4-week average: 1\.25 workouts per week/);
  assert.match(p(3), /^4-week average: 3 workouts per week/);
  assert.match(p(3.5), /^4-week average: 3\.5 workouts/);
  assert.match(p(0.75), /^4-week average: 0\.75 workouts/);
  assert.ok(!p(1.25).includes('1.3'));
  // what an integer count over 4 weeks cannot give is refused, whatever its decimals
  for (const bad of [3.1, 0.07, 1.3, 2.6, 0.1, 3.01, 1.234, 0.1 + 0.2, 1 / 3, 1e-7, -1, 1000, NaN, Infinity, 2.005]) assert.throws(() => p(bad), TypeError, String(bad));
  // built from the underlying count: workouts / 4
  const w = (workouts, extra = {}) => F.profile({ workouts, asOf: '2026-11-18', validUntil: '2026-11-19', ...extra }).text;
  assert.match(w(13), /^4-week average: 3\.25 workouts/);
  assert.match(w(12), /^4-week average: 3 workouts/);
  assert.match(w(0), /^4-week average: 0 workouts/);
  for (const bad of [12.5, -1, '12', 400, NaN, 1.5]) assert.throws(() => w(bad), TypeError, String(bad));
  assert.throws(() => w(13, { perWeek: 3.5 }), TypeError);                      // the two must agree
  assert.doesNotThrow(() => w(13, { perWeek: 3.25 }));
  // a left-out day counts as unlogged: the 28-day window and the quarters stay
  assert.match(w(13, { excludedDays: ['2026-10-25'] }), /3\.25 workouts per week \(as of 2026-11-18, valid until 2026-11-19\) \(1 forgotten day left out\)$/);
  assert.throws(() => F.profile({ perWeek: 3.1, asOf: '2026-11-18', validUntil: '2026-11-19', excludedDays: ['2026-10-25'] }), TypeError);
  assert.equal(reconstructFact('4-week average: 3.1 workouts per week (as of 2026-11-18, valid until 2026-11-19)'), null);   // nor is a stored line
});

test('a weekly fact fits the days that remain: an entirely excluded week has no workouts and no minutes', () => {
  const wk = (o) => () => F.weekly({ weekStart: '2026-10-05', count: 3, minutes: 90, ...o });
  const all = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  assert.throws(wk({ excludedDays: all }), TypeError);                          // all seven left out, yet 3 workouts and 90 minutes
  assert.throws(wk({ excludedCount: 7 }), TypeError);
  assert.doesNotThrow(() => F.weekly({ weekStart: '2026-10-05', count: 0, minutes: 0, excludedDays: all }));
  assert.equal(F.weekly({ weekStart: '2026-10-05', count: 0, minutes: 0, excludedCount: 7 }).text, '[weekly] Week of 2026-10-05: 0 workouts, 0 min (7 forgotten days left out)');
  // minutes fit in the remaining days (1440 a day)
  assert.doesNotThrow(() => F.weekly({ weekStart: '2026-10-05', count: 1, minutes: 1440, excludedCount: 6 }));
  assert.throws(() => F.weekly({ weekStart: '2026-10-05', count: 1, minutes: 1441, excludedCount: 6 }), TypeError);
  assert.throws(() => F.weekly({ weekStart: '2026-10-05', count: 1, minutes: 2881, excludedCount: 5 }), TypeError);
  assert.equal(reconstructFact('[weekly] Week of 2026-10-05: 3 workouts, 90 min (7 forgotten days left out)'), null);   // nor is a stored line
});

test('summaries, titles and tiers come only from the closed file kinds', (t) => {
  const { s } = mk(t);
  assert.equal(s.create('rolling', [cov(1)], ['[S1] type=test']), false);   // raw source
  assert.deepEqual(s.paths(), []);
});

test('fail closed: a damaged forgotten.json blocks every read and write; a missing one means empty', (t) => {
  const { s } = mk(t);
  create(s);
  assert.equal(s.isSuppressed(R(1)), false);      // missing file = empty
  const f = path.join(s.dir, 'forgotten.json');
  const cases = ['not json', '{"forgotten":[]}', '["abc"]', '[1]', '', '[', `["${'A'.repeat(64)}"]`, 'null'];
  for (const c of cases) {
    fs.writeFileSync(f, c);
    assert.throws(() => s.view('rolling'), MemoryUnavailableError, c);
    assert.throws(() => s.paths(), MemoryUnavailableError, c);
    assert.throws(() => s.insert('rolling', cov(9), SRC()), MemoryUnavailableError, c);
    assert.throws(() => s.create('rolling', [cov(9)], [SRC()]), MemoryUnavailableError, c);
    assert.throws(() => s.delete('rolling'), MemoryUnavailableError, c);
    assert.throws(() => s.isSuppressed(R(1)), MemoryUnavailableError, c);
    assert.throws(() => s.suppress([R(1)]), MemoryUnavailableError, c);
  }
  fs.rmSync(f);
  fs.mkdirSync(f);                                 // unreadable
  assert.throws(() => s.view('rolling'), MemoryUnavailableError);
  assert.throws(() => s.suppress([R(1)]), MemoryUnavailableError);
  fs.rmSync(f, { recursive: true });
  fs.writeFileSync(f, '[]\n');                     // valid and empty again
  assert.ok(s.view('rolling'));
});

test('a pending journal blocks reads until it is recovered', (t) => {
  const { s } = mk(t);
  create(s);
  assert.equal(s.writeJournal({ op: 'forget_reason', reason: 'too_early', at: NOW.toISOString() }), true);
  assert.throws(() => s.view('rolling'), MemoryUnavailableError);
  assert.throws(() => s.paths(), MemoryUnavailableError);
  assert.ok(s[ACCESS](() => s.view('rolling')));
  s[ACCESS](() => s.clearJournal());
  assert.ok(s.view('rolling'));
});

test('definitions are deep-frozen: mutation attempts throw and change nothing', (t) => {
  const { s } = mk(t);
  const header = '<!-- idx: tier=pinned; summary=Rolling workout summaries: daily 28 days, weekly 12 weeks -->\n# Rolling summaries\n';
  const attempts = [
    () => { FILE_KINDS.profile.summary = 'Anything 5'; },
    () => { FILE_KINDS.profile.path = '../x.md'; },
    () => { FILE_KINDS.profile.tier = 'hot'; },
    () => { FILE_KINDS.profile.facts.push('daily'); },
    () => { FILE_KINDS.profile.facts[0] = 'tap'; },
    () => { FILE_KINDS.evil = { tier: 'pinned', summary: 'x', title: 'x', path: 'x.md', facts: [] }; },
    () => { delete FILE_KINDS.profile; },
    () => { REASONS.too_early = 'whatever'; },
    () => { REASONS.extra = 'x'; },
    () => { WHY.other = 'x'; },
    () => { ACTIVITIES.push('skydiving'); },
    () => { ROLL_ACTIVITIES[0] = 'Heart rate'; },
    () => { DAYS[0] = 'Sun'; },
    () => { DERIVED_KINDS.push('feedback'); },
  ];
  for (const a of attempts) assert.throws(a, TypeError);
  const frozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => typeof v !== 'object' || v === null || frozen(v));
  for (const o of [FILE_KINDS, REASONS, WHY, ACTIVITIES, ROLL_ACTIVITIES, DAYS, DERIVED_KINDS, F, S]) assert.ok(frozen(o));
  assert.equal(create(s), true);
  assert.ok(s.view('rolling').startsWith(header));
  assert.deepEqual(Object.keys(FILE_KINDS).sort(), ['feedback', 'history', 'preferences', 'profile', 'rolling']);
  const fct = cov(1);
  assert.throws(() => { fct.text = 'Heart rate 180 bpm'; }, TypeError);
});

test('constructors check numbers against each other', () => {
  const day = (activity, minutes) => ({ activity, minutes });
  const bad = [
    () => F.coverage({ workoutDays: 5, windowDays: 28 }),                                           // no end date
    () => F.coverage({ workoutDays: 5, windowDays: 28, endDate: '2026-02-30' }),
    () => F.thin({ days: 3 }),
    () => F.thin({ days: 3, endDate: 'yesterday' }),
    () => F.coverage({ workoutDays: 99, windowDays: 28, endDate: '2026-11-17' }),
    () => F.coverage({ workoutDays: 29, windowDays: 28, endDate: '2026-11-17' }),
    () => F.coverage({ workoutDays: 1, windowDays: 30, endDate: '2026-11-17' }),
    () => F.thin({ days: 1000, endDate: '2026-11-17' }),
    () => F.daily({ date: '2026-10-01', items: [day('Running', 1000), day('Walking', 500)] }),     // more than a day
    () => F.daily({ date: '2026-10-01', items: [day('Running', 10), day('Running', 20)] }),         // repeated activity
    () => F.daily({ date: '2026-10-01', items: [day('Running', 0)] }),
    () => F.weekly({ weekStart: '2026-09-08', count: 3, minutes: 120 }),                            // a Tuesday
    () => F.weekly({ weekStart: '2026-09-07', count: 3, minutes: 2 }),                              // fewer minutes than workouts
    () => F.weekly({ weekStart: '2026-09-07', count: 0, minutes: 5 }),
    () => F.weekly({ weekStart: '2026-09-07', count: 5, minutes: 10081 }),
    () => F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-20' }),                  // not the next day
    () => F.profile({ perWeek: 100, asOf: '2026-11-18', validUntil: '2026-11-19' }),
    () => F.mix({ items: [{ activity: 'Running', count: 1 }, { activity: 'Running', count: 2 }], asOf: '2026-11-18' }),
    () => F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 3, hour: 7 }, { weekday: 3, hour: 8 }, { weekday: 3, hour: 9 }] }),   // more slots than declines
    () => F.standing({ reason: 'too_early', count: 9, slots: [1, 2, 3, 4, 5, 6].map((h) => ({ weekday: 3, hour: h })) }),                      // more than 5 slots
    () => F.earlier({ action: 'declined', reason: 'too_early', count: 0 }),
    () => F.earlier({ action: 'declined', reason: 'bored', count: 3 }),
    () => F.earlier({ action: 'maybe', count: 3 }),
    () => S.earlier({ code: 'bored', ids: [{ id: R(1), at: NOW }], at: NOW }),
    () => S.earlier({ code: 'accept', ids: [R(1)], at: NOW }),                                                  // no time
    () => F.standing({ reason: 'too_early', count: 1, slots: [{ weekday: 3, hour: 7 }] }),
    () => F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 8, hour: 7 }, { weekday: 3, hour: 7 }] }),
  ];
  bad.forEach((b, i) => assert.throws(b, TypeError, String(i)));
  assert.match(F.weekly({ weekStart: '2026-09-07', count: 3, minutes: 120 }).text, /Week of 2026-09-07/);
  assert.match(F.daily({ date: '2026-10-01', items: [day('Running', 1000), day('Walking', 440)] }).text, /1000 min, Walking 440 min/);
});

test('constructors read their inputs once: a changing input cannot slip a value past the check', () => {
  let reads = 0;
  const item = { get activity() { reads++; return reads === 1 ? 'Running' : 'Heart rate 180 bpm'; }, minutes: 30 };
  assert.equal(F.daily({ date: '2026-10-01', items: [item] }).text, '[daily] 2026-10-01: Running 30 min');
  let n = 0;
  const slots = [{ get weekday() { return ++n === 1 ? 3 : 99; }, hour: 7 }, { weekday: 4, hour: 8 }];
  assert.match(F.standing({ reason: 'too_early', count: 2, slots }).text, /\(Wed 07:00; Thu 08:00\)/);
  const items = [{ activity: 'Running', count: 2 }];
  const m = F.mix({ items, asOf: '2026-11-18' });
  items[0].count = 5000; items.push({ activity: 'Heart rate', count: 1 });
  assert.equal(m.text, 'Last 4 weeks by type: Running 2 (as of 2026-11-18)');
});

test('conflicting facts for the same window, date, week, average or mix are refused', (t) => {
  const { s } = mk(t);
  const day = (date, m) => F.daily({ date, items: [{ activity: 'Running', minutes: m }] });
  const week = (d, c, m) => F.weekly({ weekStart: d, count: c, minutes: m });
  const prof = (n) => F.profile({ perWeek: n, asOf: '2026-11-18', validUntil: '2026-11-19' });
  const mix = (n) => F.mix({ items: [{ activity: 'Running', count: n }], asOf: '2026-11-18' });
  const conflicts = [
    ['profile', [prof(3), prof(4)]],
    ['profile', [mix(1), mix(2)]],
    ['rolling', [F.thin({ days: 3, endDate: '2026-11-17' }), F.thin({ days: 4, endDate: '2026-11-17' })]],
    ['rolling', [day('2026-10-01', 30), day('2026-10-01', 40)]],
    ['rolling', [week('2026-09-07', 3, 120), week('2026-09-07', 2, 100)]],
    ['rolling', [cov(1, 7), cov(2, 7)]],
  ];
  for (const [kind, facts] of conflicts) {
    assert.equal(s.create(kind, facts, [SRC()]), false, `${kind}: ${facts.map((f) => f.text)}`);
    assert.match(s.lastError, /same thing/);
    assert.equal(s.replaceFacts(kind, facts, [SRC()]), false);
    assert.equal(s.view(kind), null);
    assert.equal(s.create(kind, [facts[0]], [SRC()]), true);
    assert.equal(s.insert(kind, facts[1], SRC()), false);
    assert.equal(s.view(kind).includes(facts[1].text), false);
    s.delete(kind);
  }
  assert.equal(s.create('profile', [prof(3), mix(1)], [SRC()]), true);
  assert.equal(s.create('rolling', [cov(1, 7), cov(2, 28), cov(3, 84), day('2026-10-01', 30), day('2026-10-02', 40), week('2026-09-07', 3, 120), week('2026-09-14', 2, 100)], [SRC()]), true);
});

test('a file that holds conflicting facts is refused on read, and the conflict is the reason', (t) => {
  const conflict = (e) => e instanceof MemoryUnavailableError && /two facts state the same thing/.test(e.message);
  const { s } = mk(t);
  // rolling: two otherwise valid daily facts for one date
  create(s, 'rolling');
  const rolling = path.join(s.dir, 'health/rolling.md');
  const good = fs.readFileSync(rolling, 'utf8');
  const second = '[daily] 2026-10-01: Running 45 min';
  assert.equal(validateDocument(good.replace('## Sources', `- ${second}\n## Sources`).replace('- [daily] 2026-10-01: Running 30 min\n', ''), 'rolling'), null);   // valid on its own
  assert.ok(reconstructFact(second));
  fs.writeFileSync(rolling, good.replace('## Sources', `- ${second}\n## Sources`));
  assert.throws(() => s.view('rolling'), conflict);
  assert.throws(() => s.read('rolling'), conflict);
  assert.throws(() => s.insert('rolling', D(3), SRC()), conflict);
  fs.writeFileSync(rolling, good);
  assert.ok(s.view('rolling'));
  // profile: two otherwise valid averages
  const prof = (n) => F.profile({ perWeek: n, asOf: '2026-11-18', validUntil: '2026-11-19' });
  assert.equal(s.create('profile', [prof(3)], [SRC()]), true);
  const pf = path.join(s.dir, 'about-user/profile.md');
  const pgood = fs.readFileSync(pf, 'utf8');
  assert.equal(validateDocument(pgood.replace(prof(3).text, prof(4).text), 'profile'), null);
  fs.writeFileSync(pf, pgood.replace('## Sources', `- ${prof(4).text}\n## Sources`));
  assert.throws(() => s.view('profile'), conflict);
  assert.throws(() => s.read('profile'), conflict);
  assert.equal(s.paths().includes('about-user/profile.md'), true);
  fs.writeFileSync(pf, pgood);
  assert.ok(s.view('profile'));
});

test('every fact type has exactly one home file: no type can be written or read in another file', (t) => {
  const { s } = mk(t);
  const samples = {
    tap: F.tap({ recId: R(1), activity: 'run', weekday: 3, hour: 7, reason: 'too_early' }),
    earlier: F.earlier({ action: 'declined', reason: 'too_early', count: 2 }),
    decline: F.decline({ recId: R(1), activity: 'run', weekday: 3, hour: 7 }),
    accept: F.accept({ recId: R(1), activity: 'run', weekday: 3, hour: 7 }),
    standing: F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 3, hour: 7 }, { weekday: 3, hour: 8 }] }),
    change: F.change({ reason: 'too_early', at: '2026-11-18T12:00:00.000Z', count: 2 }),
    history: F.history({ reason: 'too_early', count: 2, at: '2026-11-18T12:00:00.000Z', why: 'other' }),
    daily: D(1),
    weekly: F.weekly({ weekStart: '2026-09-07', count: 3, minutes: 120 }),
    profile: F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19' }),
    mix: F.mix({ items: [{ activity: 'Running', count: 2 }], asOf: '2026-11-18' }),
    coverage: cov(1, 28),
    thin: F.thin({ days: 3, endDate: '2026-11-17' }),
  };
  const kinds = Object.keys(FILE_KINDS);
  const homes = {};
  for (const [type, fact] of Object.entries(samples)) {
    homes[type] = kinds.filter((k) => FILE_KINDS[k].facts.includes(type));
    assert.equal(homes[type].length, 1, `${type} must have one home: ${homes[type]}`);
    for (const k of kinds) {
      const src = type === 'tap' ? S.tap({ recId: R(1), reason: 'too_early', at: NOW }) : (type === 'accept' || type === 'decline') ? S.accept({ recId: R(1), at: NOW })
        : type === 'earlier' ? S.earlier({ code: 'too_early', ids: [{ id: R(1), at: NOW }, { id: R(2), at: NOW }], at: NOW })
        : type === 'history' ? S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: [R(1), R(2)], at: NOW }) : SRC();
      const derived = ['standing', 'change', 'history'].includes(type);
      if (derived) assert.equal(s.create(k, [fact], [src]), false, `${type} in ${k}: callers cannot write derived facts`);
      const ok = derived ? s[DERIVE](() => s.create(k, [fact], [src])) : s.create(k, [fact], [src]);
      assert.equal(ok, homes[type][0] === k, `${type} in ${k}`);
      if (ok) s.delete(k);
    }
  }
  // the types in each file kind never overlap
  const all = kinds.flatMap((k) => FILE_KINDS[k].facts);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(FILE_KINDS.feedback.facts, ['tap', 'decline', 'accept', 'earlier']);
  assert.deepEqual(FILE_KINDS.profile.facts, ['profile', 'mix', 'load', 'regularity', 'body']);
  assert.deepEqual(FILE_KINDS.rolling.facts, ['daily', 'weekly', 'coverage', 'thin', 'today', 'week']);
});

test('the leftover check really sees a store temp file (the temp file name is fixed, not .tmp)', (t) => {
  const { s } = mk(t);
  create(s);
  assert.deepEqual(leftovers(s), []);
  fs.writeFileSync(path.join(s.dir, `health/rolling.md${TEMP_SUFFIX}`), 'old facts');
  assert.deepEqual(leftovers(s), [`health/rolling.md${TEMP_SUFFIX}`]);
  assert.deepEqual(s.tempFiles(), [`health/rolling.md${TEMP_SUFFIX}`]);
  assert.equal(TEMP_SUFFIX, '.memtmp');
  fs.writeFileSync(path.join(s.dir, 'health/other.tmp'), 'not ours');           // not a store temp name: not flagged
  assert.deepEqual(leftovers(s), [`health/rolling.md${TEMP_SUFFIX}`]);
  s.sweepTemps();
  assert.deepEqual(leftovers(s), []);
});

test('a failed write that dies before cleanup is caught by the leftover check', (t) => {
  // the injected writer leaves the temp file behind and then the process "stops": remove is a no-op
  const { s } = mk(t, U(1), { writeFile: (p, x) => { fs.writeFileSync(p, x.slice(0, 5)); } });
  assert.equal(create(s), false);
  assert.deepEqual(leftovers(s), []);                                          // the store cleans its own temp file
});

// ---------- durability: fsync the temp file before the rename, the directory after every rename and delete ----------
import { recording } from './store-helpers.mjs';

test('a write syncs the temp file, renames it, then syncs the directory, in that order', (t) => {
  const rec = recording();
  const { s } = mk(t, U(1), rec.opts);
  create(s);
  assert.deepEqual(rec.log(s.dir).slice(-4), [
    'writeFile health/rolling.md.memtmp', 'fsyncFile health/rolling.md.memtmp',
    'rename health/rolling.md.memtmp health/rolling.md', 'fsyncDir health']);
  // the new directory itself was made durable (its parent was synced) before the file was written
  const first = rec.log(s.dir);
  assert.ok(first.indexOf('fsyncDir .') >= 0 && first.indexOf('fsyncDir .') < first.indexOf('writeFile health/rolling.md.memtmp'));
  rec.calls.length = 0;
  assert.equal(s.insert('rolling', D(3), SRC()), true);                         // a directory that already exists
  assert.deepEqual(rec.log(s.dir), [
    'writeFile health/rolling.md.memtmp', 'fsyncFile health/rolling.md.memtmp',
    'rename health/rolling.md.memtmp health/rolling.md', 'fsyncDir health']);
});

test('every delete is followed by a directory sync: a file, the journal, a temp-file sweep, a failed write', (t) => {
  const rec = recording();
  const { s } = mk(t, U(1), rec.opts);
  create(s);
  rec.calls.length = 0;
  assert.equal(s.delete('rolling'), true);
  assert.deepEqual(rec.log(s.dir), ['remove health/rolling.md', 'fsyncDir health']);
  rec.calls.length = 0;
  assert.equal(s.delete('rolling'), true);                                      // already gone: the directory is still synced, so a retry is durable
  assert.deepEqual(rec.log(s.dir), ['fsyncDir health']);
  rec.calls.length = 0;
  assert.equal(s.delete('profile'), true);                                      // no such directory at all: nothing to sync
  assert.deepEqual(rec.log(s.dir), []);
  // the journal: written like any file, deleted with a directory sync
  assert.equal(s.writeJournal({ op: 'forget_reason', reason: 'too_early', at: NOW.toISOString() }), true);
  assert.deepEqual(rec.log(s.dir), [
    'writeFile journal.json.memtmp', 'fsyncFile journal.json.memtmp', 'rename journal.json.memtmp journal.json', 'fsyncDir .']);
  rec.calls.length = 0;
  assert.equal(s.clearJournal(), true);
  assert.deepEqual(rec.log(s.dir), ['remove journal.json', 'fsyncDir .']);
  // a temp-file sweep
  fs.writeFileSync(path.join(s.dir, `stray.md${TEMP_SUFFIX}`), 'old facts');
  rec.calls.length = 0;
  s.sweepTemps();
  assert.deepEqual(rec.log(s.dir), [`remove stray.md${TEMP_SUFFIX}`, 'fsyncDir .']);
});

test('the cleanup after a failed write is synced too, and the temp file is synced before it is checked', (t) => {
  const rec = recording({ writeFile: (p, x) => fs.writeFileSync(p, x.slice(0, 5)) });
  const { s } = mk(t, U(1), rec.opts);
  assert.equal(create(s), false);
  const log = rec.log(s.dir);
  const i = log.indexOf('remove health/rolling.md.memtmp');
  assert.ok(i > log.indexOf('fsyncFile health/rolling.md.memtmp'));
  assert.equal(log[i + 1], 'fsyncDir health');
  assert.ok(!log.some((l) => l.startsWith('rename')));                           // a torn temp file is never renamed into place
});

// ---------- directory-sync errors fail the operation, except the platform's own "not supported" ----------
const failing = (state) => {
  const dirFds = new Set();
  return {
    ...fs,
    openSync: (...a) => { const fd = fs.openSync(...a); if (fs.fstatSync(fd).isDirectory()) dirFds.add(fd); return fd; },
    closeSync: (fd) => { dirFds.delete(fd); return fs.closeSync(fd); },
    fsyncSync: (fd) => {                                   // only directory syncs fail; file syncs are real
      if (state.code && dirFds.has(fd)) throw Object.assign(new Error(`injected ${state.code}`), { code: state.code });
      return fs.fsyncSync(fd);
    },
  };
};

test('the tolerated directory-sync codes are listed in one place and nothing else is tolerated', () => {
  assert.deepEqual([...DIR_SYNC_TOLERATED], ['ENOTSUP', 'EOPNOTSUPP']);
  assert.deepEqual(Object.keys(DIR_SYNC_UNSUPPORTED_PLATFORMS), ['win32']);
  for (const code of ['ENOTSUP', 'EOPNOTSUPP']) for (const platform of ['linux', 'darwin', 'win32']) assert.equal(toleratedDirSyncError(code, platform), true);
  for (const code of ['EACCES', 'EIO', 'ENOSPC', 'EROFS', 'EBADF', 'EINVAL', 'EPERM', 'EISDIR', undefined, 'ENOENT']) {
    assert.equal(toleratedDirSyncError(code, 'linux'), false, `${code} on linux`);
    assert.equal(toleratedDirSyncError(code, 'darwin'), false, `${code} on darwin`);
  }
  for (const code of ['EINVAL', 'EPERM', 'EISDIR']) assert.equal(toleratedDirSyncError(code, 'win32'), true, `${code} on win32`);
  for (const code of ['EACCES', 'EIO', 'ENOSPC']) assert.equal(toleratedDirSyncError(code, 'win32'), false, `${code} on win32`);
});

test('a directory-sync failure fails the write and the delete, and a retry works once the disk is back', (t) => {
  for (const code of ['EACCES', 'EIO', 'EINVAL', 'ENOSPC']) {
    const state = { code: null };
    const { s } = mk(t, U(1), { fsImpl: failing(state), platform: 'linux' });
    state.code = code;
    assert.equal(create(s), false, code);                                          // reported as failed, not as done
    assert.match(s.lastError, new RegExp(code));
    assert.equal(s.lastStatus, 'failed');
    state.code = null;
    assert.equal(create(s), true, code);                                           // the retry works
    state.code = code;
    assert.equal(s.insert('rolling', D(3), SRC()), false, code);
    assert.equal(s.delete('rolling'), false, code);                                // a delete is not reported done either
    assert.equal(s.writeJournal({ op: 'forget_reason', reason: 'too_early', at: NOW.toISOString() }), false, code);
    assert.equal(s.suppressType('daily'), false, code);
    state.code = null;
    assert.equal(s.delete('rolling'), true);
  }
});

test('a failed directory sync makes a whole forget fail, not succeed without durability', (t) => {
  const state = { code: null };
  const { s } = mk(t, U(1), { fsImpl: failing(state) });
  s.create('rolling', [D(1), D(2)], [SRC()]);
  state.code = 'EIO';
  assert.equal(s.delete('rolling'), false);                                        // the file may be gone, but durability is not claimed
  state.code = null;
  assert.equal(s.delete('rolling'), true);                                         // the retry syncs the directory before reporting done
  assert.equal(s.view('rolling'), null);
  state.code = 'EIO';
  assert.equal(s.delete('rolling'), false);                                        // even though the file is already gone: not durable yet
  state.code = null;
  assert.equal(s.delete('rolling'), true);
});

test('the tolerated "not supported" codes do not fail anything; on windows the documented codes are tolerated too', (t) => {
  for (const [code, platform] of [['ENOTSUP', 'linux'], ['EOPNOTSUPP', 'darwin'], ['EINVAL', 'win32'], ['EPERM', 'win32'], ['EISDIR', 'win32']]) {
    const state = { code };
    const { s } = mk(t, U(1), { fsImpl: failing(state), platform });
    assert.equal(create(s), true, `${code} ${platform}`);
    assert.equal(s.insert('rolling', D(3), SRC()), true);
    assert.equal(s.delete('rolling'), true);
    assert.equal(s.lastStatus, 'ok');
  }
  // the same codes are NOT tolerated where the platform does support directory sync
  const state = { code: 'EINVAL' };
  const root = tempRoot();
  t.after(() => cleanup(root));
  assert.throws(() => new MemoryStore(root, U(1), { fsImpl: failing(state), platform: 'linux' }), /EINVAL/);   // even creating the folder is synced
});

// ---------- only ENOENT means absent: a file that exists but cannot be read is never overwritten ----------
test('a read error (EACCES, EIO) on an existing file fails create, insert, replaceFacts and delete and changes nothing', (t) => {
  for (const code of ['EACCES', 'EIO']) {
    const state = { on: false };
    const fsImpl = { ...fs, openSync: (p, ...rest) => {
      if (state.on && String(p).endsWith('health/rolling.md')) throw Object.assign(new Error(`injected ${code}`), { code });
      return fs.openSync(p, ...rest);
    } };
    const { s } = mk(t, U(1), { fsImpl });
    assert.equal(create(s, 'rolling'), true);
    const file = path.join(s.dir, 'health/rolling.md');
    const before = fs.readFileSync(file);
    state.on = true;
    assert.throws(() => s.create('rolling', [D(5)], [SRC()]), MemoryUnavailableError, `create ${code}`);        // it exists: not "absent"
    assert.throws(() => s.insert('rolling', D(3), SRC()), MemoryUnavailableError, `insert ${code}`);
    assert.throws(() => s.replaceFacts('rolling', [D(9)], [SRC()]), MemoryUnavailableError, `replaceFacts ${code}`);
    assert.throws(() => s.strReplace('rolling', D(1).text, D(1, 45)), MemoryUnavailableError, `strReplace ${code}`);
    assert.throws(() => s.delete('rolling'), MemoryUnavailableError, `delete ${code}`);
    state.on = false;
    assert.ok(fs.readFileSync(file).equals(before), `${code}: the file is byte-identical`);
    assert.deepEqual(leftovers(s), []);
    assert.deepEqual(s.view('rolling').split('\n').slice(3, 5), ['- [daily] 2026-10-01: Running 30 min', '- [daily] 2026-10-02: Running 30 min']);
    // a genuinely absent file is still created
    assert.equal(s.delete('rolling'), true);
    assert.equal(create(s, 'rolling'), true);
  }
});

test('the write path itself refuses to overwrite a file it cannot read (not only the callers that read first)', (t) => {
  const state = { on: false };
  const fsImpl = { ...fs, openSync: (p, ...rest) => {
    if (state.on && String(p).endsWith('health/rolling.md')) throw Object.assign(new Error('injected EIO'), { code: 'EIO' });
    return fs.openSync(p, ...rest);
  } };
  const { s } = mk(t, U(1), { fsImpl });
  create(s, 'rolling');
  const before = fs.readFileSync(path.join(s.dir, 'health/rolling.md'));
  const doc = s.read('rolling');
  state.on = true;
  assert.throws(() => s.replaceFacts('rolling', doc.facts.slice(1), doc.sources), MemoryUnavailableError);   // facts and sources already in hand
  assert.match(s.lastError, /cannot be read/);
  assert.ok(fs.readFileSync(path.join(s.dir, 'health/rolling.md')).equals(before));
  assert.deepEqual(leftovers(s), []);
});

// ---------- creating the root: every missing ancestor, one level at a time, each parent synced ----------
function recordingFs() {
  const log = [];
  const fdPath = new Map();
  const fsImpl = {
    ...fs,
    mkdirSync: (p, ...rest) => { log.push(`mkdir ${p}`); return fs.mkdirSync(p, ...rest); },
    openSync: (p, ...rest) => { const fd = fs.openSync(p, ...rest); fdPath.set(fd, p); return fd; },
    fsyncSync: (fd) => { log.push(`fsync ${fdPath.get(fd)}`); return fs.fsyncSync(fd); },
  };
  return { fsImpl, log };
}

test('an absent root is created one level at a time and the parent of each new directory is synced', (t) => {
  const base = fs.realpathSync(tempRoot());
  t.after(() => cleanup(base));
  const root = path.join(base, 'a', 'b', 'c');                          // none of a, b, c exists
  const { fsImpl, log } = recordingFs();
  const s = new MemoryStore(root, U(1), { fsImpl });
  assert.deepEqual(log, [
    `mkdir ${path.join(base, 'a')}`, `fsync ${base}`,
    `mkdir ${path.join(base, 'a', 'b')}`, `fsync ${path.join(base, 'a')}`,
    `mkdir ${root}`, `fsync ${path.join(base, 'a', 'b')}`,
    `mkdir ${s.dir}`, `fsync ${root}`,                                  // the user folder, then its parent
  ]);
  // a root that already exists only needs the user folder synced; an existing user folder needs nothing
  const again = recordingFs();
  new MemoryStore(root, U(2), { fsImpl: again.fsImpl });
  assert.deepEqual(again.log, [`mkdir ${path.join(root, U(2))}`, `fsync ${root}`]);
  const third = recordingFs();
  new MemoryStore(root, U(2), { fsImpl: third.fsImpl });
  assert.deepEqual(third.log, []);
});

test('a failed sync of an ancestor fails the construction; the tolerated codes do not', (t) => {
  const base = fs.realpathSync(tempRoot());
  t.after(() => cleanup(base));
  const failOn = (code, after) => {
    const { fsImpl } = recordingFs();
    let n = 0;
    return { ...fsImpl, fsyncSync: (fd) => { if (++n >= after) throw Object.assign(new Error(code), { code }); return fs.fsyncSync(fd); } };
  };
  // the sync of the topmost new directory's parent (the first one) fails
  assert.throws(() => new MemoryStore(path.join(base, 'x', 'y'), U(1), { fsImpl: failOn('EIO', 1), platform: 'linux' }), /EIO/);
  assert.throws(() => new MemoryStore(path.join(base, 'p', 'q'), U(1), { fsImpl: failOn('EACCES', 2), platform: 'linux' }), /EACCES/);   // a middle one
  assert.ok(new MemoryStore(path.join(base, 'm', 'n'), U(1), { fsImpl: failOn('ENOTSUP', 1), platform: 'linux' }));
});

// ---------- canonical order inside one fact, and the count of forgotten days left out ----------
test('lists inside one fact are canonical: every permutation of the items renders the same line', () => {
  const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  const daily = [{ activity: 'Walking', minutes: 30 }, { activity: 'Running', minutes: 40 }, { activity: 'Yoga', minutes: 20 }, { activity: 'Cycling', minutes: 15 }];
  const texts = new Set(perms(daily).map((items) => F.daily({ date: '2026-10-01', items }).text));
  assert.deepEqual([...texts], ['[daily] 2026-10-01: Cycling 15 min, Running 40 min, Walking 30 min, Yoga 20 min']);
  const mix = [{ activity: 'Walking', count: 4 }, { activity: 'Running', count: 6 }, { activity: 'Strength training', count: 2 }, { activity: 'HIIT', count: 1 }];
  const mixTexts = new Set(perms(mix).map((items) => F.mix({ items, asOf: '2026-11-18' }).text));
  assert.deepEqual([...mixTexts], ['Last 4 weeks by type: HIIT 1, Running 6, Strength training 2, Walking 4 (as of 2026-11-18)']);
  // the ids of a fold and of a history entry, in any order, and the excluded days of an aggregate
  const ids = [R(3), R(1), R(2)];
  const foldTexts = new Set(perms(ids).map((p) => S.earlier({ code: 'accept', ids: p.map((id) => ({ id, at: NOW })), at: NOW }).text));
  assert.equal(foldTexts.size, 1);
  assert.ok([...foldTexts][0].endsWith(`ids=${R(1)}@${NOW.toISOString()},${R(2)}@${NOW.toISOString()},${R(3)}@${NOW.toISOString()}`));
  assert.equal(new Set(perms(ids).map((p) => S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: p, at: NOW }).text)).size, 1);
  const days = ['2026-10-07', '2026-10-06', '2026-10-09'];
  assert.equal(new Set(perms(days).map((d) => F.weekly({ weekStart: '2026-10-05', count: 3, minutes: 90, excludedDays: d }).text)).size, 1);
  // the stored lines re-render exactly, and a line that is not canonical is not a fact
  assert.ok(reconstructFact('[daily] 2026-10-01: Cycling 15 min, Running 40 min'));
  assert.equal(reconstructFact('[daily] 2026-10-01: Running 40 min, Cycling 15 min'), null);
  assert.equal(reconstructFact('Last 4 weeks by type: Walking 4, Running 6 (as of 2026-11-18)'), null);
  // the standing slots are an ordered list (the latest declines, oldest first), not a set: their order is kept as given
  assert.match(F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 5, hour: 6 }, { weekday: 3, hour: 7 }] }).text, /\(Fri 06:00; Wed 07:00\)/);
  assert.throws(() => S.earlier({ code: 'accept', ids: [{ id: R(1), at: NOW }, { id: R(1), at: NOW }], at: NOW }), TypeError);   // an id twice is still refused
});

test('an aggregate that left forgotten days out says how many, never which; a complete one reads as before', () => {
  const day = ['2026-10-25'];
  const cases = [
    [F.weekly, { weekStart: '2026-10-19', count: 6, minutes: 240 }, '[weekly] Week of 2026-10-19: 6 workouts, 240 min'],
    [F.coverage, { workoutDays: 5, windowDays: 28, endDate: '2026-11-17' }, 'Workouts logged on 5 of the 28 days ending 2026-11-17'],
    [F.profile, { perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19' }, '4-week average: 3 workouts per week (as of 2026-11-18, valid until 2026-11-19)'],
    [F.mix, { items: [{ activity: 'Running', count: 6 }], asOf: '2026-11-18' }, 'Last 4 weeks by type: Running 6 (as of 2026-11-18)'],
    [F.thin, { days: 9, endDate: '2026-11-17' }, 'Days of data: 9 (ending 2026-11-17)'],
  ];
  for (const [make, input, plain] of cases) {
    assert.equal(make(input).text, plain);                                                      // no exclusion: as before
    const one = make({ ...input, excludedDays: day });
    assert.equal(one.text, `${plain} (1 forgotten day left out)`);
    assert.ok(!one.text.includes('2026-10-25'));
    assert.equal(make({ ...input, excludedDays: ['2026-10-25', '2026-10-24'] }).text, `${plain} (2 forgotten days left out)`);
    for (const f of [make(input), one]) {                                                       // preserved on parse
      const back = reconstructFact(f.text);
      assert.equal(back.text, f.text);
      assert.equal(back.excludedCount, f.excludedCount);
    }
    assert.equal(reconstructFact(`${plain} (0 forgotten days left out)`), null);               // zero is never written
    assert.equal(reconstructFact(`${plain} (1 forgotten days left out)`), null);               // exact wording
    assert.equal(reconstructFact(`${plain} (1 forgotten day left out)`)?.excludedCount, 1);
    assert.throws(() => make({ ...input, excludedDays: ['2099-01-01'] }), TypeError);          // a day outside the window
  }
});
