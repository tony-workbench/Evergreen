import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FACT_TYPES, FACT_TYPE_IDS, FACT_TYPE_GROUPS, FACT_TEMPLATES, SUPPRESSED_ERROR, typeOf } from '../src/facts/index.mjs';
import { completedFacts } from './helpers/completed-day.mjs';
import { FACT_GROUPS } from '../src/contract/index.mjs';
import { generateScenario, SCENARIO_KINDS } from '../src/scenarios/generate.mjs';

const dir = new URL('../fixtures/personas/', import.meta.url);
const personas = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

const dayList = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
const mk = (dates, workouts = [], extra = {}) => ({
  exportDate: '2020-01-01T00:00:00Z',
  persona: { key: 't' },
  dailySummaries: dates.map((date) => ({ date, restingHeartRate: 50 + (date.slice(-1) % 3), sleepMinutes: { totalAsleep: 420 + (date.slice(-1) % 4) } })),
  workouts,
  ...extra,
});
const wk = (date, type = 'Running', hour = 7, min = 30) => ({ activityType: type, start: `${date}T${String(hour).padStart(2, '0')}:00:00-08:00`, end: `${date}T${String(hour).padStart(2, '0')}:50:00-08:00`, durationMin: min });
const find = (facts, id) => facts.find((f) => f.id === id);
const ids = (facts) => facts.map((f) => f.id);

// A spread of situations that together exercise every fact type.
function cases() {
  const out = [];
  for (const p of personas) {
    const now = `${p.dailySummaries.at(-1).date}T23:00:00-08:00`;
    out.push([{ ...p, exportDate: now }, now, { ...{ target: { workoutsPerWeek: 4 } } }]);
  }
  for (const kind of SCENARIO_KINDS) {
    const g = generateScenario(kind, 2);
    out.push([g.snapshot, g.now, { target: { workoutsPerWeek: 4 } }]);
    out.push([{ ...g.snapshot, workouts: g.snapshot.workouts.map((w) => ({ ...w, effort: 6 })) }, g.now, {}]);
  }
  const dates = dayList('2026-10-01', 28);
  const slots = [];
  for (const d of ['2026-10-12', '2026-10-19', '2026-10-26']) slots.push(wk(d, 'Running', 7), wk(d.replace('-12', '-14').replace('-19', '-21').replace('-26', '-28'), 'Yoga', 18));
  out.push([mk(dates, slots), '2026-10-28T22:00:00-08:00', {}]);
  out.push([mk(dayList('2026-10-01', 14), [wk('2026-10-05')]), '2026-10-20T22:00:00-08:00', { target: { workoutsPerWeek: 3 } }]); // today unlogged
  out.push([mk(dayList('2026-10-01', 30), []), '2026-10-30T22:00:00-08:00', {}]); // no workouts
  out.push([mk(dayList('2026-10-01', 5), []), '2026-10-05T22:00:00-08:00', {}]); // thin
  return out.map(([s, now, extra]) => [{ ...s, ...extra }, now]);
}

// Refreshes during the day (in_progress): with data for the unfinished day, and without.
function liveCases() {
  const g = generateScenario('steady', 3);
  const day = g.now.slice(0, 10);
  return ['21:00', '05:00'].map((hhmm) => {
    const now = `${day}T${hhmm}:00-08:00`;
    return [{ ...g.snapshot, exportDate: now, target: { workoutsPerWeek: 4 } }, now];
  });
}

