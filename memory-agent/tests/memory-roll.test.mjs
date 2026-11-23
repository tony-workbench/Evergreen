import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryStore, F, COMPUTED, forgetFactType, forgetFactKey, forgetDerived } from '../src/store/index.mjs';
import { FACT_TYPE_IDS } from '../src/facts/index.mjs';
import { rollDay, NOT_STORED } from '../src/memory/roll.mjs';
import { makeMemoryIO } from './memory-io.mjs';

const USER = `usr_${'c3'.repeat(8)}`;
const snapshot = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/moderate.json', import.meta.url), 'utf8'));
const MIDNIGHT = '2026-11-18T00:00:00-08:00';
const NOON = '2026-11-18T12:00:00-08:00';
const mk = () => {
  const mem = makeMemoryIO();
  return { mem, store: new MemoryStore('/mem', USER, { io: mem.io }) };
};
const roll = (store, now) => rollDay({ store, snapshot: { ...snapshot, exportDate: now }, now });

test('every engine fact id is stored (COMPUTED), replaced by a store sentence, or listed as not stored', () => {
  const replaced = ['history.thin', 'coverage.28d', 'mix.count'];            // the store's Days of data, Workouts logged on, Last 4 weeks by type
  for (const id of FACT_TYPE_IDS) assert.ok(Object.hasOwn(COMPUTED, id) || replaced.includes(id), id);
  for (const id of NOT_STORED) assert.ok(Object.hasOwn(COMPUTED, id), id);
});

test('midnight roll writes rolling and profile; running it twice gives identical files', () => {
  const { mem, store } = mk();
  const first = roll(store, MIDNIGHT);
  assert.deepEqual([first.ok, first.mode, first.day, first.wrote], [true, 'completed', '2026-11-17', ['rolling', 'profile']]);
  const files = mem.dump('/mem');
  assert.deepEqual(roll(store, MIDNIGHT), first);
  assert.deepEqual(mem.dump('/mem'), files);
  assert.match(files[`${USER}/health/rolling.md`], /\n- \[daily\] 2026-11-17: Running 46 min\n/);
});

test('during the day only the raw so-far line changes; twice gives identical files', () => {
  const { mem, store } = mk();
  roll(store, MIDNIGHT);
  const before = mem.dump('/mem');
  const r = roll(store, NOON);
  assert.deepEqual([r.ok, r.mode, r.wrote], [true, 'in_progress', ['rolling']]);
  const after = mem.dump('/mem');
  assert.equal(after[`${USER}/about-user/profile.md`], before[`${USER}/about-user/profile.md`]);
  const rolling = after[`${USER}/health/rolling.md`];
  assert.ok(rolling.includes('- 2026-11-18 has no data so far: 0 of 1 days logged.'));
  assert.ok(!rolling.includes('ratio 1.58'), "yesterday's comparison for the day is replaced");
  roll(store, NOON);
  assert.deepEqual(mem.dump('/mem'), after);
});

test('a stopped fact type and a forgotten mix key are never written again', () => {
  const { mem, store } = mk();
  roll(store, MIDNIGHT);
  assert.equal(forgetFactType(store, 'regularity'), true);
  assert.equal(forgetFactKey(store, 'mix', 'Running'), true);
  assert.equal(forgetFactType(store, 'load'), true);
  assert.equal(roll(store, MIDNIGHT).ok, true);
  const profile = mem.dump('/mem')[`${USER}/about-user/profile.md`];
  assert.ok(!/Days since|Fixed slot|load is/.test(profile), profile);
  assert.match(profile, /Last 4 weeks by type: Cycling 2, HIIT 1, Strength training 4, Walking 4, Yoga 4 \(as of/);
});

test('a forgotten derived file is not written; the other file still is', () => {
  const { mem, store } = mk();
  assert.equal(forgetDerived(store, 'profile'), true);
  assert.deepEqual(roll(store, MIDNIGHT).wrote, ['rolling']);
  assert.equal(mem.exists(`${store.dir}/about-user/profile.md`), false);
});

test('a bad snapshot or time is an error result, and nothing is written', () => {
  const { mem, store } = mk();
  assert.equal(rollDay({ store, snapshot: { ...snapshot, dailySummaries: 'x' }, now: MIDNIGHT }).ok, false);
  assert.equal(rollDay({ store, snapshot, now: 'tomorrow' }).ok, false);
  assert.equal(rollDay({ store, snapshot, now: NOON, mode: 'completed' }).ok, false);
  assert.deepEqual(mem.dump('/mem'), {});
});

test('the store refuses engine-looking text that is not an engine sentence', () => {
  const { store } = mk();
  assert.throws(() => F.computed({ id: 'volume.today', text: 'You should run more today.' }), TypeError);
  assert.throws(() => F.computed({ id: 'history.thin', text: '5 days of data; fewer than 14.' }), TypeError);   // replaced by the store's own sentence
  assert.equal(store.create('rolling', [{ cls: 'fact', kind: 'today', text: 'On 2026-11-17: 1 counted workout (10 minutes or more) and 45.94 workout minutes.', key: 'x' }], []), false);
});

test('"Workouts logged on N of the 28 days" counts days with a counted workout, not days with any record', () => {
  const { store } = mk();
  roll(store, MIDNIGHT);
  const line = /Workouts logged on (\d+) of the 28 days/.exec(store.view('rolling'));
  const days = new Set(snapshot.workouts.filter((w) => w.durationMin >= 10 && w.start.slice(0, 10) >= '2026-10-21' && w.start.slice(0, 10) <= '2026-11-17').map((w) => w.start.slice(0, 10)));
  assert.equal(Number(line[1]), days.size);
  assert.ok(days.size < 28, 'the persona has days with a summary and no workout');
});

test('a week with an unlogged day gets no weekly line; fully logged weeks do', () => {
  const gap = '2026-11-04';
  const holey = { ...snapshot, dailySummaries: snapshot.dailySummaries.filter((s) => s.date !== gap), workouts: snapshot.workouts.filter((w) => w.start.slice(0, 10) !== gap) };
  const { store } = mk();
  assert.equal(rollDay({ store, snapshot: { ...holey, exportDate: MIDNIGHT }, now: MIDNIGHT }).ok, true);
  const rolling = store.view('rolling');
  assert.ok(!rolling.includes('Week of 2026-11-02'), 'the week with the gap');
  assert.ok(rolling.includes('Week of 2026-10-26') && rolling.includes('Week of 2026-11-09'));
});
