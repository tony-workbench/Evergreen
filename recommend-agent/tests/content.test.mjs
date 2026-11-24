// What goes into a home session: the movement library's shape and words, the chains, the session that fits the
// person's minutes and equipment, the week's floor of sets, and each checkContent code failing when it should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVEMENTS, movementOf, chainOf, workoutContent, weekContent, checkContent, movementLibrary, feelingWordsIn, mastered,
  sessionMinutes, setsByPattern, MAIN_PATTERNS, WEEK_FLOOR_SETS, LOAD_MAX_KG } from '../src/content.mjs';
import { EQUIPMENT, ALWAYS_THERE } from '../src/rules.mjs';

const ALL = ['backpack', 'chair', 'table', 'sofa', 'book', 'step'];
const rules = (over = {}) => ({ equipment: ALL, ...over });
const codes = (r) => r.violations.map((v) => v.code);
const allTop = (id, day, load) => { const m = movementOf(id); const top = (m.dose.reps ?? m.dose.seconds)[1]; return { movementId: id, day, sets: Array(m.dose.sets).fill(top), ...(load ? { load } : {}) }; };

test('every movement has the words the workout page shows, and none of them points outside', () => {
  const ids = new Set();
  for (const m of MOVEMENTS) {
    assert.match(m.id, /^[a-z0-9_]{1,48}$/, m.id);
    assert.ok(!ids.has(m.id), `${m.id} twice`); ids.add(m.id);
    for (const key of ['name', 'setup', 'feel', 'pass']) assert.ok(typeof m[key] === 'string' && m[key].length > 0, `${m.id}.${key}`);
    assert.ok(m.steps.length >= 1 && m.steps.length <= 4, `${m.id} steps`);
    assert.equal(m.mistakes.length, 2, `${m.id} mistakes`);
    assert.ok(m.equipment.every((e) => EQUIPMENT.includes(e)), `${m.id} equipment`);
    assert.ok(Boolean(m.dose.reps) !== Boolean(m.dose.seconds), `${m.id} dose is reps or seconds`);
    assert.deepEqual(m.images, [], `${m.id} has no pictures yet`);
    assert.doesNotMatch(JSON.stringify(m), /https?:|www\./i, m.id);
  }
});

test('a movement passes on something seen or counted, never on a feeling', () => {
  for (const m of MOVEMENTS) assert.deepEqual(feelingWordsIn(m.pass), [], `${m.id}: ${m.pass}`);
  assert.deepEqual(feelingWordsIn('You feel it in your thighs.'), ['feel']);
  assert.deepEqual(feelingWordsIn('大腿有点酸'), ['酸']);
});

test('easier and harder link both ways, and each chain starts at a movement anyone can do', () => {
  for (const m of MOVEMENTS) {
    if (m.harder) assert.equal(movementOf(m.harder).easier, m.id, `${m.id} -> ${m.harder}`);
    if (m.easier) assert.equal(movementOf(m.easier).harder, m.id, `${m.easier} -> ${m.id}`);
    assert.equal(movementOf(chainOf(m.id)).entry, true, `${m.id}'s chain starts at an entry movement`);
  }
  assert.equal(movementLibrary().movements.length, MOVEMENTS.length);
});

test('a first session uses only the first movement of each chain, and fits the person\'s minutes', () => {
  for (const focus of ['full', 'lower', 'upper', 'full_lower', 'full_upper']) {
    const { content } = workoutContent({ sessionId: 's1', focus, minutes: 25, rules: rules() });
    assert.ok(content.items.length >= 3, focus);
    assert.ok(content.minutes <= 25, `${focus} takes ${content.minutes}`);
    assert.equal(content.minutes, sessionMinutes(content.items));
    for (const i of content.items) assert.equal(movementOf(i.movementId).entry, true, `${focus}: ${i.movementId}`);
    assert.equal(content.items.filter((i) => i.isNew).length, 0);
  }
});

test('the shorter the session, the fewer movements or sets, never longer than asked', () => {
  const long = workoutContent({ sessionId: 's', focus: 'full', minutes: 40, rules: rules() }).content;
  const short = workoutContent({ sessionId: 's', focus: 'full', minutes: 12, rules: rules() }).content;
  assert.ok(short.minutes <= 12 || short.items.every((i) => i.sets === 1), `${short.minutes} minutes`);
  assert.ok(short.items.reduce((n, i) => n + i.sets, 0) < long.items.reduce((n, i) => n + i.sets, 0));
});

test('without the equipment, a chain starts further on or another stands in', () => {
  const { content } = workoutContent({ sessionId: 's', focus: 'full', rules: rules({ equipment: [] }) });
  // Only what every home has: a floor and a wall.
  for (const i of content.items) assert.ok(movementOf(i.movementId).equipment.every((e) => ALWAYS_THERE.includes(e)), i.movementId);
  assert.ok(content.items.some((i) => i.movementId === 'bodyweight_squat'));
});

test('two sessions at the top of the range earn the next movement up, one new movement at a time', () => {
  const history = [allTop('sit_to_stand', '2026-11-20'), allTop('sit_to_stand', '2026-11-23'), allTop('wall_push_up', '2026-11-20'), allTop('wall_push_up', '2026-11-23')];
  assert.ok(mastered(history, 'sit_to_stand'));
  const { content } = workoutContent({ sessionId: 's', focus: 'full', rules: rules(), history });
  const ids = content.items.map((i) => i.movementId);
  assert.equal(content.items.filter((i) => i.isNew).length, 1);
  assert.ok(ids.includes('bodyweight_squat'), ids.join());
  assert.ok(ids.includes('wall_push_up'), 'the second step up waits for the next session');
});