test('FACT_TYPES is the closed list: every emitted fact has an entry, every entry is emitted, groups and templates agree', () => {
  const emitted = new Map();
  for (const [snap, now] of cases()) for (const f of completedFacts(snap, now)) emitted.set(typeOf(f.id), f.group);
  for (const [snap, now] of liveCases()) for (const f of completedFacts(snap, now, { dayMode: 'in_progress' })) emitted.set(typeOf(f.id), f.group);
  for (const [type, group] of emitted) {
    const entry = FACT_TYPES.find((t) => t.id === type);
    assert.ok(entry, `emitted fact type ${type} has no FACT_TYPES entry`);
    assert.equal(entry.group, group, type);
  }
  for (const t of FACT_TYPES) assert.ok(emitted.has(t.id), `FACT_TYPES entry ${t.id} is never emitted`);
  assert.deepEqual([...FACT_TYPE_IDS].sort(), Object.keys(FACT_TEMPLATES).sort());
  assert.equal(new Set(FACT_TYPE_IDS).size, FACT_TYPE_IDS.length);
  for (const g of FACT_TYPE_GROUPS) assert.ok(FACT_GROUPS.includes(g), g);
  assert.deepEqual(FACT_TYPES.filter((t) => t.keyed).map((t) => t.id), ['regularity.slot']);
  assert.equal(FACT_TYPES.find((t) => t.id === 'regularity.slot').keyed.by, 'activityType.weekday.hour');
  // the group is the first part of the id
  for (const t of FACT_TYPES) assert.equal(t.id.split('.')[0], t.group);
});

test('nothing suppressed is byte-identical to the output without the option', () => {
  for (const [snap, now] of cases()) {
    const base = JSON.stringify(completedFacts(snap, now));
    for (const opt of [{}, { suppressed: undefined }, { suppressed: null }, { suppressed: {} }, { suppressed: { types: [], keys: [] } }, undefined]) {
      assert.equal(JSON.stringify(completedFacts(snap, now, opt)), base);
    }
  }
});

test('suppressing one type, one group or one key removes exactly those facts, and nothing is written in their place', () => {
  const [slotSnap, slotNow] = cases()[cases().length - 4];
  const base = completedFacts(slotSnap, slotNow);
  assert.ok(find(base, 'regularity.slot.Running.Mon.07') && find(base, 'regularity.slot.Yoga.Wed.18'));
  // one type
  const oneType = completedFacts(slotSnap, slotNow, { suppressed: { types: ['body.sleep'] } });
  assert.deepEqual(ids(oneType), ids(base).filter((id) => id !== 'body.sleep'));
  assert.equal(JSON.stringify(oneType), JSON.stringify(base.filter((f) => f.id !== 'body.sleep')));
  // one group
  const oneGroup = completedFacts(slotSnap, slotNow, { suppressed: { types: ['body'] } });
  assert.deepEqual(ids(oneGroup), ids(base).filter((id) => !id.startsWith('body.')));
  // one key
  const oneKey = completedFacts(slotSnap, slotNow, { suppressed: { keys: [{ type: 'regularity.slot', key: 'Running.Mon.07' }] } });
  assert.deepEqual(ids(oneKey), ids(base).filter((id) => id !== 'regularity.slot.Running.Mon.07'));
  assert.ok(find(oneKey, 'regularity.slot.Yoga.Wed.18'));
  // no sentence, hint or number mentions that something was suppressed
  for (const f of [...oneType, ...oneGroup, ...oneKey]) assert.doesNotMatch(JSON.stringify(f), /suppress|hidden|stopped|omitted|withheld/i);
  // a type and a key together, and repeated entries
  const both = completedFacts(slotSnap, slotNow, { suppressed: { types: ['body.sleep', 'body.sleep'], keys: [{ type: 'regularity.slot', key: 'Running.Mon.07' }] } });
  assert.deepEqual(ids(both), ids(base).filter((id) => id !== 'body.sleep' && id !== 'regularity.slot.Running.Mon.07'));
});

