# Contract

The shapes the three engines and the app agree on, and the tests that run the engines together. [AGENTS.md](AGENTS.md) is the contract itself; read it first.

- `schemas/`: the shared values as JSON Schema.
- `fixtures/`: valid examples for three sample people (`sam`, `alex`, `jordan`), invalid ones named by what is wrong, the hand-offs with their results, and `swift/` (one list per type, to decode as `[Type]`).
- `src/`: `validateAs(name, value)` and the hand-off functions the app mirrors in Swift. No dependencies.
- `tests/`: the fixtures, and one week run over the three phone bundles.

## Use

Needs Node.js 20 or newer. Run from `contract/`; there is nothing to install.

1. `npm test` runs every test against the committed bundles (`dist/` in each engine). After changing an engine, run `npm install && npm run build` in its folder first.
2. A bundle that is missing is skipped and named; with `EVERGREEN_STRICT=1` it fails.
3. `npm run check` prints which globals are there and whether their results fit.
4. After changing a schema, run `npm run generate`. It rewrites `src/schemas.mjs` and `fixtures/`.

Bundles elsewhere: set `EVERGREEN_MEMORY_BUNDLE`, `EVERGREEN_RECOMMEND_BUNDLE` and `EVERGREEN_CALENDAR_BUNDLE` to the three files.

In an engine's tests: `import { assertValid } from '../../contract/src/index.mjs'`.
