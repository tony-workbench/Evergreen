import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  MemoryUnavailableError, validateJournal, FILE_KINDS, DERIVED_FACT_TYPES, recordFeedback, changePreference, forget, forgetDerived, restoreDerived, recover,
  forgetFactType, forgetFactKey, restoreFactType, restoreFactKey, suppressedTypes, forgetRecommendation, memoryIndex, factLines, F,
  classifyFact, classifySource, parseTap, reconstructFact, REASONS, S, TEMP_SUFFIX, validateDocument,
  FEEDBACK_FILE, PREFS_FILE, HISTORY_FILE,
} from '../src/store/index.mjs';
import { DERIVE } from '../src/store/memory-store.mjs';
import { tapsOf } from '../src/store/derive.mjs';
import { MemoryStore, tempRoot, cleanup, NOW, seedProfile, cov, ROLL_SRC, R, U, recording } from './store-helpers.mjs';

const mk = (t, user = U(1), opts) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  return new MemoryStore(root, user, opts);
};
// Declines observed after a change must be later than the change (the change is a boundary in time).
const LATER = new Date('2026-11-19T12:00:00Z');
const LATEST = new Date('2026-11-26T12:00:00Z');
const later = { now: LATER };
// weekday 3 = Wed, 5 = Fri
const tap = (s, recId, reason = 'too_early', o = {}) =>
  recordFeedback(s, { action: 'declined', recId, activity: 'run', weekday: 3, hour: 7, reason, now: NOW, ...o });
const all = (s) => s.paths().map((p) => s.viewPath(p)).join('\n');

test('a tap with a valid reason is stored at once as a numbered statement with its source', (t) => {
  const s = mk(t);
  const r = recordFeedback(s, { action: 'declined', recId: R(1), activity: 'run', weekday: 3, hour: 7, reason: 'too_early', now: NOW });
  assert.equal(r.written, true);
  assert.equal(r.promoted, null);
  const text = s.view(FEEDBACK_FILE);
  assert.ok(text.includes(`- Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(1)})\n`));
  assert.ok(text.includes(`ref=recommendation:${R(1)};`));
});

test('every allowed reason is stored', (t) => {
  const s = mk(t);
  for (const [i, reason] of ['too_early', 'too_late', 'too_long', 'too_hard', 'not_today'].entries()) {
    assert.equal(tap(s, R(i), reason).written, true, reason);
  }
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 5);
});

test('a decline with no valid reason is not stored', (t) => {
  const s = mk(t);
  for (const reason of ['dislike', '', 0, false, 'toString', '__proto__', 'too early', 'TOO_EARLY', ' too_early', {}, []]) {
    assert.equal(recordFeedback(s, { action: 'declined', recId: R(1), activity: 'run', weekday: 3, hour: 7, reason, now: NOW }).written, false);
  }
  assert.deepEqual(s.paths(), []);
});

test('only structured, allowlisted fields are accepted', (t) => {
  const s = mk(t);
  const bad = [
    { recId: 'r 1' }, { recId: '' }, { recId: 'a'.repeat(41) }, { recId: 'r\n1' },
    { activity: 'run; heart rate 180 bpm' }, { activity: 'skydiving' }, { activity: undefined },
    { weekday: 0 }, { weekday: 8 }, { weekday: 'Wed' }, { weekday: 3.5 },
    { hour: 24 }, { hour: -1 }, { hour: '07:00' }, { hour: 7.5 },
    { now: undefined },
  ];
  for (const o of bad) assert.equal(tap(s, R(1), 'too_early', o).written, false, JSON.stringify(o));
  assert.deepEqual(s.paths(), []);
});

test('two declines with the same reason become one counted statement, not an inference', (t) => {
  const s = mk(t);
  assert.equal(tap(s, R(1)).promoted, null);
  const r2 = tap(s, R(2), 'too_early', { weekday: 5, hour: 6 });
  assert.equal(r2.promoted, 'Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)');
  const prefs = s.view(PREFS_FILE);
  assert.ok(prefs.includes('- Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)\n'));
  assert.match(prefs, /tier=pinned/);
  assert.ok(!/Avoids|Prefers|Often/.test(all(s)));
});

test('a third decline updates the same entry in place', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3));
  const prefs = s.view(PREFS_FILE);
  assert.ok(prefs.includes('Declined 3 suggestions as too early (Wed 07:00; Wed 07:00; Wed 07:00)'));
  assert.equal(factLines(prefs).length, 1);
});

test('the standing entry shows the latest five slots by observation time, not insertion order', (t) => {
  // id, hour suggested, observation time. Deliberately out of order; two share a time (tie broken by id).
  const taps = [
    { id: R(5), hour: 15, at: '2026-11-10T09:00:00.000Z' },
    { id: R(1), hour: 11, at: '2026-11-03T09:00:00.000Z' },
    { id: R(7), hour: 17, at: '2026-11-17T09:00:00.000Z' },
    { id: R(3), hour: 13, at: '2026-11-05T09:00:00.000Z' },
    { id: R(2), hour: 12, at: '2026-11-04T09:00:00.000Z' },
    { id: R(6), hour: 16, at: '2026-11-12T09:00:00.000Z' },
    { id: R(4), hour: 14, at: '2026-11-12T09:00:00.000Z' },     // same time as R(6): R(4) comes first
  ];
  // Expected, worked out by hand: by time then id -> R1 R2 R3 R5 R4 R6 R7 (hours 11 12 13 15 14 16 17); latest five: 13 15 14 16 17.
  const want = 'Declined 7 suggestions as too late (latest 5: Wed 13:00; Wed 15:00; Wed 14:00; Wed 16:00; Wed 17:00)';
  const orders = [taps, [...taps].reverse(), [taps[3], taps[6], taps[0], taps[2], taps[1], taps[5], taps[4]]];
  const files = [];
  for (const order of orders) {
    const s = mk(t, U(1));
    let last;
    for (const x of order) last = tap(s, x.id, 'too_late', { hour: x.hour, now: x.at });
    assert.equal(last.promoted, want);
    assert.deepEqual(factLines(s.view(PREFS_FILE)), [`- ${want}`]);
    files.push(s.view(FEEDBACK_FILE) + s.view(PREFS_FILE));
    fs.rmSync(s.dir, { recursive: true });
  }
  assert.equal(files[0], files[1]);      // the same taps in any order give byte-identical files
  assert.equal(files[0], files[2]);
});

test('different reasons are counted separately', (t) => {
  const s = mk(t);
  tap(s, R(1), 'too_early'); tap(s, R(2), 'too_late');
  assert.equal(s.view(PREFS_FILE), null);
  tap(s, R(3), 'too_long'); tap(s, R(4), 'too_long');
  assert.deepEqual(factLines(s.view(PREFS_FILE)), ['- Declined 2 suggestions as too long (Wed 07:00; Wed 07:00)']);
});

test('two different recommendation ids with identical slot and reason count as two taps', (t) => {
  const s = mk(t);
  assert.equal(tap(s, R(1)).written, true);
  const r2 = tap(s, R(2));
  assert.equal(r2.written, true);
  assert.equal(r2.duplicate, undefined);
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 2);
  assert.equal(r2.promoted, 'Declined 2 suggestions as too early (Wed 07:00; Wed 07:00)');
});

test('a repeat of the same recommendation id is the only duplicate and does not count twice', (t) => {
  const s = mk(t);
  tap(s, R(1));
  const again = tap(s, R(1));
  assert.equal(again.written, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.promoted, null);
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 1);
  assert.equal(s.view(PREFS_FILE), null);
  // even if the repeat claims another reason or slot, the first statement stands
  tap(s, R(1), 'too_late', { hour: 9 });
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 1);
});

test('promotion is recomputed on retry: a failed promotion is repaired by repeating the tap', (t) => {
  let failPrefs = false;
  const s = mk(t, U(1), {
    writeFile: (p, x) => fs.writeFileSync(p, failPrefs && p.includes('preferences') ? '' : x),
  });
  tap(s, R(1));
  failPrefs = true;
  const r2 = tap(s, R(2));
  assert.equal(r2.written, true);
  assert.equal(r2.promoted, null);
  assert.equal(r2.promotionFailed, true);
  assert.equal(s.view(PREFS_FILE), null);
  failPrefs = false;
  const retry = tap(s, R(2));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.promoted, 'Declined 2 suggestions as too early (Wed 07:00; Wed 07:00)');
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 2);
});

test('failed feedback write returns written:false and a retry is not mistaken for a duplicate', (t) => {
  let bad = true;
  const s = mk(t, U(1), { writeFile: (p, x) => fs.writeFileSync(p, bad ? '' : x) });
  assert.equal(tap(s, R(1)).written, false);
  assert.equal(s.view(FEEDBACK_FILE), null);
  bad = false;
  const r = tap(s, R(1));
  assert.equal(r.written, true);
  assert.equal(r.duplicate, undefined);
});

test('a changed preference moves the counted entry to history with date and reason', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  assert.equal(changePreference(s, { reason: 'too_early', why: 'schedule_change', now: NOW }), true);
  const prefs = s.view(PREFS_FILE);
  assert.ok(prefs.includes('- At the change on 2026-11-18T12:00:00.000Z: 2 declines as too early moved to history; new count starts at 0\n'));
  assert.ok(!prefs.includes('Declined 2'));
  const h = s.view(HISTORY_FILE);
  assert.ok(h.includes('- Recorded 2 declines as too early; changed on 2026-11-18T12:00:00.000Z (reason given: schedule change)\n'));
  assert.match(h, /tier=cold/);
});

test('after a change only later taps count again', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  assert.equal(s.view(FEEDBACK_FILE), null);
  assert.equal(tap(s, R(3), 'too_early', later).promoted, null);
  assert.equal(tap(s, R(4), 'too_early', later).promoted, 'Declined 2 suggestions as too early since 2026-11-18T12:00:00.000Z (Wed 07:00; Wed 07:00)');
});

test('changePreference needs a standing entry, a known reason, a known why and a date', (t) => {
  const s = mk(t);
  const base = { reason: 'too_early', why: 'other', now: NOW };
  assert.equal(changePreference(s, base), false);
  tap(s, R(1)); tap(s, R(2));
  for (const o of [{ reason: 'nope' }, { why: 'because I said so and 150 bpm' }, { now: undefined }]) {
    assert.equal(changePreference(s, { ...base, ...o }), false, JSON.stringify(o));
  }
  assert.equal(changePreference(s, { ...base, reason: 'too_late' }), false);
  assert.equal(s.view(HISTORY_FILE), null);
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 2);
});

test('forget a standing preference deletes every fact and source about it in feedback, preferences and history', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  tap(s, R(3), 'too_early', later); tap(s, R(4), 'too_early', later);                       // a new standing entry after the change
  tap(s, R(201), 'too_long');                         // unrelated, must survive
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.startsWith('- Declined 2 suggestions as too early')));
  assert.equal(forget(s, PREFS_FILE, 'Declined 2 suggestions as too early'), true);
  const text = all(s);
  assert.ok(!/too early|too_early/.test(text), text);
  assert.ok(!/recommendation[: ]r[1-4]/.test(text));
  assert.equal(s.view(HISTORY_FILE), null);
  assert.ok(!/too early/.test(memoryIndex(s)));
  assert.ok(s.view(FEEDBACK_FILE).includes(`too long (recommendation ${R(201)})`));   // unrelated tap kept
  // forgotten facts cannot regenerate from old feedback; only new taps count
  assert.equal(tap(s, R(5)).promoted, null);
  assert.equal(s.view(PREFS_FILE), null);
  assert.equal(tap(s, R(6)).promoted, 'Declined 2 suggestions as too early (Wed 07:00; Wed 07:00)');
});

test('forget through a history entry also removes the preference and the taps', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  tap(s, R(3)); tap(s, R(4));
  assert.equal(forget(s, HISTORY_FILE, 'Recorded 2 declines as too early'), true);
  assert.ok(!/too early|too_early|r[1-4]\b/.test(all(s)));
  assert.deepEqual(s.paths(), []);
});

test('forgetting one tap removes it with its source and recounts the standing entry', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3));
  assert.equal(forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(2)})`), true);
  assert.ok(!all(s).includes(R(2)));
  assert.ok(factLines(s.view(PREFS_FILE))[0].startsWith('- Declined 2 suggestions'));
  assert.equal(forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(3)})`), true);
  assert.equal(s.view(PREFS_FILE), null);              // below two taps, no standing entry
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 1);
});

test('forget of a missing fact or file fails without writing', (t) => {
  const s = mk(t);
  assert.equal(forget(s, PREFS_FILE, 'x 1'), false);
  tap(s, R(1)); tap(s, R(2));
  const before = all(s);
  assert.equal(forget(s, PREFS_FILE, 'Not there 1'), false);
  assert.equal(forget(s, PREFS_FILE, ''), false);
  assert.equal(all(s), before);
});

test('forget fails and can be retried when a write fails part way', (t) => {
  let bad = false;
  const s = mk(t, U(1), { writeFile: (p, x) => fs.writeFileSync(p, bad ? 'junk' : x) });
  tap(s, R(1)); tap(s, R(2)); tap(s, R(201), 'too_long');
  bad = true;
  assert.equal(forget(s, PREFS_FILE, 'Declined 2 suggestions'), false);
  assert.ok(s.view(PREFS_FILE).includes('Declined 2 suggestions'));
  bad = false;
  assert.equal(forget(s, PREFS_FILE, 'Declined 2 suggestions'), true);
  assert.ok(!/too early/.test(all(s)));
  assert.ok(s.view(FEEDBACK_FILE).includes(R(201)));
});

test('memoryIndex: pinned in full first, others as a count line, nothing else', (t) => {
  const s = mk(t);
  seedProfile(s);
  tap(s, R(1), 'too_long'); tap(s, R(2), 'too_long');
  changePreference(s, { reason: 'too_long', why: 'goal_change', now: NOW });
  const p = memoryIndex(s);
  assert.ok(p.includes('## about-user/profile.md (2 facts)'));
  assert.ok(p.includes('## preferences/workouts.md (1 facts)'));
  assert.ok(!p.includes('feedback/recommendations.md'));                 // feedback was moved to history, file is gone
  assert.ok(p.includes('- history/preferences.md: 1 facts'));
  assert.ok(p.includes('## Other memory files (1 files)'));
  assert.ok(p.indexOf('## preferences/workouts.md') < p.indexOf('Other memory files'));
  assert.ok(p.lastIndexOf('## ') < p.indexOf('- history/'));
  assert.ok(!p.includes('replaced because'));                            // history is a count line only
});

test('memoryIndex lists feedback as a cold file with a count generated from the file', (t) => {
  const s = mk(t);
  seedProfile(s);
  for (let i = 1; i <= 4; i++) tap(s, R(i), i % 2 ? 'too_long' : 'too_late');
  const p = memoryIndex(s);
  assert.ok(p.includes('- feedback/recommendations.md: 4 facts'));
  assert.ok(!p.includes('What the user said'));
  assert.ok(p.split(/\s+/).length < 600, `words: ${p.split(/\s+/).length}`);
});

test('pinned profile and preferences are printed in full; rolling is the compact view', (t) => {
  const s = mk(t);
  seedProfile(s);
  Object.keys(REASONS).forEach((reason, i) => { tap(s, R(10 + i), reason); tap(s, R(50 + i), reason); });
  const prefs = s.read(PREFS_FILE).facts;
  assert.equal(prefs.length, 5);
  const p = memoryIndex(s);
  for (const f of [...prefs, ...s.read('profile').facts]) assert.ok(p.includes(`- ${f.text}`), f.text);   // nothing cut
  assert.ok(p.includes('## preferences/workouts.md (5 facts)'));
});

test('the compact rolling view: all weekly lines, the latest 7 daily lines, a count of the earlier ones; under 600 words', (t) => {
  const s = mk(t);
  seedProfile(s);                                                                      // 28 daily + 12 weekly in the rolling file
  tap(s, R(1)); tap(s, R(2)); acc(s, R(3));
  const p = memoryIndex(s);
  assertIndexLines(s);
  const lines = p.split('\n');
  const daily = lines.filter((l) => l.startsWith('- [daily]'));
  assert.deepEqual(daily.map((l) => l.slice(10, 20)), ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);   // the latest 7
  assert.equal(lines.filter((l) => l.startsWith('- [weekly]')).length, 12);            // all weekly lines
  assert.ok(lines.includes('- health/rolling.md: 21 earlier daily lines not shown'));
  assert.ok(lines.includes('## health/rolling.md (40 facts)'));
  const words = p.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 600, `words: ${words}`);
  // no earlier day leaks into the text
  assert.ok(!p.includes('[daily] 2026-10-21') && !p.includes('[daily] 2026-10-01'));
  // with 7 or fewer daily lines there is no note
  const u = mk(t, U(2));
  u.create('rolling', [F.daily({ date: '2026-10-01', items: [{ activity: 'Running', minutes: 30 }] })], [ROLL_SRC()]);
  assert.ok(!memoryIndex(u).includes('not shown'));
});

test('memoryIndex is deterministic and independent of creation order', (t) => {
  const a = mk(t, U(1)); const b = mk(t, U(2));
  seedProfile(a);
  tap(a, R(1)); tap(a, R(2));
  tap(b, R(1)); tap(b, R(2));
  seedProfile(b);
  assert.equal(memoryIndex(a), memoryIndex(a));
  assert.equal(memoryIndex(a), memoryIndex(b));
});

test('memoryIndex of an empty store is empty and never lists sources', (t) => {
  const s = mk(t);
  assert.equal(memoryIndex(s), '');
  seedProfile(s);
  assert.ok(!memoryIndex(s).includes('[S-roll]'));
});

// ---------- helpers for the rest ----------
const BANNED = /\b(should|try|rest|great|a lot|too much|will|improve|advice|must|need to|recommend)\b/i;
const reasonIn = (line) => Object.keys(REASONS).find((k) => new RegExp(`\\bas ${REASONS[k]}\\b`).test(line));
function sourceIdFor(fact) {
  const kind = classifyFact(fact);
  if (kind === 'tap') return `S${parseTap(fact).recId}`;
  if (kind === 'earlier') return `E-${/accepts$/.test(fact) ? 'accept' : /no reason given$/.test(fact) ? 'none' : reasonIn(fact)}`;
  if (kind === 'accept' || kind === 'decline') return `S${/\(recommendation (rec_[0-9a-f]+)[,)]/.exec(fact)[1]}`;
  if (kind === 'standing') return `P-${reasonIn(fact)}`;
  if (kind === 'change') return `C-${reasonIn(fact)}`;
  if (kind === 'history') return `H-${reasonIn(fact)}`;
  return 'S-roll';
}
/** Every fact line is a template line with no advice words and has a matching source line. */
const PATHS = Object.values(FILE_KINDS).map((k) => k.path.replace(/[./]/g, '\\$&')).join('|');
const INDEX_LINE = new RegExp(`^(?:## (?:${PATHS}) \\(\\d+ facts\\)|## Other memory files \\(\\d+ files\\)|- (?:${PATHS}): \\d+ facts|- (?:${PATHS}): \\d+ earlier daily lines not shown)$`);
/** Every line memoryIndex prints is a header or count line with a number, or a templated fact; no advice words. */
function assertIndexLines(s) {
  const out = memoryIndex(s);
  for (const line of out.split('\n')) {
    const ok = INDEX_LINE.test(line) || (line.startsWith('- ') && classifyFact(line.slice(2)));
    assert.ok(ok, `index line not allowed: ${line}`);
    assert.match(line, /\d/, line);
    if (line.startsWith('- ') && classifyFact(line.slice(2))) assert.ok(measure(line.slice(2)), `no measurement in: ${line}`);
    assert.ok(!BANNED.test(line), line);
  }
  return out;
}
function assertLintedAndSourced(s) {
  if (s.paths().length) assertIndexLines(s);
  for (const p of s.paths()) {
    const text = s.viewPath(p);
    const sources = text.split('## Sources\n')[1].split('\n').filter(Boolean);
    for (const l of factLines(text)) {
      const f = l.slice(2);
      assert.ok(classifyFact(f), `${p}: ${f}`);
      assert.ok(!BANNED.test(f), `${p}: ${f}`);
      assert.ok(sources.some((x) => x.startsWith(`- [${sourceIdFor(f)}] `)), `no source for ${p}: ${f}`);
    }
    for (const x of sources) assert.ok(classifySource(x.slice(2)), `${p}: ${x}`);
  }
}
const snapshot = (s) => {
  const out = {};
  for (const n of fs.readdirSync(s.dir, { recursive: true })) {
    const f = path.join(s.dir, n);
    if (fs.statSync(f).isFile()) out[n] = fs.readFileSync(f, 'utf8');
  }
  return out;
};
/** A store whose writer counts writes and can go down from the k-th write on. */
function flaky(t) {
  const ctl = { n: 0, k: null };
  const s = mk(t, U(1), {
    writeFile: (p, x) => {
      ctl.n++;
      if (ctl.k !== null && ctl.n >= ctl.k) throw new Error('down');
      fs.writeFileSync(p, x);
    },
    remove: (p) => {                                         // deletions are steps too
      ctl.n++;
      if (ctl.k !== null && ctl.n >= ctl.k) throw new Error('down');
      fs.rmSync(p, { force: true });
    },
  });
  return { s, ctl };
}
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');

