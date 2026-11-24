# Memory agent

Evergreen's memory. Each day code turns a health snapshot into short facts (numbers with their windows, never advice) and keeps them as plain Markdown files. Once a day a model proposes what to remember from those facts, code checks and applies it, and the result is a table for the recommendation agent. It runs on the phone in JavaScriptCore; Node is only for the tests and the sample run.

## Run

Needs Node.js 20 or newer. Run everything from `memory-agent/`.

```sh
npm install                    # once: esbuild, for the phone bundle
npm test
npm run build                  # writes dist/memory-phone.js
node scripts/demo.mjs          # a sample run: 28 days for one sample person, then the table
node scripts/demo.mjs moderate # or sedentary
```

`dist/memory-phone.js` is committed: the contract tests load it, and the app ships a copy as `app/Evergreen/Resources/Memory/memory-phone.js`. The calls are in `docs/PHONE.md`.

## What the planner reads

Before the memory agent has a table, the planner reads the brief. For the `half_marathon` sample person:

```text
- Workouts: 6.5 a week (4-week average).
- Usual times: Running Tue 6 PM, Thu 6 AM, Sun 8 AM (3 of the last 4 weeks).
- Mix over 4 weeks: Running 20, Strength training 4, Yoga 2.
- Last 4 fully logged weeks: 6, 6, 7, 6 workouts.
- Load: 368 min in the last 7 days, 1.14× the 28-day weekly average.
- Average sleep: 8.7 h a night over 7 days (28-day average 8.5 h).
- Resting heart rate: 49 bpm over 7 days (28-day average 48 bpm).
```

Each line can be stopped and restored by its key; a stopped line stays out.

## The daily table

Once a day a model proposes one operation per memory (ADD, NOOP, MERGE, SUPERSEDE, REVIEW) from the day's computed facts. Code executes it behind guardrails, memories are versioned with states, and forgetting really deletes. The app makes the model call with the person's own key; this code only prepares the request and applies the answer.

`node scripts/demo.mjs` prints the table for the `half_marathon` sample person after 28 days:

```md
| Slot | What | Since | Sure? |
| --- | --- | --- | --- |
| response.run.early | 2 of 3 planned run sessions before 08:00 were not done in the last 28 days. | 2026-11-13 | confirmed |
| routine.training_place | You train at home, without gym equipment. | 2026-10-21 | likely |
| routine.mix | Workouts by activity over the last 28 days: running 20, strength training 4, yoga 2. | 2026-11-01 | likely |
| routine.weekly_volume | Weekly average over 4 weeks: 6.5 workouts and 323 workout minutes. | 2026-11-01 | likely |
| routine.run.thu_06 | Running on Thu between 06:00 and 07:00 in 3 of the last 4 weeks. | 2026-11-12 | likely |
| routine.run.sun_08 | Running on Sun between 08:00 and 09:00 in 3 of the last 4 weeks. | 2026-11-15 | likely |
| routine.run.tue_18 | Running on Tue between 18:00 and 19:00 in 3 of the last 4 weeks. | 2026-11-17 | likely |
| body.resting_hr | Average resting heart rate is 49 bpm over 7 days and 48 bpm over 28 days. | 2026-11-01 | likely |
| body.sleep | Average sleep is 8.7 h a night over 7 days and 8.5 h over 28 days. | 2026-11-01 | likely |
| load.week | Load over the last 7 days: 368 minutes, 1.14 times the 28-day weekly average. | 2026-11-01 | likely |
```

Once it has a row, this table is what `memoryPlannerText` returns. How it works: `docs/MEMORY-LOGIC.md`, section 9.

## Docs

- `docs/MEMORY-LOGIC.md`: how it works
- `docs/PHONE.md`: the calls the app makes
- `docs/CONTRACT.md`: the snapshot that goes in and the facts that come out
- `docs/STORE.md`: the fact store
- `docs/PREFERENCE.md`: stated preferences, not decided
- `docs/RESEARCH.md`: what other health apps do