// Which facts disclose the value of a base fact, written here independently of the engine's table.
const DEPENDENTS = {
  'volume.today': ['past.today_vs_avg', 'past.today_vs_highest', 'past.today_rank'],
  'volume.week': ['past.week_vs_avg', 'past.week_rank', 'past.week_comparisons_skipped', 'load.ratio', 'regularity.per_week', 'goal.workouts_per_week', 'goal.target_progress'],
  'volume.28d': ['load.ratio', 'regularity.per_week', 'regularity.days_since_last', 'mix.count', 'mix.median_length', 'mix.start_bands'],
  'mix.count': ['mix.median_length', 'mix.start_bands'],
  'load.ratio': ['coverage.28d'],
};
const closure = (baseIds) => {
  const out = new Set(baseIds);
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of [...out]) for (const d of DEPENDENTS[id] || []) if (!out.has(d)) { out.add(d); changed = true; }
  }
  return out;
};

test('suppressing a whole group removes that group and every fact that discloses its values, and changes nothing else, in every situation', () => {
  for (const group of FACT_TYPE_GROUPS) {
    for (const [snap, now, dayMode] of [...cases().map((c) => [...c, 'completed']), ...liveCases().map((c) => [...c, 'in_progress'])]) {
      const mode = dayMode === 'completed' ? {} : { dayMode };
      const base = completedFacts(snap, now, mode);
      const gone = closure(FACT_TYPES.filter((t) => t.group === group).map((t) => t.id));
      const got = completedFacts(snap, now, { ...mode, suppressed: { types: [group] } });
      const expected = base.filter((f) => f.group !== group && !gone.has(typeOf(f.id)));
      assert.equal(JSON.stringify(got), JSON.stringify(expected), `${group} @ ${now}`);
    }
  }
});

// A snapshot with distinctive minutes, so a restated value can be found by its digits.
function distinctive() {
  const dates = dayList('2026-10-01', 30);
  const w = (d, min, hour = 7) => ({ activityType: 'Running', start: `${d}T${String(hour).padStart(2, '0')}:00:00-08:00`, end: `${d}T${String(hour).padStart(2, '0')}:59:00-08:00`, durationMin: min });
  const workouts = [w('2026-10-30', 37.3), w('2026-10-28', 41.7), w('2026-10-26', 22.9), w('2026-10-24', 53.7), w('2026-10-21', 47.7), w('2026-10-18', 33.3), w('2026-10-14', 61.9), w('2026-10-09', 25.5), w('2026-10-05', 44.4)];
  const snap = mk(dates, workouts, { target: { workoutsPerWeek: 3 } });
  snap.dailySummaries = snap.dailySummaries.map((d, i) => ({ ...d, restingHeartRate: 50 + ((i * 3) % 5), sleepMinutes: { totalAsleep: 400 + ((i * 7) % 31) } }));
  return [snap, '2026-10-30T22:00:00-08:00'];
}
const token = (v) => new RegExp(`(?<![\\d.])${String(v).replace(/\./g, '\\.')}(?![\\d])`);

test('suppressing a base fact removes every fact that restates its value, for today, week, 28d, body, regularity, load and goal', () => {
  const [snap, now] = distinctive();
  const base = completedFacts(snap, now);
  // [base id, numbers keys whose values must not appear anywhere in what remains]
  const bases = [
    ['volume.today', ['minutes']],
    ['volume.week', ['minutes']],
    ['volume.28d', ['minutes']],
    ['body.sleep', ['average7', 'average28']],
    ['body.resting_hr', ['average7', 'average28']],
    ['regularity.days_since_last', []],
    ['regularity.per_week', []],
    ['load.ratio', ['ratio', 'averagePerWeek28']],
    ['goal.workouts_per_week', ['baselineWorkoutsPerWeek']],
  ];
  for (const [id, keys] of bases) {
    const got = completedFacts(snap, now, { suppressed: { types: [id] } });
    const gone = closure([id]);
    assert.equal(JSON.stringify(got), JSON.stringify(base.filter((f) => !gone.has(typeOf(f.id)))), id);
    const numbers = find(base, id).numbers;
    for (const k of keys) {
      const t = token(numbers[k]);
      for (const f of got) assert.doesNotMatch(f.text, t, `${id}.${k} = ${numbers[k]} is restated by ${f.id}`);
    }
  }
  // the facts that were found to restate values really did, in the unsuppressed output
  assert.match(find(base, 'past.today_vs_avg').text, token(find(base, 'volume.today').numbers.minutes));
  assert.match(find(base, 'past.week_vs_avg').text, token(find(base, 'volume.week').numbers.minutes));
  assert.match(find(base, 'load.ratio').text, token(find(base, 'volume.week').numbers.minutes));
});

