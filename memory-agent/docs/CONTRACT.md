# Contract

The snapshot goes in, facts come out. `validateSnapshot` and `validateFacts` (`src/contract/`) return `{ ok, errors }`; `computeFacts(snapshot, now, { dayMode, suppressed })` (`src/facts/`) returns the facts.

## Snapshot

| Field | Rule |
| --- | --- |
| `exportDate`, `start`, `end` | ISO 8601 with offset; hour 0-23, minute and second 0-59, at most 3 fractional digits, real date (`parseTimestamp`) |
| `persona.key` | non-empty string |
| `dailySummaries[]` | `date` YYYY-MM-DD; optional `restingHeartRate` 0-250, `steps`, `sleepMinutes.totalAsleep` 0-1440 (at most 6 decimals) |
| `workouts[]` | `activityType`, `start`, `end`, `durationMin` >= 0; optional `effort` 1-10 (2 decimals); other fields are never read or output |
| `target.workoutsPerWeek` | optional; > 0, at most 2 decimals |
| `calendar.events[]` | Optional events with title and start/end. Validated, then ignored: no fact reads them. |

## Facts

`{ id, group, text, numbers, window }`: one sentence with a number, the values shown, and the days covered (`7d`, `28d`, `a vs b`). Same input, same bytes.

| Id | Group | States | Key numbers |
| --- | --- | --- | --- |
| `history.thin` | history | days of data, fewer than 14 (only fact); window = first to last logged date | `daysOfData`, `spanDays` |
| `coverage.28d` | coverage | logged days behind the load average | `loggedDays` |
| `volume.today`, `volume.today_so_far`, `volume.today_unlogged` | volume | counted workouts and minutes of the day | `workouts`, `minutes`, `shortWorkouts` |
| `volume.week`, `volume.28d` | volume | counted totals, logged and unlogged days | `workouts`, `minutes`, `loggedDays`, `unloggedDays` |
| `past.today_vs_avg` | past | day against previous 28 days | `ratio`, `percent`, `averageMinutesPerDay` |
| `past.today_vs_highest` | past | day at 2x or more the highest day | `ratio` |
| `past.today_rank` | past | rank among 28 days | `rank`, `of` |
| `past.week_vs_avg` | past | 7 days against the 4-week average | `ratio`, `percent` |
| `past.week_rank` | past | rank among 12 complete weeks | `rank`, `of` |
| `past.week_comparisons_skipped` | past | week not fully logged | `loggedDays` |
| `load.ratio` | load | 7-day load against 28-day weekly average | `basis`, `load7`, `ratio` |
| `regularity.days_since_last` | regularity | days since last counted workout, as of the last completed day | `asOf`, `daysSinceLast` |
| `regularity.longest_gap` | regularity | longest run of logged days without one | `gapDays`, `unloggedDays` |
| `regularity.per_week` | regularity | counted workouts per week | `perWeek`, `loggedDays` |
| `regularity.slot` (id `regularity.slot.<activity>.<Day>.<HH>`), `regularity.slots_none` | regularity | same activity, weekday and hour in 3 of 4 weeks | `weekday`, `hour`, `hourEnd` |
| `mix.count`, `mix.median_length`, `mix.start_bands` | mix | by activity and start time | `byActivity` |
| `body.sleep`, `body.resting_hr` | body | 7-day against 28-day average | `average7`, `average28` |
| `goal.workouts_per_week` | goal | week against baseline | `ratio` |
| `goal.target_progress` | goal | week against the target | `ratio`, `percentOfTarget` |

## Rules

- **Counted workout:** 10 minutes or more. Shorter ones make their day logged and are stated, not counted. Repeats (same activity and instant) count once.
- **Days:** local date of the timestamp. Workouts not ended by `now` are ignored. Unknown activities read `Other`, no slot. Strength types read "strength training" unless both share a sentence.
- **Unlogged days** are unknown, never zero. Weekly comparisons need 7 logged days, averages 7, body facts 3.
- **Abstention:** under 14 logged days, only `history.thin`.
- **Wording:** State both numbers and ratio. Percentages require nonzero values and ratios 0.1–10. Zero baselines have no ratio; equality is exact. Effort weights require complete effort data. Minutes are exact to milliseconds. Display averages and ratios to two decimals; exact fractions live in `numbers.exact`.
- **Conflicts rejected:** two different summaries for one date; same activity, instant and duration with different `effort`. `computeFacts` validates first and throws.
- **Day modes:** `auto` (default) reads a local midnight as `completed`, any other `now` as `in_progress`; `completed` needs a midnight and describes the day just ended. `in_progress` writes only raw counts for the unfinished day; other facts use completed days. If `exportDate` is after `now` (a look-back), summaries dated on or after the last described day are ignored.
- **No raw health data** (per-workout heart rate, routes, samples). Messages never echo input.

## Suppression

`suppressed` is `{ types, keys }`. `types` are fact ids or dot-prefixes (`body`, `body.sleep`). `keys` is `{ type: 'regularity.slot', key: 'Running.Mon.07' }`. Suppressed facts leave no hint; unknown entries throw.

- Variants follow their type (`volume.today_so_far`, `volume.today_unlogged`, `regularity.slots_none`).
- A fact restating another's value goes with it (`dependsOn` in `FACT_TYPES`, `src/facts/types.mjs`).
- Accepted limit: an aggregate equal to a suppressed value only because it rests on one record stays.

`src/contract` and `src/facts` are plain ECMAScript importing only each other; a test scans for Node-only code.

## Forgotten days

`forgottenDays: ['YYYY-MM-DD', ...]` makes those local dates unlogged in every fact: their records are ignored (a workout under two offsets goes if either date is listed). The store owns the list and passes it on every call.

## Lint and scenarios

`lintFact(text, { id })` requires the engine's template and no banned words, second person, modals or imperatives, and returns categories only. `computeFacts` lints every fact and throws on a bad line. `lintWords` skips the template. `generateScenario(kind, seed)` returns `{ snapshot, now, planted }`.
