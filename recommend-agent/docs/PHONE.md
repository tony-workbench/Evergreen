# Phone host

`dist/recommend-phone.js` sets six globals: JSON string in, JSON string out, never a throw. Success: `{"ok":true,...}`. Failure: `{"ok":false,"error":{"code","text"}}`. No network, clock or model, and no web address in or out.

Shared values follow `contract/AGENTS.md`: ISO 8601 times with offset; `memory` is `{rows}` (a `key` goes into `basedOn`, never parsed); activities: `run`, `long_run` (the longest run, 60+ minutes), `walk`, `strength`, `yoga`, `ride`, `elliptical`, `swim`, `stretch`, `rest`, `other` (named by `data.label`).

- `recommendWeek({now, history, memory?, calendar?, stopped?, shoes?, newPairArrives?, raceDate?})`: the no-key week: `sessions` (`{id, day, start, minutes, activity, intensity, reason, basedOn}`), `reasons` (`{sessionId: [{code, text}]}`), `notes`, `summary`, `summaryReasons`, `suggestions`, `signals`, `actions`.
- `planContext({now, tz?, memory, calendar?, stopped?, shoes?, raceDate?, newPairArrives?, history?})`: `usualWeek`, `maxSessions`, `maxMinutes`, `loadThisWeek`, `loadUsual`, `loadCap`, `loadUnit`, `readiness`, `freeSlots`, `shoe`, `race`, `stoppedSlots`, `stoppedKeys`, `memoryKeys`, `limits`.
- `planBrief({context})`: `{lines}`, the week's limits as sentences for the model.
- `checkPlan({plan: {sessions}, context})`: `{pass, violations: [{code, text, sessionId?}], hints: [{code, action?, sessionId?, fix}], load}`; `hints[i]` fixes `violations[i]`; `context` is `planContext`'s input.
- `explainAction({action, memory})`: `{text, basedOn, memory: [{key, found, text}]}`.
- `checkWeek({sessions, calendar})`: `{conflicts: [{code, action, id, start, end, text, fix}]}`.

`history`: `{workouts: [{activityType, start, end, durationMin?, avgHeartRate?, effort?, distanceKm?}], daily: [{date, sleepMin?, restingHeartRate?}]}`, as read from Apple Health. Without it, `planContext` and `checkPlan` work from memory rows, in minutes. `shoes` is `{boughtOn, startMiles}`: a worn pair moves long runs off the road, and a new pair starts with two short easy runs.

`checkPlan` codes: `invalid_session`, `unknown_activity`, `bad_duration`, `outside_window`, `overlap`, `calendar_conflict`, `load_over_cap`, `hard_when_tired`, `race_day_session`, `no_rest_before_race`, `taper_too_long`, `worn_shoes_long_run`, `break_in_too_long`, `break_in_not_easy`, `too_many_sessions`, `too_many_minutes`, `too_many_days_in_a_row`, `back_to_back_hard`, `unknown_memory_key`, `stopped_memory_key`, `stopped_slot`.

The week is 7 local days from today; a session today starts 60+ minutes after `now` and ends by 22:00. A week may sit 10% over `loadCap`.

- `stopped_slot`: a usual time listed in `stopped: [{key?, activity, weekday, hour}]`.
- `too_many_sessions`: over the usual training days plus one (else 3).
- `too_many_minutes`: over the usual weekly minutes after a heavy 7 days; else over 1.1 times them or the usual week's minutes.
- `too_many_days_in_a_row`: more than the usual week has (3 allowed).
- `back_to_back_hard`: unless both days are usually hard.

```js
const call = (name, args) => JSON.parse(globalThis[name](JSON.stringify(args)));
const day = (ago) => new Date(Date.UTC(2026, 10, 20 - ago)).toISOString().slice(0, 10);
const run = (ago) => ({ activityType: 'Running', start: `${day(ago)}T18:00:00-08:00`, end: `${day(ago)}T18:50:00-08:00`, avgHeartRate: 130 });
const history = { workouts: [24, 17, 10, 3].map(run), daily: [] };            // four Tuesday evenings
const memory = { rows: [{ memoryId: 'm1', key: 'k1', kind: 'usual_slot', state: 'saved', statement: 'Runs on Tuesday evenings.',
  data: { activity: 'run', weekday: 1, hour: 18, minutes: 50, weeksSeen: 4, weeksTotal: 4 } }] };
const context = { now: '2026-11-20T09:00:00-08:00', history, memory, raceDate: '2026-11-29' };
const numbers = call('planContext', context);
const brief = call('planBrief', { context });
const week = call('recommendWeek', context);
const checked = call('checkPlan', { plan: { sessions: week.sessions }, context });
const tuesday = week.sessions.find((s) => s.basedOn.includes('k1'));
const why = call('explainAction', { action: tuesday, memory });
const result = { maxMinutes: numbers.maxMinutes, line: brief.lines[5], pass: checked.pass, start: tuesday.start, minutes: tuesday.minutes, why: why.text };
```
