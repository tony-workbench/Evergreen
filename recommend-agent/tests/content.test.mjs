// What goes into a home session: the movement library's shape and words, the chains, the session that fits the
// person's minutes and equipment, the week's floor of sets, and each checkContent code failing when it should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { MOVEMENTS, movementOf, chainOf, workoutContent, weekContent, checkContent, movementLibrary, feelingWordsIn, mastered,
  sessionMinutes, itemSeconds, setsByPattern, MAIN_PATTERNS, WEEK_FLOOR_SETS, LOAD_MAX_KG, SLOW_EXTRA_SECONDS } from '../src/content.mjs';
import { EQUIPMENT, ALWAYS_THERE } from '../src/rules.mjs';

const ALL = ['backpack', 'chair', 'table', 'sofa', 'book', 'step'];
const rules = (over = {}) => ({ equipment: ALL, ...over });
const codes = (r) => r.violations.map((v) => v.code);
const allTop = (id, day, load, slow) => { const m = movementOf(id); const top = (m.dose.reps ?? m.dose.seconds)[1]; return { movementId: id, day, sets: Array(m.dose.sets).fill(top), ...(load ? { load } : {}), ...(slow ? { slow } : {}) }; };
// Every set at the top at the usual tempo, then every set at the top done slow: what earns the next movement up.
const passedTwice = (id, days = ['2026-11-20', '2026-11-23'], load) => [allTop(id, days[0], load), allTop(id, days[1], load, true)];
const itemIn = (focus, history, id, over = {}) => workoutContent({ sessionId: 's', focus, minutes: 60, rules: rules(), history, ...over }).content.items.find((i) => i.movementId === id);
const IMAGES = new URL('../../app/Evergreen/Resources/Movements/', import.meta.url);

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
    assert.ok(m.images === undefined || Array.isArray(m.images), `${m.id} images`);
    assert.doesNotMatch(JSON.stringify(m), /https?:|www\./i, m.id);
  }
});

test('a movement may have no pictures yet, and any picture it lists is in the app', () => {
  for (const m of MOVEMENTS) for (const image of m.images ?? []) assert.ok(existsSync(new URL(image, IMAGES)), `${m.id}: ${image}`);
  assert.equal(existsSync(new URL('not-a-picture.png', IMAGES)), false);
});

