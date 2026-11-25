// Every fixture is checked against the schema its name starts with: fixtures/valid must fit, fixtures/invalid must not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SCHEMAS, validateAs, explain, sessionToIntent, rowsToCalendarMemory, outcomesFor, keysToReject, rowsToStopped } from '../src/index.mjs';

const dir = (path) => new URL(`../${path}/`, import.meta.url);
const read = (url) => JSON.parse(readFileSync(url, 'utf8'));
const names = Object.keys(SCHEMAS);

test('src/schemas.mjs is the same as schemas/*.schema.json', () => {
  const files = readdirSync(dir('schemas')).filter((f) => f.endsWith('.schema.json'));
  assert.deepEqual(files.map((f) => f.replace('.schema.json', '')).sort(), [...names].sort());
  for (const f of files) assert.deepEqual(SCHEMAS[f.replace('.schema.json', '')], read(new URL(f, dir('schemas'))), `${f}: run node scripts/generate.mjs`);
});

for (const group of readdirSync(dir('fixtures/valid'))) {
  test(`valid: ${group}`, async (t) => {
    const files = readdirSync(dir(`fixtures/valid/${group}`));
    if (group !== 'kinds') assert.deepEqual(names.filter((n) => !files.includes(`${n}.json`)), [], 'a person has one example of every value');
    for (const f of files) {
      await t.test(f, () => {
        const r = validateAs(f.split('.')[0], read(new URL(f, dir(`fixtures/valid/${group}`))));
        assert.ok(r.ok, explain(r).join('; '));
      });
    }
  });
}

for (const name of names) {
  test(`invalid: ${name}`, async (t) => {
    const files = readdirSync(dir(`fixtures/invalid/${name}`));
    assert.ok(files.length >= 3, 'each schema has invalid examples');
    for (const f of files) {
      await t.test(f.replace('.json', '').replaceAll('-', ' '), () => {
        const r = validateAs(name, read(new URL(f, dir(`fixtures/invalid/${name}`))));
        assert.equal(r.ok, false, `${name} accepted ${f}`);
        assert.ok(r.errors.every((e) => e.path && e.message), 'every error says where and what');
      });
    }
  });
}

test('fixtures/swift has one list per value type and every item fits', () => {
  const files = readdirSync(dir('fixtures/swift'));
  assert.deepEqual(files.sort(), [...names.map((n) => `${n}.json`), 'handoffs.json'].sort());
  for (const name of names) {
    const list = read(new URL(`${name}.json`, dir('fixtures/swift')));
    assert.ok(Array.isArray(list) && list.length >= 3, `${name}.json is a list with an example for each person`);
    for (const value of list) { const r = validateAs(name, value); assert.ok(r.ok, `${name}.json: ${explain(r).join('; ')}`); }
  }
});

test('the memory-row schema has a data shape for every kind, and every kind has a valid example', () => {
  const kinds = SCHEMAS['memory-row'].properties.kind.enum;
  assert.deepEqual(SCHEMAS['memory-row'].oneOf.map((v) => v.properties.kind.const), kinds);
  const seen = new Set();
  for (const group of readdirSync(dir('fixtures/valid'))) for (const f of readdirSync(dir(`fixtures/valid/${group}`))) {
    const v = read(new URL(f, dir(`fixtures/valid/${group}`)));
    if (f.startsWith('memory-row')) seen.add(v.kind);
    if (f === 'memory-table.json') for (const r of v.rows) seen.add(r.kind);
  }
  assert.deepEqual(kinds.filter((k) => !seen.has(k)), []);
});

for (const f of readdirSync(dir('fixtures/handoffs'))) {
  test(`hand-offs: ${f.replace('.json', '')} gives the recorded results`, () => {
    const h = read(new URL(f, dir('fixtures/handoffs')));
    assert.deepEqual(sessionToIntent(h.sessionToIntent.session, h.rowsToCalendarMemory.rows), h.sessionToIntent.intent);
    assert.deepEqual(rowsToCalendarMemory(h.rowsToCalendarMemory.rows), h.rowsToCalendarMemory.memory);
    assert.deepEqual(keysToReject(h.keysToReject.session, h.keysToReject.rows), h.keysToReject.keys);
    assert.equal(h.keysToReject.keys.length, 1);
    assert.deepEqual(rowsToStopped(h.rowsToStopped.rows), h.rowsToStopped.stopped);
    assert.ok(h.keysToReject.session.basedOn.length > 1, 'the declined session cites more than the row that is rejected');
    const o = h.outcomesFor;
    assert.deepEqual(o.days.flatMap((day) => outcomesFor(o.planRecords, o.healthWorkouts, day)), o.outcomes);
  });
}

