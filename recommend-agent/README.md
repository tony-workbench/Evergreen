# Recommendation agent

The week planner's rules. No server, model or network. A model proposes a week; this code gives it the numbers, checks its plan, and plans the week itself when there is no model.

## Use it

```sh
npm install
npm test
npm run build     # writes dist/recommend-phone.js
npm run sample    # prints a sample week, its brief and its check
npm run eval:home # plans 30 home weeks and grades each one
```

Needs Node.js 20 or newer. The app loads a copy of `dist/recommend-phone.js` in JavaScriptCore; [docs/PHONE.md](docs/PHONE.md) lists its globals.

## What is inside

- `src/workouts.mjs`: the week, from 4 weeks of history, memory rows, race taper, sleep, resting heart rate, shoe wear, weekly load and the calendar.
- `src/plan.mjs`: `planContext` (the numbers), `planBrief` (the limits as sentences), `checkPlan` (every hard rule as a check).
- `src/memory.mjs`: the memory table rows and the activity list.
- `src/rules.mjs`, `src/homeweek.mjs`: My rules, each day's kind (home, out, rest) and the week at home, kept day by day.
- `src/content.mjs`, `data/movements.json`: a session's movements, sets and reps, built by code from the movement library, and `checkContent`, its check.
- `data/workout_ideas/`: optional extras for a run, each with the guide it comes from.

## Tests

`tests/fixtures/workouts.json` holds 76 recorded weeks. `npm test` plans each again and compares days, activities, minutes, start times, memory keys and reason codes. The sample histories live in `tests/support/`, never in the bundle.

`npm run eval:home` (`scripts/eval-home-weeks.mjs`) plans 30 different home weeks, from no day at home to four, with different equipment, movements to avoid, calendars and session lengths, and grades each: no session on a day out or a rest day, nothing avoided or not owned, sessions within the time, and at least the weekly floor of sets for each movement pattern. It prints one line per week and exits 1 on any failure; `tests/eval-home-weeks.test.mjs` runs it inside `npm test`.

`EVERGREEN_STRICT=1 npm test` fails instead of skipping when the contract folder is missing.
