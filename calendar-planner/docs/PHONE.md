# Phone host

`dist/calendar-phone.js` sets three globals; each returns one JSON string and never throws or saves. See `contract/AGENTS.md`. Failure: `{"ok":false,"error":{"code","text"}}`; show `text`.

**`calendarPlan`** takes:

- `intent`, or `request` (a sentence, read by rules).
- `now`: ISO with offset. `tzOffsetMinutes`: minutes east of UTC. `tzChanges?`: `[{at, tzOffsetMinutes}]`.
- `events`: `[{id, title, start, end, fixed: true}]`.
- `workouts`: `[{id, sessionId?, activity, title?, start, end, minutes, group?}]`.
- `memory?`: `{slots: [{key, activity, weekday, hour, minutes}], declined: [ids], paceMinPerKm}`.

**`calendarIntentSchema()`** returns the JSON Schema of `intent`: `{kind, activity?, title?, minutes?, sessionId?, targetWorkoutId?, day?, after?, exact?, before?, partOfDay?, raceDate?, distanceKm?}`. `kind`: `add | move | resize | cancel | race`.

**`calendarReplan`** takes the same, with `plan` (the last result) and `change` in place of the request:

- `{type: "drag", id, start}`
- `{type: "answer", answerId}`
- `{type: "text", text}` or `{type: "text", intent}`

Both return:

- `ok`, `kind` (the intent kinds, `question` or `none`), `message`.
- `proposed`: `[{id, sessionId?, activity, title, start, end, minutes, status, reason}]`. `status`: `new | moved | resized | cancelled`. `rest` spans its day, `minutes: 0`.
- `question?`: `{text, answers: [{id, label}]}`, at most three; none: reply with a `text` change.
- `undoToken`, `replaces?`: this proposal's id and the one before.
- `state`: opaque; save `state.declined` into `memory.declined`.

Confirm and undo are the app's job: write `proposed` on confirm and keep what it replaced under `undoToken`.

```js
const call = (name, args) => JSON.parse(globalThis[name](JSON.stringify(args)));
const week = { now: '2026-11-09T09:00:00-08:00', tzOffsetMinutes: -480, workouts: [],
  events: [{ id: 'e1', title: 'Team sync', start: '2026-11-09T17:00:00-08:00', end: '2026-11-09T18:00:00-08:00', fixed: true }] };
const first = call('calendarPlan', { ...week, intent: { kind: 'add', activity: 'walk', minutes: 30, day: '2026-11-09', after: '17:00', partOfDay: 'evening' } });
const moved = call('calendarReplan', { ...week, plan: first, change: { type: 'drag', id: first.proposed[0].id, start: '2026-11-09T20:00:00-08:00' } });
```
