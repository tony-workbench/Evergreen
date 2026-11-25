import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, replan, WEEK, day, date, get, overlaps, after } from './helpers.mjs';

const ids = (r) => r.proposed.map((p) => p.id);
const drag = (p, id, start, more) => replan(p, { type: 'drag', id, start }, more);
const answer = (p, answerId, more) => replan(p, { type: 'answer', answerId }, more);
const text = (p, t, more) => replan(p, { type: 'text', text: t }, more);
const EMPTY = { ok: true, kind: 'none', message: '', proposed: [], undoToken: 'u-0', state: {} };

test('a drag moves that one block; the rest of the week stays', () => {
  const first = plan('yoga tomorrow morning');
  const r = drag(first, 'new-1', day(1, '09', '07'));
  assert.deepEqual([r.kind, ids(r), r.proposed[0].start, r.proposed[0].status, r.proposed[0].reason], ['add', ['new-1'], day(1, '09'), 'new', 'Moved by you.']);
  assert.equal(r.replaces, first.undoToken);
  const w = drag(EMPTY, 'w1', day(2, '08'));
  assert.deepEqual([w.kind, ids(w), get(w, 'w1').status, get(w, 'w1').start, get(w, 'w1').end], ['move', ['w1'], 'moved', day(2, '08'), day(2, '08', '45')]);
  // Dragged back to where it was, nothing is proposed any more.
  assert.deepEqual(drag(w, 'w1', day(1, '18')).proposed, []);
});

test('a drag onto a fixed event lands on the next free time after it', () => {
  const r = drag(EMPTY, 'w1', day(1, '14', '30'));
  assert.deepEqual([get(r, 'w1').start, get(r, 'w1').reason], [day(1, '15'), 'Client call is at that time, so this is the next free time after it.']);
  for (const e of WEEK.events) assert.ok(!overlaps(get(r, 'w1'), e));
});

test('a drag onto another workout re-plans only that workout', () => {
  const r = drag(EMPTY, 'w1', day(3, '06', '45'));
  assert.deepEqual(ids(r), ['w1', 'w2']);
  assert.deepEqual([get(r, 'w1').start, get(r, 'w2').status, get(r, 'w2').start, get(r, 'w2').reason], [day(3, '06', '45'), 'moved', day(3, '08'), 'Moved to make room for Run.']);
  const week = after(r);
  for (const a of week) for (const b of week) assert.ok(a.id === b.id || !overlaps(a, b));
  for (const e of WEEK.events) assert.ok(!overlaps(get(r, 'w2'), e));
});

// Ported from Plan Calendar's demo: a small drag moves nothing else, a drag onto the next step moves only the later steps.
test('in a race plan a drag re-plans only the steps after it', () => {
  const race = plan('My race is on the 29th'), [s1, s2, s3] = race.proposed;
  const small = drag(race, 'race-1', '2026-11-21T09:00:00-08:00');
  assert.deepEqual([small.kind, small.proposed[0].start, small.proposed[1].start, small.proposed[2].start], ['race', '2026-11-21T09:00:00-08:00', s2.start, s3.start]);
  const big = drag(race, 'race-1', s2.start);
  assert.equal(get(big, 'race-1').start, s2.start);
  assert.ok(Date.parse(get(big, 'race-2').start) >= Date.parse(get(big, 'race-1').end));
  assert.equal(get(big, 'race-2').reason, 'Moved to stay after Last long run.');
  assert.equal(get(big, 'race-3').start, s3.start);
  assert.equal(get(big, 'race-rest').start, get(race, 'race-rest').start);
  const mid = drag(race, 'race-2', s3.start);
  assert.equal(get(mid, 'race-1').start, s1.start);
  assert.ok(Date.parse(get(mid, 'race-3').start) >= Date.parse(get(mid, 'race-2').end));
  assert.ok(get(mid, 'race-3').end <= '2026-11-28T00:00:00-08:00');
  const late = drag(race, 'race-3', '2026-11-28T10:00:00-08:00');
  assert.deepEqual([late.proposed.map((p) => p.start), late.message], [race.proposed.map((p) => p.start), 'Easy run has to end before the rest day.']);
});

