// What goes into a home session: the movement library's shape and words, the chains, the session that fits the
// person's minutes and equipment, the week's floor of sets, and each checkContent code failing when it should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { MOVEMENTS, movementOf, chainOf, workoutContent, weekContent, checkContent, movementLibrary, feelingWordsIn, mastered,
  sessionMinutes, itemSeconds, setsByPattern, MAIN_PATTERNS, WEEK_FLOOR_SETS, WEEK_TARGET_SETS, MIN_ITEMS, LOAD_MAX_KG, SLOW_EXTRA_SECONDS } from '../src/content.mjs';
import { EQUIPMENT, ALWAYS_THERE } from '../src/rules.mjs';

const ALL = ['backpack', 'chair', 'table', 'sofa', 'book', 'step'];
const rules = (over = {}) => ({ equipment: ALL, ...over });
const codes = (r) => r.violations.map((v) => v.code);
// Every set at the top of the range; `marks` is { load?, slow?, tooHard? } as the phone writes them.
const allTop = (id, day, { load, slow, tooHard } = {}) => { const m = movementOf(id); const top = (m.dose.reps ?? m.dose.seconds)[1]; return { movementId: id, day, sets: Array(m.dose.sets).fill(top), ...(load ? { load } : {}), ...(slow ? { slow } : {}), ...(tooHard ? { tooHard } : {}) }; };
const DAYS = ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-26', '2026-11-27'];
// Two sessions at the top at the usual tempo (the slow step comes), then two at the top done slow: the slow step is behind
// it. For a movement with no backpack, that earns the next movement up.
const passedTwice = (id, days = DAYS, load) => [allTop(id, days[0], { load }), allTop(id, days[1], { load }), allTop(id, days[2], { load, slow: true }), allTop(id, days[3], { load, slow: true })];
// A backpack movement then takes one heavier step at the top: that earns the next movement up.
const passedHeavier = (id, load) => [...passedTwice(id, DAYS, load), allTop(id, DAYS[4], { load: load + 1 })];
// Movement `id` in a 60-minute session built for `req` ({ focus, history, ...anything workoutContent reads }).
const itemIn = (id, req) => workoutContent({ sessionId: 's', minutes: 60, rules: rules(), ...req }).content.items.find((i) => i.movementId === id);
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
    assert.ok(content.items.length >= MIN_ITEMS, focus);
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

test('two sessions at the top, then two slow ones at the top, earn the next movement up, one new movement at a time', () => {
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

test('a movement left out or marked "can\'t do" falls back to the easier one in its chain, never the harder one', () => {
  // The squat was earned and passed, so the backpack squat would be next; the person now can't do the squat.
  const history = [...passedTwice('sit_to_stand'), ...passedTwice('bodyweight_squat', DAYS.slice(4))];
  const squatIn = (over) => workoutContent({ sessionId: 's', focus: 'lower', minutes: 60, rules: rules(over), history }).content.items
    .find((i) => chainOf(i.movementId) === 'sit_to_stand')?.movementId;
  assert.equal(squatIn({}), 'backpack_squat', 'with nothing left out the chain moves on');
  assert.equal(squatIn({ movements: { bodyweight_squat: 'cannot' } }), 'sit_to_stand');
  assert.equal(squatIn({ avoid: ['bodyweight_squat'] }), 'sit_to_stand');
  // The check agrees: the harder one is not earned through a movement left out, unless the person says "I can".
  const one = (over) => codes(checkContent({ content: { items: [{ movementId: 'backpack_squat', sets: 3 }] }, rules: rules(over), history }));
  assert.deepEqual(one({ avoid: ['bodyweight_squat'] }), ['gated_movement']);
  assert.deepEqual(one({ movements: { bodyweight_squat: 'cannot' } }), ['gated_movement']);
  assert.deepEqual(one({ avoid: ['bodyweight_squat'], movements: { backpack_squat: 'can' } }), []);
  assert.equal(squatIn({ avoid: ['bodyweight_squat'], movements: { backpack_squat: 'can' } }), 'backpack_squat');
});

test('two sessions in a row with every set at the top bring the slow step, at the same weight; one is not enough', () => {
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: [allTop('backpack_row', DAYS[0], { load: 4 })] }).slow, undefined, 'once is not enough');
  const row = itemIn('backpack_row', { focus: 'upper', history: [allTop('backpack_row', DAYS[0], { load: 4 }), allTop('backpack_row', DAYS[1], { load: 4 })] });
  assert.equal(row.slow, true);
  assert.equal(row.load, 4);
  assert.equal(itemIn('wall_push_up', { focus: 'upper', history: [allTop('wall_push_up', DAYS[0]), allTop('wall_push_up', DAYS[1])] }).slow, true);
});

