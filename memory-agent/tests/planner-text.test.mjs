import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, F, S } from '../src/store/index.mjs';
import { plannerText, MAX_WORDS, DAILY_SHOWN, WEEKLY_SHOWN } from '../src/memory/planner-text.mjs';
import { makeMemoryIO } from './memory-io.mjs';

const USER = `usr_${'b2'.repeat(8)}`;
const AT = '2026-11-18T08:00:00.000Z';
const mk = () => {
  const mem = makeMemoryIO();
  return { mem, store: new MemoryStore('/mem', USER, { io: mem.io }) };
};
const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString().slice(0, 10);
const monday = (n) => new Date(Date.UTC(2026, 6, 6) + n * 7 * 86400000).toISOString().slice(0, 10);   // 2026-07-06 is a Monday
const WORDS = (t) => t.split(/\s+/).filter(Boolean).length;

/** A rolling file with 28 daily and 12 weekly lines, plus a profile with `slots` fixed-slot lines. */
function fill(store, slots) {
  const daily = Array.from({ length: 28 }, (_, i) => F.daily({ date: day(i), items: [{ activity: 'Running', minutes: 30 + i }] }));
  const weekly = Array.from({ length: 12 }, (_, i) => F.weekly({ weekStart: monday(i), count: 3, minutes: 120 }));
  assert.equal(store.create('rolling', [...daily, ...weekly], [S.roll({ date: '2026-10-28', at: AT })]), true);
  const acts = ['running', 'walking', 'cycling', 'hiking'];
  const slotFacts = Array.from({ length: slots }, (_, i) => {
    const [a, wd, h] = [acts[i % 4], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i % 7], String(6 + (i % 10)).padStart(2, '0')];
    return F.computed({ id: `regularity.slot.${a}.${wd}.${h}`, text: `Fixed slot among recognised activities: ${a} on ${wd} between ${h}:00 and ${String(Number(h) + 1).padStart(2, '0')}:00, in 3 of the last 4 weeks.` });
  });
  assert.equal(store.create('profile', [F.profile({ perWeek: 3, asOf: '2026-10-28', validUntil: '2026-10-29' }), ...slotFacts], []), true);
}

test('compact view: pinned files, 12 weekly, latest 7 daily, a count line, and only path and count for the other files', () => {
  const { store } = mk();
  fill(store, 0);
  store.create('feedback', [F.accept({ recId: 'rec_00000001', activity: 'run', weekday: 3, hour: 7 })], [S.accept({ recId: 'rec_00000001', at: AT })]);
  const p = plannerText(store);
  assert.equal(p.ok, true);
  const lines = p.text.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('- [daily]')).length, DAILY_SHOWN);
  assert.equal(lines.filter((l) => l.startsWith('- [weekly]')).length, WEEKLY_SHOWN);
  assert.ok(lines.includes('- health/rolling.md: 21 earlier daily lines and 0 earlier weekly lines not shown'));
  assert.ok(lines.includes('- feedback/recommendations.md: 1 facts'));
  assert.ok(!p.text.includes('Accepted 1'), 'feedback is a count only');
  assert.ok(lines.includes(`- [daily] ${day(27)}: Running 57 min`) && !lines.some((l) => l.includes(`[daily] ${day(20)}:`)), 'the latest days, not the oldest');
  assert.deepEqual(p.leftOut, { daily: 21, weekly: 0 });
  assert.equal(p.words, WORDS(p.text));
});

test('the same store gives the same text', () => {
  const a = mk(); const b = mk();
  fill(a.store, 3); fill(b.store, 3);
  assert.equal(plannerText(a.store).text, plannerText(b.store).text);
});

test('over 600 words: the oldest daily lines go first, then the oldest weekly lines, and the text says how many', () => {
  const { store } = mk();
  fill(store, 26);                                         // 26 slot lines make the pinned part long
  const p = plannerText(store);
  assert.equal(p.ok, true, p.error);
  assert.ok(p.words <= MAX_WORDS, `${p.words} words`);
  assert.ok(p.leftOut.daily > 21, 'every daily line the cap would show was dropped too');
  assert.ok(p.leftOut.weekly > 0, 'weekly lines were dropped after the daily ones');
  assert.ok(p.text.includes(`${p.leftOut.daily} earlier daily lines and ${p.leftOut.weekly} earlier weekly lines not shown`));
  assert.ok(!p.text.includes(`[weekly] Week of ${monday(0)}`), 'the oldest weekly line is gone');
  assert.ok(p.text.includes(`[weekly] Week of ${monday(11)}`), 'the newest weekly line stays');
});

test('too long even without rolling lines: an error and no text', () => {
  const { store } = mk();
  fill(store, 40);
  const p = plannerText(store);
  assert.equal(p.ok, false);
  assert.equal(Object.hasOwn(p, 'text'), false);
  assert.match(p.error, /too long/);
});

test('an invalid file gives an error and no text', () => {
  const { mem, store } = mk();
  fill(store, 0);
  mem.plant(`${store.dir}/health/rolling.md`, 'not a memory file\n');
  const p = plannerText(store);
  assert.equal(p.ok, false);
  assert.equal(Object.hasOwn(p, 'text'), false);
  assert.equal(p.error, 'MemoryUnavailableError');
});

test('a pending journal that cannot be completed gives an error and no text', () => {
  const { mem, store } = mk();
  fill(store, 0);
  mem.plant(`${store.dir}/journal.json`, '{"op":"forget_recommendation"}\n');
  const p = plannerText(store);
  assert.equal(p.ok, false);
  assert.equal(Object.hasOwn(p, 'text'), false);
});

test('an empty memory gives a header only', () => {
  const p = plannerText(mk().store);
  assert.deepEqual([p.ok, p.text], [true, 'Memory facts (counts and dates only)']);
});
