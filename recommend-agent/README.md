# Recommendation agent

The week planner's rules. No server, model or network. A model proposes a week; this code gives it the numbers, checks its plan, and plans the week itself when there is no model.

## Use it

```sh
npm install
npm test
npm run build     # writes dist/recommend-phone.js
npm run sample    # prints a sample week, its brief and its check
```

Needs Node.js 20 or newer. The app loads a copy of `dist/recommend-phone.js` in JavaScriptCore; [docs/PHONE.md](docs/PHONE.md) lists its globals.

## What is inside

- `src/workouts.mjs`: the week, from 4 weeks of history, memory rows, race taper, sleep, resting heart rate, shoe wear, weekly load and the calendar.
- `src/plan.mjs`: `planContext` (the numbers), `planBrief` (the limits as sentences), `checkPlan` (every hard rule as a check).
- `src/memory.mjs`: the memory table rows and the activity list.
- `data/workout_ideas/`: optional extras for a run, each with the guide it comes from.

## Tests

`tests/fixtures/workouts.json` holds 76 recorded weeks. `npm test` plans each again and compares days, activities, minutes, start times, memory keys and reason codes. The sample histories live in `tests/support/`, never in the bundle.

`EVERGREEN_STRICT=1 npm test` fails instead of skipping when the contract folder is missing.