test('every produced line fits a template, has no advice word, and has a matching source', (t) => {
  const s = mk(t);
  seedProfile(s);
  tap(s, R(1)); tap(s, R(2), 'too_early', { weekday: 5, hour: 6 }); tap(s, R(3), 'too_long'); tap(s, R(4), 'too_long'); tap(s, R(5), 'not_today');
  assertLintedAndSourced(s);
  changePreference(s, { reason: 'too_early', why: 'schedule_change', now: NOW });
  assertLintedAndSourced(s);
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.includes('At the change on')));
  tap(s, R(6)); tap(s, R(7));
  assertLintedAndSourced(s);
  forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(7)})`);
  assertLintedAndSourced(s);
});

test('the preference-change fact gets its source in the same write', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changePreference(s, { reason: 'too_early', why: 'goal_change', now: NOW });
  const prefs = s.view(PREFS_FILE);
  assert.ok(prefs.includes('- At the change on 2026-11-18T12:00:00.000Z: 2 declines as too early moved to history; new count starts at 0\n'));
  assert.ok(prefs.includes('- [C-too_early] type=chat; ref=preference_change:too_early;'));
  assert.ok(!prefs.includes('[P-too_early]'));
  assert.ok(s.view(HISTORY_FILE).includes('- [H-too_early] type=chat;'));
});

test('adversarial input cannot reach storage through any entry point', (t) => {
  const s = mk(t);
  const adversarial = ['Heart rate 180 bpm', 'Run 3 times tomorrow', 'You will improve by 5%', 'rest more 2 days', '1, 2, 3, 4, 5, 6, 7', 'run\nWed'];
  for (const a of adversarial) {
    for (const o of [{ activity: a }, { recId: a }, { weekday: a }, { hour: a }, { reason: a }, { now: a }]) {
      assert.equal(tap(s, R(1), 'too_early', o).written, false, `${a} ${JSON.stringify(o)}`);
    }
  }
  tap(s, R(1)); tap(s, R(2));
  for (const a of adversarial) {
    assert.equal(changePreference(s, { reason: 'too_early', why: a, now: NOW }), false);
    assert.equal(changePreference(s, { reason: a, why: 'other', now: NOW }), false);
  }
  assert.equal(s.view(HISTORY_FILE), null);
  assertLintedAndSourced(s);
  assert.equal(s.readJournal(), null);
});

test('forget a tap, then replay its id: nothing comes back', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(201), 'too_long');
  assert.equal(forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(1)})`), true);
  const r = tap(s, R(1));
  assert.equal(r.written, false);
  assert.equal(r.suppressed, true);
  assert.ok(!all(s).includes(`recommendation ${R(1)})`));
  assert.equal(s.view(PREFS_FILE), null);
});

test('forget a standing preference, then replay one id and then two ids: nothing comes back', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(201), 'too_long');
  assert.equal(forget(s, PREFS_FILE, 'Declined 2 suggestions as too early'), true);
  assert.equal(tap(s, R(1)).written, false);
  assert.equal(s.view(PREFS_FILE), null);
  assert.equal(tap(s, R(2)).written, false);
  assert.equal(s.view(PREFS_FILE), null);
  assert.ok(!/too early/.test(all(s)) && !/too early/.test(memoryIndex(s)));
  // a different id is a new tap and counts from zero
  assert.equal(tap(s, R(9)).promoted, null);
});

test('the suppression marker holds only sha256 hashes, never content, and is never indexed', (t) => {
  const s = mk(t);
  tap(s, R(77)); tap(s, R(2)); tap(s, R(201), 'too_long');
  forget(s, PREFS_FILE, 'Declined 2 suggestions as too early');
  const raw = fs.readFileSync(path.join(s.dir, 'forgotten.json'), 'utf8');
  assert.deepEqual(JSON.parse(raw), [sha(R(2)), sha(R(77)), sha(`forgotten:${R(2)}`), sha(`forgotten:${R(77)}`)].sort());   // each forgotten id: suppressed and marked forgotten
  assert.ok(!/early|rec_|run|Wed/.test(raw));
  assert.ok(!memoryIndex(s).includes('forgotten'));
  assert.ok(!s.paths().some((p) => p.includes('forgotten')));
});

test('ids moved to history by a change cannot be replayed into a new count', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  assert.equal(tap(s, R(1)).written, false);
  assert.equal(tap(s, R(2)).written, false);
  assert.equal(s.view(FEEDBACK_FILE), null);
});

function changeScenario(s) {
  tap(s, R(1)); tap(s, R(2), 'too_early', { weekday: 5, hour: 6 }); tap(s, R(201), 'too_long');
}
const changeOp = (s) => changePreference(s, { reason: 'too_early', why: 'schedule_change', now: NOW });

test('changePreference is recoverable: a failure after any write is finished by the next call', (t) => {
  const clean = flaky(t);
  changeScenario(clean.s);
  clean.ctl.n = 0;
  assert.equal(changeOp(clean.s), true);
  const total = clean.ctl.n;
  const want = snapshot(clean.s);
  assert.ok(total >= 5, `writes: ${total}`);
  assert.ok(!('journal.json' in want));
  for (let k = 1; k <= total; k++) {
    const { s, ctl } = flaky(t);
    changeScenario(s);
    ctl.n = 0; ctl.k = k;
    assert.equal(changeOp(s), false, `k=${k}`);
    if (k > 1) assert.notEqual(s.readJournal(), null, `journal kept, k=${k}`);   // k=1: the journal itself could not be written
    ctl.k = null;
    assert.equal(changeOp(s), true, `retry k=${k}`);
    assert.deepEqual(snapshot(s), want, `k=${k}`);
    assertLintedAndSourced(s);
  }
});

test('any other call also finishes a pending journal', (t) => {
  const { s, ctl } = flaky(t);
  changeScenario(s);
  ctl.n = 0; ctl.k = 4;
  changeOp(s);
  ctl.k = null;
  assert.notEqual(s.readJournal(), null);
  const r = tap(s, R(209), 'too_hard');                      // recordFeedback runs recovery first
  assert.equal(r.written, true);
  assert.equal(s.readJournal(), null);
  assert.ok(s.view(PREFS_FILE).includes('At the change on'));
  assert.ok(!factLines(s.view(FEEDBACK_FILE)).some((l) => l.includes('too early')));
});

test('recover is a no-op without a journal and reports a damaged journal', (t) => {
  const s = mk(t);
  assert.deepEqual(recover(s), { ok: true, applied: null });
  fs.writeFileSync(path.join(s.dir, 'journal.json'), '{"op":"rm -rf"}\n');
  assert.equal(recover(s).ok, false);
  assert.equal(tap(s, R(1)).written, false);
});

test('forget is recoverable after a failure at any write', (t) => {
  const run = (s) => forget(s, PREFS_FILE, 'Declined 2 suggestions as too early');
  const clean = flaky(t);
  changeScenario(clean.s);
  clean.ctl.n = 0;
  assert.equal(run(clean.s), true);
  const total = clean.ctl.n;
  const want = snapshot(clean.s);
  for (let k = 1; k <= total; k++) {
    const { s, ctl } = flaky(t);
    changeScenario(s);
    ctl.n = 0; ctl.k = k;
    assert.equal(run(s), false, `k=${k}`);
    ctl.k = null;
    run(s);                                                  // finishes the journal (or runs the whole forget again)
    assert.deepEqual(snapshot(s), want, `k=${k}`);
    assert.ok(!/too early/.test(all(s)));
  }
});

test('forgetting a tap is recoverable after a failure at any write', (t) => {
  const run = (s) => forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(1)})`);
  const clean = flaky(t);
  changeScenario(clean.s);
  clean.ctl.n = 0;
  assert.equal(run(clean.s), true);
  const total = clean.ctl.n;
  const want = snapshot(clean.s);
  for (let k = 1; k <= total; k++) {
    const { s, ctl } = flaky(t);
    changeScenario(s);
    ctl.n = 0; ctl.k = k;
    assert.equal(run(s), false, `k=${k}`);
    ctl.k = null;
    run(s);
    assert.deepEqual(snapshot(s), want, `k=${k}`);
    assert.equal(tap(s, R(1)).written, false);
  }
});

test('fail closed: while a journal cannot be recovered, no memory text can be read', (t) => {
  const { s, ctl } = flaky(t);
  changeScenario(s);
  assert.ok(memoryIndex(s).includes('Declined 2 suggestions as too early'));
  ctl.n = 0; ctl.k = 2;                                    // the forget starts, then the disk goes away
  assert.equal(forget(s, PREFS_FILE, 'Declined 2 suggestions as too early'), false);
  assert.notEqual(s.readJournal(), null);
  assert.ok(fs.readFileSync(path.join(s.dir, 'preferences/workouts.md'), 'utf8').includes('too early'));   // still on disk
  // recovery keeps failing: nothing readable, nothing leaks
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);
  assert.throws(() => s.view(PREFS_FILE), MemoryUnavailableError);
  assert.throws(() => s.view(FEEDBACK_FILE), MemoryUnavailableError);
  assert.throws(() => s.paths(), MemoryUnavailableError);
  let leaked = '';
  try { leaked = memoryIndex(s); } catch (e) { leaked = String(e.message); }
  assert.ok(!/Declined|too early/.test(leaked));
  // once the disk is back, the next read finishes the forget and the preference never shows
  ctl.k = null;
  const p = memoryIndex(s);
  assert.ok(!/too early/.test(p));
  assert.equal(s.readJournal(), null);
});

test('fail closed: a journal that is damaged blocks the index', (t) => {
  const s = mk(t);
  changeScenario(s);
  fs.writeFileSync(path.join(s.dir, 'journal.json'), '{"op":"forget_reason","reason":"../../x","at":"now"}\n');
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);
  assert.throws(() => s.view(PREFS_FILE), MemoryUnavailableError);
});

test('fail closed: a damaged forgotten.json blocks feedback, forget, change and the index', (t) => {
  const s = mk(t);
  changeScenario(s);
  forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(1)})`);
  fs.writeFileSync(path.join(s.dir, 'forgotten.json'), '{"oops":1}');
  assert.throws(() => tap(s, R(1)), MemoryUnavailableError);          // a forgotten id cannot be replayed
  assert.throws(() => tap(s, R(50)), MemoryUnavailableError);
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);
  assert.throws(() => forget(s, PREFS_FILE, 'Declined'), MemoryUnavailableError);
  assert.throws(() => changeOp(s), MemoryUnavailableError);
  assert.ok(!fs.readFileSync(path.join(s.dir, 'feedback/recommendations.md'), 'utf8').includes(R(50)));
});

test('index never lists stray files or caller-chosen paths', (t) => {
  const s = mk(t);
  seedProfile(s);
  fs.writeFileSync(path.join(s.dir, 'heart_rate_180.md'), 'x');
  fs.mkdirSync(path.join(s.dir, 'notes'));
  fs.writeFileSync(path.join(s.dir, 'notes', 'raw_samples.md'), 'x');
  const p = assertIndexLines(s);
  assert.ok(!/heart_rate|raw_samples|notes/.test(p));
});

test('a hand-edited pinned file with an invalid line is never returned or indexed', (t) => {
  const s = mk(t);
  seedProfile(s);
  const FILES = { profile: 'about-user/profile.md', rolling: 'health/rolling.md' };
  const good = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, fs.readFileSync(path.join(s.dir, rel), 'utf8')]));
  const bad = [
    ['profile', '- Heart rate 180 bpm'],                                                  // no template
    ['rolling', '- Heart rate 180 bpm'],
    ['rolling', '- Workouts logged on 99 of the 28 days ending 2026-11-17'],              // grammar fits, numbers do not
    ['rolling', '- Workouts logged on 03 of the 28 days ending 2026-11-17'],              // not the canonical rendering
    ['rolling', '- Workouts logged on 5 of the 28 days ending 2026-02-30'],               // not a date
    ['rolling', '- Workouts logged on 5 of 28 days'],                                     // the older wording, no end date
    ['rolling', '- Days of data: 1000 (ending 2026-11-17)'],
    ['rolling', '- Days of data: 9'],
    ['rolling', '- Thin history: 9 days of data ending 2026-11-17'],      // the old, judging wording is gone
    ['profile', '- 4-week average: 1.250 workouts per week (as of 2026-11-18, valid until 2026-11-19)'],
    ['profile', '- [daily] 2026-10-01: Running 40 min'],                                  // a rolling fact in the profile file
    ['profile', '- Workouts logged on 5 of the 28 days ending 2026-11-17'],               // a coverage fact in the profile file
  ];
  for (const [kind, line] of bad) {
    const f = path.join(s.dir, FILES[kind]);
    fs.writeFileSync(f, good[kind].replace('## Sources', `${line}\n## Sources`));
    assert.throws(() => s.view(kind), MemoryUnavailableError, line);
    assert.throws(() => s.viewPath(FILES[kind]), MemoryUnavailableError, line);
    assert.throws(() => s.read(kind), MemoryUnavailableError, line);
    assert.throws(() => memoryIndex(s), MemoryUnavailableError, line);
    assert.throws(() => s.insert(kind, kind === 'rolling' ? cov(5, 7) : F.thin({ days: 3, endDate: '2026-11-17' }), ROLL_SRC()), MemoryUnavailableError, line);
    fs.writeFileSync(f, good[kind]);
  }
  const rf = path.join(s.dir, FILES.rolling);
  const dup = '- Workouts logged on 1 of the 28 days ending 2026-11-17';
  fs.writeFileSync(rf, good.rolling.replace('## Sources', `${dup}\n${dup}\n## Sources`));
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);                           // duplicate
  fs.writeFileSync(rf, good.rolling.replace('- [S-roll]', '- Heart rate 180 bpm\n- [S-roll]'));
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);                           // bad source line
  fs.writeFileSync(rf, good.rolling.replace('# Rolling summaries', '# Rolling 180 bpm'));
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);                           // bad title
  assert.equal(s.delete('rolling'), true);                                               // an invalid file can still be cleared
  fs.writeFileSync(rf, good.rolling);
  assert.ok(memoryIndex(s).includes('4-week average'));
});

test('a feedback file with a fact that no constructor would write is refused', (t) => {
  const s = mk(t);
  tap(s, R(1));
  const f = path.join(s.dir, 'feedback/recommendations.md');
  const good = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, good.replace('## Sources', `- Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(1)})\n## Sources`));
  assert.throws(() => s.view(FEEDBACK_FILE), MemoryUnavailableError);          // duplicate
  fs.writeFileSync(f, good.replace('## Sources', `- Declined 1 run suggested for Wed 08:00 as too late (recommendation ${R(1)})\n## Sources`));
  assert.throws(() => s.view(FEEDBACK_FILE), MemoryUnavailableError);          // same id twice
  assert.throws(() => tap(s, R(2)), MemoryUnavailableError);
});

test('replaceFacts takes only trusted objects and rejects the whole call if one fails', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  const before = all(s);
  const doc = s.read(PREFS_FILE);
  const ok = doc.facts[0];
  assert.equal(s.replaceFacts(PREFS_FILE, [ok, 'Declined 9 suggestions as too early (Wed 07:00)'], doc.sources), false);
  assert.equal(s.replaceFacts(PREFS_FILE, [ok, { cls: 'fact', kind: 'standing', text: ok.text }], doc.sources), false);
  assert.equal(s.replaceFacts(PREFS_FILE, [ok], ['[P-too_early] type=feedback']), false);
  assert.equal(s.replaceFacts(PREFS_FILE, [cov(1)], doc.sources), false);          // a coverage fact does not belong here
  assert.equal(all(s), before);
});

test('forgetting one derived line is refused; forgetDerived removes the file and nothing recomputes it until restored', (t) => {
  const s = mk(t);
  seedProfile(s);
  const before = s.view('profile');
  assert.equal(forget(s, 'profile', '4-week average'), false);
  assert.match(s.lastError, /refused.*forgetDerived/);
  assert.equal(forget(s, 'rolling', '[daily]'), false);
  assert.equal(s.view('profile'), before);
  assert.equal(forgetDerived(s, 'tap'), false);                                    // only derived kinds
  assert.equal(forgetDerived(s, 'profile'), true);
  assert.equal(s.view('profile'), null);
  assert.ok(!memoryIndex(s).includes('4-week average'));
  // a recompute (create), an insert, a replace: nothing is written
  seedProfile(s);
  assert.equal(s.view('profile'), null);
  assert.equal(s.create('profile', [cov(1)], [ROLL_SRC()]), false);
  assert.equal(s.replaceFacts('profile', [cov(1)], [ROLL_SRC()]), false);
  assert.equal(s.insert('profile', cov(2), ROLL_SRC()), false);
  assert.equal(s.view('profile'), null);
  assert.ok(!memoryIndex(s).includes('4-week average'));
  assert.ok(memoryIndex(s).includes('## health/rolling.md'));                      // the other derived file is untouched
  // the marker is a hash only, in the validated format, and survives a new store object
  const raw = fs.readFileSync(path.join(s.dir, 'forgotten.json'), 'utf8');
  assert.match(raw, /^\["[0-9a-f]{64}"\]\n$/);
  assert.ok(!/profile|rolling/.test(raw));
  const again = new MemoryStore(path.dirname(s.dir), U(1));
  assert.equal(again.create('profile', [cov(1)], [ROLL_SRC()]), false);
  // restore, then recompute works
  assert.equal(restoreDerived(s, 'profile'), true);
  seedProfile(s);
  assert.ok(memoryIndex(s).includes('4-week average'));
  assert.equal(fs.readFileSync(path.join(s.dir, 'forgotten.json'), 'utf8'), '[]\n');
  assert.equal(restoreDerived(s, 'tap'), false);
});

test('forgetting a derived file does not disturb forgotten recommendation ids', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long');
  forget(s, PREFS_FILE, 'Declined 2 suggestions as too early');
  seedProfile(s);
  forgetDerived(s, 'rolling');
  restoreDerived(s, 'rolling');
  assert.equal(tap(s, R(1)).written, false);                                       // still suppressed
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, 'forgotten.json'), 'utf8')).length, 4);   // two ids, each suppressed and marked forgotten
});

test('a journal whose values no constructor accepts cannot be recovered and blocks reads', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  const j = { op: 'change_preference', reason: 'too_early', why: 'other', at: '2026-13-45T00:00:00.000Z', count: 2, ids: [R(1), R(2)] };
  fs.writeFileSync(path.join(s.dir, 'journal.json'), `${JSON.stringify(j)}\n`);
  assert.equal(recover(s).ok, false);
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);
  fs.writeFileSync(path.join(s.dir, 'journal.json'), `${JSON.stringify({ ...j, date: '2026-11-18', count: 1 })}\n`);   // a history entry records at least 2 declines
  assert.equal(recover(s).ok, false);
  assert.throws(() => memoryIndex(s), MemoryUnavailableError);
  assert.equal(forget(s, PREFS_FILE, 'Declined'), false);
});

test('forgetDerived is journaled: a stop after any step is finished before anything can be read', (t) => {
  const run = (s) => forgetDerived(s, 'profile');
  const setup = (s) => { seedProfile(s); tap(s, R(1)); };
  const clean = flaky(t);
  setup(clean.s);
  clean.ctl.n = 0;
  assert.equal(run(clean.s), true);
  const total = clean.ctl.n;
  const want = snapshot(clean.s);
  assert.ok(total >= 4, `steps: ${total}`);                  // journal, suppression, delete, journal removal
  assert.ok(!('about-user/profile.md' in want));
  for (let k = 1; k <= total; k++) {
    const { s, ctl } = flaky(t);
    setup(s);
    ctl.n = 0; ctl.k = k;
    assert.equal(run(s), false, `k=${k}`);
    if (k > 1) {
      // the journal is there: nothing can be read, so the forgotten facts cannot be indexed
      assert.throws(() => s.view('profile'), MemoryUnavailableError, `k=${k}`);
      ctl.k = ctl.n;                                         // recovery keeps failing
      assert.throws(() => memoryIndex(s), MemoryUnavailableError, `k=${k}`);
    }
    ctl.k = null;
    if (k === 1) assert.equal(run(s), true);                 // the journal itself was not written: nothing started, so ask again
    const p = memoryIndex(s);                                // otherwise the next read finishes the forget
    assert.ok(!p.includes('4-week average'), `k=${k}`);
    assert.equal(s.readJournal(), null);
    assert.equal(s.create('profile', [cov(1)], [ROLL_SRC()]), false);
    assert.deepEqual(snapshot(s), want, `k=${k}`);
  }
});