test('a session where "Too hard" was pressed never counts toward a step, even with every set at the top', () => {
  const pressed = [allTop('wall_push_up', DAYS[0]), allTop('wall_push_up', DAYS[1], { tooHard: true })];
  assert.equal(itemIn('wall_push_up', { focus: 'upper', history: pressed }).slow, undefined, 'no slow step');
  const slowPressed = [...passedTwice('wall_push_up').slice(0, 3), allTop('wall_push_up', DAYS[3], { slow: true, tooHard: true })];
  assert.equal(itemIn('wall_push_up', { focus: 'upper', history: slowPressed }).slow, true, 'the slow step stays');
  const ids = (history) => workoutContent({ sessionId: 's', focus: 'upper', minutes: 60, rules: rules(), history }).content.items.map((i) => i.movementId);
  assert.ok(!ids(slowPressed).includes('table_push_up'), 'no harder movement');
  const heavy = [...passedTwice('backpack_row', DAYS, 4).slice(0, 3), allTop('backpack_row', DAYS[3], { load: 4, slow: true }), allTop('backpack_row', DAYS[4], { load: 5, tooHard: true })];
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: heavy }).load, 5, 'no kilogram after a session marked too hard');
  assert.throws(() => workoutContent({ sessionId: 's', focus: 'upper', rules: rules(), history: 'x' }), (e) => e.code === 'bad_content');
});

test('no slow step before the top of the range, nor for a movement held for seconds', () => {
  const short = { ...allTop('wall_push_up', DAYS[1]), sets: [15, 15, 11] };
  assert.equal(itemIn('wall_push_up', { focus: 'upper', history: [allTop('wall_push_up', DAYS[0]), short] }).slow, undefined);
  assert.equal(itemIn('wall_push_up', { focus: 'upper', history: [] }).slow, undefined);
  // Two sessions at the top of a held movement go straight to the harder one: no slow step in between.
  const held = workoutContent({ sessionId: 's', focus: 'full', minutes: 60, turn: 2, rules: rules(), history: [allTop('kneeling_side_plank', DAYS[0]), allTop('kneeling_side_plank', DAYS[1])] }).content;
  const plank = held.items.find((i) => chainOf(i.movementId) === 'kneeling_side_plank');
  assert.deepEqual([plank.movementId, plank.slow], ['side_plank', undefined]);
});

test('the slow step stays until two slow sessions in a row reach the top, and comes only once', () => {
  const twice = [allTop('wall_push_up', DAYS[0]), allTop('wall_push_up', DAYS[1])];
  const missed = { ...allTop('wall_push_up', DAYS[2], { slow: true }), sets: [15, 12, 10] };
  assert.equal(itemIn('wall_push_up', { focus: 'upper', history: [...twice, missed] }).slow, true);
  assert.equal(itemIn('wall_push_up', { focus: 'upper', history: [...twice, allTop('wall_push_up', DAYS[2], { slow: true })] }).slow, true, 'one slow session at the top is not enough');
  const done = [...passedTwice('backpack_row', DAYS, 4), allTop('backpack_row', DAYS[4], { load: 5 })];
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: done, rules: rules({ equipment: ['backpack'] }) }).slow, undefined);
});

test('a slow item takes two more seconds for every rep, timed at the top of the range', () => {
  const item = { movementId: 'wall_push_up', sets: 3, reps: [10, 14], rest: 60 };
  assert.equal(itemSeconds({ ...item, slow: true }) - itemSeconds(item), 3 * 14 * SLOW_EXTRA_SECONDS);
  // 3 sets of 14 reps at 5 seconds, two rests of 60 and 30 seconds to set up: the worst case, not the middle of 10 to 14.
  assert.equal(itemSeconds(item), 3 * 14 * 5 + 2 * 60 + 30);
});

test('after the slow step, one session with every set at the top adds one kilogram', () => {
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: passedTwice('backpack_row', undefined, 4) }).load, 5);
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: passedHeavier('backpack_row', 4), rules: rules({ equipment: ['backpack'] }) }).load, 6);
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: passedTwice('backpack_row', undefined, 4).slice(0, 3) }).load, 4, 'not during the slow step');
});

