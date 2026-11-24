# How the agents connect

One contract for the three agents and the app. Every bundle and the Swift code follow it; `contract/schemas/` holds the JSON Schemas and `contract/tests/` runs the three bundles together.

## The parts

| Part | Runs | Thinks with | Owns |
| --- | --- | --- | --- |
| Fact engine (`memory-agent`) | Code, daily | nothing | Exact facts from Health data |
| Memory agent (`memory-agent`) | Once a day | The person's model | Versioned memories and the daily table |
| Recommendation agent (`recommend-agent`) | When the table or the week changes, or on request | The person's model | A proposed week |
| Calendar agent (`calendar-planner`) | When a session is accepted, or on request | The person's model | Where a session goes in the real week |
| App (Swift) | Always | nothing | The plan, the calendar writes, the key, the screen, earned screen time |

The agents never call each other. The app passes one agent's output to the next (hub and spoke), so every hand-off is a typed value that can be checked and tested.

## The loop

1. **Facts.** After local midnight the fact engine rolls the day that ended.
2. **Remember.** The Memory agent gets the day's facts and outcomes, proposes changes, code applies them, and `memoryTable` returns the table.
3. **Recommend.** The Recommendation agent gets the table and `planContext`, proposes a week, and `checkPlan` must pass before anything is shown.
4. **Place.** When the person accepts a session, the Calendar agent turns it into an `intent` for `calendarPlan`, which finds the exact time around real events and returns a preview.
5. **Confirm.** A session that fits without moving anything is written at once, because the person just asked for it. Anything that moves another block or asks a question is written only after the person confirms the preview. The app records the action so it can be undone.
6. **Feedback.** "Not now" rejects the usual time the session stands on: the `usual_slot` rows with the session's activity, weekday and start hour. Other rows it cites (volume, sleep, load, mix) are never rejected this way. Done and missed sessions become tomorrow's `outcomes`. Then the loop repeats.

A sentence typed in Ask goes to a router that picks one agent, or chains Recommend then Place for requests such as "plan my week".

## Shared values

These are identical in every bundle and in Swift. The schemas are the source.

- **Time:** ISO 8601 with offset. Days are local `YYYY-MM-DD`. Hours are 24-hour integers.
- **Activity:** one closed list: `run`, `long_run`, `walk`, `strength`, `yoga`, `ride`, `swim`, `elliptical`, `stretch`, `rest`, `other`. `other` is anything not named; a memory row's `data` may then carry `label`, the original name. Display names are the app's job.
- **Memory row:** `{ memoryId, key, slot, group, kind, statement, data, state, confidence, since, updated }`. `key` is opaque: nobody parses it. Anything a consumer needs is in `data`, by `kind`:
  - `usual_slot`: `{ activity, weekday (0-6, Monday 0), hour, minutes, weeksSeen, weeksTotal }`
  - `weekly_volume`: `{ workoutsPerWeek, minutesPerWeek }`
  - `load`: `{ minutes7d, ratioToUsual }`
  - `sleep`: `{ hours7d, hours28d }`
  - `resting_hr`: `{ bpm7d, bpm28d }`
  - `mix`: `{ byActivity: { activity: count } }`
  - `response`: `{ about, pattern }` (for example skipped early sessions)
  - `gear`: `{ item, km, boughtOn }`
  - `goal`: `{ what, date }`
- **Session:** `{ id, day, start, minutes, activity, intensity ("easy"|"steady"|"hard"), reason, basedOn: [memory key] }`. `id` is stable for the same day, activity and start.
- **Preview block:** `{ id, sessionId?, activity, title, start, end, minutes, status ("new"|"moved"|"resized"|"cancelled"), reason }`.
- **Outcome:** `{ sessionId, day, activity, plannedStart, done, actualStart?, actualMinutes? }`.
- **Error:** `{ ok: false, error: { code, text } }`. `text` is one plain sentence the app can show.

Details the lines above leave open (the schemas enforce them):