test('a second change moves the declines since the first one and leaves no standing entry behind', (t) => {
  const s = mk(t);
  const change = (date, now) => changePreference(s, { reason: 'too_early', why: 'schedule_change', now });
  tap(s, R(1)); tap(s, R(2));
  assert.equal(change('2026-11-18', NOW), true);
  tap(s, R(3), 'too_early', later); tap(s, R(4), 'too_early', later);
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.startsWith('- Declined 2 suggestions as too early since 2026-11-18T12:00:00.000Z')));
  assert.equal(change('2026-11-19', new Date('2026-11-19T13:00:00Z')), true);
  assert.deepEqual(factLines(s.view(PREFS_FILE)).sort(), [
    '- At the change on 2026-11-18T12:00:00.000Z: 2 declines as too early moved to history; new count starts at 0',
    '- At the change on 2026-11-19T13:00:00.000Z: 2 declines as too early moved to history; new count starts at 0']);
  assert.equal(s.view(FEEDBACK_FILE), null);                      // the new taps are gone
  assert.ok(!all(s).includes('[P-too_early]'));
  assert.equal(tap(s, R(3), 'too_early', { now: LATEST }).written, false);   // and cannot be replayed
  assertLintedAndSourced(s);
  assert.equal((s.view(PREFS_FILE).match(/\[C-too_early\]/g) || []).length, 1);
  assert.equal(tap(s, R(5), 'too_early', { now: LATEST }).promoted, null);   // the count starts again
  assert.equal(change('2026-11-19', new Date('2026-11-19T13:00:00.000Z')), true);   // said again with nothing left to move: already done
  assert.equal(change('2026-11-20', new Date('2026-11-20T13:00:00Z')), false);  // one decline is not a standing entry: nothing to move
});

test('a stop between a tap and its promotion is repaired by the next read', (t) => {
  const { s, ctl } = flaky(t);
  tap(s, R(1));
  ctl.n = 0;
  ctl.k = 2;                                                       // the tap is written, the promotion is not
  const r = tap(s, R(2));
  assert.equal(r.written, true);
  assert.equal(r.promotionFailed, true);
  ctl.k = null;
  assert.ok(memoryIndex(s).includes('Declined 2 suggestions as too early'));   // no further tap needed
  assert.equal(s.view(PREFS_FILE).includes('[P-too_early]'), true);
});

// ---------- the measurement of each template: a count, minutes or an average, never a date, id or time ----------
const sanitize = (t) => t.replace(/\d{4}-\d{2}-\d{2}/g, 'DATE').replace(/rec_[0-9a-f]+/g, 'ID').replace(/\b\d\d:00\b/g, 'TIME').replace(/latest \d/, 'latest');
const MEASURE = {
  tap: [/^Declined (\d+) [a-z]+ suggested/, /(?<=^Declined )\d+ /],
  earlier: [/^Earlier: (\d+) /, /(?<=^Earlier: )\d+ /],
  decline: [/^Declined (\d+) [a-z]+ suggested/, /(?<=^Declined )\d+ /],
  accept: [/^Accepted (\d+) [a-z]+ suggested/, /(?<=^Accepted )\d+ /],
  standing: [/^Declined (\d+) suggestions/, /(?<=^Declined )\d+ (?=suggestions)/],
  history: [/^Recorded (\d+) declines/, /(?<=^Recorded )\d+ /],
  change: [/: (\d+) declines as/, /(?<=: )\d+ (?=declines)/],
  daily: [/(\d+) min/, / \d+ min/g],
  weekly: [/(\d+) workouts, (\d+) min/, /\d+ workouts, \d+ min/],
  profile: [/: (\d+(?:\.\d+)?) workouts per week/, /\d+(?:\.\d+)? (?=workouts per week)/],
  mix: [/by type: (?:[A-Za-z ]+ \d+)/, / \d+(?=,| \()/g],
  coverage: [/(\d+) of the (\d+) days/, /\d+ of the \d+ /],
  thin: [/Days of data: (\d+)/, /(?<=Days of data: )\d+ /],
};
/** The numeric measurement of a stored sentence, or null. Digits in dates, ids and times never count. */
function measure(text) {
  const kind = classifyFact(text) ?? Object.keys(MEASURE).find((k) => MEASURE[k][0].test(sanitize(text)));
  return kind && MEASURE[kind][0].exec(sanitize(text))?.[0] ? kind : null;
}
const SAMPLES = () => ({
  tap: F.tap({ recId: R(1), activity: 'run', weekday: 3, hour: 7, reason: 'too_early' }),
  earlier: F.earlier({ action: 'declined', reason: 'too_early', count: 12 }),
  decline: F.decline({ recId: R(3), activity: 'run', weekday: 5, hour: 6 }),
  accept: F.accept({ recId: R(2), activity: 'walk', weekday: 3, hour: 7 }),
  standing: F.standing({ reason: 'too_early', count: 7, slots: [1, 2, 3, 4, 5].map((h) => ({ weekday: 3, hour: h + 5 })) }),
  change: F.change({ reason: 'too_early', at: '2026-11-18T12:00:00.000Z', count: 2 }),
  history: F.history({ reason: 'too_early', count: 2, at: '2026-11-18T12:00:00.000Z', why: 'other' }),
  daily: F.daily({ date: '2026-10-01', items: [{ activity: 'Running', minutes: 40 }, { activity: 'Walking', minutes: 30 }] }),
  weekly: F.weekly({ weekStart: '2026-09-07', count: 3, minutes: 120 }),
  profile: F.profile({ perWeek: 3.25, asOf: '2026-11-18', validUntil: '2026-11-19' }),
  mix: F.mix({ items: [{ activity: 'Running', count: 6 }, { activity: 'Walking', count: 4 }], asOf: '2026-11-18' }),
  coverage: F.coverage({ workoutDays: 5, windowDays: 28, endDate: '2026-11-17' }),
  thin: F.thin({ days: 9, endDate: '2026-11-17' }),
});

test('every template carries its own measurement; digits from dates, ids and times never satisfy it', () => {
  for (const [kind, fact] of Object.entries(SAMPLES())) {
    assert.equal(fact.kind, kind);
    assert.equal(measure(fact.text), kind, `${kind}: ${fact.text}`);
    // take the measurement out: the sentence must no longer fit its template, and must carry no measurement,
    // even though dates, ids and times (digits) are still in it
    const variant = fact.text.replace(MEASURE[kind][1], '');
    assert.notEqual(variant, fact.text, `${kind}: nothing removed`);
    assert.equal(reconstructFact(variant), null, `${kind}: ${variant}`);
    assert.equal(measure(variant), null, `${kind}: ${variant}`);
    if (kind !== 'earlier') assert.match(variant, /\d/, `${kind}: dates, ids or times are still there`);
  }
  // sentences made only of dates and ids are not facts
  for (const bad of [
    'Moved 2 declines as too early to history on 2026-11-18; 0 now counted',
    'Counted at the change on 2026-11-18: 0 declines as too early',          // the older wording is gone
    'Declined run suggested for Wed 07:00 as too early (recommendation rec_00000001)',
    'At the change on 2026-11-18T12:00:00.000Z: declines as too early moved to history; new count starts at 0',
    '[daily] 2026-10-01: Running min',
    '[weekly] Week of 2026-09-07: workouts, min',
    '4-week average: workouts per week (as of 2026-11-18, valid until 2026-11-19)',
    'Workouts logged on of the days ending 2026-11-17',
    'Workouts logged on 5 of 28 days',                                          // no end date: the older wording is gone
    'Days of data: 9',
    'Thin history: 9 days of data ending 2026-11-17',
  ]) assert.equal(reconstructFact(bad), null, bad);
});

test('the preference-change fact is rendered with its counts', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3));
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: NOW }), true);
  assert.deepEqual(factLines(s.view(PREFS_FILE)), ['- At the change on 2026-11-18T12:00:00.000Z: 3 declines as too early moved to history; new count starts at 0']);
  assert.ok(measure(factLines(s.view(PREFS_FILE))[0].slice(2)));
  assert.ok(memoryIndex(s).includes('At the change on 2026-11-18T12:00:00.000Z: 3 declines as too early moved to history; new count starts at 0'));
});

