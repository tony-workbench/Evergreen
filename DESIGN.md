---
name: Evergreen
description: Training that grows with you: an encouraging coach on light, green-tinted neutrals; one pine accent and one typeface belong to the agent, everything else stays still.
colors:
  surface: "#F7F8F6"
  card: "#FFFFFF"
  text: "#15201B"
  text-muted: "#55615B"
  accent: "#1F6F5C"
  on-accent: "#FFFFFF"
  rule: "#E3E7E4"
  success: "#2F7A4F"
  warning: "#8A5A00"
  error: "#B3261E"
  dark-surface: "#0F1513"
  dark-card: "#18201D"
  dark-text: "#EEF2EF"
  dark-text-muted: "#A6B1AC"
  dark-accent: "#5FC2A6"
  dark-on-accent: "#0F1513"
  dark-rule: "#26302C"
typography:
  display:
    fontFamily: General Sans
    fontWeight: 600
    fontSize: 24pt (agent card headline), 30–40pt (onboarding titles)
    letterSpacing: -0.01em
  body:
    fontFamily: SF Pro
    fontSize: 17pt (Dynamic Type .body)
    lineHeight: 22pt
  label:
    fontFamily: SF Pro
    fontSize: 13pt (Dynamic Type .footnote)
  mono:
    fontFamily: SF Pro
    fontFeature: tnum
rounded:
  sm: 8px
  md: 12px
  lg: 20px
  phone: 40px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  agent-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
  button-ghost:
    borderColor: "{colors.rule}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  badge:
    borderColor: "{colors.accent}"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
---

# Evergreen

## Overview

