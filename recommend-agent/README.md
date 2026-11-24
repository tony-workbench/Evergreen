# Recommendation agent

The week planner's rules. No server, model or network. A model proposes a week; this code gives it the numbers, checks it, and plans the week itself without a model.

## Use it

```sh
npm install
npm test
npm run build     # writes dist/recommend-phone.js
npm run sample    # prints a sample week, brief and check
npm run eval:home # 30 home weeks, one lever per comparison (docs/HOME.md)
```

Needs Node.js 20+. The app runs `dist/recommend-phone.js` in JavaScriptCore; [docs/PHONE.md](docs/PHONE.md) and [docs/HOME.md](docs/HOME.md) list its globals.

## What is inside

- `src/workouts.mjs`: the week, from history, memory, race taper, sleep, resting heart rate, shoe wear, load and calendar.
- `src/plan.mjs`: `planContext` (the numbers), `planBrief` (the limits as sentences), `checkPlan` (every hard rule).
- `src/memory.mjs`: memory table rows and the activity list.
- `src/rules.mjs`, `src/homeweek.mjs`, `src/content.mjs`: My rules, the week at home, and each session from `data/movements.json`.
- `data/workout_ideas/`: extras for a run.

## Tests

`tests/fixtures/workouts.json` holds 76 recorded weeks. `npm test` plans each again and compares days, activities, minutes, start times, memory keys and reason codes. The sample histories live in `tests/support/`, never in the bundle.

`EVERGREEN_STRICT=1 npm test` fails instead of skipping when the contract folder is missing.