// ---------- suppression at the single commit boundary ----------
test('a forgotten recommendation id cannot be written back through any public write method', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long');
  assert.equal(forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(1)})`), true);
  const fact = F.tap({ recId: R(1), activity: 'run', weekday: 3, hour: 7, reason: 'too_early' });
  const src = S.tap({ recId: R(1), reason: 'too_early', at: NOW });
  const doc = s.read(FEEDBACK_FILE);
  const before = snapshot(s);
  assert.equal(s.insert(FEEDBACK_FILE, fact, src), false);
  assert.match(s.lastError, /forgotten recommendation id/);
  assert.equal(s.replaceFacts(FEEDBACK_FILE, [...doc.facts, fact], [...doc.sources, src]), false);
  assert.equal(s.replaceFacts(FEEDBACK_FILE, doc.facts, [...doc.sources, src]), false);                 // the source alone
  assert.equal(s.strReplace(FEEDBACK_FILE, doc.facts[0].text, fact, src), false);
  assert.deepEqual(snapshot(s), before);
  assert.ok(!all(s).includes(R(1)));
  // after the last tap is gone the file does not exist, and create is refused too
  forget(s, FEEDBACK_FILE, 'Declined 1 run suggested for Wed 07:00 as too early');
  forget(s, FEEDBACK_FILE, 'Declined 1 run suggested for Wed 07:00 as too long');
  assert.equal(s.view(FEEDBACK_FILE), null);
  assert.equal(s.create(FEEDBACK_FILE, [fact], [src]), false);
  assert.equal(s.view(FEEDBACK_FILE), null);
  // ids moved to history by a change are covered too
  tap(s, R(11)); tap(s, R(12));
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  const t11 = F.tap({ recId: R(11), activity: 'run', weekday: 3, hour: 7, reason: 'too_early' });
  assert.equal(s.create(FEEDBACK_FILE, [t11], [S.tap({ recId: R(11), reason: 'too_early', at: NOW })]), false);
});

// ---------- temporary files ----------
const filesWith = (dir, needles) => {
  const hits = [];
  for (const n of fs.readdirSync(dir, { recursive: true })) {
    const f = path.join(dir, String(n));
    if (!fs.statSync(f).isFile()) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (needles.some((x) => text.includes(x))) hits.push(String(n));
  }
  return hits;
};

test('a stop after a temp write cannot leave a forgotten fact on disk: a forget removes every leftover', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long');
  // simulate a crash right after the temp file was written (the target had the old facts)
  fs.copyFileSync(path.join(s.dir, 'preferences/workouts.md'), path.join(s.dir, `preferences/workouts.md${TEMP_SUFFIX}`));
  fs.copyFileSync(path.join(s.dir, 'feedback/recommendations.md'), path.join(s.dir, `feedback/recommendations.md${TEMP_SUFFIX}`));
  fs.writeFileSync(path.join(s.dir, `forgotten.json${TEMP_SUFFIX}`), '[]\n');
  assert.ok(filesWith(s.dir, ['too early']).length >= 4);
  assert.equal(forget(s, PREFS_FILE, 'Declined 2 suggestions as too early'), true);
  assert.deepEqual(filesWith(s.dir, ['too early', 'as too early']), []);          // no file anywhere under the user folder
  assert.deepEqual(filesWith(s.dir, [R(1), R(2)]), []);
  assert.deepEqual(s.tempFiles(), []);
  assert.ok(filesWith(s.dir, ['too long']).length >= 1);                          // the unrelated tap stays
});

test('forgetting a derived file also removes its leftover temp file', (t) => {
  const s = mk(t);
  seedProfile(s);
  fs.copyFileSync(path.join(s.dir, 'about-user/profile.md'), path.join(s.dir, `about-user/profile.md${TEMP_SUFFIX}`));
  assert.equal(forgetDerived(s, 'profile'), true);
  assert.deepEqual(filesWith(s.dir, ['4-week average']), []);
  assert.deepEqual(s.tempFiles(), []);
});

test('leftover temp files are removed on construction and in recover; odd entries are handled safely', (t) => {
  const root = tempRoot();
  t.after(() => cleanup(root));
  const a = new MemoryStore(root, U(1));
  a.create('rolling', [F.thin({ days: 3, endDate: '2026-11-17' })], [ROLL_SRC()]);
  fs.copyFileSync(path.join(a.dir, 'health/rolling.md'), path.join(a.dir, `health/rolling.md${TEMP_SUFFIX}`));
  const b = new MemoryStore(root, U(1));                                           // a restart
  assert.deepEqual(b.tempFiles(), []);
  fs.writeFileSync(path.join(a.dir, `x.md${TEMP_SUFFIX}`), 'old facts');
  fs.mkdirSync(path.join(a.dir, 'health/nested'));
  fs.writeFileSync(path.join(a.dir, `health/nested/y${TEMP_SUFFIX}`), 'old facts');
  assert.deepEqual(a.tempFiles().length, 2);
  assert.equal(recover(a).ok, true);
  assert.deepEqual(a.tempFiles(), []);
  // a symlink with a temp name is unlinked, never followed
  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'keep me');
  fs.symlinkSync(outside, path.join(a.dir, `link.md${TEMP_SUFFIX}`));
  a.sweepTemps();
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
  assert.deepEqual(a.tempFiles(), []);
  // a directory with a temp name makes the store unavailable
  fs.mkdirSync(path.join(a.dir, `dir${TEMP_SUFFIX}`));
  assert.throws(() => a.sweepTemps(), MemoryUnavailableError);
  assert.throws(() => memoryIndex(a), MemoryUnavailableError);
});

test('temp files use the store-owned name and never survive a failed write', (t) => {
  let seen = [];
  const s = mk(t, U(1), { writeFile: (p, x) => { seen.push(path.basename(p)); fs.writeFileSync(p, x.slice(0, 5)); } });
  assert.equal(s.create('rolling', [F.thin({ days: 3, endDate: '2026-11-17' })], [ROLL_SRC()]), false);
  assert.deepEqual(seen, [`rolling.md${TEMP_SUFFIX}`]);
  assert.deepEqual(s.tempFiles(), []);
});

// ---------- derived facts: the store writes them, callers cannot ----------
const DERIVED = () => ({
  standing: F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 3, hour: 7 }, { weekday: 3, hour: 7 }] }),
  change: F.change({ reason: 'too_early', at: '2026-11-18T12:00:00.000Z', count: 2 }),
  history: F.history({ reason: 'too_early', count: 2, at: '2026-11-18T12:00:00.000Z', why: 'other' }),
});
const HOME = { standing: PREFS_FILE, change: PREFS_FILE, history: HISTORY_FILE };

test('callers cannot write standing, change or history facts, also after the preference was forgotten', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long');
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  assert.equal(forget(s, PREFS_FILE, 'At the change on 2026-11-18T12:00:00.000Z: 2 declines as too early moved to history; new count starts at 0'), true);
  assert.equal(s.view(PREFS_FILE), null);
  assert.equal(s.view(HISTORY_FILE), null);
  const before = snapshot(s);
  const src = S.standing({ reason: 'too_early', at: NOW });
  for (const [type, fact] of Object.entries(DERIVED())) {
    for (const kind of Object.keys(FILE_KINDS)) {
      const source = type === 'history' ? S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: [R(1), R(2)], at: NOW }) : type === 'change' ? S.change({ reason: 'too_early', at: NOW }) : src;
      assert.equal(s.create(kind, [fact], [source]), false, `create ${type} in ${kind}`);
      assert.equal(s.replaceFacts(kind, [fact], [source]), false, `replaceFacts ${type} in ${kind}`);
    }
    assert.match(s.lastError, /derived by the store/);
  }
  // also into an existing file, by insert and strReplace
  const taps = s.read(FEEDBACK_FILE);
  assert.equal(s.insert(PREFS_FILE, DERIVED().standing, src), false);               // no preferences file: nothing to insert into
  tap(s, R(4)); tap(s, R(5));                                                       // the store itself makes a standing entry from new taps
  assert.equal(s.insert(PREFS_FILE, DERIVED().change, S.change({ reason: 'too_early', at: NOW })), false);
  const stand = s.read(PREFS_FILE).facts[0];
  assert.equal(s.strReplace(PREFS_FILE, stand.text, DERIVED().change, S.change({ reason: 'too_early', at: NOW })), false);
  assert.equal(s.replaceFacts(PREFS_FILE, [stand, DERIVED().change], s.read(PREFS_FILE).sources), false);
  assert.equal(s.read(FEEDBACK_FILE).facts.length, taps.facts.length + 2);
  assert.deepEqual(factLines(s.view(PREFS_FILE)), [`- Declined 2 suggestions as too early (Wed 07:00; Wed 07:00)`]);
  assert.notDeepEqual(snapshot(s), before);                                          // the store's own recompute did write
});

test('a standing entry that disagrees with the taps held is refused on read, and a history entry needs its change fact', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  const f = path.join(s.dir, 'preferences/workouts.md');
  const good = fs.readFileSync(f, 'utf8');
  assert.ok(s.view(PREFS_FILE));
  const wrong = [
    good.replace('Declined 2 suggestions', 'Declined 3 suggestions').replace('(Wed 07:00; Wed 07:00)', '(Wed 07:00; Wed 07:00; Wed 07:00)'),   // count above the taps
    good.replace('Wed 07:00; Wed 07:00', 'Wed 07:00; Fri 07:00'),                                                                           // slots not from the taps
    good.replace('too early', 'too late'),                                                                                                 // no such taps
  ];
  for (const text of wrong) {
    assert.equal(validateDocument(text, 'preferences'), null);                         // the template alone would accept it
    fs.writeFileSync(f, text);
    assert.throws(() => s.view(PREFS_FILE), MemoryUnavailableError, text);
    assert.throws(() => s.read(PREFS_FILE), MemoryUnavailableError);
    assert.throws(() => s.viewPath('preferences/workouts.md'), MemoryUnavailableError);
    assert.ok(memoryIndex(s).includes('Declined 2 suggestions as too early (Wed 07:00; Wed 07:00)'));   // the recompute repairs it
    assert.equal(s.view(PREFS_FILE), good);
  }
  fs.writeFileSync(f, good.replace('## Sources', '## Sources').replace(/^- Declined.*\n/m, ''));   // a standing entry that is missing
  assert.throws(() => s.view(PREFS_FILE), MemoryUnavailableError);
  assert.ok(memoryIndex(s));
  // a standing entry with no taps at all
  fs.rmSync(path.join(s.dir, 'feedback/recommendations.md'));
  assert.throws(() => s.view(PREFS_FILE), MemoryUnavailableError);
});

test('a history entry without its change fact is refused on read', (t) => {
  const s = mk(t);
  assert.equal(s[DERIVE](() => s.create(HISTORY_FILE, [DERIVED().history], [S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: [R(1), R(2)], at: NOW })])), true);
  assert.throws(() => s.view(HISTORY_FILE), MemoryUnavailableError);
  assert.throws(() => s.read(HISTORY_FILE), MemoryUnavailableError);
  // with the matching change fact it reads fine
  assert.equal(s[DERIVE](() => s.create(PREFS_FILE, [DERIVED().change], [S.change({ reason: 'too_early', at: NOW })])), true);
  assert.ok(s.view(HISTORY_FILE));
  // a change fact for another date does not match
  s[DERIVE](() => s.replaceFacts(PREFS_FILE, [F.change({ reason: 'too_early', at: '2026-11-19T12:00:00.000Z', count: 2 })], [S.change({ reason: 'too_early', at: NOW })]));
  assert.throws(() => s.view(HISTORY_FILE), MemoryUnavailableError);
});

test('stored sentences make no continuous-truth claim and stay true after later declines', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long');
  changePreference(s, { reason: 'too_early', why: 'schedule_change', now: NOW });
  const change = factLines(s.view(PREFS_FILE))[0];
  const hist = factLines(s.view(HISTORY_FILE))[0];
  assert.equal(change, '- At the change on 2026-11-18T12:00:00.000Z: 2 declines as too early moved to history; new count starts at 0');
  assert.equal(hist, '- Recorded 2 declines as too early; changed on 2026-11-18T12:00:00.000Z (reason given: schedule change)');
  // a later decline of the same kind does not make either stored sentence false: they are unchanged
  assert.equal(tap(s, R(14), 'too_early', later).written, true);
  assert.equal(tap(s, R(15), 'too_early', later).written, true);
  assert.equal(tap(s, R(16), 'too_early', later).written, true);       // really recorded, three more declines
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.startsWith('- Declined 3 suggestions as too early since 2026-11-18T12:00:00.000Z')));
  assert.ok(factLines(s.view(PREFS_FILE)).includes(change));
  assert.deepEqual(factLines(s.view(HISTORY_FILE)), [hist]);
  // no word in any stored fact claims the thing is still or until true
  for (const p of s.paths()) {
    for (const l of factLines(s.viewPath(p))) assert.ok(!/\b(until|now|currently|still|always|never)\b/i.test(l), l);
  }
  for (const f of Object.values(DERIVED())) assert.ok(!/\b(until|now|currently|still|always)\b/i.test(f.text), f.text);
});

// ---------- exactly one valid source per tap ----------
test('a feedback file where a tap has no matching source, or has several, is refused (each broken shape)', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  const f = path.join(s.dir, 'feedback/recommendations.md');
  const good = fs.readFileSync(f, 'utf8');
  const line1 = good.split('\n').find((l) => l.startsWith(`- [S${R(1)}]`));
  assert.ok(line1);
  const shapes = {
    'a tap without a source': [good.replace(`${line1}\n`, ''), /no source/],
    'two sources for one tap': [good.replace(line1, `${line1}\n${line1.replace('2026-11-18T12:00:00.000Z', '2026-11-19T12:00:00.000Z')}`), /two sources/],
    'a source naming another reason': [good.replace(line1, line1.replace('excerpt=too_early', 'excerpt=too_late')), /another reason/],
    'a source with no tap': [`${good}- [S${R(9)}] type=feedback; ref=recommendation:${R(9)}; observed_at=2026-11-18T12:00:00.000Z; excerpt=too_early\n`, /no tap/],
    'a source with an impossible time': [good.replace(line1, line1.replace('2026-11-18T12:00:00.000Z', '2026-13-45T12:00:00.000Z')), /constructor/],
    'a source that is not a tap source': [`${good}- [P-too_early] type=feedback; ref=feedback/recommendations.md; observed_at=2026-11-18T12:00:00.000Z\n`, /not a tap source/],
  };
  for (const [name, [text, why]] of Object.entries(shapes)) {
    fs.writeFileSync(f, text);
    assert.throws(() => s.view(FEEDBACK_FILE), (e) => e instanceof MemoryUnavailableError && why.test(e.message), name);
    assert.throws(() => memoryIndex(s), MemoryUnavailableError, name);
    assert.throws(() => tap(s, R(3)), MemoryUnavailableError, name);
  }
  fs.writeFileSync(f, good);
  assert.ok(s.view(FEEDBACK_FILE));
  // the same shapes cannot be written
  const doc = s.read(FEEDBACK_FILE);
  assert.equal(s.replaceFacts(FEEDBACK_FILE, doc.facts, doc.sources.slice(1)), false);
  assert.match(s.lastError, /no source/);
  assert.equal(s.replaceFacts(FEEDBACK_FILE, doc.facts, [...doc.sources, S.tap({ recId: R(1), reason: 'too_early', at: new Date('2026-11-19T00:00:00Z') })]), false);
  assert.equal(s.replaceFacts(FEEDBACK_FILE, doc.facts, [...doc.sources.slice(1), S.tap({ recId: R(1), reason: 'too_late', at: NOW })]), false);
  assert.match(s.lastError, /another reason/);
  assert.equal(s.replaceFacts(FEEDBACK_FILE, doc.facts, [...doc.sources, S.tap({ recId: R(9), reason: 'too_early', at: NOW })]), false);
  assert.equal(s.view(FEEDBACK_FILE), good);
  fs.rmSync(f);
  assert.equal(s.create(FEEDBACK_FILE, [doc.facts[0]], []), false);
});

test('a missing observation time is never turned into time zero', () => {
  const t1 = F.tap({ recId: R(1), activity: 'run', weekday: 3, hour: 7, reason: 'too_early' });
  assert.throws(() => tapsOf({ facts: [t1], sources: [] }, 'too_early'), TypeError);
  const ok = tapsOf({ facts: [t1], sources: [S.tap({ recId: R(1), reason: 'too_early', at: NOW })] }, 'too_early');
  assert.equal(ok[0].at, NOW.getTime());
});

test('a history entry must agree with its own change fact: reason, moment and count', (t) => {
  const s = mk(t);
  const at = '2026-11-18T12:00:00.000Z';
  const hsrc = S.history({ reason: 'too_early', changedAt: at, why: 'other', ids: [R(1), R(2), R(3)], at: NOW });
  const csrc = S.change({ reason: 'too_early', at: NOW });
  const change = (n, when = at) => s[DERIVE](() => s.replaceFacts(PREFS_FILE, [F.change({ reason: 'too_early', at: when, count: n })], [csrc]));
  s[DERIVE](() => s.create(HISTORY_FILE, [F.history({ reason: 'too_early', count: 3, at, why: 'other' })], [hsrc]));
  assert.equal(change(2), true);
  assert.throws(() => s.view(HISTORY_FILE), MemoryUnavailableError);                 // 3 recorded, the change says 2
  assert.equal(change(4), true);
  assert.throws(() => s.view(HISTORY_FILE), MemoryUnavailableError);                 // 4 is not 3 either: the counts are equal, not "at least"
  change(3);
  assert.ok(s.view(HISTORY_FILE));
  change(3, '2026-11-18T12:00:00.001Z');                                              // another moment: no matching change
  assert.throws(() => s.view(HISTORY_FILE), MemoryUnavailableError);
});

// ---------- forgetting a fact type or one key of it ----------
const dayFact = (d, m = 40) => F.daily({ date: `2026-10-${String(d).padStart(2, '0')}`, items: [{ activity: 'Running', minutes: m }] });
const rollingTexts = (s) => (s.view('rolling') ? factLines(s.view('rolling')).map((l) => l.slice(2)) : []);
/**
 * A recompute the way the roll and the engine would do it from 28 logged days (2026-10-01 to 2026-10-28, 40 minutes each):
 * it skips suppressed types and keys, and treats forgotten days as unlogged, so no line depends on a forgotten day.
 */
const LOGGED = Array.from({ length: 28 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
function recompute(s) {
  const sup = suppressedTypes(s);
  const days = LOGGED.filter((d) => !sup.days.includes(d));
  const facts = days.map((d) => dayFact(Number(d.slice(8))));
  const weeks = new Map();
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    const start = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    weeks.set(start, (weeks.get(start) ?? 0) + 1);
  }
  const within = (lo, hi) => sup.days.filter((d) => d >= lo && d <= hi);
  const plus = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  for (const [start, n] of weeks) facts.push(F.weekly({ weekStart: start, count: n, minutes: 40 * n, excludedDays: within(start, plus(start, 6)) }));
  facts.push(F.coverage({ workoutDays: days.filter((d) => d >= '2026-10-21').length, windowDays: 28, endDate: '2026-11-17', excludedDays: within('2026-10-21', '2026-11-17') }),
    F.thin({ days: 9, endDate: '2026-11-17', excludedDays: within('0000-01-01', '2026-11-17') }));
  const keep = (f) => !sup.types.includes(f.kind) && !sup.keys.some((k) => k.type === f.kind && f.key === `${f.kind}:${k.key}`);
  const out = facts.filter(keep);
  return out.length ? s.replaceFacts('rolling', out, [ROLL_SRC()]) : true;
}
const forgottenRaw = (s) => JSON.parse(fs.readFileSync(path.join(s.dir, 'forgotten.json'), 'utf8'));

test('forgetFactType: every line of the type goes, the recompute cannot write it again, other types stay', (t) => {
  const s = mk(t);
  seedProfile(s);
  recompute(s);
  assert.ok(rollingTexts(s).some((x) => x.startsWith('[daily]')));
  assert.equal(forgetFactType(s, 'daily'), true);
  assert.ok(!rollingTexts(s).some((x) => x.startsWith('[daily]')));
  assert.ok(rollingTexts(s).some((x) => x.startsWith('[weekly]')));
  assert.ok(s.view('profile').includes('4-week average'));
  assert.ok(!memoryIndex(s).includes('[daily]'));
  assert.deepEqual(forgottenRaw(s), ['type:daily']);                            // a type id, never content
  assert.deepEqual(suppressedTypes(s), { types: ['daily'], keys: [], days: [] });
  // the recompute (which skips suppressed types) never brings it back, however often it runs
  for (let i = 0; i < 3; i++) { assert.equal(recompute(s), true); assert.ok(!rollingTexts(s).some((x) => x.startsWith('[daily]'))); }
  assert.ok(rollingTexts(s).some((x) => x.startsWith('[weekly]')));
  // restore: the type may be written again
  assert.equal(restoreFactType(s, 'daily'), true);
  assert.deepEqual(suppressedTypes(s), { types: [], keys: [], days: [] });
  assert.equal(recompute(s), true);
  assert.ok(rollingTexts(s).filter((x) => x.startsWith('[daily]')).length === 28);
  assert.equal(restoreFactType(s, 'daily'), true);                              // twice is harmless
});

test('forgetFactType also covers the profile file and the types without constructors yet', (t) => {
  const s = mk(t);
  seedProfile(s);
  assert.equal(forgetFactType(s, 'mix'), true);
  assert.ok(!s.view('profile').includes('Last 4 weeks by type'));
  assert.ok(s.view('profile').includes('4-week average'));
  assert.equal(forgetFactType(s, 'profile'), true);
  assert.equal(s.view('profile'), null);                                         // nothing left: the file is gone
  assert.equal(forgetFactType(s, 'body'), true);                                 // no constructor yet, still suppressible
  assert.deepEqual(suppressedTypes(s).types, ['body', 'mix', 'profile']);
  for (const id of ['today', 'week', 'load', 'regularity']) assert.ok(Object.hasOwn(DERIVED_FACT_TYPES, id), id);
  for (const bad of ['bogus', '', 'Daily', 'daily ', 'type:daily', '__proto__', 'toString', undefined, 5, null]) {
    assert.equal(forgetFactType(s, bad), false, String(bad));
    assert.equal(restoreFactType(s, bad), false, String(bad));
  }
  assert.deepEqual(suppressedTypes(s).types, ['body', 'mix', 'profile']);
});

test('forgetFactKey on a daily key forgets the DAY: the daily line and every aggregate covering it go, and the roll treats it as unlogged', (t) => {
  const s = mk(t);
  seedProfile(s);                                                                           // profile and mix as of 2026-11-18 (window 22 Oct to 18 Nov)
  recompute(s);
  const weekly = () => rollingTexts(s).filter((x) => x.startsWith('[weekly]'));
  assert.deepEqual(weekly().map((x) => x.slice(0, 27)), ['[weekly] Week of 2026-09-28', '[weekly] Week of 2026-10-05', '[weekly] Week of 2026-10-12', '[weekly] Week of 2026-10-19', '[weekly] Week of 2026-10-26']);
  assert.ok(weekly().includes('[weekly] Week of 2026-10-05: 7 workouts, 280 min'));
  assert.equal(forgetFactKey(s, 'daily', '2026-10-07'), true);
  // right after the forget: no line in any derived file depends on the day
  assert.ok(!rollingTexts(s).some((x) => x.startsWith('[daily] 2026-10-07')));
  assert.ok(!weekly().some((x) => x.startsWith('[weekly] Week of 2026-10-05')));            // the week that contained it
  assert.ok(!rollingTexts(s).some((x) => x.startsWith('Days of data')));                    // everything up to 17 Nov includes it
  assert.ok(rollingTexts(s).some((x) => x.startsWith('Workouts logged on')));               // the 28-day window starts after 7 Oct: it does not
  assert.ok(s.view('profile').includes('4-week average'));                                  // nor does the 28 days ending 18 Nov
  assert.equal(weekly().length, 4);
  assert.deepEqual(forgottenRaw(s), ['day:2026-10-07']);                                    // a day, never content
  assert.deepEqual(suppressedTypes(s), { types: [], keys: [], days: ['2026-10-07'] });
  // the recompute leaves the day out and SAYS so (a count, never the date)
  for (let i = 0; i < 2; i++) {
    assert.equal(recompute(s), true);
    assert.ok(!rollingTexts(s).some((x) => x.startsWith('[daily] 2026-10-07')));
    assert.ok(weekly().includes('[weekly] Week of 2026-10-05: 6 workouts, 240 min (1 forgotten day left out)'));
    assert.ok(rollingTexts(s).includes('Days of data: 9 (ending 2026-11-17) (1 forgotten day left out)'));
  }
  assert.ok(!memoryIndex(s).includes('2026-10-07'));
  // a daily fact for that day cannot be written by any public path
  assert.equal(s.insert('rolling', dayFact(7), ROLL_SRC()), false);
  assert.match(s.lastError, /suppressed/);
  assert.equal(s.insert('rolling', dayFact(30), ROLL_SRC()), true);                         // another day is fine
  // a day inside the 28-day coverage window and the profile window: those aggregates go at once
  assert.equal(forgetFactKey(s, 'daily', '2026-10-25'), true);
  assert.equal(s.view('profile'), null);                                                    // profile and mix covered the 25th: both deleted
  assert.ok(!rollingTexts(s).some((x) => x.startsWith('Workouts logged on')));              // coverage too
  assert.ok(!weekly().some((x) => x.startsWith('[weekly] Week of 2026-10-19')));
  const index = memoryIndex(s);
  assert.ok(!index.includes('4-week average') && !index.includes('Last 4 weeks') && !index.includes('Workouts logged on'));
  assert.equal(recompute(s), true);
  assert.ok(rollingTexts(s).includes('Workouts logged on 7 of the 28 days ending 2026-11-17 (1 forgotten day left out)'));   // 8 logged days from 21 Oct, minus the 25th
  assert.ok(rollingTexts(s).includes('[weekly] Week of 2026-10-19: 6 workouts, 240 min (1 forgotten day left out)'));
  assert.ok(rollingTexts(s).includes('Days of data: 9 (ending 2026-11-17) (2 forgotten days left out)'));
  // restore lifts the days; weekly and mix keys still use the plain key entries
  assert.equal(restoreFactKey(s, 'daily', '2026-10-07'), true);
  assert.equal(restoreFactKey(s, 'daily', '2026-10-25'), true);
  assert.deepEqual(forgottenRaw(s), []);
  assert.equal(recompute(s), true);
  assert.equal(rollingTexts(s).filter((x) => x.startsWith('[daily]')).length, 28);
  assert.ok(rollingTexts(s).includes('Workouts logged on 8 of the 28 days ending 2026-11-17'));               // complete again: no note
  assert.equal(forgetFactKey(s, 'weekly', '2026-09-28'), true);
  assert.deepEqual(forgottenRaw(s), ['key:weekly:2026-09-28']);
  assert.deepEqual(suppressedTypes(s), { types: [], keys: [{ type: 'weekly', key: '2026-09-28' }], days: [] });
  assert.ok(!rollingTexts(s).some((x) => x.startsWith('[weekly] Week of 2026-09-28')));
  assert.equal(recompute(s), true);
  assert.ok(!rollingTexts(s).some((x) => x.startsWith('[weekly] Week of 2026-09-28')));
  assert.ok(memoryIndex(s) && !memoryIndex(s).includes('day:'));                            // never listed
});

test('forgetFactKey on a mix removes only that activity; the last one removes the line', (t) => {
  const s = mk(t);
  seedProfile(s);
  assert.equal(forgetFactKey(s, 'mix', 'Walking'), true);
  assert.ok(s.view('profile').includes('Last 4 weeks by type: Running 6, Strength training 2 (as of 2026-11-18)'));
  const doc = s.read('profile');
  const mixWithWalking = F.mix({ items: [{ activity: 'Running', count: 1 }, { activity: 'Walking', count: 1 }], asOf: '2026-11-18' });
  assert.equal(s.replaceFacts('profile', [doc.facts[0], mixWithWalking], doc.sources), false);   // the key is suppressed
  assert.equal(forgetFactKey(s, 'mix', 'Running'), true);
  assert.equal(forgetFactKey(s, 'mix', 'Strength training'), true);
  assert.ok(!s.view('profile').includes('Last 4 weeks by type'));
  assert.ok(s.view('profile').includes('4-week average'));
  for (const [type, key] of [['coverage', 'x'], ['daily', '2026-13-45'], ['daily', 'Running'], ['mix', 'Skydiving'], ['mix', '2026-10-01'], ['weekly', ''], ['bogus', '2026-10-01'], ['daily', undefined]]) {
    assert.equal(forgetFactKey(s, type, key), false, `${type} ${key}`);
    assert.equal(restoreFactKey(s, type, key), false);
  }
});

test('callers cannot write a suppressed type or key through any public path', (t) => {
  const s = mk(t);
  seedProfile(s);
  forgetFactType(s, 'weekly');
  forgetFactKey(s, 'daily', '2026-10-05');
  forgetFactKey(s, 'mix', 'Walking');
  const wk = F.weekly({ weekStart: '2026-09-07', count: 3, minutes: 120 });
  const d5 = dayFact(5);
  const mixW = F.mix({ items: [{ activity: 'Walking', count: 2 }], asOf: '2026-11-18' });
  const before = snapshot(s);
  const doc = s.read('rolling');
  assert.equal(s.insert('rolling', wk, ROLL_SRC()), false);
  assert.match(s.lastError, /suppressed/);
  assert.equal(s.insert('rolling', d5, ROLL_SRC()), false);
  assert.equal(s.replaceFacts('rolling', [...doc.facts, wk], doc.sources), false);
  assert.equal(s.replaceFacts('rolling', [...doc.facts, d5], doc.sources), false);
  assert.equal(s.strReplace('rolling', doc.facts[0].text, wk), false);
  assert.equal(s.strReplace('rolling', doc.facts[0].text, d5), false);
  assert.equal(s.insert('profile', mixW, ROLL_SRC()), false);
  assert.equal(s.replaceFacts('profile', [mixW], [ROLL_SRC()]), false);
  assert.deepEqual(snapshot(s), before);
  // creating the file from nothing is refused too
  s.delete('rolling');
  assert.equal(s.create('rolling', [wk], [ROLL_SRC()]), false);
  assert.equal(s.create('rolling', [d5], [ROLL_SRC()]), false);
  assert.equal(s.create('rolling', [dayFact(6)], [ROLL_SRC()]), true);          // another date is fine
  assert.equal(s.view('rolling').includes('2026-10-05'), false);
});

test('a damaged forgotten.json (with the new entries) fails closed', (t) => {
  const s = mk(t);
  seedProfile(s);
  forgetFactType(s, 'daily');
  forgetFactKey(s, 'weekly', '2026-09-14');
  forgetFactKey(s, 'daily', '2026-10-05');
  const f = path.join(s.dir, 'forgotten.json');
  const good = fs.readFileSync(f, 'utf8');
  const bad = [
    '["type:bogus"]', '["type:daily:extra"]', '["key:daily:2026-13-45"]', '["key:daily:2026-10-05"]', '["day:2026-13-45"]', '["day:2026-10-5"]', '["day:2026-10-05 "]', '["day:"]', '["key:coverage:x"]', '["key:mix:Skydiving"]',
    '["type:daily","type:daily"]', '["key:daily:2026-10-05 "]', '[{"type":"daily"}]', '["type:Daily"]', '{"types":["daily"]}', '["Heart rate 180 bpm"]',
  ];
  for (const c of bad) {
    fs.writeFileSync(f, c);
    assert.throws(() => memoryIndex(s), MemoryUnavailableError, c);
    assert.throws(() => s.view('rolling'), MemoryUnavailableError, c);
    assert.throws(() => suppressedTypes(s), MemoryUnavailableError, c);
    assert.throws(() => s.insert('rolling', dayFact(3), ROLL_SRC()), MemoryUnavailableError, c);
    assert.throws(() => forgetFactType(s, 'weekly'), MemoryUnavailableError, c);
    assert.throws(() => restoreFactType(s, 'daily'), MemoryUnavailableError, c);
  }
  fs.writeFileSync(f, good);
  assert.deepEqual(suppressedTypes(s), { types: ['daily'], keys: [{ type: 'weekly', key: '2026-09-14' }], days: ['2026-10-05'] });
});

test('the type and key operations are journaled: a stop after any step is finished before anything is read', (t) => {
  const ops = {
    'forgetFactType daily': [(s) => forgetFactType(s, 'daily'), /\[daily\]/],
    'forgetFactType mix': [(s) => forgetFactType(s, 'mix'), /Last 4 weeks/],
    'forgetFactKey daily': [(s) => forgetFactKey(s, 'daily', '2026-10-05'), /\[daily\] 2026-10-05/],
    'forgetFactKey mix': [(s) => forgetFactKey(s, 'mix', 'Walking'), /Walking/],
  };
  for (const [name, [run, gone]] of Object.entries(ops)) {
    const setup = (s) => { seedProfile(s); };
    const clean = flaky(t);
    setup(clean.s);
    clean.ctl.n = 0;
    assert.equal(run(clean.s), true, name);
    const total = clean.ctl.n;
    const want = snapshot(clean.s);
    assert.ok(total >= 4, `${name}: ${total} steps`);                           // journal, suppression, rewrite, journal removal
    assert.ok(!gone.test(memoryIndex(clean.s)), name);
    for (let k = 1; k <= total; k++) {
      const { s, ctl } = flaky(t);
      setup(s);
      ctl.n = 0; ctl.k = k;
      assert.equal(run(s), false, `${name} k=${k}`);
      const late = s.readJournal() === null && k > 1;                                       // only the final recount did not run
      if (late) {
        ctl.k = null;
        assert.ok(memoryIndex(s));                                                          // the next read recounts
        assert.deepEqual(snapshot(s), want, `${name} late k=${k}`);
        continue;
      }
      if (k > 1) {
        assert.throws(() => s.view('rolling'), MemoryUnavailableError, `${name} k=${k}`);       // reads are blocked
        assert.throws(() => s.view('profile'), MemoryUnavailableError, `${name} k=${k}`);
        ctl.k = ctl.n;
        assert.throws(() => memoryIndex(s), MemoryUnavailableError, `${name} k=${k}`);
      }
      ctl.k = null;
      if (k === 1) assert.equal(run(s), true);                                  // the journal itself was not written
      const p = memoryIndex(s);                                                 // the next read finishes it
      assert.ok(!gone.test(p), `${name} k=${k}`);
      assert.equal(s.readJournal(), null);
      assert.deepEqual(snapshot(s), want, `${name} k=${k}`);
    }
  }
});

test('forget on a derived line now points at the type and key operations', (t) => {
  const s = mk(t);
  seedProfile(s);
  assert.equal(forget(s, 'rolling', '[daily] 2026-10-05'), false);
  assert.match(s.lastError, /forgetFactType or forgetFactKey/);
});

test('across whole operations, every rename follows a temp sync and precedes a directory sync, and every delete is followed by one', (t) => {
  const rec = recording();
  const s = mk(t, U(1), rec.opts);
  seedProfile(s);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long');
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  tap(s, R(4), 'too_early', later); tap(s, R(5), 'too_early', later);
  forget(s, PREFS_FILE, 'Declined 2 suggestions as too early');
  forgetFactType(s, 'daily'); forgetFactKey(s, 'mix', 'Walking'); forgetDerived(s, 'profile');
  fs.writeFileSync(path.join(s.dir, `feedback/recommendations.md${TEMP_SUFFIX}`), 'old facts');
  memoryIndex(s);
  const calls = rec.calls;
  const renames = calls.filter((c) => c[0] === 'rename').length;
  const removes = calls.filter((c) => c[0] === 'remove').length;
  assert.ok(renames > 20 && removes > 3, `${renames} renames, ${removes} removes`);
  calls.forEach(([name, a, b], i) => {
    if (name === 'rename') {
      assert.deepEqual(calls[i - 1], ['fsyncFile', a], `rename #${i}: the temp file is synced right before`);
      assert.deepEqual(calls[i + 1], ['fsyncDir', path.dirname(b)], `rename #${i}: the directory is synced right after`);
      assert.ok(calls.slice(0, i).some((c) => c[0] === 'writeFile' && c[1] === a));
    }
    if (name === 'remove') assert.deepEqual(calls[i + 1], ['fsyncDir', path.dirname(a)], `remove #${i}: the directory is synced right after`);
  });
});