test('a set below the top keeps the backpack as heavy as last time', () => {
  const short = { ...allTop('backpack_row', DAYS[4], { load: 5 }), sets: [15, 15, 9] };
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: [...passedTwice('backpack_row', undefined, 4), short] }).load, 5);
});

test('the backpack never goes past what it holds, and a weight the person set is used as is', () => {
  const nearlyFull = [...passedTwice('backpack_row', undefined, LOAD_MAX_KG - 1)];
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: nearlyFull, rules: rules({ equipment: ['backpack'] }) }).load, LOAD_MAX_KG);
  const full = [...passedTwice('backpack_row', undefined, LOAD_MAX_KG)];
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: full, rules: rules({ equipment: ['backpack'] }) }).load, LOAD_MAX_KG);
  assert.equal(itemIn('backpack_row', { focus: 'upper', history: [], loads: { backpack_row: 3 } }).load, 3);
});

test('a backpack movement unlocks the next one up after one heavier step, without waiting for 12 kg', () => {
  const ids = (history) => workoutContent({ sessionId: 's', focus: 'upper', minutes: 60, rules: rules(), history }).content.items.map((i) => i.movementId);
  const slowDone = passedTwice('backpack_row', undefined, 4);
  assert.ok(ids(slowDone).includes('backpack_row') && !ids(slowDone).includes('one_arm_row'), 'the heavier step comes first');
  assert.ok(ids(passedHeavier('backpack_row', 4)).includes('one_arm_row'), ids(passedHeavier('backpack_row', 4)).join());
  const heavierMissed = [...slowDone, { ...allTop('backpack_row', DAYS[4], { load: 5 }), sets: [15, 15, 9] }];
  assert.ok(!ids(heavierMissed).includes('one_arm_row'), 'the heavier session has to count too');
  assert.ok(ids([...passedTwice('backpack_row', undefined, LOAD_MAX_KG)]).includes('one_arm_row'), 'already at what a backpack holds');
});

