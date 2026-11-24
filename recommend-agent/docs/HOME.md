# Home training

The globals for home strength sessions (`src/content.mjs`, `src/homeweek.mjs`). Same rules as [PHONE.md](PHONE.md): JSON in, JSON out, never a throw.

## The week at home

With `rules`, `planContext`, `recommendWeek` and `checkPlan` plan from today through Sunday: 7 days on a Monday, 2 on a Saturday and 8 on a Sunday (through next Sunday, so the Sunday-evening build covers the whole next week). Send `dayKinds` for each of those days. `dayOffsets` (`{"YYYY-MM-DD": "+HH:MM" | "-HH:MM"}`, each day's UTC offset at noon) keeps every day on its own clock across a clock change; a day it leaves out uses the offset of `now`. Anything else is `bad_day_offsets`.

## A session

- `workoutContent({sessionId, focus, minutes?, rules, history?, loads?, turn?, lastPain?, deload?})` -> `{content: {sessionId, focus, minutes, items: [{movementId, sets, reps | seconds, load?, rest, isNew, slow?}]}}`.
- `weekContent({sessions: [{sessionId, focus}], rules, history?, loads?, deload?})` -> `{contents, setsByPattern, target, note}`.
- `checkContent({content, rules, history?, minutes?, week?, floor?})` -> `{pass, violations: [{code, text, movementId?}]}`. Codes: `unknown_movement`, `bad_dose`, `equipment_not_owned`, `avoided_movement`, `gated_movement`, `too_many_new`, `session_too_long`, `sets_below_floor`.
- `contentBrief({focus, rules, history?, loads?, minutes?, deload?, lastPain?})` -> `{lines, choices: [{id, name, pattern, level, isNew, dose: {sets, reps | seconds}}], target: {minutes, items: [fewest, most], maxNew, sets: [1, 6], weekSets: {floor, aim}}}`: what a model may choose from, and the limits as sentences. Nothing personal, no calendar text.
- `proposedContent({proposal: {items: [{movementId, sets, reps?, seconds?}], reason?}, sessionId, focus, rules, history?, loads?, minutes?, week?, deload?, lastPain?})` -> `{content, pass, violations}`. The proposal is untrusted: mistakes come back as violations (`bad_proposal`, `item_count`, `duplicate_movement`, and every `checkContent` code). A range must sit inside the library's. Code fills rest, load, `isNew`, `slow` and minutes; `reason` is dropped. `week` is the week's contents; this one replaces the one with its `sessionId`. `rulesWeek` is what `weekContent` built for the same days: a pattern it can't bring to 4 sets is held to the sets it does reach (`floor`), so a week with one or two days at home isn't refused for what no week of its days could do. Use `content` only when `pass`.
- `movementLibrary({})` -> `{version, movements}`.

`history` is `[{movementId, day, sets: [reps or seconds per set], load?, slow?}]`; send `slow: true` for a session done slow.

## Moving on

Each step needs a session with every set at the top of the range:

1. More reps: the item shows the whole range; the person climbs it.
2. Slower (`slow: true`): each rep's lowering takes 2 seconds longer. Once per movement, until topped slow. Not for timed movements.
3. Heavier: a backpack movement gets 1 kg more after each topped session, up to 12 kg.
4. Harder: the next movement unlocks after two topped sessions in a row, the slow step done, and 12 kg for a backpack movement. A `gated` movement never skips an easier one the person lacks equipment for.