test('dependsOn names known ids and has no cycles', () => {
  const byId = Object.fromEntries(FACT_TYPES.map((t) => [t.id, t]));
  for (const t of FACT_TYPES) for (const d of t.dependsOn || []) assert.ok(byId[d], `${t.id} depends on unknown ${d}`);
  const visit = (id, path) => {
    assert.ok(!path.includes(id), `cycle: ${[...path, id].join(' > ')}`);
    for (const d of byId[id].dependsOn || []) visit(d, [...path, id]);
  };
  for (const t of FACT_TYPES) visit(t.id, []);
  // what the table declares equals the independent table used by these tests
  for (const [base, dependents] of Object.entries(DEPENDENTS)) {
    for (const d of dependents) assert.ok(closure([base]).has(d));
  }
  for (const t of FACT_TYPES) for (const d of t.dependsOn || []) assert.ok(closure([d]).has(t.id), `${t.id} is declared dependent on ${d}`);
});

test('suppressing a fact that others lean on does not leave a misleading statement', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  const snap = mk(dates, [wk('2026-10-05'), wk('2026-10-28')]);
  const base = completedFacts(snap, now);
  assert.equal(base[0].id, 'coverage.28d');
  // load suppressed: the coverage sentence ("so the 28-day load average uses ...") goes too; everything else is as before
  const noLoad = completedFacts(snap, now, { suppressed: { types: ['load.ratio'] } });
  assert.ok(!find(noLoad, 'coverage.28d') && !find(noLoad, 'load.ratio'));
  assert.equal(JSON.stringify(noLoad), JSON.stringify(base.filter((f) => f.id !== 'load.ratio' && f.id !== 'coverage.28d')));
  // coverage suppressed: the load fact stays, with its own logged-day count
  const noCoverage = completedFacts(snap, now, { suppressed: { types: ['coverage'] } });
  assert.equal(JSON.stringify(noCoverage), JSON.stringify(base.filter((f) => f.id !== 'coverage.28d')));
  assert.match(find(noCoverage, 'load.ratio').text, /\b28 logged days\b/);
});

test('slots: suppressing keys or the type never leaves a "no fixed slot" sentence behind', () => {
  const [snap, now] = cases()[cases().length - 4];
  const base = completedFacts(snap, now);
  assert.equal(base.filter((f) => f.id.startsWith('regularity.slot.')).length, 2);
  assert.ok(!find(base, 'regularity.slots_none'));
  const all = completedFacts(snap, now, { suppressed: { keys: [{ type: 'regularity.slot', key: 'Running.Mon.07' }, { type: 'regularity.slot', key: 'Yoga.Wed.18' }] } });
  assert.ok(!all.some((f) => f.id.startsWith('regularity.slot')), 'no slot sentence at all, in particular no "found: 0"');
  const type = completedFacts(snap, now, { suppressed: { types: ['regularity.slot'] } });
  assert.ok(!type.some((f) => f.id.startsWith('regularity.slot')));
  // with no slots to begin with, the "none" sentence is a variant of the slot type
  const [none, noneNow] = cases().find(([s, n]) => n === '2026-10-30T22:00:00-08:00' && s.workouts.length === 0);
  assert.ok(find(completedFacts(none, noneNow), 'regularity.slots_none'));
  assert.ok(!find(completedFacts(none, noneNow, { suppressed: { types: ['regularity.slot'] } }), 'regularity.slots_none'));
  assert.ok(find(completedFacts(none, noneNow, { suppressed: { types: ['regularity.days_since_last'] } }), 'regularity.slots_none'));
});