test('hand-offs: the edges', () => {
  const session = { id: 's1', day: '2026-11-14', start: '2026-11-14T00:00:00-08:00', minutes: 0, activity: 'rest', intensity: 'easy', reason: 'Rest.', basedOn: ['a', 'b', 'a'] };
  assert.deepEqual(sessionToIntent(session), { kind: 'add', activity: 'rest', sessionId: 's1', day: '2026-11-14' });
  // "Not now" on a Sunday 07:00 long run: only the usual time with that activity, weekday and hour goes.
  const slot = (key, activity, weekday, hour) => ({ key, kind: 'usual_slot', state: 'saved', data: { activity, weekday, hour, minutes: 90, weeksSeen: 3, weeksTotal: 4 } });
  const sunday = { id: 's9', day: '2026-11-15', start: '2026-11-15T07:30:00-08:00', minutes: 90, activity: 'long_run', intensity: 'steady', reason: 'Usual.', basedOn: ['vol', 'sleep', 'k1', 'k2'] };
  const table = [slot('k1', 'long_run', 6, 7), slot('k2', 'run', 6, 7), slot('k3', 'long_run', 5, 7), slot('k4', 'long_run', 6, 8), { key: 'vol', kind: 'weekly_volume', state: 'saved', data: {} }, { key: 'sleep', kind: 'sleep', state: 'saved', data: {} }];
  assert.deepEqual(keysToReject(sunday, table), ['k1']);
  assert.deepEqual(keysToReject({ ...sunday, start: '2026-11-15T09:00:00-08:00' }, table), [], 'a session moved off the usual hour rejects nothing');
  assert.deepEqual(keysToReject(sunday, []), []);
  assert.deepEqual(keysToReject(session, table), []);
  const rowing = { ...session, id: 's2', minutes: 40, activity: 'other', start: '2026-11-14T19:00:00-08:00' }, label = 'Rowing on the machine at the gym with the long name that goes past sixty';
  assert.deepEqual(sessionToIntent(rowing, [{ key: 'a', data: {} }, { key: 'b', data: { label } }]), { kind: 'add', activity: 'other', title: label.slice(0, 60), minutes: 40, sessionId: 's2', day: '2026-11-14', after: '19:00', exact: true });
  assert.deepEqual(sessionToIntent(rowing), { kind: 'add', activity: 'other', minutes: 40, sessionId: 's2', day: '2026-11-14', after: '19:00', exact: true });
  assert.equal(sessionToIntent({ ...rowing, activity: 'run' }, [{ key: 'b', data: { label } }]).title, undefined);
  const row = (state, key = 'opaque') => ({ key, kind: 'usual_slot', state, data: { activity: 'long_run', weekday: 6, hour: 7, minutes: 90, weeksSeen: 3, weeksTotal: 4 } });
  assert.deepEqual(rowsToCalendarMemory([row('saved'), row('confirmed', 'x'), row('rejected', 'y'), row('candidate', 'z'), { key: 'k', kind: 'sleep', state: 'saved', data: {} }]), { slots: [{ key: 'opaque', activity: 'long_run', weekday: 6, hour: 7, minutes: 90 }, { key: 'x', activity: 'long_run', weekday: 6, hour: 7, minutes: 90 }] });
  // One Health run cannot count for two planned runs; the nearest start wins; a rest record gives no outcome; other days are left out.
  const records = [
    { sessionId: 'am', day: '2026-11-10', activity: 'run', plannedStart: '2026-11-10T07:00:00-08:00' },
    { sessionId: 'pm', day: '2026-11-10', activity: 'long_run', plannedStart: '2026-11-10T18:00:00-08:00' },
    { sessionId: 'off', day: '2026-11-10', activity: 'rest', plannedStart: '2026-11-10T00:00:00-08:00' },
    { sessionId: 'later', day: '2026-11-11', activity: 'run', plannedStart: '2026-11-11T07:00:00-08:00' },
  ];
  const health = [{ activityType: 'Running', start: '2026-11-10T18:20:10.216112-08:00', durationMin: 61.4 }, { activityType: 'Yoga', start: '2026-11-10T07:00:00-08:00', durationMin: 30 }];
  assert.deepEqual(outcomesFor(records, health, '2026-11-10'), [
    { sessionId: 'am', day: '2026-11-10', activity: 'run', plannedStart: '2026-11-10T07:00:00-08:00', done: false },
    { sessionId: 'pm', day: '2026-11-10', activity: 'long_run', plannedStart: '2026-11-10T18:00:00-08:00', done: true, actualStart: '2026-11-10T18:20:10.216-08:00', actualMinutes: 61 },
  ]);
});