test('"I can do this" skips the wait, "can\'t do" and the avoid list stop the chain', () => {
  const can = workoutContent({ sessionId: 's', focus: 'upper', rules: rules({ movements: { knee_push_up: 'can', table_push_up: 'can' } }) }).content;
  assert.ok(can.items.some((i) => i.movementId === 'knee_push_up'));
  const cannot = workoutContent({ sessionId: 's', focus: 'lower', rules: rules({ movements: { sit_to_stand: 'cannot' } }) }).content;
  assert.ok(!cannot.items.some((i) => chainOf(i.movementId) === 'sit_to_stand'));
  const avoided = workoutContent({ sessionId: 's', focus: 'upper', rules: rules({ avoid: ['wall_push_up'] }) }).content;
  assert.ok(!avoided.items.some((i) => chainOf(i.movementId) === 'wall_push_up'));
});

test('a backpack movement done at the top twice gets one more kilogram, up to what a backpack holds', () => {
  const history = [allTop('backpack_row', '2026-11-20', 4), allTop('backpack_row', '2026-11-23', 4)];
  const row = workoutContent({ sessionId: 's', focus: 'upper', rules: rules(), history }).content.items.find((i) => i.movementId === 'backpack_row');
  assert.ok(row, 'still rowing: one_arm_row waits');
  const heavy = [allTop('backpack_press', '2026-11-20', LOAD_MAX_KG), allTop('backpack_press', '2026-11-23', LOAD_MAX_KG)];
  const press = workoutContent({ sessionId: 's', focus: 'upper', rules: rules(), history: heavy }).content.items.find((i) => i.movementId.endsWith('press'));
  assert.ok(press.load <= LOAD_MAX_KG);
  const set = workoutContent({ sessionId: 's', focus: 'upper', rules: rules(), loads: { backpack_row: 3 } }).content.items.find((i) => i.movementId === 'backpack_row');
  assert.equal(set.load, 3, 'a load the person set is used as is');
});

test('pain at 4 last time or a lighter week takes a set off', () => {
  const usual = workoutContent({ sessionId: 's', focus: 'full', minutes: 40, rules: rules() }).content;
  const eased = workoutContent({ sessionId: 's', focus: 'full', minutes: 40, rules: rules(), lastPain: 4 }).content;
  const lighter = workoutContent({ sessionId: 's', focus: 'full', minutes: 40, rules: rules(), deload: true }).content;
  for (const c of [eased, lighter]) c.items.forEach((i, k) => assert.equal(i.sets, Math.max(1, usual.items[k].sets - 1)));
});

test('a week gives every main pattern at least four sets when there is room, and says so when it is short', () => {
  const three = weekContent({ rules: rules(), sessions: [{ sessionId: 'a', focus: 'full' }, { sessionId: 'b', focus: 'full' }, { sessionId: 'c', focus: 'full' }] });
  for (const p of MAIN_PATTERNS) assert.ok(three.setsByPattern[p] >= WEEK_FLOOR_SETS, `${p}: ${three.setsByPattern[p]}`);
  for (const c of three.contents) assert.ok(c.minutes <= 25);
  const one = weekContent({ rules: rules(), sessions: [{ sessionId: 'a', focus: 'full' }] });
  assert.match(one.note, /below the 8 to 10 aimed for/);
  assert.deepEqual(setsByPattern(one.contents), one.setsByPattern);
});

test('checkContent: each code fails when it should, and a built session passes', () => {
  const built = workoutContent({ sessionId: 's', focus: 'full', rules: rules() }).content;
  assert.equal(checkContent({ content: built, rules: rules() }).pass, true);
  const one = (movementId, over = {}) => checkContent({ content: { items: [{ movementId, sets: 3 }] }, rules: rules(), ...over });
  assert.deepEqual(codes(one('lunge_jump')), ['unknown_movement']);
  assert.deepEqual(codes(one('backpack_row', { rules: rules({ equipment: [] }) })), ['equipment_not_owned']);
  assert.deepEqual(codes(one('glute_bridge', { rules: rules({ avoid: ['glute_bridge'] }) })), ['avoided_movement']);
  assert.deepEqual(codes(one('push_up')), ['gated_movement']);
  const fresh = checkContent({ content: { items: [{ movementId: 'knee_push_up', sets: 3 }, { movementId: 'reverse_lunge', sets: 3 }] },
    rules: rules({ movements: {} }), history: [allTop('table_push_up', 'a'), allTop('table_push_up', 'b'), allTop('wall_split_squat', 'a'), allTop('wall_split_squat', 'b')] });
  assert.deepEqual(codes(fresh), ['too_many_new']);
  const long = checkContent({ content: { items: ['sit_to_stand', 'wall_push_up', 'backpack_row', 'hip_hinge', 'glute_bridge', 'dead_bug'].map((movementId) => ({ movementId, sets: 4 })) }, rules: rules() });
  assert.ok(codes(long).includes('session_too_long'));
  const week = checkContent({ content: built, rules: rules(), week: [built] });
  assert.ok(codes(week).includes('sets_below_floor'));
});

test('bad input is a bad_content error, not a crash', () => {
  for (const bad of [null, { focus: 'arms', rules: {} }, { focus: 'full', rules: {}, history: 'yesterday' }, { focus: 'full', rules: {}, minutes: 2 }]) {
    assert.throws(() => workoutContent(bad), (e) => e.code === 'bad_content' || e.code === 'bad_rules');
  }
  assert.throws(() => checkContent({}), (e) => e.code === 'bad_content');
});