- **Time, exactly:** `YYYY-MM-DDTHH:MM:SS` with an optional fraction, then `+HH:MM` or `-HH:MM`. `Z` is not accepted, because the local day must be readable from the text.
- **Closed values:** a row, session, block, outcome, intent or error has no other fields. A result (table, plan, plan check, calendar result) has `ok: true` and may carry more fields.
- **Memory row fields:** `memoryId`, `key` and `slot` are non-empty opaque strings (`slot` names the memory this row is a version of); `group` is `routine`, `body`, `load`, `response`, `gear` or `goal`; `state` is `candidate`, `saved`, `confirmed`, `rejected`, `superseded` or `inactive`, and the table holds only `saved` and `confirmed`; `confidence` is 0 to 1; `since` and `updated` are days.
- **Row data:** `usual_slot.minutes` is the usual length (5 to 240); `load.ratioToUsual` is null when there is no usual load; `gear.boughtOn` and `goal.date` are a day or null; `mix.byActivity` has only Activity names.
- **Session fields:** `minutes` is 0 for `rest`, else 5 to 240; `basedOn` may be empty.
- **Preview block:** a rest day spans its day, midnight to midnight, with `minutes: 0`.
- **Memory table:** `{ ok: true, rows: [Memory row] }`.
- **Plan:** `{ ok: true, sessions: [Session], summary }`. **Plan check:** `{ ok: true, pass, violations: [{ code, text, sessionId? }] }`; `pass` is true only with no violations.
- **Calendar intent:** `{ kind ("add"|"move"|"resize"|"cancel"|"race"), activity?, title?, minutes?, sessionId?, targetWorkoutId?, day?, after?, exact?, before?, partOfDay?, raceDate?, distanceKm? }`; `after` and `before` are local `HH:MM`; `exact: true` means start exactly at `after` and needs `after`; `add` needs `activity`, and its `sessionId` comes back on the proposed block; `title` (1 to 60 characters) is the block's title, mainly for `other`.
- **Calendar result:** `{ ok: true, kind ("add"|"move"|"resize"|"cancel"|"race"|"question"|"none"), message, proposed: [Preview block], question?: { text, answers: [{ id, label }] }, undoToken, replaces?, state }`.
- **Evidence:** `[{ id, text, numbers }]`, with whatever else the model needs. An outcome is the item with id `outcome.<sessionId>` (a character other than a letter, digit, `_` or `-` becomes `_`) and `numbers.done`.
- **Session id:** letters, digits, `_` and `-` only.
- **User id:** `usr_` and 8 to 32 hex characters (`usr_5a17c0de`), never a name or an email. The memory store accepts nothing else.
- **Stopped slot:** `{ key?, activity, weekday, hour }`, the data of a `usual_slot` row the person rejected. A session with that activity, weekday and start hour fails `checkPlan` with `stopped_slot`, and `recommendWeek` never proposes it.
- **Plan size:** a week has at most `maxSessions` sessions (rest not counted) and, when `maxMinutes` is a number, at most `maxMinutes` minutes in all. `checkPlan` rejects more with the codes `too_many_sessions` and `too_many_minutes`; a model shortens or drops sessions to fit.
- **Plan window:** 7 local days starting today (the local day of `now`). A session today starts at least 60 minutes after `now` and ends by 22:00; otherwise today is empty. `checkPlan` rejects a session outside the window.

## Calls

Every global takes one JSON string and returns one JSON string. It never throws: a failure is an Error value. The bundles are `memory-agent/dist/memory-phone.js`, `recommend-agent/dist/recommend-phone.js` and `calendar-planner/dist/calendar-phone.js`.

| Global | Takes | Returns |
| --- | --- | --- |
| `memoryDailyRequest` | `{ root, user, now, snapshot, outcomes: [Outcome], extras?: { gear?, goal? } }`; `extras` is what the app knows about gear and the goal | `{ ok: true, day, evidence }` and whatever the model needs |
| `memoryDailyApply` | `{ root, user, now, day, proposals }`; `proposals` is the model's answer as it came | `{ ok: true, applied: [...] }` |
| `memoryDemoModel` | what `memoryDailyRequest` returned | a rule-based stand-in for the model's answer: for tests, and the app's fallback when the model gives no usable answer |
| `memoryTable` | `{ root, user }` | Memory table |
| `memoryReviewQueue` | `{ root, user }` | `{ ok: true, rows: [{ memoryId, key, kind, statement, data, ... }] }`, what the person is asked about |
| `memoryForget` | `{ root, user, what: "day", day, snapshot }` | `{ ok: true }`; it rolls again from the snapshot, so the table is never left empty |
| `memoryReject`, `memoryRestore`, `memoryConfirm` | `{ root, user, key, now }` | `{ ok: true }`; the next `memoryTable` shows the change |
| `planContext` | the context `{ now, memory: { rows }, stopped: [Stopped slot], calendar: [{ start, end, title }], history: { workouts, daily } }` | `{ ok: true, maxMinutes, maxSessions }` and whatever the model needs; `maxMinutes` is null when the usual minutes are not known |
| `planBrief` | `{ context }` | `{ ok: true, lines }`, the week's limits as sentences for the model |
| `checkPlan` | `{ plan: { sessions }, context }` with the same context | Plan check |
| `recommendWeek` | the same context | Plan, by rules alone |
| `calendarPlan` | `{ intent or request, now, tzOffsetMinutes, events, workouts, memory }` | Calendar result |
| `calendarReplan` | the same with `plan` and `change` in place of the intent | Calendar result |
| `calendarIntentSchema` | nothing | the Calendar intent schema |