test('today unlogged: suppressing volume.today also removes its "no data" variant', () => {
  const [snap, now] = cases().find(([s, n]) => n === '2026-10-20T22:00:00-08:00');
  const base = completedFacts(snap, now);
  assert.ok(find(base, 'volume.today_unlogged') && !find(base, 'volume.today'));
  const got = completedFacts(snap, now, { suppressed: { types: ['volume.today'] } });
  assert.ok(!find(got, 'volume.today_unlogged'));
  assert.equal(JSON.stringify(got), JSON.stringify(base.filter((f) => f.id !== 'volume.today_unlogged')));
});

test('the "comparisons not stated" sentence is written only while some comparison it speaks of can still be written', () => {
  const [snap, now] = cases().find(([s, n]) => n === '2026-10-20T22:00:00-08:00'); // incomplete week, with a target
  const base = completedFacts(snap, now);
  assert.ok(find(base, 'past.week_comparisons_skipped'));
  const four = ['past.week_vs_avg', 'past.week_rank', 'load.ratio', 'goal.workouts_per_week'];
  // the target comparison is still not stated, so the sentence stays
  assert.ok(find(completedFacts(snap, now, { suppressed: { types: four } }), 'past.week_comparisons_skipped'));
  // all of them suppressed: no sentence, no hint
  assert.ok(!find(completedFacts(snap, now, { suppressed: { types: [...four, 'goal.target_progress'] } }), 'past.week_comparisons_skipped'));
  assert.ok(!find(completedFacts(snap, now, { suppressed: { types: ['past', 'load', 'goal'] } }), 'past.week_comparisons_skipped'));
  // without a target only four comparisons exist
  const { target, ...noTarget } = snap;
  assert.ok(!find(completedFacts(noTarget, now, { suppressed: { types: four } }), 'past.week_comparisons_skipped'));
  assert.ok(find(completedFacts(noTarget, now, { suppressed: { types: four.slice(1) } }), 'past.week_comparisons_skipped'));
});

test('suppressing everything under thin history gives an empty list', () => {
  const [snap, now] = cases().at(-1);
  assert.deepEqual(completedFacts(snap, now, { suppressed: { types: ['history'] } }), []);
  assert.equal(completedFacts(snap, now)[0].id, 'history.thin');
});

test('unknown ids and malformed lists are rejected with a fixed error text', () => {
  const [snap, now] = cases()[0];
  assert.equal(SUPPRESSED_ERROR, 'suppressed lists an unknown fact type or key');
  const bad = [
    { types: ['nope'] },
    { types: ['bod'] }, // not a dot-prefix of any id
    { types: ['body.'] },
    { types: ['body.sleep.extra'] },
    { types: ['feedback'] },
    { types: [''] },
    { types: [7] },
    { types: 'body' },
    { types: ['body'], other: [] },
    { keys: [{ type: 'body.sleep', key: 'x' }] }, // not a keyed type
    { keys: [{ type: 'regularity.slot', key: 'Running' }] },
    { keys: [{ type: 'regularity.slot', key: 'Other.Mon.07' }] },
    { keys: [{ type: 'regularity.slot', key: 'Frobnicate.Mon.07' }] },
    { keys: [{ type: 'regularity.slot', key: 'Running.Mon.24' }] },
    { keys: [{ type: 'regularity.slot', key: 'Running.Mon.07', extra: 1 }] },
    { keys: [{ type: 'regularity.slot' }] },
    { keys: ['Running.Mon.07'] },
    { keys: {} },
    [],
    'body',
    5,
  ];
  for (const suppressed of bad) {
    assert.throws(() => completedFacts(snap, now, { suppressed }), (e) => e instanceof Error && e.message === SUPPRESSED_ERROR, JSON.stringify(suppressed));
  }
  // the error text does not echo the offending value
  try {
    completedFacts(snap, now, { suppressed: { types: ['secret-looking-value'] } });
  } catch (e) {
    assert.ok(!e.message.includes('secret-looking-value'));
  }
  // rejected even when the history is thin (checked before anything is computed)
  assert.throws(() => completedFacts(cases().at(-1)[0], cases().at(-1)[1], { suppressed: { types: ['nope'] } }), /unknown fact type or key/);
  // every valid id, group and dot-prefix is accepted
  for (const id of [...FACT_TYPE_IDS, ...FACT_TYPE_GROUPS, 'regularity.slot']) completedFacts(snap, now, { suppressed: { types: [id] } });
});