test('the next movement up waits for two sessions in a row at the top, then two slow ones', () => {
  const ids = (history) => workoutContent({ sessionId: 's', focus: 'full', minutes: 60, rules: rules(), history }).content.items.map((i) => i.movementId);
  assert.ok(!ids([allTop('sit_to_stand', DAYS[0])]).includes('bodyweight_squat'), 'once is not enough');
  assert.ok(!ids([allTop('sit_to_stand', DAYS[0]), allTop('sit_to_stand', DAYS[1])]).includes('bodyweight_squat'), 'twice without the slow step');
  assert.ok(!ids(passedTwice('sit_to_stand').slice(0, 3)).includes('bodyweight_squat'), 'one slow session is not two');
  const broken = [...passedTwice('sit_to_stand').slice(0, 3), { ...allTop('sit_to_stand', DAYS[3], { slow: true }), sets: [12, 12, 8] }, allTop('sit_to_stand', DAYS[4], { slow: true })];
  assert.ok(!ids(broken).includes('bodyweight_squat'), 'not two slow sessions in a row');
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

test('a session has four or five movements whenever the library, the equipment and the minutes allow it', () => {
  for (const focus of ['full', 'lower', 'upper', 'full_lower', 'full_upper']) {
    for (const equipment of [ALL, [], ['chair']]) {
      const { content } = workoutContent({ sessionId: 's', focus, minutes: 25, rules: rules({ equipment }) });
      assert.ok(content.items.length >= MIN_ITEMS && content.items.length <= 5, `${focus} with ${equipment.join() || 'nothing'}: ${content.items.length}`);
      assert.ok(content.minutes <= 25, `${focus}: ${content.minutes}`);
    }
  }
  // No backpack and no table: the upper-body chains left are pushing against a wall and arm raises, so a second core
  // movement makes the fourth.
  const upper = workoutContent({ sessionId: 's', focus: 'upper', minutes: 25, rules: rules({ equipment: [] }) }).content;
  assert.deepEqual(upper.items.map((i) => movementOf(i.movementId).pattern), ['upper_push', 'upper_pull', 'core', 'core']);
});

test('only a session too short for four movements of one set has fewer, and it still fits its minutes', () => {
  const tiny = workoutContent({ sessionId: 's', focus: 'full', minutes: 5, rules: rules() }).content;
  assert.ok(tiny.items.length < MIN_ITEMS && tiny.items.length >= 1, String(tiny.items.length));
  assert.ok(tiny.minutes <= 5, `${tiny.minutes} minutes`);
  assert.deepEqual(codes(checkContent({ content: tiny, rules: rules(), focus: 'full', minutes: 5 })), []);
});

test('checkContent with the focus refuses three movements when four were possible, and six', () => {
  const built = workoutContent({ sessionId: 's', focus: 'full', rules: rules() }).content;
  assert.deepEqual(codes(checkContent({ content: built, rules: rules(), focus: 'full' })), []);
  const three = { ...built, items: built.items.slice(0, 3) };
  assert.deepEqual(codes(checkContent({ content: three, rules: rules(), focus: 'full' })), ['item_count']);
  const six = { items: ['sit_to_stand', 'wall_push_up', 'backpack_row', 'hip_hinge', 'glute_bridge', 'dead_bug'].map((movementId) => ({ movementId, sets: 1 })) };
  assert.deepEqual(codes(checkContent({ content: six, rules: rules(), focus: 'full', minutes: 60 })), ['item_count']);
  assert.deepEqual(codes(checkContent({ content: three, rules: rules() })), [], 'without the focus the count is not checked');
});

test('a week reaches for eight sets of each main pattern while the sessions have the minutes, and never goes past ten', () => {
  const week = (focuses, over = {}) => weekContent({ rules: rules(), sessions: focuses.map((focus, k) => ({ sessionId: `s${k}`, focus })), ...over });
  const split = week(['lower', 'upper', 'lower', 'upper']);
  for (const p of MAIN_PATTERNS) assert.ok(split.setsByPattern[p] >= WEEK_TARGET_SETS[0] && split.setsByPattern[p] <= WEEK_TARGET_SETS[1], `${p}: ${split.setsByPattern[p]}`);
  assert.equal(split.note, null);
  const three = week(['full', 'full', 'full']);
  for (const p of MAIN_PATTERNS) assert.ok(three.setsByPattern[p] >= WEEK_TARGET_SETS[0] && three.setsByPattern[p] <= WEEK_TARGET_SETS[1], `${p}: ${three.setsByPattern[p]}`);
  for (const w of [split, three, week(['full', 'full']), week(['full_lower', 'full_upper', 'full'])]) {
    for (const c of w.contents) assert.ok(c.minutes <= 25 && c.minutes === sessionMinutes(c.items), `${c.sessionId}: ${c.minutes}`);
    for (const p of MAIN_PATTERNS) assert.ok(w.setsByPattern[p] <= WEEK_TARGET_SETS[1], `${p}: ${w.setsByPattern[p]}`);
  }
  // Longer sessions leave room: two full-body days of 35 minutes add sets that 25 minutes can't.
  const roomy = week(['full', 'full'], { minutes: 35 });
  assert.ok(MAIN_PATTERNS.some((p) => roomy.setsByPattern[p] > week(['full', 'full']).setsByPattern[p]), JSON.stringify(roomy.setsByPattern));
  for (const c of roomy.contents) assert.ok(c.minutes <= 35, `${c.sessionId}: ${c.minutes}`);
});

test('a lighter week keeps its sessions one set short: no sets are added toward the target', () => {
  const sessions = ['full', 'full', 'full'].map((focus, k) => ({ sessionId: `s${k}`, focus }));
  const usual = weekContent({ rules: rules(), sessions });
  const lighter = weekContent({ rules: rules(), sessions, deload: true });
  for (const p of MAIN_PATTERNS) assert.ok(lighter.setsByPattern[p] < usual.setsByPattern[p], `${p}: ${lighter.setsByPattern[p]} against ${usual.setsByPattern[p]}`);
  for (const c of lighter.contents) for (const i of c.items) assert.ok(i.sets <= movementOf(i.movementId).dose.sets - 1, i.movementId);
});

test('sets_above_target: a week with more than ten sets of a pattern fails', () => {
  const heavy = { sessionId: 'a', items: [{ movementId: 'sit_to_stand', sets: 6 }, { movementId: 'wall_split_squat', sets: 5 }] };
  const r = checkContent({ content: { items: [] }, rules: rules(), week: [heavy] });
  assert.ok(codes(r).includes('sets_above_target'), codes(r).join());
  const ten = { sessionId: 'a', items: [{ movementId: 'sit_to_stand', sets: 5 }, { movementId: 'wall_split_squat', sets: 5 }] };
  assert.ok(!codes(checkContent({ content: { items: [] }, rules: rules(), week: [ten] })).includes('sets_above_target'));
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
    rules: rules({ movements: {} }), history: [...passedTwice('table_push_up'), ...passedTwice('wall_split_squat')] });
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
