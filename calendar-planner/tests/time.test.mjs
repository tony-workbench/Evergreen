import test from 'node:test';
import assert from 'node:assert/strict';
import { makeZone, offsetOf } from '../src/planner/time.mjs';
import { plan, date, hm } from './helpers.mjs';

test('the offset is read from tzOffsetMinutes, or from `now` when it is missing', () => {
  assert.equal(offsetOf('2026-11-09T09:00:00-08:00'), -480);
  assert.equal(offsetOf('2026-11-09T09:00:00+05:30'), 330);
  assert.equal(offsetOf('2026-11-09T17:00:00Z'), 0);
  const r = plan('yoga tomorrow morning', { now: '2026-11-09T09:00:00+05:30', tzOffsetMinutes: undefined, events: [], workouts: [] });
  assert.equal(r.proposed[0].start, '2026-11-10T06:00:00+05:30');
  assert.equal(r.proposed[0].end, '2026-11-10T06:30:00+05:30');
});

test('wall time goes in and out without losing the instant', () => {
  const z = makeZone({ now: '2026-11-09T09:00:00-08:00', tzOffsetMinutes: -480 });
  assert.equal(z.wall('2026-11-09T17:00:00Z'), '2026-11-09T09:00:00.000Z');
  assert.equal(z.local(z.wall('2026-11-10T01:30:00Z')), '2026-11-09T17:30:00-08:00');
  assert.throws(() => makeZone({ now: 'soon' }), { code: 'BadNow' });
});

test('clocks going back: a plan for the next morning carries the new offset', () => {
  // US Pacific leaves daylight time on Sunday 1 November 2026 at 09:00 UTC.
  const zone = { now: '2026-10-31T10:00:00-07:00', tzOffsetMinutes: -420, tzChanges: [{ at: '2026-11-01T09:00:00Z', tzOffsetMinutes: -480 }] };
  const events = [{ id: 'e', title: 'Brunch', start: '2026-11-01T06:00:00-08:00', end: '2026-11-01T07:00:00-08:00', fixed: true }];
  const today = plan('walk tonight', { ...zone, events, workouts: [] });
  assert.equal(today.proposed[0].start, '2026-10-31T17:00:00-07:00');
  const sunday = plan('long run tomorrow morning', { ...zone, events, workouts: [] });
  // 06:00 is taken by brunch (given in the new offset), 07:00 would run into breakfast, so 08:00 local.
  assert.equal(sunday.proposed[0].start, '2026-11-01T08:00:00-08:00');
  assert.equal(sunday.proposed[0].end, '2026-11-01T09:30:00-08:00');
  const named = plan('swim on Sunday at 7', { ...zone, events: [], workouts: [] });
  assert.equal(named.proposed[0].start, '2026-11-01T07:00:00-08:00');
  // Without tzChanges the offset stays what it was at `now`.
  const flat = plan('swim on Sunday at 7', { now: zone.now, tzOffsetMinutes: -420, events: [], workouts: [] });
  assert.equal(flat.proposed[0].start, '2026-11-01T07:00:00-07:00');
});

test('clocks going forward: the next morning is one hour closer in real time', () => {
  // US Pacific enters daylight time on Sunday 14 March 2027 at 10:00 UTC.
  const zone = { now: '2027-03-13T10:00:00-08:00', tzOffsetMinutes: -480, tzChanges: [{ at: '2027-03-14T10:00:00Z', tzOffsetMinutes: -420 }] };
  const r = plan('run tomorrow at 7', { ...zone, events: [], workouts: [] });
  assert.equal(r.proposed[0].start, '2027-03-14T07:00:00-07:00');
  assert.equal(Date.parse(r.proposed[0].start) - Date.parse(zone.now), 20 * 3600000);
  const monday = plan('yoga on Monday morning', { ...zone, events: [], workouts: [] });
  assert.equal(monday.proposed[0].start, '2027-03-15T06:00:00-07:00');
});

test('near midnight the day is the local day, not the UTC day', () => {
  // 23:50 on Monday in UTC-8 is already Tuesday in UTC.
  const late = { now: '2026-11-09T23:50:00-08:00', tzOffsetMinutes: -480, events: [], workouts: [] };
  assert.equal(plan('yoga tomorrow morning', late).proposed[0].start, '2026-11-10T06:00:00-08:00');
  assert.equal(date(plan('run on Tuesday', late).proposed[0].start), '2026-11-10');
  const tonight = plan('walk tonight', late);
  assert.equal(tonight.proposed[0].start, '2026-11-10T06:00:00-08:00');
  assert.match(tonight.message, /Nothing fits at that time/);
  // 00:10 on Tuesday in UTC+9 is still Monday in UTC.
  const early = { now: '2026-11-10T00:10:00+09:00', tzOffsetMinutes: 540, events: [], workouts: [] };
  const today = plan('find me a 30 minute run today after 6', early);
  assert.equal(today.proposed[0].start, '2026-11-10T18:00:00+09:00');
  assert.equal(date(plan('my race is on Sunday', early).proposed.at(-1).start), '2026-11-14');
  assert.equal(hm(plan('stretch before work', early).proposed[0].start), '06:00');
});