// ---------- accepted and declined recommendations ----------
const acc = (s, recId, o = {}) => recordFeedback(s, { action: 'accepted', recId, activity: 'run', weekday: 3, hour: 7, now: NOW, ...o });

test('an accepted recommendation is stored as an accept with no reason, and is not a decline', (t) => {
  const s = mk(t);
  const r = acc(s, R(1));
  assert.deepEqual(r, { written: true, promoted: null });
  const text = s.view(FEEDBACK_FILE);
  assert.ok(text.includes(`- Accepted 1 run suggested for Wed 07:00 (recommendation ${R(1)})\n`));
  assert.ok(!text.includes('Declined'));
  assert.ok(text.includes(`- [S${R(1)}] type=feedback; ref=recommendation:${R(1)}; observed_at=2026-11-18T12:00:00.000Z\n`));   // no excerpt: no reason
  assert.ok(!text.includes('excerpt='));
  assert.equal(s.view(PREFS_FILE), null);
  assertLintedAndSourced(s);
  // a decline is still a decline, side by side with the accept
  assert.equal(tap(s, R(2)).written, true);
  const facts = factLines(s.view(FEEDBACK_FILE));
  assert.deepEqual(facts.map((l) => l.split(' ')[1]).sort(), ['Accepted', 'Declined']);
  assertLintedAndSourced(s);
});

test('an accept with a reason is rejected; so is a missing or unknown action', (t) => {
  const s = mk(t);
  for (const reason of ['too_early', 'too_late', 'whatever', '', 0, false]) {
    const r = acc(s, R(1), { reason });
    assert.equal(r.written, false, String(reason));
    assert.match(r.why, /no reason/);
  }
  assert.equal(acc(s, R(1), { reason: null }).written, true);                     // null is "no reason"
  for (const action of [undefined, null, '', 'accept', 'decline', 'ACCEPTED', 'accepted ', 'declined\n', 5, true]) {
    const r = recordFeedback(s, { action, recId: R(7), activity: 'run', weekday: 3, hour: 7, reason: 'too_early', now: NOW });
    assert.equal(r.written, false, String(action));
    assert.match(r.why, /action must be accepted or declined/);
  }
  assert.equal(recordFeedback(s, { recId: R(8), activity: 'run', weekday: 3, hour: 7, now: NOW }).written, false);   // no action at all
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 1);
});

test('accepts never count toward a standing entry; only declines of one reason do', (t) => {
  const s = mk(t);
  tap(s, R(1));
  for (let i = 10; i < 16; i++) acc(s, R(i));                                      // six accepts of the same slot
  assert.equal(s.view(PREFS_FILE), null);
  const r = tap(s, R(2), 'too_early', { weekday: 5, hour: 6 });
  assert.equal(r.promoted, 'Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)');   // two declines, not eight
  acc(s, R(20));
  assert.deepEqual(factLines(s.view(PREFS_FILE)), ['- Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)']);
  // one recommendation id has one outcome: an accept after a decline (or the reverse) is a duplicate and changes nothing
  const dup = acc(s, R(1));
  assert.equal(dup.duplicate, true);
  assert.equal(tap(s, R(10)).duplicate, true);
  assert.equal(factLines(s.view(FEEDBACK_FILE)).filter((l) => l.startsWith('- Accepted')).length, 7);
  assert.equal(factLines(s.view(FEEDBACK_FILE)).filter((l) => l.startsWith('- Declined')).length, 2);
  assertLintedAndSourced(s);
});

test('a change of preference leaves the accepts alone', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); acc(s, R(3));
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  assert.deepEqual(factLines(s.view(FEEDBACK_FILE)), [`- Accepted 1 run suggested for Wed 07:00 (recommendation ${R(3)})`]);
  assert.equal(acc(s, R(3)).duplicate, true);
  assertLintedAndSourced(s);
});

test('forget by recommendation id removes either an accept or a decline, and the id cannot be replayed', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long'); acc(s, R(4)); acc(s, R(5));
  assert.equal(forgetRecommendation(s, R(4)), true);                                // an accept
  assert.ok(!all(s).includes(R(4)));
  assert.equal(acc(s, R(4)).written, false);                                        // replay: suppressed
  assert.equal(acc(s, R(4)).suppressed, true);
  assert.equal(tap(s, R(4)).written, false);
  assert.ok(all(s).includes(R(5)));                                                 // the other accept stays
  assert.equal(forgetRecommendation(s, R(2)), true);                                // a decline: the standing entry is recounted
  assert.ok(!all(s).includes(R(2)));
  assert.equal(s.view(PREFS_FILE), null);
  assert.equal(tap(s, R(2)).written, false);
  // by the exact line too, with the prefix API
  assert.equal(forget(s, FEEDBACK_FILE, `Accepted 1 run suggested for Wed 07:00 (recommendation ${R(5)})`), true);
  assert.ok(!all(s).includes(R(5)));
  assert.equal(forgetRecommendation(s, R(99)), false);
  assert.equal(forgetRecommendation(s, 'x'), false);
  assert.equal(forgetRecommendation(s, undefined), false);
  assert.ok(factLines(s.view(FEEDBACK_FILE)).some((l) => l.includes('too long')));
  assertLintedAndSourced(s);
});

test('the sources of accepts and declines must match their facts', (t) => {
  const s = mk(t);
  tap(s, R(1)); acc(s, R(2));
  const f = path.join(s.dir, 'feedback/recommendations.md');
  const good = fs.readFileSync(f, 'utf8');
  const decl = good.split('\n').find((l) => l.startsWith(`- [S${R(1)}]`));
  const accl = good.split('\n').find((l) => l.startsWith(`- [S${R(2)}]`));
  const bad = [
    good.replace(accl, `${accl}; excerpt=too_early`),       // an accept with a reason
    good.replace(decl, decl.replace('; excerpt=too_early', '')),   // a decline without one
  ];
  for (const text of bad) {
    fs.writeFileSync(f, text);
    assert.throws(() => s.view(FEEDBACK_FILE), (e) => e instanceof MemoryUnavailableError && /another reason/.test(e.message));
  }
  fs.writeFileSync(f, good);
  assert.ok(s.view(FEEDBACK_FILE));
  // the same id as an accept and a decline in one file is two facts for one key
  fs.writeFileSync(f, good.replace('## Sources', `- Accepted 1 run suggested for Wed 07:00 (recommendation ${R(1)})\n## Sources`));
  assert.throws(() => s.view(FEEDBACK_FILE), (e) => e instanceof MemoryUnavailableError && /same thing/.test(e.message));
  // a suppressed id cannot come back as an accept either
  fs.writeFileSync(f, good);
  forgetRecommendation(s, R(2));
  assert.equal(s.insert(FEEDBACK_FILE, F.accept({ recId: R(2), activity: 'run', weekday: 3, hour: 7 }), S.accept({ recId: R(2), at: NOW })), false);
  assert.match(s.lastError, /forgotten recommendation id/);
});

// ---------- a standing entry after a change says it counts only taps since the change ----------
test('after a change the standing entry says since when it counts; without a change the wording is as before', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long'); tap(s, R(4), 'too_long');
  assert.deepEqual(factLines(s.view(PREFS_FILE)).sort(), [
    '- Declined 2 suggestions as too early (Wed 07:00; Wed 07:00)',
    '- Declined 2 suggestions as too long (Wed 07:00; Wed 07:00)']);
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  tap(s, R(5), 'too_early', { weekday: 3, hour: 7, ...later }); tap(s, R(6), 'too_early', { weekday: 5, hour: 6, ...later });
  const prefs = factLines(s.view(PREFS_FILE));
  assert.ok(prefs.includes('- Declined 2 suggestions as too early since 2026-11-18T12:00:00.000Z (Wed 07:00; Fri 06:00)'));
  assert.ok(prefs.includes('- Declined 2 suggestions as too long (Wed 07:00; Wed 07:00)'));       // another reason: unchanged wording
  assert.ok(memoryIndex(s).includes('as too early since 2026-11-18T12:00:00.000Z ('));
  assertLintedAndSourced(s);
  // a third decline keeps the date; a second change moves it
  tap(s, R(7), 'too_early', later);
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.startsWith('- Declined 3 suggestions as too early since 2026-11-18T12:00:00.000Z (')));
  changePreference(s, { reason: 'too_early', why: 'goal_change', now: new Date('2026-11-25T09:00:00Z') });
  tap(s, R(8), 'too_early', { now: LATEST }); tap(s, R(9), 'too_early', { now: LATEST });
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.startsWith('- Declined 2 suggestions as too early since 2026-11-25T09:00:00.000Z (')));
  assertLintedAndSourced(s);
  // forgetting the preference removes the change too, so the wording goes back to the plain one
  forget(s, PREFS_FILE, 'Declined 2 suggestions as too early since 2026-11-25T09:00:00.000Z');
  tap(s, R(21)); tap(s, R(22));
  assert.ok(factLines(s.view(PREFS_FILE)).includes('- Declined 2 suggestions as too early (Wed 07:00; Wed 07:00)'));
});

test('a standing entry must say "since" exactly when, and as of the date that, a change says', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changePreference(s, { reason: 'too_early', why: 'other', now: NOW });
  tap(s, R(3), 'too_early', later); tap(s, R(4), 'too_early', later);
  const f = path.join(s.dir, 'preferences/workouts.md');
  const good = fs.readFileSync(f, 'utf8');
  assert.ok(good.includes(' since 2026-11-18T12:00:00.000Z ('));
  for (const [name, text] of Object.entries({
    'the date is left out': good.replace(' since 2026-11-18T12:00:00.000Z', ''),
    'a wrong date': good.replace('since 2026-11-18T12:00:00.000Z', 'since 2026-11-17T12:00:00.000Z'),
    'a wrong time on the right date': good.replace('since 2026-11-18T12:00:00.000Z', 'since 2026-11-18T12:00:01.000Z'),
    'a date that is not a change': good.replace('since 2026-11-18T12:00:00.000Z', 'since 2026-12-01T00:00:00.000Z'),
  })) {
    assert.equal(validateDocument(text, 'preferences'), null, name);                 // the template alone accepts it
    fs.writeFileSync(f, text);
    assert.throws(() => s.view(PREFS_FILE), (e) => e instanceof MemoryUnavailableError && /does not match the taps/.test(e.message), name);
    assert.ok(memoryIndex(s).includes('since 2026-11-18T12:00:00.000Z ('), name);                  // the recompute repairs it
    assert.equal(s.view(PREFS_FILE), good);
  }
  // "since" with no change at all
  const t2 = mk(t, U(2));
  tap(t2, R(1)); tap(t2, R(2));
  const f2 = path.join(t2.dir, 'preferences/workouts.md');
  const plain = fs.readFileSync(f2, 'utf8');
  fs.writeFileSync(f2, plain.replace('as too early (', 'as too early since 2026-11-18T12:00:00.000Z ('));
  assert.throws(() => t2.view(PREFS_FILE), MemoryUnavailableError);
});

// ---------- the change is a boundary in time ----------
test('a delayed decline observed at or before the change is refused and writes nothing; later ones count', (t) => {
  const s = mk(t);
  const at = (h) => ({ now: new Date(`2026-11-18T${String(h).padStart(2, '0')}:00:00Z`) });
  tap(s, R(1), 'too_early', at(8)); tap(s, R(2), 'too_early', at(9));
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: new Date('2026-11-18T12:00:00Z') }), true);
  const before = snapshot(s);
  for (const h of [7, 10, 11, 12]) {                                              // before, and exactly at, the change moment
    const r = tap(s, R(30 + h), 'too_early', at(h));
    assert.equal(r.written, false, `hour ${h}`);
    assert.equal(r.why, 'refused: observed at or before the latest change of this preference');
  }
  assert.deepEqual(snapshot(s), before);                                          // nothing written, no marker either
  assert.equal(tap(s, R(40), 'too_early', { now: new Date('2026-11-18T12:00:00.001Z') }).written, true);   // just after: counted
  // other reasons are not bounded by this change
  assert.equal(tap(s, R(41), 'too_long', at(8)).written, true);
  // an accept has no reason and is not a decline: not bounded
  assert.equal(acc(s, R(42), at(8)).written, true);
  // a second decline after the change makes the standing entry say since the change, and counts only taps after it
  assert.equal(tap(s, R(43), 'too_early', { now: new Date('2026-11-18T13:00:00Z') }).promoted, 'Declined 2 suggestions as too early since 2026-11-18T12:00:00.000Z (Wed 07:00; Wed 07:00)');
});

test('a change moves only the declines observed at or before its own time', (t) => {
  const s = mk(t);
  const at = (h) => ({ now: new Date(`2026-11-18T${String(h).padStart(2, '0')}:00:00Z`) });
  tap(s, R(1), 'too_early', at(8)); tap(s, R(2), 'too_early', at(9)); tap(s, R(3), 'too_early', at(15)); tap(s, R(4), 'too_early', at(16));
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: new Date('2026-11-18T12:00:00Z') }), true);
  assert.ok(factLines(s.view(HISTORY_FILE))[0].startsWith('- Recorded 2 declines as too early; changed on 2026-11-18'));   // 2 moved, not 4
  assert.deepEqual(factLines(s.view(FEEDBACK_FILE)).map((l) => /recommendation (rec_\d+)/.exec(l)[1]).sort(), [R(3), R(4)]);
  assert.ok(factLines(s.view(PREFS_FILE)).includes('- Declined 2 suggestions as too early since 2026-11-18T12:00:00.000Z (Wed 07:00; Wed 07:00)'));   // the later two
  assert.equal(tap(s, R(1), 'too_early', at(20)).written, false);                 // a moved id cannot be replayed
  assertLintedAndSourced(s);
  // fewer than two declines at or before the change: there is nothing to move
  const u = mk(t, U(2));
  tap(u, R(1), 'too_early', at(8)); tap(u, R(2), 'too_early', at(15));
  assert.equal(changePreference(u, { reason: 'too_early', why: 'other', now: new Date('2026-11-18T12:00:00Z') }), false);
  assert.equal(u.view(HISTORY_FILE), null);
});

test('the date of a change is the UTC date of its own time; no other date can be given', (t) => {
  const s = mk(t);
  tap(s, R(1), 'too_early', { now: new Date('2026-11-16T08:00:00Z') }); tap(s, R(2), 'too_early', { now: new Date('2026-11-17T09:00:00Z') });
  // an old parameter is not read: a change on 20 November can only say 20 November
  assert.equal(changePreference(s, { reason: 'too_early', wasTrueUntil: '2026-11-19', why: 'other', now: new Date('2026-11-20T23:30:00Z') }), true);
  assert.deepEqual(factLines(s.view(PREFS_FILE)), ['- At the change on 2026-11-20T23:30:00.000Z: 2 declines as too early moved to history; new count starts at 0']);
  assert.ok(factLines(s.view(HISTORY_FILE))[0].includes('changed on 2026-11-20T23:30:00.000Z'));
  assert.ok(!all(s).includes('2026-11-19'));
  // the date follows `now` across midnight UTC
  const u = mk(t, U(2));
  tap(u, R(1), 'too_early', { now: new Date('2026-11-17T08:00:00Z') }); tap(u, R(2), 'too_early', { now: new Date('2026-11-17T09:00:00Z') });
  assert.equal(changePreference(u, { reason: 'too_early', why: 'other', now: new Date('2026-11-18T00:00:00.000Z') }), true);
  assert.ok(factLines(u.view(PREFS_FILE))[0].includes('At the change on 2026-11-18T00:00:00.000Z:'));
  // the journal carries the change's own moment (to the millisecond) and no separate date
  const j = { op: 'change_preference', reason: 'too_early', why: 'other', at: '2026-11-20T10:00:00.000Z', count: 2, ids: [R(1), R(2)] };
  assert.equal(validateJournal(JSON.stringify(j)), null);
  assert.notEqual(validateJournal(JSON.stringify({ ...j, date: '2026-11-20' })), null);
  assert.notEqual(validateJournal(JSON.stringify({ ...j, at: '2026-11-20T10:00:00Z' })), null);
});