// The app says these three belong together (new shoes: a break-in run, a tempo run, then the long run).
const SHOES = { workouts: [
  { id: 'a', activity: 'Running', title: 'Break-in run', start: day(1, '18'), end: day(1, '18', '30'), group: 'shoes' },
  { id: 'b', activity: 'Running', title: 'Tempo run', start: day(3, '18'), end: day(3, '18', '30'), group: 'shoes' },
  { id: 'c', activity: 'Running', title: 'Long run', start: day(5, '09'), end: day(5, '10', '30'), group: 'shoes' },
  { id: 'd', activity: 'Yoga', title: 'Yoga', start: day(2, '07'), end: day(2, '07', '30') },
] };

test('related items: one merged question with three answers', () => {
  const q = drag(EMPTY, 'a', day(2, '18'), SHOES);
  assert.equal(q.kind, 'question');
  assert.deepEqual(ids(q), ['a']);
  assert.equal(q.question.text, 'Break-in run, Tempo run and Long run are part of the same plan. Move them together?');
  assert.deepEqual(q.question.answers, [{ id: 'all', label: 'Move all' }, { id: 'only:b', label: 'Only Tempo run' }, { id: 'none', label: 'No, just this one' }]);
  // The same question from a sentence.
  const said = plan("move tomorrow's run to Wednesday", SHOES);
  assert.deepEqual([said.kind, said.question.text, get(said, 'a').start], ['question', q.question.text, day(2, '18')]);

  const all = answer(q, 'all', SHOES);
  assert.deepEqual([all.kind, all.question, ids(all)], ['move', undefined, ['a', 'b', 'c']]);
  assert.deepEqual([get(all, 'b').start, get(all, 'c').start, get(all, 'c').reason], [day(4, '18'), day(6, '09'), 'Moved together with Break-in run, as you confirmed.']);

  const only = answer(q, 'only:b', SHOES);
  assert.deepEqual([ids(only), get(only, 'b').start], [['a', 'b'], day(4, '18')]);
  // The one left out counts as refused: dragging again does not ask about it.
  assert.equal(drag(only, 'a', day(2, '20', '30'), SHOES).question.text, 'Break-in run and Tempo run are part of the same plan. Move them together?');

  const no = answer(q, 'none', SHOES);
  assert.deepEqual([no.kind, ids(no), no.question, no.message], ['move', ['a'], undefined, 'Okay, I left the other workouts where they are.']);
  assert.throws(() => assert.equal(answer(q, 'maybe', SHOES).ok, true));
  assert.equal(answer(no, 'all', SHOES).message, 'There is no open question.');
});

test('a refusal is remembered: later changes do not ask again, also in a new plan', () => {
  const q = drag(EMPTY, 'a', day(2, '18'), SHOES), no = answer(q, 'none', SHOES);
  const again = drag(no, 'a', day(2, '19', '30'), SHOES);
  assert.deepEqual([again.kind, again.question, ids(again)], ['move', undefined, ['a']]);
  assert.equal(drag(again, 'b', day(4, '18'), SHOES).question, undefined);
  assert.equal(text(no, "move Saturday's long run to the afternoon", SHOES).question, undefined);
  // The app keeps state.declined and hands it back as memory.declined.
  assert.deepEqual([...no.state.declined].sort(), ['a', 'b', 'c']);
  const fresh = plan("move tomorrow's run to Wednesday", { ...SHOES, memory: { declined: no.state.declined } });
  assert.deepEqual([fresh.kind, fresh.question], ['move', undefined]);
});

test('a question left open counts as refused once another change comes; the same drag again keeps it', () => {
  const q = drag(EMPTY, 'a', day(2, '18'), SHOES);
  const nudge = drag(q, 'a', day(2, '20', '30'), SHOES);
  assert.equal(nudge.kind, 'question');
  const all = answer(nudge, 'all', SHOES);
  assert.deepEqual([get(all, 'b').start, get(all, 'c').start], [day(4, '20', '30'), day(6, '11', '30')]);
  const other = drag(q, 'd', day(2, '08'), SHOES);
  assert.deepEqual([other.question, ids(other)], [undefined, ['d', 'a']]);
  assert.equal(drag(other, 'a', day(2, '19', '30'), SHOES).question, undefined);
});