The recommendation bundle sets six globals: `recommendWeek`, `planContext`, `planBrief`, `checkPlan`, `explainAction` and `checkWeek`; `recommendWeek` plans from `history`. The memory bundle sets 13 globals: the nine above and `memoryRoll`, `memoryState`, `memoryPlannerText`, `memoryBrief` for the facts. Each engine's `docs/PHONE.md` lists every field.

A bundle may also set `recommendDemoModel({ context, rows })`, a fixed stand-in that returns `{ sessions, summary }`; the week test uses its own scripted model when it is not there. The memory model's answer is the memory agent's own format, so the week test needs `memoryDemoModel`.

## Hand-off functions

`contract/src/adapt.mjs` is the reference; Swift does the same.

- `sessionToIntent(session, rows)`: `{ kind: "add", activity, minutes, sessionId, day, after, exact: true }`, with `after` the local `HH:MM` of `start`: an accepted suggestion goes at the time that was shown. For `other`, `title` is the `data.label` of the first `basedOn` row that has one, cut to 60 characters. A rest session gives `{ kind: "add", activity: "rest", sessionId, day }`.
- `rowsToCalendarMemory(rows)`: `{ slots: [{ key, activity, weekday, hour, minutes }] }`, one for each saved or confirmed `usual_slot` row, copied from `data`.
- `outcomesFor(planRecords, healthWorkouts, day)`: one Outcome for each plan record `{ sessionId, day, activity, plannedStart }` of that day except rest. It is done when a Health workout of the same activity started that local day; each workout counts once, the closest planned and actual starts first. A Health run counts for `run` and `long_run`.
- `rowsToStopped(rows)`: `{ key, activity, weekday, hour }` for each `usual_slot` row given: the rows the app has rejected.
- `keysToReject(session, rows)`: the keys of the `usual_slot` rows whose `data.activity`, `data.weekday` and `data.hour` are the session's activity, weekday and start hour. Never every key in `basedOn`: the model chose those.

## Hand-offs

| From | To | Value | Rule |
| --- | --- | --- | --- |
| Fact engine | Memory agent | `evidence[]` | The model may only state numbers found here |
| Memory agent | Recommendation agent | `memoryTable.rows` | Only saved and confirmed rows |
| Memory agent | Calendar agent | rows of kind `usual_slot` | Used as preferred times |
| App | Recommendation agent | `stopped`: Stopped slot[] | Rejected rows are not in the table, so the app passes their slots |
| Recommendation agent | App | `Session[]` | Shown only after `checkPlan` passes |
| App | Calendar agent | one `Session` | Becomes the intent from `sessionToIntent` |
| Calendar agent | App | `PreviewBlock[]`, optional question | Nothing is written yet |
| App | Memory agent | `key`s of the matching `usual_slot` rows | On "Not now": `memoryReject` each key from `keysToReject` |
| App | Memory agent | `Outcome[]` | Next day's evidence |

## Rules that hold everywhere

- A model proposes; code checks and executes. No agent writes to the calendar, opens a link or changes memory by itself.
- `basedOn` may only contain keys present in the table the agent was given. `checkPlan` rejects anything else.
- A rejected memory row is never used and never comes back without the person restoring it.
- One failure stops the chain with nothing half-written; the last good screen stays.
- The key stays in the Keychain and goes only to the model provider.

## Tests

`contract/tests/week.test.mjs` loads the three built bundles in one JavaScript context with a scripted model and runs a week: table, plan, guardrail, placement, a "Not now", the next day's table and plan without that row, and outcomes feeding memory. Each bundle also validates its inputs and outputs against `contract/schemas/` in its own tests, and Swift decodes the same fixtures.