test('the standing sentence states the UTC moment of the change: a decline one second after it counts, one before is refused', (t) => {
  const s = mk(t);
  const when = (iso) => ({ now: new Date(iso) });
  tap(s, R(1), 'too_early', when('2026-11-18T09:00:00Z')); tap(s, R(2), 'too_early', when('2026-11-18T10:00:00Z'));
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: new Date('2026-11-18T17:00:00.000Z') }), true);
  // the same calendar date, after the change: counts (the window of the statement is the moment, not the date)
  assert.equal(tap(s, R(3), 'too_early', when('2026-11-18T17:00:01Z')).written, true);
  assert.equal(tap(s, R(4), 'too_early', when('2026-11-18T23:59:59Z')).promoted,
    'Declined 2 suggestions as too early since 2026-11-18T17:00:00.000Z (Wed 07:00; Wed 07:00)');
  // before it, even a second before, on the same date: refused
  assert.equal(tap(s, R(5), 'too_early', when('2026-11-18T16:59:59Z')).written, false);
  assert.equal(tap(s, R(6), 'too_early', when('2026-11-18T17:00:00Z')).written, false);       // exactly at it
  assert.deepEqual(factLines(s.view(FEEDBACK_FILE)).length, 2);
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.includes('since 2026-11-18T17:00:00.000Z (')));
  assertLintedAndSourced(s);
  // a timestamp that is only a date, or not in UTC form, is not a valid "since"
  for (const since of ['2026-11-18', '2026-11-18T17:00:00Z', '2026-11-18T17:00:00.000+01:00', '2026-13-18T17:00:00.000Z', 'noon', 5, {}]) {
    assert.throws(() => F.standing({ reason: 'too_early', count: 2, slots: [{ weekday: 3, hour: 7 }, { weekday: 3, hour: 7 }], since }), TypeError, String(since));
  }
});

// ---------- one canonical order: the same facts give the same bytes and the same planner text ----------
const permutations = (xs) => {
  const rot = (k) => [...xs.slice(k), ...xs.slice(0, k)];
  const half = Math.floor(xs.length / 2);
  return [xs, [...xs].reverse(), rot(1), rot(2), rot(xs.length - 1),
    [...xs.slice(half)].reverse().concat(xs.slice(0, half)), xs.filter((_, i) => i % 2).concat(xs.filter((_, i) => !(i % 2)))];
};
const rollingInput = () => {
  const day = (d, m) => F.daily({ date: `2026-10-${String(d).padStart(2, '0')}`, items: [{ activity: 'Running', minutes: m }] });
  const wk = (w, c) => F.weekly({ weekStart: w, count: c, minutes: c * 40 });
  return {
    facts: [day(9, 30), day(2, 40), day(11, 20), wk('2026-09-28', 3), wk('2026-09-14', 2), wk('2026-10-05', 4), cov(5, 28), cov(2, 7), cov(30, 84), F.thin({ days: 9, endDate: '2026-11-17' })],
    sources: ['2026-11-18T12:00:00.000Z', '2026-11-16T12:00:00.000Z', '2026-11-17T12:00:00.000Z'].map((at) => S.roll({ date: at.slice(0, 10), at: new Date(at) })),
  };
};

test('rolling and profile are written in one canonical order, whatever order the facts and sources come in', (t) => {
  const prof = F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19' });
  const mix = F.mix({ items: [{ activity: 'Running', count: 6 }], asOf: '2026-11-18' });
  const { facts, sources } = rollingInput();
  const expectedRolling = [
    '[daily] 2026-10-02: Running 40 min', '[daily] 2026-10-09: Running 30 min', '[daily] 2026-10-11: Running 20 min',
    '[weekly] Week of 2026-09-14: 2 workouts, 80 min', '[weekly] Week of 2026-09-28: 3 workouts, 120 min', '[weekly] Week of 2026-10-05: 4 workouts, 160 min',
    'Workouts logged on 5 of the 28 days ending 2026-11-17', 'Workouts logged on 2 of the 7 days ending 2026-11-17', 'Workouts logged on 30 of the 84 days ending 2026-11-17',
    'Days of data: 9 (ending 2026-11-17)'];
  const files = { rolling: new Set(), profile: new Set(), indexes: new Set(), inserted: new Set() };
  permutations(facts).forEach((fp, i) => {
    const sp = permutations(sources)[i];
    const s = mk(t, U(1));
    assert.equal(s.create('rolling', fp, sp), true);
    assert.equal(s.create('profile', i % 2 ? [prof, mix] : [mix, prof], sp), true);
    files.rolling.add(s.view('rolling')); files.profile.add(s.view('profile')); files.indexes.add(memoryIndex(s));
    assert.deepEqual(factLines(s.view('rolling')).map((l) => l.slice(2)), expectedRolling);
    // the same facts added one at a time, in that order, give the same file
    const u = mk(t, U(2));
    assert.equal(u.create('rolling', [fp[0]], [sp[0]]), true);
    fp.slice(1).forEach((f, j) => assert.equal(u.insert('rolling', f, sp[(j + 1) % sp.length]), true));
    files.inserted.add(u.view('rolling'));
  });
  assert.equal(files.rolling.size, 1, 'rolling differs between orders');
  assert.equal(files.profile.size, 1, 'profile differs between orders');
  assert.equal(files.indexes.size, 1, 'memoryIndex differs between orders');
  assert.equal(files.inserted.size, 1, 'insert order changes the file');
  assert.deepEqual(factLines([...files.profile][0]).map((l) => l.slice(2)).map((x) => x.split(':')[0]), ['Last 4 weeks by type', '4-week average']);   // by type id: mix, profile
  // sources: no fact owns an S-roll source, so they follow the facts, by text
  const rollSources = [...files.rolling][0].split('## Sources\n')[1].split('\n').filter(Boolean);
  assert.deepEqual(rollSources, [...rollSources].sort());
});

test('feedback, preferences and history are canonical too: sources follow their facts', (t) => {
  const make = (order) => {
    const s = mk(t, U(1));
    for (const [id, reason, h] of order) tap(s, R(id), reason, { hour: h, now: new Date(`2026-11-1${id}T09:00:00Z`) });
    acc(s, R(9));
    return s;
  };
  const input = [[1, 'too_early', 7], [2, 'too_early', 8], [3, 'too_long', 9], [4, 'too_long', 10], [5, 'too_late', 11]];
  const bytes = new Set();
  const indexes = new Set();
  for (const order of permutations(input)) {
    const s = make(order);
    bytes.add(['feedback', 'preferences'].map((k) => s.view(k)).join('\n--\n'));
    indexes.add(memoryIndex(s));
  }
  assert.equal(bytes.size, 1);
  assert.equal(indexes.size, 1);
  const fb = [...bytes][0].split('\n--\n')[0];
  const sourceIds = fb.split('## Sources\n')[1].split('\n').filter(Boolean).map((l) => /\[S(rec_\d+)\]/.exec(l)[1]);
  const factIds = factLines(fb).map((l) => /\((?:recommendation) (rec_\d+)\)/.exec(l)[1]);
  assert.deepEqual(sourceIds, factIds);                                              // sources in the order of their facts
  // a hand-reordered file prints in the same order as the canonical one
  const s = make(input);
  const printed = memoryIndex(s);
  const f = path.join(s.dir, 'preferences/workouts.md');
  const text = fs.readFileSync(f, 'utf8');
  const [head, rest] = text.split('## Current facts\n');
  const [facts, srcs] = rest.split('## Sources\n');
  fs.writeFileSync(f, `${head}## Current facts\n${facts.split('\n').filter(Boolean).reverse().join('\n')}\n## Sources\n${srcs.split('\n').filter(Boolean).reverse().join('\n')}\n`);
  assert.equal(memoryIndex(s), printed);
});

// ---------- a decline without a reason (one tap on the watch) ----------
const dec = (s, recId, o = {}) => recordFeedback(s, { action: 'declined', recId, activity: 'run', weekday: 3, hour: 7, now: NOW, ...o });

test('a decline without a reason is stored with its own wording and source; with a reason it is stored as before', (t) => {
  const s = mk(t);
  for (const reason of [undefined, null]) {
    const r = dec(s, R(reason === null ? 2 : 1), { reason });
    assert.deepEqual(r, { written: true, promoted: null });
  }
  const text = s.view(FEEDBACK_FILE);
  assert.ok(text.includes(`- Declined 1 run suggested for Wed 07:00 (recommendation ${R(1)}, no reason given)\n`));
  assert.ok(text.includes(`- [S${R(1)}] type=feedback; ref=recommendation:${R(1)}; observed_at=2026-11-18T12:00:00.000Z\n`));   // no excerpt
  assert.ok(!text.includes('excerpt='));
  assert.equal(dec(s, R(3), { reason: 'too_early' }).written, true);
  assert.ok(s.view(FEEDBACK_FILE).includes(`- Declined 1 run suggested for Wed 07:00 as too early (recommendation ${R(3)})\n`));
  assert.ok(s.view(FEEDBACK_FILE).includes(`excerpt=too_early`));
  assertLintedAndSourced(s);
});

test('an empty, unknown or mistyped reason is refused; only an absent reason means none', (t) => {
  const s = mk(t);
  for (const reason of ['', ' ', 'dislike', 'too early', 'TOO_EARLY', 'toString', '__proto__', 0, false, true, {}, [], NaN]) {
    const r = dec(s, R(1), { reason });
    assert.equal(r.written, false, String(reason));
    assert.equal(r.why, 'the reason must be one of the five, or absent');
  }
  assert.deepEqual(s.paths(), []);
});

test('declines without a reason never promote and are not part of any standing entry', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 6; i++) assert.equal(dec(s, R(i), { hour: 6 + (i % 3) }).promoted, null);
  assert.equal(s.view(PREFS_FILE), null);                                           // six declines, no standing entry
  assert.equal(tap(s, R(10)).promoted, null);                                       // one reasoned decline: still none
  const r = tap(s, R(11), 'too_early', { weekday: 5, hour: 6 });
  assert.equal(r.promoted, 'Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)');   // counts the two reasoned ones only
  dec(s, R(12)); dec(s, R(13), { reason: undefined });
  assert.deepEqual(factLines(s.view(PREFS_FILE)), ['- Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)']);
  assert.equal(dec(s, R(11), { hour: 9 }).duplicate, true);                         // one outcome per id, whichever came first
  assert.equal(factLines(s.view(FEEDBACK_FILE)).filter((l) => l.includes('no reason given')).length, 8);
  assertLintedAndSourced(s);
});

test('forget by recommendation id works for a decline without a reason, and the id cannot be replayed', (t) => {
  const s = mk(t);
  dec(s, R(1)); dec(s, R(2)); tap(s, R(3)); tap(s, R(4)); acc(s, R(5));
  assert.equal(forgetRecommendation(s, R(1)), true);
  assert.ok(!all(s).includes(R(1)));
  assert.equal(dec(s, R(1)).written, false);
  assert.equal(dec(s, R(1)).suppressed, true);
  assert.equal(tap(s, R(1)).written, false);
  assert.equal(forget(s, FEEDBACK_FILE, `Declined 1 run suggested for Wed 07:00 (recommendation ${R(2)}, no reason given)`), true);   // by the exact line
  assert.ok(!all(s).includes(R(2)));
  assert.equal(forgetRecommendation(s, R(3)), true);                                // a reasoned decline: the standing entry is recounted
  assert.equal(s.view(PREFS_FILE), null);
  assert.ok(all(s).includes(R(4)) && all(s).includes(R(5)));
  assertLintedAndSourced(s);
  // the sweeps: a stop in the middle of forgetting a decline without a reason is finished by the next read
  const { s: f, ctl } = flaky(t);
  dec(f, R(1)); tap(f, R(2)); tap(f, R(3));
  ctl.n = 0; ctl.k = 2;
  assert.equal(forgetRecommendation(f, R(1)), false);
  ctl.k = null;
  assert.ok(!memoryIndex(f).includes('no reason given'));
  assert.ok(!all(f).includes(R(1)));
});

test('a change moves only the reasoned declines; declines without a reason stay as plain counted facts', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); dec(s, R(3)); dec(s, R(4), { reason: null }); acc(s, R(5));
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: NOW }), true);
  assert.ok(factLines(s.view(HISTORY_FILE))[0].startsWith('- Recorded 2 declines as too early'));   // two, not four
  assert.deepEqual(factLines(s.view(FEEDBACK_FILE)).map((l) => l.slice(2, 22)).sort(), ['Accepted 1 run sugge', 'Declined 1 run sugge', 'Declined 1 run sugge']);
  assert.ok(all(s).includes(`${R(3)}, no reason given`) && all(s).includes(R(4)) && all(s).includes(R(5)));
  assert.equal(dec(s, R(3)).duplicate, true);                                       // not moved: still an outcome for its id
  assertLintedAndSourced(s);
});

test('the sources of declines without a reason must match their facts', (t) => {
  const s = mk(t);
  dec(s, R(1)); tap(s, R(2));
  const f = path.join(s.dir, 'feedback/recommendations.md');
  const good = fs.readFileSync(f, 'utf8');
  const line = good.split('\n').find((l) => l.startsWith(`- [S${R(1)}]`));
  for (const [text, why] of [
    [good.replace(line, `${line}; excerpt=too_early`), /another reason/],               // a reason that was never given
    [good.replace(`${line}\n`, ''), /no source/],
  ]) {
    fs.writeFileSync(f, text);
    assert.throws(() => s.view(FEEDBACK_FILE), (e) => e instanceof MemoryUnavailableError && why.test(e.message));
  }
  fs.writeFileSync(f, good);
  const tapLine = good.split('\n').find((l) => l.startsWith(`- [S${R(2)}]`));
  fs.writeFileSync(f, good.replace(tapLine, tapLine.replace('; excerpt=too_early', '')));        // a reasoned decline whose source lost its reason
  assert.throws(() => s.view(FEEDBACK_FILE), (e) => e instanceof MemoryUnavailableError && /another reason/.test(e.message));
});

// ---------- forgetting a recommendation that a change already moved into a history entry ----------
const changeAt = (s, o = {}) => changePreference(s, { reason: 'too_early', why: 'other', now: NOW, ...o });

test('forget a recommendation inside a history entry: the count goes down, the entry goes at zero, the ids stay suppressed', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2)); tap(s, R(3), 'too_long');
  assert.equal(changeAt(s), true);
  assert.deepEqual(factLines(s.view(HISTORY_FILE)), ['- Recorded 2 declines as too early; changed on 2026-11-18T12:00:00.000Z (reason given: other)']);
  assert.ok(s.view(HISTORY_FILE).includes(`ids=${R(1)},${R(2)}`));                    // the source lists what the entry aggregated
  assert.deepEqual(factLines(s.view(PREFS_FILE)), ['- At the change on 2026-11-18T12:00:00.000Z: 2 declines as too early moved to history; new count starts at 0']);
  assert.equal(forgetRecommendation(s, R(1)), true);
  assert.deepEqual(factLines(s.view(HISTORY_FILE)), ['- Recorded 1 declines as too early; changed on 2026-11-18T12:00:00.000Z (reason given: other)']);
  // the change fact is recomputed with it (same journaled op): it no longer claims two were moved
  assert.deepEqual(factLines(s.view(PREFS_FILE)), ['- At the change on 2026-11-18T12:00:00.000Z: 1 declines as too early moved to history; new count starts at 0']);
  assert.ok(!all(s).includes(R(1)));
  assert.ok(s.view(HISTORY_FILE).includes(`ids=${R(2)}\n`));
  assert.equal(tap(s, R(1), 'too_early', later).written, false);                      // replaying it is ignored
  assert.equal(tap(s, R(1), 'too_early', later).suppressed, true);
  assertLintedAndSourced(s);
  assert.equal(forgetRecommendation(s, R(2)), true);
  assert.equal(s.view(HISTORY_FILE), null);                                           // zero left: the entry and its source are gone
  assert.ok(!all(s).includes(R(2)));
  assert.equal(tap(s, R(2), 'too_early', later).written, false);
  assert.equal(s.view(PREFS_FILE), null);                                             // zero moved: the change fact is gone too, nothing says two were moved
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, 'forgotten.json'), 'utf8')).length, 4);      // both ids still suppressed, and marked forgotten
  assert.equal(forgetRecommendation(s, R(2)), false);                                 // nothing left to forget
  assert.equal(forgetRecommendation(s, R(3)), true);                                  // an ordinary decline still works
  assertLintedAndSourced(s);
});

test('two changes of one reason on one day are stored separately, each with its own moment and count', (t) => {
  const s = mk(t);
  const at = (h) => ({ now: new Date(`2026-11-18T${h}:00:00Z`) });
  tap(s, R(1), 'too_early', at('08')); tap(s, R(2), 'too_early', at('09'));
  assert.equal(changeAt(s, at('10')), true);
  tap(s, R(3), 'too_early', at('11')); tap(s, R(4), 'too_early', at('12')); tap(s, R(5), 'too_early', at('12'));
  assert.equal(changeAt(s, at('13')), true);
  // not "4 moved at one change": two changes, 2 and 3
  assert.deepEqual(factLines(s.view(PREFS_FILE)).sort(), [
    '- At the change on 2026-11-18T10:00:00.000Z: 2 declines as too early moved to history; new count starts at 0',
    '- At the change on 2026-11-18T13:00:00.000Z: 3 declines as too early moved to history; new count starts at 0']);
  assert.deepEqual(factLines(s.view(HISTORY_FILE)).sort(), [
    '- Recorded 2 declines as too early; changed on 2026-11-18T10:00:00.000Z (reason given: other)',
    '- Recorded 3 declines as too early; changed on 2026-11-18T13:00:00.000Z (reason given: other)']);
  assert.ok(s.view(HISTORY_FILE).includes(`ids=${R(1)},${R(2)}\n`) && s.view(HISTORY_FILE).includes(`ids=${R(3)},${R(4)},${R(5)}\n`));
  // forgetting an id lowers only its own change and history entry
  assert.equal(forgetRecommendation(s, R(3)), true);
  assert.deepEqual(factLines(s.view(PREFS_FILE)).sort(), [
    '- At the change on 2026-11-18T10:00:00.000Z: 2 declines as too early moved to history; new count starts at 0',
    '- At the change on 2026-11-18T13:00:00.000Z: 2 declines as too early moved to history; new count starts at 0']);
  assert.deepEqual(factLines(s.view(HISTORY_FILE)).sort(), [
    '- Recorded 2 declines as too early; changed on 2026-11-18T10:00:00.000Z (reason given: other)',
    '- Recorded 2 declines as too early; changed on 2026-11-18T13:00:00.000Z (reason given: other)']);
  assertLintedAndSourced(s);
});

test('a history source must list exactly the declines its entry counts', (t) => {
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changeAt(s);
  const f = path.join(s.dir, 'history/preferences.md');
  const good = fs.readFileSync(f, 'utf8');
  const line = good.split('\n').find((l) => l.startsWith('- [H-too_early]'));
  const shapes = {
    'one id listed, two counted': [good.replace(line, line.replace(`,${R(2)}`, '')), /different number/],
    'three ids listed': [good.replace(line, `${line},${R(3)}`), /different number/],
    'ids not sorted': [good.replace(line, line.replace(`${R(1)},${R(2)}`, `${R(2)},${R(1)}`)), /constructor/],
    'an id twice': [good.replace(line, line.replace(`${R(1)},${R(2)}`, `${R(1)},${R(1)}`)), /constructor/],
    'a bad id': [good.replace(line, line.replace(R(2), 'heart_rate_180')), /constructor|history source/],
    'no ids at all': [good.replace(line, line.replace(/; ids=.*/, '')), /constructor|history source/],
    'no source': [good.replace(`${line}\n`, ''), /no source listing/],
    'a source for no entry': [`${good}${line.replace('2026-11-18', '2026-11-19')}\n`, /no entry/],
  };
  for (const [name, [text, why]] of Object.entries(shapes)) {
    fs.writeFileSync(f, text);
    assert.throws(() => s.view(HISTORY_FILE), (e) => e instanceof MemoryUnavailableError && why.test(e.message), name);
  }
  fs.writeFileSync(f, good);
  assert.ok(s.view(HISTORY_FILE));
});

test('forgetting a recommendation inside history survives a stop at any write', (t) => {
  const setup = (s) => { tap(s, R(1)); tap(s, R(2)); tap(s, R(3)); changeAt(s); };
  const clean = flaky(t);
  setup(clean.s);
  clean.ctl.n = 0;
  assert.equal(forgetRecommendation(clean.s, R(1)), true);
  const total = clean.ctl.n;
  const want = snapshot(clean.s);
  assert.ok(total >= 1);                                    // the id is already suppressed, so the history rewrite is the one write
  for (let k = 1; k <= total; k++) {
    const { s, ctl } = flaky(t);
    setup(s);
    ctl.n = 0; ctl.k = k;
    assert.equal(forgetRecommendation(s, R(1)), false, `k=${k}`);
    ctl.k = null;
    assert.equal(forgetRecommendation(s, R(1)), true, `retry k=${k}`);
    assert.deepEqual(snapshot(s), want, `k=${k}`);
    assert.ok(!all(s).includes(R(1)));
  }
});