test('in_progress: suppressing volume.today also removes the "so far today" variant', () => {
  const [snap, now] = liveCases()[0];
  const base = completedFacts(snap, now, { dayMode: 'in_progress' });
  assert.ok(find(base, 'volume.today_so_far'));
  const got = completedFacts(snap, now, { dayMode: 'in_progress', suppressed: { types: ['volume.today'] } });
  assert.ok(!find(got, 'volume.today_so_far') && !find(got, 'volume.today_unlogged'));
  assert.equal(JSON.stringify(got), JSON.stringify(base.filter((f) => f.id !== 'volume.today_so_far')));
});

test('declared dependents with a one-workout window: nothing restates the forgotten total or the forgotten counts', () => {
  const dates = dayList('2026-10-01', 30);
  const now = '2026-10-30T22:00:00-08:00';
  // one counted workout in the whole window, 20 days back, with distinctive minutes (it is outside the week and the day)
  const snap = mk(dates, [{ activityType: 'Running', start: '2026-10-10T07:00:00-08:00', end: '2026-10-10T07:59:00-08:00', durationMin: 41.37 }]);
  const base = completedFacts(snap, now);
  assert.equal(find(base, 'volume.28d').numbers.minutes, 41.37);
  assert.match(find(base, 'mix.median_length').text, /41\.37 min/); // the median of one workout is its total
  // volume.28d suppressed: the median (which repeats the total), the counts and the bands go with it
  const noTotal = completedFacts(snap, now, { suppressed: { types: ['volume.28d'] } });
  for (const id of ['mix.median_length', 'mix.count', 'mix.start_bands', 'regularity.days_since_last', 'regularity.per_week', 'load.ratio', 'coverage.28d']) assert.ok(!find(noTotal, id), id);
  for (const f of noTotal) assert.doesNotMatch(f.text, token('41.37'), `${f.id} repeats the forgotten total`);
  // mix.count suppressed: the median and the bands (by construction they restate the counts and the activity names) go too
  const noMix = completedFacts(snap, now, { suppressed: { types: ['mix.count'] } });
  assert.ok(!find(noMix, 'mix.median_length') && !find(noMix, 'mix.start_bands'));
  assert.ok(find(noMix, 'volume.28d'));
  // the median alone can be suppressed without touching the others
  const noMedian = completedFacts(snap, now, { suppressed: { types: ['mix.median_length'] } });
  assert.deepEqual(ids(noMedian), ids(base).filter((id) => id !== 'mix.median_length'));
  // every declared dependent of every base is really removed with it
  for (const [baseId, dependents] of Object.entries(DEPENDENTS)) {
    const got = ids(completedFacts(snap, now, { suppressed: { types: [baseId] } }));
    for (const d of dependents) assert.ok(!got.includes(d), `${d} survives the suppression of ${baseId}`);
  }
});

test('docs/CONTRACT.md lists every fact id and group, and stays short', () => {
  const doc = readFileSync(new URL('../docs/CONTRACT.md', import.meta.url), 'utf8');
  for (const t of FACT_TYPES) assert.ok(doc.includes(`\`${t.id}\``), `${t.id} is missing from the facts table`);
  for (const g of FACT_TYPE_GROUPS) assert.ok(doc.includes(g), g);
  assert.ok(doc.split(/\s+/).filter(Boolean).length <= 900, 'CONTRACT.md is over 900 words');
});
