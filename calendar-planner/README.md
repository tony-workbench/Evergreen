# Calendar planner

The planning engine for Evergreen's calendar: one script the iOS app loads in JavaScriptCore.

It takes a request as one sentence ("find me 45 minutes for a walk after 8 tonight", "move Sunday's long run to the afternoon", "my race is on the 29th") or as a structured intent from an agent. It plans around the person's events and workouts in local time and returns proposed blocks, each with a one-sentence reason. It asks one merged question when linked workouts may need to move together. It never saves anything: the app writes the proposal.

It is built on [Plan Calendar](https://github.com/tony-workbench/plan-calendar): the same planner core and its rules, search and hybrid approaches, with local time, fitness words and a phone entry added. The engine uses no model, network or key. Shared values follow [`contract/AGENTS.md`](../contract/AGENTS.md).

## Run it

You need Node.js 20 or newer.

1. `npm install`
2. `npm test` runs the tests.
3. `npm run demo` prints six example sentences and their proposals.
4. `npm run build` writes `dist/calendar-phone.js`. The app ships a copy as `app/Evergreen/Resources/Engines/calendar-phone.js`.

## Docs

- [Phone host](docs/PHONE.md): the three functions and every field.
