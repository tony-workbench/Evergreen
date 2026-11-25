// The JS rules against the Python rules they were ported from: every golden case in fixtures/workouts.json (inputs and the
// Python answers, kept as plain JSON) must give the same plan. Wording may differ; the code of every reason must match.
// A case names a sample history (`persona`); tests/support/sample.mjs turns it into the history the bundle takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommendWeek, checkPlan } from './support/sample.mjs';
import { memoryFor } from './support/harness-memory.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
export const workoutCases = load('workouts');

// The Python tag of a rule -> its code.
const TAG_CODES = [
  [/^your usual \w{3} \d\d:00 slot \(memory\)$/, 'memory_slot'], [/^long run$/, 'long_run'], [/^taper: race in \d+ days$/, 'taper'],
  [/^ease off: .* → easy$/, 'ease_off'], [/^shoes at \d+% → off the road$/, 'worn_shoes_swap'], [/^break-in run in the new pair$/, 'break_in'],
  [/^trimmed to stay under your weekly load cap$/, 'load_trim'], [/^moved after a calendar conflict$/, 'calendar_moved'],
  [/^no free slot that day$/, 'no_free_slot'], [/^race day$/, 'race_day'],
];
const tagCode = (tag) => TAG_CODES.find(([re]) => re.test(tag))?.[1] ?? `unknown: ${tag}`;

test(`the week matches the Python rules on ${workoutCases.length} golden cases`, async (t) => {
  let overCap = 0;
  for (const c of workoutCases) {
    await t.test(c.name, () => {
      const want = c.output;
      const input = { ...c.input, memory: memoryFor(c.input) };
      const got = recommendWeek(input, 1); // the Python week starts tomorrow
      // Intentional divergence: where the Python week ends over the weekly load limit, the bundle trims on to the limit.
      const over = want.signals.plannedLoad > want.signals.loadCap;
      if (over) {
        overCap += 1;
        assert.deepEqual({ ...got.signals, plannedLoad: 0 }, { ...want.signals, plannedLoad: 0 });
        assert.ok(got.signals.plannedLoad < want.signals.plannedLoad);
        assert.ok(got.signals.plannedLoad <= want.signals.loadCap || got.sessions.every((s) => s.minutes <= 20), 'still over the limit');
      } else assert.deepEqual(got.signals, want.signals);
      assert.deepEqual(got.condition, want.condition);
      assert.equal(got.historySource, 'phone'); // the bundle only ever plans from the history it is given
      assert.equal(got.memorySource, want.memorySource === null ? null : 'phone');
      assert.equal(got.actions.length, want.actions.length);
      got.actions.forEach((a, i) => {
        const w = want.actions[i];
        if (over) {
          // Same day, activity, start time and memory keys; minutes only ever shorter; the same rules, plus the trim where it was added.
          for (const k of ['id', 'kind', 'planItemId', 'points', 'createdAt', 'basedOn']) assert.deepEqual(a[k], w[k], `${w.id} ${k}`);
          assert.deepEqual(a.evidence.map((e) => e.passage), w.evidence.map((e) => e.passage), `${w.id} evidence`);
          assert.deepEqual([a.after?.start, a.after?.activityType], [w.after?.start, w.after?.activityType], `${w.id} start`);
          if (w.after) assert.ok(Date.parse(a.after.end) <= Date.parse(w.after.end), `${w.id} minutes`);
          const rest = (codes) => codes.filter((x) => x !== 'load_trim');
          assert.deepEqual(rest(a.rules), rest(w.rules.map(tagCode)), `${w.id} rules`);
          assert.deepEqual(a.reasons.map((r) => r.code), a.rules.length ? a.rules : ['usual']);
          return;
        }
        for (const k of ['id', 'kind', 'title', 'planItemId', 'after', 'points', 'createdAt', 'basedOn']) assert.deepEqual(a[k], w[k], `${w.id} ${k}`);
        // Intentional divergence: no web address leaves the bundle, so a citation names its publication and carries no url.
        assert.deepEqual(a.evidence.map((e) => e.passage), w.evidence.map((e) => e.passage), `${w.id} evidence`);
        for (const e of a.evidence) assert.deepEqual(Object.keys(e), ['source', 'passage']);
        assert.deepEqual(a.rules, w.rules.map(tagCode), `${w.id} rules`);
        assert.deepEqual(a.reasons.map((r) => r.code), w.rules.length ? w.rules.map(tagCode) : ['usual'], `${w.id} reasons`);
      });
      if (!over) {
        // The same suggestions; their source is a title and a publication name, with no host and no url.
        assert.deepEqual(got.suggestions.map(({ why, source, ...rest }) => rest), want.suggestions.map(({ why, source, ...rest }) => rest));
        got.suggestions.forEach((s, i) => {
          assert.equal(s.why.split(';')[0], want.suggestions[i].why.split(';')[0]);
          assert.equal(s.source.title, want.suggestions[i].source.title);
          assert.deepEqual(Object.keys(s.source), ['title', 'name']);
        });
      }

      // The same week in the shared session shape, and the fallback passes its own guardrail.
      const booked = got.actions.filter((a) => a.kind === 'addWorkout');
      assert.equal(got.sessions.length, booked.length);
      got.sessions.forEach((s, i) => {
        assert.equal(s.start, booked[i].after.start);
        assert.equal(s.id, booked[i].sessionId);
        assert.deepEqual(s.basedOn, booked[i].basedOn);
        assert.deepEqual(got.reasons[s.id].map((r) => r.code), booked[i].reasons.map((r) => r.code));
      });

      // Intentional divergence: the bundle's own week is 7 local days starting today (Python: tomorrow), with a session today
      // only when it starts an hour or more after now and ends by 22:00. That week passes the guardrail.
      const week = recommendWeek(input);
      const today = c.input.now.slice(0, 10);
      const last = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10);
      for (const s of week.sessions) {
        assert.ok(s.day >= today && s.day <= last, `${s.id} is outside ${today}..${last}`);
        if (s.day === today) assert.ok(Date.parse(s.start) >= Date.parse(c.input.now) + 3600e3, `${s.id} starts too soon`);
      }
      assert.ok(week.signals.plannedLoad <= week.signals.loadCap || week.sessions.every((s) => s.minutes <= 20), 'over the limit');
      const { busy, ...context } = input;
      const checked = checkPlan({ plan: { sessions: week.sessions }, context: { ...context, calendar: busy } });
      assert.deepEqual(checked.violations, []);
      assert.equal(checked.pass, true);
    });
  }
  assert.equal(overCap, 33); // the cases the second trim pass changes
});