test('a reasonless decline is stored', (t) => {
  const s = mk(t);
  assert.equal(dec(s, R(1)).written, true);
  assert.ok(s.view(FEEDBACK_FILE).includes('no reason given'));
});

// ---------- bounded feedback: the latest 30 outcomes stay, older ones fold into counts ----------
const base = Date.parse('2026-11-01T00:00:00Z');
const minute = (i) => ({ now: new Date(base + i * 60000) });
/** Outcome i: an accept when i % 3 === 0, a decline without a reason when i % 3 === 1, a decline as too early otherwise. */
const outcome = (s, i) => (i % 3 === 0 ? acc(s, R(i), minute(i)) : i % 3 === 1 ? dec(s, R(i), minute(i)) : tap(s, R(i), 'too_early', { hour: 5 + (i % 10), ...minute(i) }));
const ids = (n, pred) => Array.from({ length: n }, (_, k) => k + 1).filter(pred).map(R).sort();
const foldLine = (s, re) => factLines(s.view(FEEDBACK_FILE)).map((l) => l.slice(2)).find((l) => re.test(l));
const foldRows = (s, code) => new RegExp(`^- \\[E-${code}\\] .*; ids=(\\S+)$`, 'm').exec(s.view(FEEDBACK_FILE))?.[1].split(',');
const foldIds = (s, code) => foldRows(s, code)?.map((x) => x.split('@')[0]);

test('beyond 30 outcomes the older ones fold into one count per action and reason, ids kept in the fold source', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 45; i++) assert.equal(outcome(s, i).written, true, `outcome ${i}`);
  const lines = factLines(s.view(FEEDBACK_FILE)).map((l) => l.slice(2));
  assert.equal(lines.filter((l) => !l.startsWith('Earlier:')).length, 30);                 // the latest 30 stay as lines
  assert.deepEqual(lines.filter((l) => l.startsWith('Earlier:')).sort(), [
    'Earlier: 5 accepts', 'Earlier: 5 declines as too early', 'Earlier: 5 declines with no reason given']);   // outcomes 1 to 15, five of each
  // the ids of the folded outcomes, worked out independently, sorted and unique
  assert.deepEqual(foldIds(s, 'accept'), ids(15, (i) => i % 3 === 0));
  assert.deepEqual(foldIds(s, 'none'), ids(15, (i) => i % 3 === 1));
  assert.deepEqual(foldIds(s, 'too_early'), ids(15, (i) => i % 3 === 2));
  // no kept line is also folded, and the oldest are the folded ones
  for (const l of lines.filter((x) => !x.startsWith('Earlier:'))) assert.ok(!/rec_0000000[1-9]\b|rec_0000001[0-5]\b/.test(l), l);
  // the standing entry still counts the folded declines of its reason: 15 in all, the latest five shown
  assert.ok(factLines(s.view(PREFS_FILE))[0].startsWith('- Declined 15 suggestions as too early (latest 5: '));
  assertLintedAndSourced(s);
  assert.ok(memoryIndex(s).includes('- feedback/recommendations.md: 33 facts'));            // 30 lines + 3 folds
  // a folded id answered again is a duplicate: nothing changes, nothing is counted twice
  const before = snapshot(s);
  assert.equal(acc(s, R(3)).duplicate, true);
  assert.equal(tap(s, R(2), 'too_early').duplicate, true);
  assert.deepEqual(snapshot(s), before);
});

test('forgetting a folded id lowers its count, the count line goes at zero, and the id cannot be replayed', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 45; i++) outcome(s, i);
  assert.equal(forgetRecommendation(s, R(3)), true);                                      // a folded accept
  assert.ok(foldLine(s, /^Earlier: 4 accepts$/));
  assert.ok(!foldIds(s, 'accept').includes(R(3)));
  assert.equal(acc(s, R(3), minute(100)).suppressed, true);                               // replay ignored
  assert.equal(forgetRecommendation(s, R(2)), true);                                      // a folded decline as too early: the standing count drops
  assert.ok(foldLine(s, /^Earlier: 4 declines as too early$/));
  assert.ok(factLines(s.view(PREFS_FILE))[0].startsWith('- Declined 14 suggestions as too early'));
  assert.equal(tap(s, R(2), 'too_early', minute(101)).suppressed, true);
  assert.equal(forgetRecommendation(s, R(1)), true);                                      // a folded decline without a reason
  assert.ok(foldLine(s, /^Earlier: 4 declines with no reason given$/));
  for (const i of [6, 9, 12, 15]) assert.equal(forgetRecommendation(s, R(i)), true);      // the rest of the accepts
  assert.ok(!foldLine(s, /accepts$/));                                                    // zero: the line and its source are gone
  assert.equal(foldIds(s, 'accept'), undefined);
  assert.ok(!all(s).includes(R(3)) && !all(s).includes(R(6)));
  assert.equal(forgetRecommendation(s, R(3)), false);                                     // nothing left under that id
  assertLintedAndSourced(s);
  // forgetting the whole fold line by its text
  assert.equal(forget(s, FEEDBACK_FILE, 'Earlier: 4 declines with no reason given'), true);
  assert.ok(!foldLine(s, /no reason given$/));
  assert.equal(dec(s, R(4), minute(102)).suppressed, true);                               // its ids are suppressed
  assertLintedAndSourced(s);
});

test('a change moves the folded declines of its reason with the kept ones', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 45; i++) outcome(s, i);
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: new Date(base + 60 * 60000) }), true);
  assert.ok(factLines(s.view(HISTORY_FILE))[0].startsWith('- Recorded 15 declines as too early; changed on 2026-11-01'));
  assert.ok(!foldLine(s, /declines as too early$/));
  assert.ok(!factLines(s.view(FEEDBACK_FILE)).some((l) => l.includes('as too early')));
  assert.equal(forgetRecommendation(s, R(2)), true);                                      // a folded id, now inside the history entry
  assert.ok(factLines(s.view(HISTORY_FILE))[0].startsWith('- Recorded 14 declines'));
  assertLintedAndSourced(s);
});

test('a fold keeps EVERY folded id, with its time; there is no cap', (t) => {
  const s = mk(t);
  const syn = (i) => `rec_a${i.toString(16).padStart(7, '0')}`;
  const n = 6000;
  const rows = Array.from({ length: n }, (_, i) => ({ id: syn(i), at: base + i * 1000 }));
  assert.equal(s.create(FEEDBACK_FILE, [F.earlier({ action: 'accepted', count: n })], [S.earlier({ code: 'accept', ids: rows, at: new Date(base + n * 1000) })]), true);
  for (let i = 1; i <= 35; i++) acc(s, R(i), minute(i + n));                              // 35 accepts: the oldest 5 fold in as well
  assert.ok(foldLine(s, /^Earlier: 6005 accepts$/));
  const listed = foldRows(s, 'accept');
  assert.equal(listed.length, 6005);                                                      // every id, none dropped
  assert.deepEqual(listed.map((x) => x.split('@')[0]), [...listed.map((x) => x.split('@')[0])].sort());
  assert.ok(listed.includes(`${R(1)}@${new Date(base + (1 + n) * 60000).toISOString()}`));   // an id folded just now, with its time
  assert.equal(forgetRecommendation(s, R(1)), true);                                      // so it can be forgotten
  assert.equal(forgetRecommendation(s, syn(7)), true);
  assert.ok(foldLine(s, /^Earlier: 6003 accepts$/));
  assert.equal(foldRows(s, 'accept').length, 6003);
  assert.ok(s.view(FEEDBACK_FILE));
});

test('a year of 3 outcomes a day stays well within 50 KB per person', (t) => {
  const s = mk(t);
  seedProfile(s);
  const day = 86400000;
  let n = 0;
  for (let d = 0; d < 365; d++) {
    for (let k = 0; k < 3; k++) {
      n += 1;
      const id = `rec_${n.toString(16).padStart(8, '0')}`;
      const at = { now: new Date(base + d * day + k * 3600000) };
      if (n % 3 === 0) acc(s, id, at); else if (n % 3 === 1) dec(s, id, at); else tap(s, id, 'too_early', at);
    }
  }
  assert.equal(n, 1095);
  const bytes = (rel) => fs.statSync(path.join(s.dir, rel)).size;
  const total = s.paths().reduce((sum, rel) => sum + bytes(rel), 0);
  assert.ok(bytes('feedback/recommendations.md') < 48 * 1024, `feedback ${bytes('feedback/recommendations.md')}`);
  assert.ok(total < 50 * 1024, `all files ${total} bytes`);
  assert.equal(factLines(s.view(FEEDBACK_FILE)).filter((l) => !l.startsWith('- Earlier:')).length >= 30, true);
  // every one of the 1095 ids is still found (kept or folded) and can be forgotten
  assert.equal(forgetRecommendation(s, `rec_${(1).toString(16).padStart(8, '0')}`), true);
  assert.equal(forgetRecommendation(s, `rec_${(1000).toString(16).padStart(8, '0')}`), true);
});

test('a feedback file with a bad fold is refused on read (each shape)', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 33; i++) acc(s, R(i), minute(i));
  const f = path.join(s.dir, 'feedback/recommendations.md');
  const good = fs.readFileSync(f, 'utf8');
  const src = good.split('\n').find((l) => l.startsWith('- [E-accept]'));
  const fact = good.split('\n').find((l) => l.startsWith('- Earlier: '));
  const idsOf = /ids=(\S+)/.exec(src)[1].split(',');
  assert.equal(idsOf.length, 3);
  const shapes = {
    'a fold without its source': [good.replace(`${src}\n`, ''), /no source listing/],
    'a source without its fold': [good.replace(`${fact}\n`, ''), /no fold/],
    'ids not sorted': [good.replace(src, src.replace(idsOf.join(','), [...idsOf].reverse().join(','))), /constructor/],
    'ids without their times': [good.replace(src, src.replace(idsOf.join(','), idsOf.map((x) => x.split('@')[0]).join(','))), /constructor/],
    'an id with a bad time': [good.replace(src, src.replace(idsOf[0], `${idsOf[0].split('@')[0]}@2026-13-45T00:00:00Z`)), /constructor/],
    'an id twice': [good.replace(src, src.replace(idsOf.join(','), `${idsOf[0]},${idsOf[0]},${idsOf[1]}`)), /constructor/],
    'a count smaller than its ids': [good.replace(fact, '- Earlier: 2 accepts'), /different number/],
    'a count larger than its ids': [good.replace(fact, '- Earlier: 4 accepts'), /different number/],
    'a folded id that is also a kept line': [good.replace(src, src.replace(idsOf.join(','), [idsOf[0], idsOf[1], `${R(33)}@2026-11-01T00:33:00.000Z`].join(','))), /both kept and folded|folded twice/],
    'two folds for one code': [good.replace(fact, `${fact}\n- Earlier: 7 accepts`), /same thing/],
    'a source of the wrong code': [good.replace(src, src.replace('[E-accept]', '[E-none]')), /no source listing|no fold/],
  };
  for (const [name, [text, why]] of Object.entries(shapes)) {
    fs.writeFileSync(f, text);
    assert.throws(() => s.view(FEEDBACK_FILE), (e) => e instanceof MemoryUnavailableError && why.test(e.message), name);
  }
  fs.writeFileSync(f, good);
  assert.ok(s.view(FEEDBACK_FILE));
});

test('a stop while folding leaves a valid file and the next outcome finishes the fold', (t) => {
  const { s, ctl } = flaky(t);
  for (let i = 1; i <= 30; i++) acc(s, R(i), minute(i));
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 30);
  ctl.n = 0; ctl.k = 2;                                                                    // the 31st is written, the fold is not
  const r = acc(s, R(31), minute(31));
  assert.equal(r.written, true);
  assert.equal(r.foldFailed, true);
  ctl.k = null;
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 31);                              // valid, just not yet folded
  assert.equal(acc(s, R(32), minute(32)).written, true);                                  // the next call folds both older ones
  assert.ok(foldLine(s, /^Earlier: 2 accepts$/));
  assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 31);                              // 30 kept + 1 fold line
  assertLintedAndSourced(s);
});

// ---------- aggregates over dates may not cover a forgotten day unless the computation excluded it ----------
test('a weekly (or coverage, profile, mix) fact covering a forgotten day is refused unless it lists the day as excluded', (t) => {
  const s = mk(t);
  seedProfile(s);
  s.delete('rolling');
  const src = ROLL_SRC();
  assert.equal(s.create('rolling', [dayFact(1)], [src]), true);
  assert.equal(forgetFactKey(s, 'daily', '2026-10-07'), true);
  assert.equal(forgetFactKey(s, 'daily', '2026-10-25'), true);
  const wk = (o = {}) => F.weekly({ weekStart: '2026-10-05', count: 6, minutes: 240, ...o });
  // a normal write that forgot to exclude the day is refused ...
  assert.equal(s.insert('rolling', wk(), src), false);
  assert.match(s.lastError, /forgotten day 2026-10-07 without excluding it/);
  assert.ok(!s.view('rolling').includes('Week of 2026-10-05'));
  assert.equal(s.replaceFacts('rolling', [...s.read('rolling').facts, wk()], s.read('rolling').sources), false);   // nor by a whole-file write
  // ... with the day excluded it is accepted, and the line records nothing extra
  assert.equal(wk({ excludedDays: ['2026-10-07'] }).text, `${wk().text} (1 forgotten day left out)`);     // a count, never the date
  assert.ok(!wk({ excludedDays: ['2026-10-07'] }).text.includes('2026-10-07'));
  assert.equal(s.insert('rolling', wk({ excludedDays: ['2026-10-07'] }), src), true);
  assert.ok(s.view('rolling').includes('[weekly] Week of 2026-10-05: 6 workouts, 240 min (1 forgotten day left out)\n'));
  // a week without any forgotten day needs nothing
  assert.equal(s.insert('rolling', F.weekly({ weekStart: '2026-10-12', count: 7, minutes: 280 }), src), true);
  // the line that is already there is carried along by any later write
  assert.equal(s.insert('rolling', F.weekly({ weekStart: '2026-10-19', count: 6, minutes: 240, excludedDays: ['2026-10-25'] }), src), true);
  assert.equal(s.insert('rolling', dayFact(30), src), true);
  // coverage over a window holding a forgotten day
  assert.equal(s.insert('rolling', F.coverage({ workoutDays: 8, windowDays: 28, endDate: '2026-11-17' }), src), false);
  assert.equal(s.insert('rolling', F.coverage({ workoutDays: 7, windowDays: 28, endDate: '2026-11-17', excludedDays: ['2026-10-25'] }), src), true);
  // profile average and mix (28 days ending as-of)
  const prof = (o = {}) => F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19', ...o });
  const mix = (o = {}) => F.mix({ items: [{ activity: 'Running', count: 6 }], asOf: '2026-11-18', ...o });
  s.delete('profile');
  assert.equal(s.create('profile', [prof(), mix()], [src]), false);
  assert.equal(s.create('profile', [prof({ excludedDays: ['2026-10-25'] }), mix({ excludedDays: ['2026-10-25'] })], [src]), true);
  assert.equal(prof({ excludedDays: ['2026-10-25'] }).text, `${prof().text} (1 forgotten day left out)`);
});

test('excludedDays must be real, unique days inside the fact\'s own range', () => {
  const wk = (excludedDays) => () => F.weekly({ weekStart: '2026-10-05', count: 6, minutes: 240, excludedDays });
  for (const bad of [['2026-10-04'], ['2026-10-12'], ['2026-10-07', '2026-10-07'], ['2026-13-07'], ['yesterday'], [5], 'x']) assert.throws(wk(bad), TypeError, JSON.stringify(bad));
  assert.doesNotThrow(wk(['2026-10-05', '2026-10-11']));
  assert.doesNotThrow(wk(undefined));
  assert.throws(() => F.coverage({ workoutDays: 1, windowDays: 7, endDate: '2026-11-17', excludedDays: ['2026-11-10'] }), TypeError);   // before the 7-day window
  assert.doesNotThrow(() => F.coverage({ workoutDays: 1, windowDays: 7, endDate: '2026-11-17', excludedDays: ['2026-11-11'] }));
});

// ---------- a delayed change splits the fold at the change time ----------
test('a change moves only the folded declines observed at or before it; later folded ones stay in the fold', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 45; i++) outcome(s, i);                       // outcomes 1..15 are folded; the too_early ones are 2, 5, 8, 11, 14
  assert.deepEqual(foldIds(s, 'too_early'), [R(11), R(14), R(2), R(5), R(8)].sort());
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: new Date(base + 10 * 60000 + 30000) }), true);   // between outcomes 10 and 11
  assert.ok(factLines(s.view(HISTORY_FILE))[0].startsWith('- Recorded 3 declines as too early'));   // 2, 5, 8
  assert.ok(s.view(HISTORY_FILE).includes(`ids=${[R(2), R(5), R(8)].join(',')}\n`));
  assert.ok(foldLine(s, /^Earlier: 2 declines as too early$/));                                   // 11 and 14 stay
  assert.deepEqual(foldIds(s, 'too_early'), [R(11), R(14)]);
  assert.ok(/ids=rec_00000011@2026-11-01T00:11:00.000Z,rec_00000014@2026-11-01T00:14:00.000Z/.test(s.view(FEEDBACK_FILE)));
  // the standing entry counts what is left since the change: 2 folded + 10 kept
  assert.ok(factLines(s.view(PREFS_FILE)).some((l) => l.startsWith('- Declined 12 suggestions as too early since 2026-11-01T00:10:30.000Z (')));
  assert.equal(forgetRecommendation(s, R(11)), true);                                             // a folded id that stayed
  assert.equal(forgetRecommendation(s, R(5)), true);                                              // an id now in history
  assert.ok(foldLine(s, /^Earlier: 1 declines as too early$/));
  assert.ok(factLines(s.view(HISTORY_FILE))[0].startsWith('- Recorded 2 declines as too early'));
  assertLintedAndSourced(s);
});

// ---------- every operation that moves or removes folded or historical ids is journaled ----------
test('forgetting inside a fold or history, forgetting a whole fold and a change are journaled: a stop at any write is finished before any read', (t) => {
  const ops = {
    'a folded id': [(s) => forgetRecommendation(s, R(5)), (s) => { for (let i = 1; i <= 45; i++) outcome(s, i); }],
    'a whole fold': [(s) => forget(s, FEEDBACK_FILE, 'Earlier: 5 declines as too early'), (s) => { for (let i = 1; i <= 45; i++) outcome(s, i); }],
    'a history id': [(s) => forgetRecommendation(s, R(2)), (s) => { for (let i = 1; i <= 45; i++) outcome(s, i); changePreference(s, { reason: 'too_early', why: 'other', now: new Date(base + 60 * 60000) }); }],
    'a change with a fold': [(s) => changePreference(s, { reason: 'too_early', why: 'other', now: new Date(base + 10 * 60000 + 30000) }), (s) => { for (let i = 1; i <= 45; i++) outcome(s, i); }],
    'an id on a line': [(s) => forgetRecommendation(s, R(40)), (s) => { for (let i = 1; i <= 45; i++) outcome(s, i); }],
  };
  for (const [name, [run, setup]] of Object.entries(ops)) {
    const clean = flaky(t);
    setup(clean.s);
    clean.ctl.n = 0;
    assert.equal(run(clean.s), true, name);
    const total = clean.ctl.n;
    const want = snapshot(clean.s);
    assert.ok(total >= 3, `${name}: ${total} steps`);                                  // journal, work, journal removal
    assert.ok(!('journal.json' in want));
    for (let k = 1; k <= total; k++) {
      const { s, ctl } = flaky(t);
      setup(s);
      ctl.n = 0; ctl.k = k;
      assert.equal(run(s), false, `${name} k=${k}`);
      const late = s.readJournal() === null && k > 1;                                       // only the final recount did not run
      if (late) {
        ctl.k = null;
        assert.ok(memoryIndex(s));                                                          // the next read recounts
        assert.deepEqual(snapshot(s), want, `${name} late k=${k}`);
        continue;
      }
      if (k > 1) {
        assert.notEqual(s.readJournal(), null, `${name} k=${k}: the journal is kept`);
        assert.throws(() => s.view(FEEDBACK_FILE), MemoryUnavailableError, `${name} k=${k}`);   // no read until it is finished
        assert.throws(() => s.view(HISTORY_FILE), MemoryUnavailableError, `${name} k=${k}`);
        ctl.k = ctl.n;
        assert.throws(() => memoryIndex(s), MemoryUnavailableError, `${name} k=${k}`);
      }
      ctl.k = null;
      assert.equal(run(s), true, `${name} retry k=${k}`);
      assert.equal(s.readJournal(), null);
      assert.deepEqual(snapshot(s), want, `${name} k=${k}`);
      assertLintedAndSourced(s);
    }
  }
});