test('every movement\'s pass says something other than its feel', () => {
  for (const m of MOVEMENTS) assert.notEqual(m.pass.trim().toLowerCase(), m.feel.trim().toLowerCase(), m.id);
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

test('two sessions at the top of the range, the second slow, earn the next movement up, one new movement at a time', () => {
  const history = [...passedTwice('sit_to_stand'), ...passedTwice('wall_push_up')];
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

test('the first time every set reaches the top, the next session is slow, at the same weight', () => {
  const row = itemIn('upper', [allTop('backpack_row', '2026-11-23', 4)], 'backpack_row');
  assert.equal(row.slow, true);
  assert.equal(row.load, 4);
  assert.equal(itemIn('upper', [allTop('wall_push_up', '2026-11-23')], 'wall_push_up').slow, true);
});

test('no slow step before the top of the range, nor for a movement held for seconds', () => {
  const short = { ...allTop('wall_push_up', '2026-11-23'), sets: [15, 15, 11] };
  assert.equal(itemIn('upper', [short], 'wall_push_up').slow, undefined);
  assert.equal(itemIn('upper', [], 'wall_push_up').slow, undefined);
  const plank = itemIn('full', [allTop('kneeling_side_plank', '2026-11-23')], 'kneeling_side_plank', { turn: 2 });
  assert.equal(plank.slow, undefined);
});

test('the slow step stays until every set reaches the top slowly, and comes only once', () => {
  const missed = { ...allTop('wall_push_up', '2026-11-23', undefined, true), sets: [15, 12, 10] };
  assert.equal(itemIn('upper', [allTop('wall_push_up', '2026-11-20'), missed], 'wall_push_up').slow, true);
  const done = [...passedTwice('backpack_row', undefined, 4), allTop('backpack_row', '2026-11-26', 5)];
  assert.equal(itemIn('upper', done, 'backpack_row').slow, undefined);
});

test('a slow item takes two more seconds for every rep', () => {
  const item = { movementId: 'wall_push_up', sets: 3, reps: [10, 14], rest: 60 };
  assert.equal(itemSeconds({ ...item, slow: true }) - itemSeconds(item), 3 * 12 * SLOW_EXTRA_SECONDS);
});

test('after the slow step, one session with every set at the top adds one kilogram', () => {
  assert.equal(itemIn('upper', passedTwice('backpack_row', undefined, 4), 'backpack_row').load, 5);
  const third = [...passedTwice('backpack_row', undefined, 4), allTop('backpack_row', '2026-11-26', 5)];
  assert.equal(itemIn('upper', third, 'backpack_row').load, 6);
});

test('a set below the top keeps the backpack as heavy as last time', () => {
  const short = { ...allTop('backpack_row', '2026-11-26', 5), sets: [15, 15, 9] };
  assert.equal(itemIn('upper', [...passedTwice('backpack_row', undefined, 4), short], 'backpack_row').load, 5);
});

test('the backpack never goes past what it holds, and a weight the person set is used as is', () => {
  const full = [...passedTwice('backpack_row', undefined, 4), allTop('backpack_row', '2026-11-26', LOAD_MAX_KG)];
  assert.equal(itemIn('upper', full.slice(0, 2).concat([{ ...full[2], load: LOAD_MAX_KG - 1 }]), 'backpack_row').load, LOAD_MAX_KG);
  assert.equal(itemIn('upper', [...full, allTop('backpack_row', '2026-11-27', LOAD_MAX_KG)], 'backpack_row'), undefined, 'at 12 kg twice the next row up comes');
  assert.equal(itemIn('upper', [], 'backpack_row', { loads: { backpack_row: 3 } }).load, 3);
});

test('a backpack movement reaches 12 kg before the next movement up', () => {
  const at11 = [...passedTwice('backpack_row', undefined, 4), allTop('backpack_row', '2026-11-26', 11), allTop('backpack_row', '2026-11-27', 11)];
  const ids = (history) => workoutContent({ sessionId: 's', focus: 'upper', minutes: 60, rules: rules(), history }).content.items.map((i) => i.movementId);
  assert.ok(ids(at11).includes('backpack_row') && !ids(at11).includes('one_arm_row'));
  const at12 = [...at11, allTop('backpack_row', '2026-11-28', LOAD_MAX_KG), allTop('backpack_row', '2026-11-29', LOAD_MAX_KG)];
  assert.ok(ids(at12).includes('one_arm_row'), ids(at12).join());
});

test('the next movement up waits for two sessions in a row at the top, and for the slow step', () => {
  const ids = (history) => workoutContent({ sessionId: 's', focus: 'full', minutes: 60, rules: rules(), history }).content.items.map((i) => i.movementId);
  assert.ok(!ids([allTop('sit_to_stand', '2026-11-23')]).includes('bodyweight_squat'), 'once is not enough');
  assert.ok(!ids([allTop('sit_to_stand', '2026-11-20'), allTop('sit_to_stand', '2026-11-23')]).includes('bodyweight_squat'), 'twice without the slow step');
  const broken = [allTop('sit_to_stand', '2026-11-20'), { ...allTop('sit_to_stand', '2026-11-22'), sets: [12, 12, 8] }, allTop('sit_to_stand', '2026-11-23', undefined, true)];
  assert.ok(!ids(broken).includes('bodyweight_squat'), 'not two in a row');
  assert.ok(ids(passedTwice('sit_to_stand')).includes('bodyweight_squat'));
});

test('a gated movement never starts its chain because its easier one needs equipment the person lacks', () => {
  assert.equal(movementOf('single_leg_glute_bridge').gated, true);
  const history = passedTwice('glute_bridge');
  const lower = (equipment) => workoutContent({ sessionId: 's', focus: 'lower', minutes: 60, rules: rules({ equipment }), history }).content.items.map((i) => i.movementId);
  assert.ok(!lower([]).includes('single_leg_glute_bridge'), lower([]).join());
  assert.ok(lower([]).includes('glute_bridge'));
  const notGated = workoutContent({ sessionId: 's', focus: 'full', rules: rules({ equipment: [] }) }).content.items.map((i) => i.movementId);
  assert.ok(notGated.includes('bodyweight_squat'), 'a movement that is not gated still starts the chain');
  assert.deepEqual(codes(checkContent({ content: { items: [{ movementId: 'single_leg_glute_bridge', sets: 3 }] }, rules: rules({ equipment: [] }), history })), ['gated_movement']);
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
  for (const sets of [0, 7, 2.5, '3']) {
    assert.deepEqual(codes(checkContent({ content: { items: [{ movementId: 'glute_bridge', sets }] }, rules: rules() })), ['bad_dose']);
  }
  const fresh = checkContent({ content: { items: [{ movementId: 'knee_push_up', sets: 3 }, { movementId: 'reverse_lunge', sets: 3 }] },
    rules: rules({ movements: {} }), history: [...passedTwice('table_push_up', ['a', 'b']), ...passedTwice('wall_split_squat', ['a', 'b'])] });
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
