# Memory logic

How the memory turns a health snapshot and a person's taps into short facts for the planner. It writes facts only: a number and its window, never advice, judgement or prediction. Example numbers come from the code; a test checks them.

Everything below is built. Stated preferences are not decided: `docs/PREFERENCE.md`.

## Where it runs

On the phone, with no server. The app loads one bundled script (`dist/memory-phone.js`) in JavaScriptCore and calls its globals with JSON (`docs/PHONE.md`); Swift supplies file access and hashing.

## 1. With the other agents

The planner gets one text, rebuilt at local midnight: the agent's table once it has a row, the brief before that. On failure the memory returns an error and no text, and the planner continues without it. The shared contract (`contract/AGENTS.md`) fixes how the agents connect.

## 2. Flow

1. **Input:** a snapshot (workouts, daily summaries) with its point in time.
2. **Compute:** the engine writes facts for the day, the week and the last 28 days; the roll passes it the store's forgotten days and suppressed types. Raw values are never written.
3. **Write:** through the store only; every write is read back. Engine sentences are checked against the engine's templates; a few long detail facts are computed but not stored.
4. **Roll:** each day facts are recomputed and replace the old ones; daily lines (28) and weekly lines (12, fully logged weeks only) are kept. The same day twice gives identical files.
5. **Output:** `briefText`: at most 8 plain bullets and 120 words, from workouts, sleep and heart rate only, numbers rounded for reading. `fullText`: the long form, at most 600 words. Or an error, no text.

Example (midnight): `On 2026-11-17: 1 counted workout (10 minutes or more) and 45.94 workout minutes.`
Example (noon): `So far today (2026-11-17): 1 counted workout (10 minutes or more) and 45.94 workout minutes, day not finished.`
Example (brief): `Load: 250 min in the last 7 days, 1.16× the 28-day weekly average.`

## 3. When and what counts

- **During the day** (after a logged or missed workout): only the raw count so far, never a comparison, rank or percentage involving today.
- A workout counts at 10 minutes or more and once it has ended; shorter ones are mentioned as not counted.
- A day without data is unknown, not zero. A comparison that needs a complete window is not written when the window has gaps.
- Under 14 days of data the only fact is `Days of data: 9 (ending 2026-11-17)`.
- Two records of one instant are one workout; conflicting records are rejected.

## 4. Facts

- **Volume:** counted workouts and minutes for the day, 7 days and 28 days, with logged and unlogged days.
- **Against own past:** the day and the week against the person's average and rank.
- **Load:** 7 days over the 28-day weekly average (effort-weighted when every workout has a score).
- **Regularity:** days since the last workout, longest stretch without one, counts per week, fixed slots (same activity, weekday and hour in 3 of 4 weeks).
- **Mix:** counts and median length by activity, start-time bands.
- **Body:** sleep and resting heart rate over 7 days against the 28-day average (at least 3 readings).
- **Goal:** workouts per week against the baseline, and against a target if given.

A percentage appears only for a ratio between 0.1 and 10; a difference that rounds to zero keeps its direction.

## 5. Files and reading

Five files per person: `profile`, `rolling`, `preferences`, `feedback`, `history`; each fact kind has one home file. The full text has the pinned files, a compact `rolling`, and the other two as path and count. The files: `docs/STORE.md`.

## 6. Changing and forgetting

- **A stated preference changes:** the old entry moves to `history/` with the date; the count restarts at zero.
- **"Forget" a stated preference:** taps, entry and history are deleted; the same recommendation id is ignored afterwards.
- **"Stop summarising X", or one brief line by its key:** those facts and any fact restating them are deleted until restored.
- **"Forget everything computed":** the derived files are deleted until restored.

After forgetting only hashes, type names and a tombstone with a forgotten day's date remain. The day is left out of every later roll and total.

## 7. Failures

A write that cannot be read back fails and the old content stays. A half-finished change is finished or rolled back on the next read; until then no text is returned. An invalid file is refused. Late data does not rewrite the past.

## 8. Open points

- Stated preferences: what the person can say or tap (`docs/PREFERENCE.md`).
- The thresholds (10 minutes, 14 days, 3 readings, 3 of 4 weeks) are choices, not taken from a source.

## 9. The memory agent

A model proposes, code executes behind guardrails, memories are versioned with states, slot keys are English, and each day's evidence is processed once.

- **When:** once a day, after the midnight roll.
- **Evidence:** the day's computed facts, session outcomes, and gear and goal from the app; never the person's words.
- **Check:** every number in a statement must be in the cited evidence.
- **Deletion:** forgetting really deletes.
- **Output:** one table a day.

**One day.** A completed `memoryRoll` keeps the day's facts as evidence (for 35 days). `memoryDailyRequest` adds the app's outcomes and extras and returns the prompt, schema, evidence and `neighbors`: the memories in the slots this evidence can touch. Code fixes the slots an item supports (`routine.run.sun_08`), so neighbors are found by exact key. The app makes one model call for extraction and consolidation together: the neighbors are known beforehand, and it costs the person half. `memoryDailyApply` executes the answer, once per day and evidence.

**Operations.** ADD: a new saved memory in an empty slot. NOOP: the day joins the target's evidence. MERGE: a new version, same state. SUPERSEDE: a new saved memory; the old one is superseded. REVIEW: a candidate and the question "Is this right?".

**Guardrails.** The row `data` is built by code from the evidence, never taken from the model.

| Code | Dropped when |
| --- | --- |
| `bad_shape`, `bad_slot`, `slot_family`, `kind_mismatch` | A field is wrong |
| `duplicate_slot`, `too_many` | A slot twice; over 30 proposals |
| `unknown_evidence`, `slot_not_supported` | Cited evidence is missing or about another slot |
| `number_not_in_evidence` | A number is not in the cited evidence, as written or rounded |
| `not_a_fact`, `raw_reading` | Advice, judgement or prediction; one day's reading |
| `slot_stopped`, `rejected_before` | The person stopped the slot or rejected that statement |
| `target_missing`, `target_not_neighbor`, `target_not_open`, `slot_occupied` | No target, not a returned neighbor, closed; ADD on a used slot |

Confidence is code's too: the share of weeks a usual slot was seen in, else 0.5, 0.75 and 1 for one, two and three days of support; what the model says about its own confidence is ignored. Asked instead (REVIEW): `low_confidence` (under 0.5); `weak_evidence` (under 3 days of support for MERGE, SUPERSEDE or a new `response`; a usual slot under 3 of 4 weeks); `older_evidence` (older than the memory).

**States.** `candidate`, `saved`, `confirmed`, `rejected`, `superseded`, `inactive`. Only the person confirms, rejects and restores. A confirmed memory's successor is saved. A memory is inactive after 35 days without evidence. A rejected memory's slot takes no write until restored.

**Table.** Saved and confirmed memories, not stopped or expired, confirmed first; at most 25 rows and 200 words. An unnamed activity is `other` with `data.label`; a usual slot's `minutes` is the person's median, else a default.

**Forgetting.** With the snapshot, forgetting a day rolls the facts again and recomputes later evidence without it. A version resting only on that day is deleted; a statement whose numbers changed is rewritten by a short code template; a memory the evidence no longer supports is deleted. A day in the last 7 also removes `load.week` until the window is whole. Without the snapshot, every aggregate of the next 34 days goes too. A stopped fact type deletes its memories; "forget everything computed" deletes all; a stopped row is rejected until restored.

**File.** `agent.json`, written through a temporary file and read back.