test('a strength session moved next to a long run asks once; unrelated workouts never move', () => {
  const q = plan("Move Thursday's strength to Saturday");
  assert.deepEqual([q.kind, ids(q), q.question.text], ['question', ['w2'], 'Strength now lands next to Long run. Move them together?']);
  assert.deepEqual(q.question.answers, [{ id: 'all', label: 'Yes, move Long run too' }, { id: 'none', label: 'No, just this one' }]);
  const yes = answer(q, 'all');
  assert.deepEqual([ids(yes), date(get(yes, 'w3').start)], [['w2', 'w3'], '2026-11-17']);
  assert.deepEqual(ids(answer(q, 'none')), ['w2']);
  // Not next to the long run: no question.
  assert.equal(plan("Move Thursday's strength to Friday").kind, 'move');
  // The long run moved onto the strength day asks the other way round.
  assert.equal(plan("move Sunday's long run to Thursday afternoon").question.text, 'Long run now lands next to Strength. Move them together?');
});

test('a follow-up sentence changes the plan on screen', () => {
  const first = plan('long run Saturday morning');
  const shorter = text(first, 'make it an hour');
  assert.deepEqual([shorter.kind, ids(shorter), shorter.proposed[0].minutes, shorter.proposed[0].status, shorter.proposed[0].start], ['add', ['new-1'], 60, 'new', day(5, '06')]);
  const moved = text(shorter, 'move it to Sunday afternoon');
  assert.deepEqual([moved.kind, moved.proposed[0].start, moved.proposed[0].minutes], ['add', day(6, '13'), 60]);
  const more = text(moved, 'also add yoga on Friday morning');
  assert.deepEqual([more.kind, ids(more)], ['add', ['new-2', 'new-1']]);
  const less = text(more, 'skip the yoga');
  assert.deepEqual(ids(less), ['new-1']);
  const mixed = text(less, "skip Thursday's strength");
  assert.deepEqual([mixed.kind, ids(mixed), get(mixed, 'w2').status], ['cancel', ['w2', 'new-1'], 'cancelled']);
  // A cancelled workout no longer takes room.
  const reuse = text(mixed, 'find me 40 minutes for a swim on Thursday at 7');
  assert.equal(get(reuse, 'new-2').start, day(3, '07'));
});

test('a follow-up that is not a request changes nothing', () => {
  const first = plan('long run Saturday morning');
  const r = text(first, 'thanks, looks good');
  assert.deepEqual([r.ok, r.kind, r.proposed, r.question], [true, 'none', first.proposed, undefined]);
  const back = text(r, 'not that early');
  assert.deepEqual([back.kind, back.proposed[0].start], ['add', day(5, '09')]);
});

test('a new race date re-plans the race, and the other proposals stay', () => {
  const race = plan('my race is on the 29th'), plus = text(race, 'add a swim tomorrow at 7');
  assert.deepEqual(ids(plus), ['new-1', 'race-1', 'race-2', 'race-3', 'race-rest']);
  const later = text(plus, 'the race is actually on December 6th');
  assert.deepEqual([later.kind, ids(later), date(get(later, 'race-rest').start)], ['race', ['new-1', 'race-1', 'race-2', 'race-3', 'race-rest'], '2026-12-05']);
  assert.ok(date(get(later, 'race-1').start) >= '2026-11-28');
});

test('the engine only proposes: workouts come back as they went in unless the proposal names them', () => {
  const r = plan("skip Thursday's strength");
  assert.deepEqual(after(r).map((x) => x.id), ['w1', 'w3']);
  const again = plan('find me 40 minutes for a swim on Thursday at 7');
  assert.equal(again.proposed[0].start, day(3, '08')); // the skip was never confirmed, so 07:00 is still taken
});