**Creative North Star:** Training that grows with you. Evergreen is an encouraging coach that shows its reasoning: every workout says why it was picked, from Apple Health data (runs, heart rate, training load) and the open time on the calendar ("Easy pace. Your training load is up 18%, so this one stays light."). Its work is recognizable at a glance because it alone gets the accent and the display face.
**Product context:** a native iPhone app that plans a person's workouts around their real week, for people who want to train a bit more than they do now. It runs on the phone with the person's own AI key. Peers are Google Health Coach, Apple Workout Buddy, Fitbod, WHOOP and Oura.
**Mode per surface:** Operate for every screen (onboarding, Today).
**Reference sites:** Oura's 2025 "Today" redesign (one daily focus), WHOOP's one-screen home, Gentler Streak (Apple Design Award 2024, humane fitness).
**Key characteristics:**
- the agent's latest action is the only card on screen
- pine accent + General Sans appear only on what the agent did
- progress is a sentence, never a ring or dense chart (a dot strip of days and the week strip are the only pictures of data)
- encouraging at the miss: a muted "Next time", never red, guilt or a minus number
- every workout carries its reason, citing the health data or calendar time behind it
- one character: the pine buddy, a round, friendly pine with dot eyes, rosy cheeks and coral running shoes. It is the guide: it waves on the tour's first screen and cheers on its last, stands beside what Evergreen noticed, and lives on Today's week strip (it stands on today's column, waves when Today opens, cheers when a workout is done or added, and a tier fills per finished workout). It has three motions, wave, walk and celebrate, and carries nothing: no props are drawn or attached to it. The tour shows the real app, not illustrations. Its leaf green, blush and shoe coral are decoration only, never text or UI color

## Colors

**Strategy:** Restrained. One accent means "the agent did this"; neutrals carry a slight green tint derived from it.
**Light or dark:** light by default; dark mode keeps the same hierarchy with a lighter accent (7.7:1 on dark card), not an inversion.
Warning is used only for the offline label; error only for real failures. Every text pair is 4.5:1 or better.

## Typography

General Sans (Fontshare, ITF Free Font License, 12 static styles + variable) is the agent's voice: first-person headlines ("Saved your workout", "Time for new running shoes?"), Today's statement and the onboarding titles only. SF Pro with Dynamic Type handles everything else: a justified exception to "no system font as body", because this is a native Operate surface and SF Pro gives Dynamic Type, accessibility and tabular numbers for free. The font file is not in the repository: put `GeneralSans-Semibold.otf` in `app/Evergreen/Resources/Fonts/` and it is registered at launch and scaled with Dynamic Type. Without it the agent's voice is SF Pro Semibold.

## Layout

iPhone portrait only. Single column on an 8pt grid, 16pt side margins, 24pt between sections, generous white space. One text hierarchy: title, body, muted footnote; numbers are tabular everywhere. Onboarding: the tour (four scenes) → Permissions (three Allow rows on one page) → What I noticed (worked out on the phone, no key needed) → Connect your AI ("Connect your key and I’ll plan your week."; "Not now" is allowed) → Today, with the first week being planned. Today: date → the hero (the top suggestion and why) → "More for your week" → the week strip with the buddy → "On your calendar" rows → a quiet "What I remember" link → "Ask Evergreen" pinned at the bottom; a gear at the top right opens Settings. Sheets (week plan, Why, What I remember) use the same column: a footnote label, then rows under 1px rules.

## Elevation & Depth

Nothing is elevated. The agent card is the card colour with a 1px rule border in both modes; there are no shadows or gradients. Rows sit flat on the surface, separated by 1px rules.

## Shapes

20pt continuous radius on the agent card, 12pt on buttons, 8pt on badges. Rows have no radius.

## Components

- **Agent card:** verb (General Sans, accent) · struck-through before → after · one-line reason · one muted line (what it keeps, or the terms) · Undo + Pick another time, or the ask's primary + Not now. VoiceOver reads it as one sentence.
- **Worn shoes (hero):** at 640 km on the pair: "Time for new running shoes?" in General Sans, accent · up to four lines, one shoe each as "Name: why", chosen for the distance on the pair, the usual week and the longest recent run (a line with a web address, a price or a health claim is not shown) · the pages the search returned, each as its site name with "Open the page" (Safari inside the app; https only; with no results, no button) · "I have new shoes" (primary; starts the new pair at zero) and "Not now". Evergreen never orders or pays, and shows no prices.
- **Plan row:** day (with a "Moved" badge when the agent moved it) · activity and length · time on the right. No radius, 16pt above and below, 1px rules between.
- **Tour:** four scenes that play the app's real screens, with a scripted state, inside a frame (1px rule, as wide as the page and 1.14 times as tall in every scene, a small scale-in). Each scene is laid out at the width that makes it fill the frame and is scaled to fit, so a scene with little in it reads larger; content is centred in the frame; every part of a scene is in its layout from the first frame and is shown by opacity, never by clipping, so nothing moves to make room, and one thing fades out before the next fades in, so nothing overlaps at any frame: (1) Today's date line, the week picture with its blocks dropping in, and the plan's three rows uncovered one by one; (2) tonight's row at 6:00 PM, "Team sync" arriving above it, the row turning to 6:45 PM with its "Moved" badge in one step and the "Saved your workout" card fading in under the rows with Undo; (3) the rain card "Rain at 7 tomorrow. Move to 2 PM, or go indoors?", a tap on "Move", the card gone, then the run on the plan at 2:00 PM with its "Moved" badge over the week picture (caption "Rain? It finds a way." / "You choose; it does the moving."; no business is named and nothing has a price); (4) the statement for a 6:00 AM run, a tap on "Not now", the statement gone, the line "Got it. I won't plan around Thursday 6 AM runs." with Undo standing alone for a moment, and then the next suggestion under it at 8:30 AM. The only thing drawn on top is a 24pt accent ring where a tap happens. Under the frame: caption (General Sans 28) and one muted line on the left, and the buddy (140pt) always in the same place on the right, reacting once per scene (a wave, a hop, a hop, the cheer); page dots; "Get started" on the last; Skip always. One scene on screen at a time: the old one fades out before the new one fades in. Each stays 5.5 s and moves on; swipe works; Reduce Motion shows each final state.
- **What I noticed:** centred on the screen: the buddy (148pt) beside the last 4 weeks as rows of dots (a full dot for a day with a workout, accent on the usual days) that draw in column by column, a one-line legend ("Each dot is a workout day · last 4 weeks · green = your usual days"), then at most three lines of 8 words or fewer, then "See my week".
- **Next workout (hero on a quiet day):** "Next up" · "Run tomorrow at 8:30 AM" (General Sans, accent) · minutes · one plain reason.
- **Week strip:** seven columns on one baseline with a letter per day. Each workout is a small accent block with its name ("Run"); a done one has a check, a missed one is muted, and today's column has a heavier baseline. On Today the buddy (104pt) stands on today's column, directly on the strip, with the week's progress sentence beside it: it waves when Today opens and cheers when a workout is done or added. Tapping it opens What I remember.
- **Suggestion lines:** under the picture, only when the week holds two or more different things (when every suggestion is the same session on different days, the picture and "Add all" already say it). Like sessions on different days are ONE line with day dots and one "Add 5" ("Your usual 7 AM run, 40 minutes." + M T W T F); a session that really differs has its own line with "Add". Press and hold for "Not now". A "not now" that rejected a usual time leaves one quiet line with Undo. "Longest", "shortest" and "easiest" are said only when this week's numbers bear them out.
- **Day dots:** seven 24pt circles lettered M to S; a marked day is filled accent with a white letter, the others faint.
- **Rain (hero):** when rain is due on an outdoor workout in the next two days: "Rain at 7 tomorrow. Move to 12 PM, or go indoors?" in General Sans, accent · one muted line ("85% chance of rain during your run.") · "Move" (primary; the dry time goes through the calendar engine, and a plain move is done at once), "Indoors" (opens up to three gyms nearby, each with its distance and "Open in Maps"; no prices, nothing to buy) and "Keep" (leaves it and doesn't ask again).
- **Calendar preview (hero):** when a session can't simply be added, or a request was typed ("Find me 30 minutes to walk tomorrow evening"): a muted "Calendar" label · ONE headline in General Sans, accent: the block itself ("Walk · Sunday 5–5:30 PM"), or the engine's question · its reason below · any other blocks that move, each with a "Moved" badge · "Confirm" (primary) and "Not now", or the question's answers as ghost buttons · one muted line: nothing is on the calendar until Confirm.
- **Week calendar:** under the buddy, in place of the week strip whenever something is planned or proposed this week (an empty week stays the compact strip): seven day columns over only the hours in use, an hour either side and six at least, 44pt an hour with a line and a label each hour. Today's column is tinted. Busy time on the person's other calendars is a grey block with no title; planned workouts are filled accent, as tall as their minutes and 24pt at least, labelled "Run 7:00" when the block is 48pt wide or more and carrying no words when it is narrower (colour and place say it; the wide day of a preview says the rest); proposed blocks are dashed accent outlines. In the compact week a moved one says "Moved" under its name; on a preview the card above carries the "Moved" badge and the block keeps its room for the time. Dragging a dashed block or a planned workout up or down, snapped to 15 minutes, asks the calendar engine for that time and shows the preview; nothing is written by a drag.
- **Today, top to bottom:** one large statement (the top suggestion, or the next workout), the week picture with the buddy on today, at most one short list (like suggestions grouped, then what was added), and "Ask Evergreen" pinned at the bottom. No labels above blocks: size and position do the structuring. A card appears only when the agent is asking something (a calendar preview, rain, worn shoes, the answer to a question, the missing key).
- **The statement:** nothing is on the plan until the person adds it, so the first thing on Today is what Evergreen suggests, as a sentence in General Sans at Large Title size, accent: "Run, Monday at 7." Under it one body line that says each thing once ("40 minutes, as usual."; a reason that only repeats the statement becomes "as usual"), a chip only for what the sentence doesn't say, then the screen's one primary button, "Add to plan", with "Not now" and "Why" as quiet text beside it. Adding is one tap when the calendar engine places it with nothing to ask: "Added" with Undo for four seconds, and the buddy cheers. The top suggestion is the open one resting on the most remembered rows, then the soonest. Under two weeks of data one muted line sits above it; with nothing to suggest it is the next workout; while planning, the skeleton with the buddy and "Planning your week…", and after six seconds one calm line, "Still planning…". The week is shown as soon as it is planned; the day's memory update runs behind it and the week changes only if what is remembered changed.
- **Basis chip:** a small accent icon (heart = Apple Health, calendar = Calendar) and one fact, in a 1px rule box. A chip appears only when it adds what the sentence doesn't already say: a number ("This week’s training is 14% above your usual.") or a calendar gap ("Between your 9 AM and 1 PM meetings"). A usual time is never a chip under a sentence that says "as usual". The Why sheet still lists every basis.
- **Why this (sheet):** each basis in full under a 1px rule: source, the fact, one muted line (since when and in how many of the last weeks it was seen; for the calendar, when the person is busy before and after), and for a remembered row "Not true for me". That rejects the row, plans the week again, and leaves one quiet line on Today, "Got it. I won’t use Sunday 8 AM runs, and planned your week again." with Undo.
- **The week picture:** the one drawn thing. Seven days side by side, today first with a heavier baseline, the buddy standing above it beside the week's sentence. A session the person added is a solid accent block (a check when done, grey when missed); a suggested one is a dashed accent outline. A block carries the activity word only ("Run"); the time most blocks share is said once under the picture ("All at 7 AM", "Most at 7 AM"), and a block shows its own time only when it differs. Tapping a dashed block adds it; press and hold for "Not now" and "Why". "Add all 6" in accent sits under it on the right. While a calendar preview waits, the picture becomes the hour calendar: the day the preview is about takes 60% of the width with its block labelled in full ("Run 1:00–1:40 PM") and draggable, the workout's present place stays behind it as a faint dotted outline, and the other days are narrow.
- **What I remember:** "Is this right?" first, when rows are waiting (the sentence, "No", "Yes"). "Your routine" (Title 3): one line per pattern with day dots ("You usually run at 7 AM." + S M T W T F S; tapping a marked day stops that day alone), then sentences only for what is not a pattern, each with a quiet "Stop". "Your body": sleep, resting heart rate and training as three figures side by side (the value in Title 3, its name, what is usual); press and hold one to stop using it. The shoe question, when it is due, sits below what is remembered, never above it. Before there is anything to remember, "What will show up here" lists the three things that will (the usual days and times, a normal week, sleep and recovery), so the sheet has no empty half. Then "Stopped" with Restore, "Forget", and "See exactly what is sent". Forgetting a day or everything asks first in the system's dialog: "Forget" in the destructive role, and "Keep" as the default.
- **Connect your AI (onboarding):** the last step, which can be put off with "Not now": the title with the small waving buddy, one line ("Connect your key and I’ll plan your week. It stays on this phone."), the AI service block from Settings, and "Where do I get a key?" open by default: three numbered steps and "Open Google AI Studio" (Safari inside the app), with the buddy (120pt, waving) standing beside them. Until a key is connected Today's hero is one calm card, "Connect your AI key to get your plan" with Connect, and asking and suggestions are off; the week and What I remember stay.
- **Settings:** a quiet gear at the top right of Today opens one screen of sections, each a small muted title over a ruled block. "Your memory": one row to What I remember, with "2 to review" in accent when rows are waiting. "AI service": one muted line on where things go ("Planning, scheduling and the daily memory update go only to Google’s Gemini API with your key."); Service, fixed, "Gemini"; Model (a field, and after a successful check a picker of the account's models); the key as a secure field with the system's Paste button, whose placeholder says "Connected · key ending …a1b2" once there is one; ONE ghost button "Check connection & save" with the result beside it in the success or warning colour ("Connected and saved · 12 models available" / "Connection failed: Google didn’t accept that key…"); "Remove key". "What I use": Apple Health, Calendar, Location, Notifications, each with "Allowed" or "Off" and "Open Settings", and one muted line on exactly what leaves the phone for it. "Automatic": four switches (daily memory update, weekly suggestions, rain check, shoe mileage check), each with a one-line hint; off stops that work. "Status": last memory update, AI calls and tokens today, the last five things that happened. "Your data": "Forget everything" in the warning colour, after a confirmation whose default is "Keep". Type is the one scale: muted footnote for section titles and hints, body for rows and values, semibold footnote for a state or a quiet action.
- **Ask Evergreen:** one field pinned to the bottom of Today under a 1px rule, with a round accent send button. Its placeholder goes through three examples ("Find me 45 minutes to run tonight", "Move Sunday’s run to the afternoon", "What do you remember about me?"). The answer is one card in the hero slot: a small muted label for the agent that answered ("Calendar", "Plan", "Memory"), the answer in body text, and Done. While it works the buddy walks beside "Working on it…". A failure is one plain sentence and never mentions the key.
- **Words:** nothing the person reads says planner, memory agent, load cap, readiness or a file name. Reasons and the week's summary from the engines are rewritten in plain words (`PlainWords`).
- **Why:** each step of the trail is a footnote label under a 1px rule, then body text. No timeline marks, no boxes around passages.
- **Buttons:** primary = solid accent, ghost = 1px rule; both 48pt tall; text buttons have a 44pt target; focus ring is 2px accent.
- **Badge:** "Moved", accent outline.
- **A workout's name:** one mapping (`Activity`) for the calendar entry, the week picture, the rows and the notifications: Run, Long run (a run of an hour or more), Walk, Strength, Yoga, Ride, Swim, Stretch, Elliptical; an activity outside the list goes by its own name, else "Workout"; a rest day is never written to the calendar.
- **Forgetting by asking:** a sentence that names a day ("forget yesterday", "wipe 2026-11-21", "the 21st") gets the card for that day alone, "Forget Saturday, November 21?", with what is deleted said in full; everything is offered only when the sentence names no day and nothing narrower; a sentence that can't be placed gets "Forget one day, or everything?" with Keep (filled), "One day" (opens What I remember) and "Everything" (asks once more). Nothing is deleted from a sentence.
- **Today without a key and with nothing planned:** under the Connect card, the buddy at 160pt and "With a key" over three ruled lines on what a key gives, then one muted line on where the key goes. No second button.
- **Launch:** the launch screen and the first frame are the surface colour, then the skeleton; nothing flashes white.
- **Destructive questions:** the safe choice is the filled or default one ("Keep"); the destructive one is quiet text in the warning colour, or the system's destructive role.
- **Nothing staged:** everything a person sees comes from their own Apple Health and calendar, the forecast where they are, or their own answers. The first time each thing really happens (a moved workout, a rain check, a shoe check), one muted line says so, once.
- **Shoe question and heads-up:** one question, asked once to someone who runs, in What I remember once a run is seen and on Today once a run is on the plan: "When did you start using your current running shoes?" with a date, an optional name, Save (the one button) and "Not now" as quiet text. From 480 km, one muted footnote under a 1px rule says how far the pair has gone, with "I have new shoes". At 640 km the worn-shoes card takes over.

## Do's and Don'ts

- Do reserve the accent and General Sans for agent actions only.
- Do write progress as a sentence ("2 of 3 this week").
- Do keep the last good screen up with a quiet label instead of a spinner.
- Don't use rings, charts, progress circles or confetti.
- Don't show minus points or red at a missed workout.
- Don't stack cards or nest a card inside a card.
- Don't add shadows, gradients, tinted tiles or colors outside the asset catalog.
- Don't put neon accents or glowing edges on dark surfaces.

## Motion

- **Approach:** minimal-functional between moments; the buddy and the tour carry the authored ones. One thing moves at a time. Transforms and opacity only; every clock stops when its view is off screen or the app is in the background.
- **Easing:** enter(ease-out) exit(ease-out) move(ease-in-out)
- **Duration:** micro 80ms, short 200ms, medium 300ms, long 600ms
- **Authored moments:** the pine buddy from its own body, nothing else. In the tour at most one or two things change at a time, 150–300ms, ease-out to enter and ease-in to leave. No decorative looping apart from the buddy's own short loops; no confetti or particles. Each is still under Reduce Motion.
  - **Today:** wave (1.9s), then stand; a 2.2s cheer when a workout is done or added.
  - **Hi:** arm up (300ms ease-out), about 2.5 swings at 2 per second, arm down (300ms). Connect your AI loops it after a 1.6s rest; Today waves once when it opens, then stands.
  - **Cheer:** three 500ms hops with arms pumping and a squash on each landing, then a small bounce.
- Onboarding's pages slide in (250ms); instant under Reduce Motion.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-19 | Initial design system | Light green-tinted neutrals, one pine accent and one display face that belong to the agent |
| 2026-11-20 | Tailored-training proposition | The value is picking the right, sustainable workout from health data and calendar time. A coach voice that cites its data; the pine as the one image, including the week's progress |
| 2026-11-20 | Pine buddy | One original character, a round pine with running shoes. Its own motion is the only authored motion, so the no-confetti rule stands |
| 2026-11-21 | Minimal Swiss pass | Flat surfaces with 1px rules instead of shadows, the 8pt grid, one text hierarchy, tabular numbers, equal 48pt buttons. The pine accent stays the only accent, for the primary action and what the agent did |
| 2026-11-21 | The buddy as guide | The first open should draw people in with motion and things they can see, with less technology on screen: a four-scene tour, What I noticed as a dot strip, the next workout as Today's hero, the week with the buddy on it, plain words everywhere |
| 2026-11-21 | "Not now" stops a memory fact | Memory comes only from data. Answers are not written into it: one tap on "Not now" stops the usual time the suggestion rested on, and What I remember lists each fact with "Stop using this" and what was stopped with Restore |
| 2026-11-21 | The tour shows the real app | Illustrated scenes and props on the buddy were unclear. The tour plays the real screens in a frame with a tap ring; the buddy keeps only its wave, walk and celebrate |
| 2026-11-21 | Nothing to buy | The app never orders or pays. For worn shoes it opens the pages the search returned and asks afterwards whether there is a new pair |
| 2026-11-21 | Real triggers only | Rain comes from the forecast, shoe wear from running distance in Apple Health, a moved workout from the real calendar |
| 2026-11-22 | Safe choice first, no waiting on memory | Launch is the surface colour, the preview block holds only its time, the empty What I remember says what will show up, "Keep" is the default on every destructive question, and the week shows before the day's memory update |
| 2026-11-22 | Nothing unchecked is shown | Every week shown passes the plan check: the AI's, the rules' own, and the starter walks, which shrink to what passes |
