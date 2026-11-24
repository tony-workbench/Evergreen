# Home training

The globals for home strength sessions (`src/content.mjs`, `src/homeweek.mjs`). Same rules as [PHONE.md](PHONE.md): JSON in, JSON out, never a throw.

## The week at home

With `rules`, `planContext`, `recommendWeek` and `checkPlan` plan from today through Sunday: 7 days on a Monday, 2 on a Saturday and 8 on a Sunday (through next Sunday, so the Sunday-evening build covers the whole next week). Send `dayKinds` for each of those days. `dayOffsets` (`{"YYYY-MM-DD": "+HH:MM" | "-HH:MM"}`, each day's UTC offset at noon) keeps every day on its own clock across a clock change; a day it leaves out uses the offset of `now`. Anything else is `bad_day_offsets`.

The split comes from the phone's `queue` (`{"YYYY-MM-DD": focus}`: what each day left this week was last planned to work), `carry` (missed sessions, first in line) and `doneToday`. `planContext` and the rules engine behind `recommendWeek` read all three through one function (`homeContextOf` in `src/homeweek.mjs`), so the reasons the model sees and the sessions code builds work the same parts: a day that drops out passes its focus to the next day at home, and a done day keeps its own.

## A session

- `workoutContent({sessionId, focus, minutes?, rules, history?, loads?, turn?, lastPain?, deload?})` -> `{content: {sessionId, focus, minutes, items: [{movementId, sets, reps | seconds, load?, rest, isNew, slow?}]}}`.
- `weekContent({sessions: [{sessionId, focus}], rules, history?, loads?, deload?})` -> `{contents, setsByPattern, target, note}`.
- `checkContent({content, rules, history?, minutes?, week?, floor?, focus?})` -> `{pass, violations: [{code, text, movementId?}]}`. Codes: `unknown_movement`, `bad_dose`, `equipment_not_owned`, `avoided_movement`, `gated_movement`, `too_many_new`, `session_too_long`, `sets_below_floor`, `sets_above_target` (a pattern over 10 sets in the week), and with `focus` `item_count`.
- A session holds 4 to 5 movements. Fewer only when even one set of each of 4 can't fit the minutes, or the library and the equipment can't supply 4 for the focus. Its minutes count every set at the top of its range (reps times seconds per rep, plus rest), so a session never runs past its length: 25 minutes, or the longest the person set in My rules.
- A week aims for 8 to 10 sets per main pattern, never fewer than 4 and never more than 10: code adds sets toward 8 while each session stays within its length, except in a lighter week and on an eased-off day.
- `contentBrief({focus, rules, history?, loads?, minutes?, deload?, lastPain?})` -> `{lines, choices: [{id, name, pattern, level, isNew, dose: {sets, reps | seconds}}], target: {minutes, items: [fewest, most], maxNew, sets: [1, 6], weekSets: {floor, aim}}}`: what a model may choose from, and the limits as sentences. Nothing personal, no calendar text.
- `proposedContent({proposal: {items: [{movementId, sets, reps?, seconds?}], reason?}, sessionId, focus, rules, history?, loads?, minutes?, week?, deload?, lastPain?})` -> `{content, pass, violations}`. The proposal is untrusted: mistakes come back as violations (`bad_proposal`, `item_count`, `duplicate_movement`, and every `checkContent` code). A range must sit inside the library's. Code fills rest, load, `isNew`, `slow` and minutes; `reason` is dropped. `week` is the week's contents; this one replaces the one with its `sessionId`. `rulesWeek` is what `weekContent` built for the same days: a pattern it can't bring to 4 sets is held to the sets it does reach (`floor`), so a week with one or two days at home isn't refused for what no week of its days could do. Use `content` only when `pass`.
- `movementLibrary({})` -> `{version, movements}`.

`history` is `[{movementId, day, sets: [reps or seconds per set], load?, slow?, tooHard?}]`; send `slow: true` for a session done slow and `tooHard: true` when the person said it was too hard.

A backpack movement's kilograms are `loads[id]` when the phone sends one, else last time's (plus the step above), else the library's start, always 1 to 12. `loads` comes from the phone finding a movement's weight in the first session with it: there "Too hard" takes off 1 kg and "Too easy" adds 2 kg, and the next session starts from what that one ended on. Otherwise the phone sends none for it, and the weight rises only by step 3.

## Moving on

A session counts when every set is at the top of the range and it isn't marked `tooHard`. The steps come in this order:

1. More reps: the item shows the whole range; the person climbs it.
2. Slower (`slow: true`): each rep's lowering takes 2 seconds longer. It starts after two sessions in a row count, and is done after two slow sessions in a row count. Not for timed movements.
3. Heavier: once its slow step is done, a backpack movement gets 1 kg more after each session that counts, up to 12 kg. This is the one step a single session earns.
4. Harder: the next movement unlocks after the last two sessions count, the slow step is done and, for a backpack movement, a session after the slow step at a heavier load (or the slow step already at 12 kg). It does not wait for 12 kg. A `gated` movement never skips an easier one the person lacks equipment for.

A movement the person left out (`avoid`) or marked as one they can't do (`rules.movements: {"<id>": "cannot"}`) is replaced by the easier movement in its chain, and the climb stops there: the harder one opens again only when the person says they can do it or has done it before. `checkContent` refuses the left-out or can't-do movement itself as `avoided_movement` and the harder one above it as `gated_movement`.

## The home-week eval

`npm run eval:home` (`scripts/eval-home-weeks.mjs`) grades thirty made-up weeks in five comparisons, one lever each, against a baseline recorded from the engine before the change set that added those levers (commit `c247786`). The header of the script states each comparison's outcome, bar and falsifier, written before any run.

- Arms: BEFORE is `c247786`'s `src/`; each lever-only arm is BEFORE with one patch from `scripts/eval-home-weeks.levers/` applied; AFTER is `src/` now. The five patches together give AFTER's weeks.
- Controls: the thirty cases, `data/movements.json`, the calendar, the clock (Monday 30 November 2026, 08:00, UTC-8), histories built from the library (never by the engine under test), and the grader, which times sessions at worst (the top of every range) and counts items and sets itself.
- Comparisons: `earning` (no step without two sessions in a row that count; as many steps after two as before), `items` (no session under four movements or over five), `weekSets` (no main pattern above ten sets a week; fewer below eight than before), `timing` (no session past the person's longest at worst) and `queue` (the rules engine and `planContext` plan the same split from the phone's queue and `doneToday`).
- Guards, held in every week by AFTER and by every arm at least as well as BEFORE: `plan`, `days`, `movements`, `equipment`, `new`, `floor` (four sets of each main pattern unless no session has room for one more), `rain`, `progress` and `picks` (scripted model answers through `proposedContent` and `checkPlan`). A week known to be wrong must fail on a rest-day session, an avoided movement, a session too long and too many sets.

`node scripts/eval-home-weeks.mjs --record-baseline` rebuilds BEFORE and the five lever-only arms from git in a temporary folder outside the repo and rewrites `scripts/eval-home-weeks.baseline.json`. A plain run grades AFTER against it and exits 1 on a missed guard, bar or known-bad code.