test('the new journal operations are validated', () => {
  const at = NOW.toISOString();
  const ok = [
    { op: 'forget_recommendation', id: R(1), at },
    { op: 'forget_fold', code: 'accept', ids: [R(1), R(2)], at },
    { op: 'forget_fold', code: 'none', ids: [R(1)], at },
    { op: 'forget_fold', code: 'too_early', ids: [R(1)], at },
  ];
  for (const j of ok) assert.equal(validateJournal(JSON.stringify(j)), null, JSON.stringify(j));
  const bad = [
    { op: 'forget_recommendation', id: 'heart_rate_180', at }, { op: 'forget_recommendation', id: R(1), at, extra: 1 }, { op: 'forget_recommendation', at },
    { op: 'forget_fold', code: 'bored', ids: [R(1)], at }, { op: 'forget_fold', code: 'accept', ids: ['x'], at }, { op: 'forget_fold', code: 'accept', at },
    { op: 'forget_fold', code: 'accept', ids: [R(1)], at: 'noon' },
  ];
  for (const j of bad) assert.notEqual(validateJournal(JSON.stringify(j)), null, JSON.stringify(j));
  // a change journal may list thousands of ids (there is no cap) but its count must equal them
  const many = Array.from({ length: 6000 }, (_, i) => `rec_b${i.toString(16).padStart(7, '0')}`);
  assert.equal(validateJournal(JSON.stringify({ op: 'change_preference', reason: 'too_early', why: 'other', at: '2026-11-18T10:00:00.000Z', count: 6000, ids: many })), null);
  assert.notEqual(validateJournal(JSON.stringify({ op: 'change_preference', reason: 'too_early', why: 'other', at: '2026-11-18T10:00:00.000Z', count: 5999, ids: many })), null);
});

test('a folded decline observed 400 ms after the change stays; one 100 ms before it moves (times are kept to the millisecond)', (t) => {
  const s = mk(t);
  const A = { id: R(1), at: Date.parse('2026-11-18T10:00:00.400Z') };      // before the change at 10:00:00.500
  const B = { id: R(2), at: Date.parse('2026-11-18T10:00:00.900Z') };      // after it, in the same second
  assert.equal(s.create(FEEDBACK_FILE, [F.earlier({ action: 'declined', reason: 'too_early', count: 2 })],
    [S.earlier({ code: 'too_early', ids: [A, B], at: new Date(B.at) })]), true);
  assert.ok(s.view(FEEDBACK_FILE).includes(`ids=${R(1)}@2026-11-18T10:00:00.400Z,${R(2)}@2026-11-18T10:00:00.900Z`));
  // a kept decline, before the change (written straight to the store: recordFeedback would refuse an outcome older than the fold)
  assert.equal(s.insert(FEEDBACK_FILE, F.tap({ recId: R(3), activity: 'run', weekday: 3, hour: 7, reason: 'too_early' }), S.tap({ recId: R(3), reason: 'too_early', at: new Date('2026-11-18T09:00:00Z') })), true);
  assert.ok(recover(s).ok);
  assert.ok(factLines(s.view(PREFS_FILE))[0].startsWith('- Declined 3 suggestions as too early ('));
  assert.equal(changePreference(s, { reason: 'too_early', why: 'other', now: new Date('2026-11-18T10:00:00.500Z') }), true);
  assert.ok(factLines(s.view(HISTORY_FILE))[0].startsWith('- Recorded 2 declines as too early'));   // R(1) and R(3), not R(2)
  assert.ok(s.view(HISTORY_FILE).includes(`ids=${R(1)},${R(3)}\n`));
  assert.deepEqual(foldIds(s, 'too_early'), [R(2)]);                                                // the later one stays folded
  assert.ok(foldLine(s, /^Earlier: 1 declines as too early$/));
  assert.ok(s.view(FEEDBACK_FILE).includes(`ids=${R(2)}@2026-11-18T10:00:00.900Z\n`));
  assertLintedAndSourced(s);
});

// ---------- a mix that excludes a forgotten day survives forgetting one of its activities ----------
test('forget a day, recompute the mix with it excluded, then forget an activity: the journal completes and memory stays readable', (t) => {
  const s = mk(t);
  seedProfile(s);
  assert.equal(forgetFactKey(s, 'daily', '2026-10-25'), true);                    // profile and mix covered the 25th: both deleted
  assert.equal(s.view('profile'), null);
  const day = ['2026-10-25'];
  const prof = F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19', excludedDays: day });
  const mix = F.mix({ items: [{ activity: 'Running', count: 6 }, { activity: 'Walking', count: 4 }], asOf: '2026-11-18', excludedDays: day });
  assert.equal(s.create('profile', [prof, mix], [ROLL_SRC()]), true);             // the recompute, with the day left out
  assert.ok(s.view('profile').includes('(as of 2026-11-18) (1 forgotten day left out)'));
  assert.equal(forgetFactKey(s, 'mix', 'Walking'), true);                         // allowed even when the mix leaves forgotten days out
  assert.equal(s.readJournal(), null);
  assert.ok(s.view('profile').includes('Last 4 weeks by type: Running 6 (as of 2026-11-18) (1 forgotten day left out)'));
  assert.ok(!memoryIndex(s).includes('Walking'));
  assert.equal(forgetFactKey(s, 'mix', 'Running'), true);                         // the last activity: the mix line goes, the rest stays
  assert.ok(!s.view('profile').includes('Last 4 weeks'));
  assert.ok(s.view('profile').includes('4-week average'));
  assertLintedAndSourced(s);
  // a rebuilt line is not a way around the rule: it must leave out at least as many days as are forgotten in its window
  assert.equal(forgetFactKey(s, 'daily', '2026-10-26'), true);
  const rebuilt = F.mix({ items: [{ activity: 'Cycling', count: 1 }], asOf: '2026-11-18', excludedCount: 1 });
  assert.equal(s.view('profile'), null);                                          // forgetting the 26th deleted the aggregates covering it
  assert.equal(s.create('profile', [rebuilt], [ROLL_SRC()]), false);              // two days forgotten in the window, only one left out
  assert.match(String(s.lastError), /without (excluding it|naming them)/, String(s.lastError));
  assert.equal(s.create('profile', [F.mix({ items: [{ activity: 'Cycling', count: 1 }], asOf: '2026-11-18', excludedDays: ['2026-10-25', '2026-10-26'] })], [ROLL_SRC()]), true, String(s.lastError));
});

// ---------- the fold is finished by a retry (even a duplicate) and by recovery ----------
test('if folding failed after a tap was saved, a duplicate retry folds, and so does recovery on its own', (t) => {
  const stop = () => {
    const { s, ctl } = flaky(t);
    for (let i = 1; i <= 30; i++) acc(s, R(i), minute(i));
    ctl.n = 0; ctl.k = 2;                                                           // the 31st is written, the fold is not
    const r = acc(s, R(31), minute(31));
    assert.equal(r.written, true);
    assert.equal(r.foldFailed, true);
    ctl.k = null;
    assert.equal(factLines(s.view(FEEDBACK_FILE)).length, 31);                       // over its limit
    return s;
  };
  // (a) the same tap again: a duplicate, which still folds
  const a = stop();
  const again = acc(a, R(31), minute(31));
  assert.equal(again.duplicate, true);
  assert.equal(again.foldFailed, undefined);
  assert.ok(foldLine(a, /^Earlier: 1 accepts$/));
  assert.equal(factLines(a.view(FEEDBACK_FILE)).filter((l) => !l.startsWith('- Earlier:')).length, 30);
  // (b) no retry at all: the next read (recovery) folds
  const b = stop();
  assert.ok(memoryIndex(b));
  assert.ok(foldLine(b, /^Earlier: 1 accepts$/));
  assert.equal(factLines(b.view(FEEDBACK_FILE)).filter((l) => !l.startsWith('- Earlier:')).length, 30);
  assert.deepEqual(snapshot(a)['feedback/recommendations.md'], snapshot(b)['feedback/recommendations.md']);   // the same file either way
  assert.equal(recover(b).ok, true);                                                // and it is idempotent
  assertLintedAndSourced(b);
});

test('a caller cannot create a new aggregate over a forgotten day with only a count of excluded days', (t) => {
  const s = mk(t);
  seedProfile(s);
  s.delete('rolling'); s.delete('profile');
  assert.equal(s.create('rolling', [dayFact(1)], [ROLL_SRC()]), true);
  assert.equal(forgetFactKey(s, 'daily', '2026-10-07'), true);
  const src = ROLL_SRC();
  const wk = (o) => F.weekly({ weekStart: '2026-10-05', count: 6, minutes: 240, ...o });
  const mix = (o) => F.mix({ items: [{ activity: 'Running', count: 6 }], asOf: '2026-10-20', ...o });          // its 28 days include 7 Oct
  // a count alone is not an exclusion: the new line must name the day it left out
  for (const attempt of [
    () => s.insert('rolling', wk({ excludedCount: 1 }), src),
    () => s.replaceFacts('rolling', [dayFact(1), wk({ excludedCount: 1 })], [src]),
    () => s.insert('rolling', F.coverage({ workoutDays: 3, windowDays: 84, endDate: '2026-11-17', excludedCount: 5 }), src),
    () => s.create('profile', [mix({ excludedCount: 1 })], [src]),
  ]) {
    assert.equal(attempt(), false);
    assert.match(String(s.lastError), /without naming them/);
  }
  assert.ok(!s.view('rolling').includes('Week of 2026-10-05'));
  // naming the actual day is accepted, and the line reads the same
  assert.equal(s.insert('rolling', wk({ excludedDays: ['2026-10-07'] }), src), true);
  assert.equal(s.create('profile', [mix({ excludedDays: ['2026-10-07'] })], [src]), true);
  // an unchanged stored line, carried along by a later write, is not re-checked
  assert.equal(s.insert('rolling', dayFact(2), src), true);
  assert.ok(s.view('rolling').includes('Week of 2026-10-05: 6 workouts, 240 min (1 forgotten day left out)'));
});

test('a preference change older than the latest change of that preference is refused and changes nothing', (t) => {
  const s = mk(t);
  const at = (h) => ({ now: new Date(`2026-11-18T${h}:00:00Z`) });
  tap(s, R(1), 'too_early', at('08')); tap(s, R(2), 'too_early', at('09'));
  assert.equal(changeAt(s, at('12')), true);
  tap(s, R(3), 'too_early', at('13')); tap(s, R(4), 'too_early', at('14'));
  const before = snapshot(s);
  for (const h of ['11', '12']) {                                                  // older, and exactly the same moment
    assert.equal(changeAt(s, at(h)), false, h);
    assert.match(s.lastError, /not later than the latest change of this preference/);
  }
  assert.deepEqual(snapshot(s), before);                                           // the newer change's source and facts are untouched
  assert.ok(s.view(PREFS_FILE).includes('[C-too_early] type=chat; ref=preference_change:too_early; observed_at=2026-11-18T12:00:00.000Z'));
  assert.equal(changeAt(s, at('15')), true);                                       // a later one is fine
  assert.ok(s.view(PREFS_FILE).includes('observed_at=2026-11-18T15:00:00.000Z'));
  // another reason is not bounded by this one
  tap(s, R(5), 'too_long', at('07')); tap(s, R(6), 'too_long', at('08'));
  assert.equal(changePreference(s, { reason: 'too_long', why: 'other', now: new Date('2026-11-18T09:00:00Z') }), true);
});

test('an outcome not newer than the newest folded one is refused, so the kept latest 30 never depend on arrival order', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 45; i++) outcome(s, i);                                    // 1..15 folded: the newest folded outcome is at minute 15
  const before = snapshot(s);
  for (const m of [3, 10, 15]) {                                                  // older than, and exactly at, the boundary
    const r = acc(s, R(100 + m), minute(m));
    assert.equal(r.written, false, `minute ${m}`);
    assert.equal(r.why, 'refused: observed at or before the newest folded outcome');
  }
  assert.equal(tap(s, R(120), 'too_early', minute(14)).written, false);
  assert.deepEqual(snapshot(s), before);                                          // nothing written
  assert.equal(acc(s, R(3)).duplicate, true);                                     // a known id is a duplicate, not refused
  assert.equal(acc(s, R(130), { now: new Date(base + 15 * 60000 + 1) }).written, true);   // just after the boundary
  // the result does not depend on arrival order: two stores fed the same newer outcomes in different orders agree
  const a = mk(t, U(2)); const b = mk(t, U(3));
  for (let i = 1; i <= 40; i++) outcome(a, i);
  for (let i = 1; i <= 40; i++) outcome(b, i);
  for (const i of [41, 42, 43]) outcome(a, i);
  for (const i of [41, 42, 43]) outcome(b, i);
  assert.equal(a.view(FEEDBACK_FILE), b.view(FEEDBACK_FILE));
});

test('the history file label is neutral: it names the file and asserts nothing about the preferences', (t) => {
  assert.equal(FILE_KINDS.history.summary, 'Preference history');
  for (const k of Object.values(FILE_KINDS)) assert.ok(!/\b(true|false|no longer|were|are)\b/i.test(k.summary), k.summary);
  const s = mk(t);
  tap(s, R(1)); tap(s, R(2));
  changeAt(s);
  assert.ok(s.view(HISTORY_FILE).startsWith('<!-- idx: tier=cold; summary=Preference history -->\n# Preference history\n'));
  assert.ok(!all(s).includes('no longer are'));
});

test('a forgotten id cannot be written back inside a fold or history source; a moved id is still listed there', (t) => {
  const s = mk(t);
  for (let i = 1; i <= 45; i++) outcome(s, i);
  assert.equal(forgetRecommendation(s, R(3)), true);                                       // a folded accept
  const doc = s.read(FEEDBACK_FILE);
  const fold = doc.sources.find((x) => x.text.startsWith('[E-accept]'));
  const at = new Date(base + 3 * 60000);
  const withBack = () => {
    const rows = [...fold.text.match(/ids=(\S+)/)[1].split(',').map((x) => ({ id: x.split('@')[0], at: Date.parse(x.split('@')[1]) })), { id: R(3), at: at.getTime() }];
    return [F.earlier({ action: 'accepted', count: rows.length }), S.earlier({ code: 'accept', ids: rows, at })];
  };
  const [bf, bs] = withBack();
  const others = doc.facts.filter((f) => f.key !== 'earlier:accept');
  const otherSources = doc.sources.filter((x) => !x.text.startsWith('[E-accept]'));
  assert.equal(s.replaceFacts(FEEDBACK_FILE, [...others, bf], [...otherSources, bs]), false);
  assert.match(s.lastError, /forgotten recommendation id in a fold or history source/);
  assert.ok(!s.view(FEEDBACK_FILE).includes(R(3)));
  // a fresh file with the same source is refused too
  const u = mk(t, U(2));
  for (let i = 1; i <= 45; i++) outcome(u, i);
  forgetRecommendation(u, R(3));
  assert.equal(u.create('history', [F.history({ reason: 'too_early', count: 1, at: '2026-11-18T12:00:00.000Z', why: 'other' })], [S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: [R(3)], at: NOW })]), false);
  // history sources: an id moved by a change is suppressed but not forgotten, so it is listed; once forgotten it cannot come back
  const h = mk(t, U(3));
  tap(h, R(1)); tap(h, R(2));
  assert.equal(changeAt(h), true);
  assert.ok(h.view(HISTORY_FILE).includes(`ids=${R(1)},${R(2)}`));                         // moved ids are listed
  assert.equal(forgetRecommendation(h, R(1)), true);
  const e = h.read(HISTORY_FILE);
  const back = [F.history({ reason: 'too_early', count: 2, at: '2026-11-18T12:00:00.000Z', why: 'other' }),
    S.history({ reason: 'too_early', changedAt: '2026-11-18T12:00:00.000Z', why: 'other', ids: [R(1), R(2)], at: NOW })];
  assert.equal(h[DERIVE](() => h.replaceFacts(HISTORY_FILE, back.slice(0, 1), [back[1]])), false);   // even the store's own path refuses it
  assert.match(h.lastError, /forgotten recommendation id in a fold or history source/);
  assert.equal(e.facts.length, 1);
  assert.ok(!h.view(HISTORY_FILE).includes(R(1)));
});

test('an aggregate cannot claim more left-out days than its window or its measurement allows', () => {
  const bad = [
    () => F.coverage({ workoutDays: 1, windowDays: 7, endDate: '2026-11-17', excludedCount: 400 }),
    () => F.coverage({ workoutDays: 1, windowDays: 7, endDate: '2026-11-17', excludedCount: 7 }),          // 1 logged + 7 left out > 7
    () => F.coverage({ workoutDays: 5, windowDays: 7, endDate: '2026-11-17', excludedCount: 3 }),          // 5 logged + 3 left out > 7
    () => F.coverage({ workoutDays: 0, windowDays: 28, endDate: '2026-11-17', excludedCount: 29 }),
    () => F.weekly({ weekStart: '2026-10-05', count: 3, minutes: 90, excludedCount: 8 }),
    () => F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19', excludedCount: 29 }),
    () => F.mix({ items: [{ activity: 'Running', count: 1 }], asOf: '2026-11-18', excludedCount: 29 }),
    () => F.thin({ days: 9, endDate: '2026-11-17', excludedCount: 401 }),
    () => F.weekly({ weekStart: '2026-10-05', count: 3, minutes: 90, excludedCount: -1 }),
    () => F.weekly({ weekStart: '2026-10-05', count: 3, minutes: 90, excludedCount: 1.5 }),
    () => F.weekly({ weekStart: '2026-10-05', count: 3, minutes: 90, excludedDays: ['2026-10-07'], excludedCount: 2 }),   // dates and count disagree
  ];
  bad.forEach((b, i) => assert.throws(b, TypeError, String(i)));
  assert.doesNotThrow(() => F.coverage({ workoutDays: 5, windowDays: 7, endDate: '2026-11-17', excludedCount: 2 }));   // exactly fills the window
  assert.throws(() => F.weekly({ weekStart: '2026-10-05', count: 3, minutes: 90, excludedCount: 7 }), TypeError);          // seven left out cannot leave 3 workouts
  assert.doesNotThrow(() => F.weekly({ weekStart: '2026-10-05', count: 0, minutes: 0, excludedCount: 7 }));
  assert.doesNotThrow(() => F.profile({ perWeek: 3, asOf: '2026-11-18', validUntil: '2026-11-19', excludedCount: 28 }));
  assert.equal(reconstructFact('Workouts logged on 1 of the 7 days ending 2026-11-17 (400 forgotten days left out)'), null);   // a stored line must be possible too
  assert.equal(reconstructFact('[weekly] Week of 2026-10-05: 3 workouts, 90 min (9 forgotten days left out)'), null);
});

test('a caller cannot claim left-out days it does not name, or name days that are not forgotten', (t) => {
  const s = mk(t);
  const wk = (o) => F.weekly({ weekStart: '2026-10-05', count: 6, minutes: 240, ...o });
  // no day is forgotten at all: a claim of left-out days has nothing behind it
  assert.equal(s.create('rolling', [wk({ excludedCount: 1 })], [ROLL_SRC()]), false);
  assert.match(s.lastError, /without naming them/);
  assert.equal(s.create('rolling', [wk({ excludedDays: ['2026-10-07'] })], [ROLL_SRC()]), false);
  assert.match(s.lastError, /2026-10-07, which is not a forgotten day/);
  assert.equal(s.create('rolling', [wk()], [ROLL_SRC()]), true);                            // no claim, no forgotten day: fine
  assert.equal(forgetFactKey(s, 'daily', '2026-10-07'), true);                              // that week's line goes
  assert.equal(s.view('rolling'), null);                                                    // it was the only line
  assert.equal(s.create('rolling', [wk({ excludedDays: ['2026-10-07'] })], [ROLL_SRC()]), true);   // now the claim is true and named
  assert.equal(s.insert('rolling', F.weekly({ weekStart: '2026-10-12', count: 1, minutes: 30, excludedDays: ['2026-10-14'] }), ROLL_SRC()), false);   // 14 Oct is not forgotten
});
