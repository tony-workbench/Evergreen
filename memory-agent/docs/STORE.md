# Memory store

Markdown facts per user.

Provisional: what the user can say or tap is not decided; see docs/PREFERENCE.md.

## Facts

Constructors make facts; lines re-render.

| Kind | Template | Home |
| --- | --- | --- |
| tap | `Declined 1 run suggested for Wed 07:00 as too early (recommendation rec_00000001)` | feedback |
| decline | `Declined 1 run suggested for Wed 07:00 (recommendation rec_00000001, no reason given)` | feedback |
| earlier | `Earlier: 12 declines as too early` | feedback |
| accept | `Accepted 1 run suggested for Wed 07:00 (recommendation rec_00000001)` | feedback |
| standing | `Declined 2 suggestions as too early (Wed 07:00; Fri 06:00)` | preferences |
| change | `At the change on 2026-11-18T12:00:00.000Z: 2 declines as too early moved to history; new count starts at 0` | preferences |
| history | `Recorded 2 declines as too early; changed on 2026-11-18T12:00:00.000Z (reason given: schedule change)` | history |
| daily | `[daily] 2026-10-01: Running 40 min, Walking 30 min` | rolling |
| weekly | `[weekly] Week of 2026-09-28: 3 workouts, 120 min` | rolling |
| profile | `4-week average: 3 workouts per week (as of 2026-11-18, valid until 2026-11-19)` | profile |
| mix | `Last 4 weeks by type: Running 6, Walking 4 (as of 2026-11-18)` | profile |
| coverage | `Workouts logged on 5 of the 28 days ending 2026-11-17` | rolling |
| thin | `Days of data: 9 (ending 2026-11-17)` | rolling |
| today | `On 2026-11-17: 1 counted workout (10 minutes or more) and 45.94 workout minutes.` | rolling |

- After a change: `Declined 2 suggestions as too early since 2026-11-18T17:00:00.000Z (Wed 07:00; Fri 06:00)`.
- Engine sentences (`F.computed({ id, text })`): today, week (rolling); load, regularity, body (profile); text must match the engine template.
- One value per key; standing, change, history store-derived; canonical order.
- The average is workouts/4; left-out days count as unlogged.
- A new aggregate (weekly, coverage, profile, mix, days of data) names left-out days (forgotten); it reads `(N forgotten days left out)`.

## Files

Ids: `usr_`/`rec_` plus 8-32 hex. Files: `about-user/profile.md`, `health/rolling.md`, `preferences/workouts.md`, `feedback/recommendations.md`, `history/preferences.md`. `memoryIndex` prints profile and preferences in full; rolling as weekly lines, the latest 7 daily lines, a count of the rest; others as counts.

## Write path

1. Check folder; validate.
2. Write `<target>.memtmp`, `fsync`, read back.
3. Rename, `fsync` the directory (new too), read back.
4. Delete: remove, sync.

Temp files are swept at construction, in `recover`, before a forget ends.

## Journal

| Journaled | Op |
| --- | --- |
| `changePreference` | `change_preference` |
| `forgetRecommendation` | `forget_recommendation` |
| other `forget...` | `forget_*` |

`journal.json` is written first, applied idempotently; `recover` runs before reads.

## Failures

- Bad or suppressed fact, read-back or sync failure: `false`, `lastError`.
- Invalid or unreadable file, bad `forgotten.json`, open journal: `MemoryUnavailableError`.
- Symlink or swapped folder: `PathEscapeError`; failed restore: `UnrecoveredWriteError`.
- Bad action, forgotten id, late or out-of-order outcome: `{ written: false, why }`.

Tolerated sync errors: `ENOTSUP`, `EOPNOTSUPP`; Windows also `EINVAL`, `EPERM`, `EISDIR`.

## Feedback

`recordFeedback` needs `action` (`accepted`/`declined`); a decline may omit reason. Two declines of a reason make a standing entry. Each change (own moment) moves reasoned declines (kept or folded) up to then into its own history entry; its change fact counts them. The file keeps the latest 30 outcomes; older fold into `Earlier:` counts.

## Forgetting

`forgetRecommendation` removes one outcome (also from a fold or history; its change fact follows), suppressing its id (not written back); `forget` on preferences drops a reason. `forgetFactType` and `forgetFactKey` remove and suppress a derived type or key; a daily key means that DAY: aggregates covering it go too; a `regularity` key is one fixed slot (`running.sun.08`), a `body` key `sleep` or `resting_hr`; `suppressedTypes` returns `types`, `keys`, `days`; `forgetDerived` deletes a file; `restore...` undoes. A lone derived line stays.

`forgotten.json`: sha256 hashes of ids and derived kinds, plus `type:daily`, `key:weekly:2026-09-28`, `day:2026-10-01`. Changed preferences go to history; computed facts are replaced by the next computation.

## Running on the phone

The core imports no `node:` module (`src/store/node/` adapts). `opts.io` is required; its methods are in `docs/PHONE.md`.
