# Changelog

All notable changes to Evergreen are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Evergreen has no numbered releases yet, so everything not yet released is under Unreleased.

## [Unreleased]

The exercise rules: planning from your own rules, training at home with a guided workout page, and reminders until it is done.

### Added

- **My rules** in Settings: rest weekdays, the hours you can train, the shortest and longest session, the equipment you have, movements to leave out, and a home place. A profile made elsewhere can be imported once.
- **Days at home, out or rest.** Each day is sorted from your rules and your calendar: an event somewhere other than home (all-day and several-day events included) makes a day out, and so does "I’m going out today" on Today. A rest weekday or a day out gets no session; every day at home gets one.
- **A workout page for a day at home.** Each movement in words, its sets and reps, a rest countdown, and Too hard, Swap and Skip. A new movement asks you to try one rep first. The first session with a backpack movement finds its weight, said as litres of water: there Too hard takes off 1 kg and Too easy adds 2 kg; afterwards Too easy is gone and the weight goes up by itself. Finishing asks how it went and how sore you are, and saves a strength workout to Apple Health.
- **Movements picked by AI**, under code checks: the AI may choose a day's movements from the app's library; code checks equipment, the leave-out list, the session's length, sets and rest days before anything is shown, and falls back to the rules' own session when the AI's choice doesn't pass. Such a session is marked "Movements picked by AI".
- **Progression in steps:** more reps, then slower (2 seconds longer on the way down), then 1 kg more in a backpack (up to 12 kg, with how many litres of water to carry), then the harder movement. A movement you can't do yet is replaced by the easier one in its chain until you say you can.
- **Movement pictures** on the workout page for twelve movements, those of a first three-day week at home with or without a backpack: the start on the left, the end on the right, the working muscles in green. How they are made is in [docs/movement-pictures.md](docs/movement-pictures.md).
- **A lighter week:** after four full weeks, the fifth has one set fewer of everything.
- **The week as a table,** kept day by day from today to Sunday (on Sunday, to the next Sunday). A missed day's work passes to the next day at home. Pick one time for a day there, see the later times and what each day holds, and take back a skip or an "already done".
- **Reminders on a day at home:** the evening before (with "Only at …" times and "I’m going out tomorrow"), 10 minutes before, at the time and at each later time; on the evening before a day out, "Tomorrow you’re out" with "I’m home tomorrow". "Later today", "Already done", "I did it another way" and "Skip today" with a reason. Settings has "Keep reminding me until I’ve trained" and "Always ask me to pick one time".
- **"Your week ahead"** every Sunday at 20:00 while you plan by your rules; the next week is worked out in the background when the system allows, and a phone that was locked then catches up as soon as it is unlocked.
- **Short breaks when rain keeps you in:** two or three six-minute breaks on a rainy afternoon at home, clear of your calendar.
- **Screen Time on the first-setup page,** with one line on what it is for; nothing is locked until Earned screen time is turned on, and turning it on first shows every app it will lock and asks "Lock these apps?".
- **Earned screen time:** social apps beside videos and games, free time every day for each group, a weekly "Unlock for 10 minutes", and 15 minutes more for each group on the day you train after a missed day.
- **A memory of where you train:** "You train at home, without gym equipment." when eight weeks of Health workouts hold none of a gym-equipment type.
- **Offline states:** the workout page and the week table say when the phone is offline and keep working from what is on the phone; the week table reloads by itself once back online.
- **UI tests** (`EvergreenUITests`): the key path on a day at home, every permission row, a reminder opening the right page, offline then online, Reduce Motion, and accessibility audits in light and dark and at the largest text size.

### Changed

- A session holds 4 to 5 movements and never runs past its length; the week aims for 8 to 10 sets for each main movement pattern and never goes over 10.
- The harder movement no longer waits for 12 kg in the backpack; the slow step starts and ends after two sessions in a row at the top of the range; a session marked "Too hard" doesn't count towards moving on.
- With no time picked, a time that passes without a start moves the session to the day's next time, on the plan and the calendar, as the "Moved to …" reminder says.
- Every notification the app sends shares one limit of six a day, the 30-minute reminders of other workouts included, and none comes from 22:00 until 09:00 (or from your own earlier start).
- The last reminder of the day has Start, Already done, "Skip today: I’m out" and "Skip today: not feeling well"; "Not today" is on Today.
- "Swap" only offers movements that are open to you.
- During the day, a calendar change works the week out again and asks the AI again only for the days that changed.
- The training-place memory counts indoor rowing, indoor cycling and indoor climbing as gym workouts, and needs no minimum length of history.
- Main buttons on a day at home are 56 pt and pinned at the bottom; button words wrap at large text sizes; secondary buttons have an outline you can see.
- My rules says what is wrong as soon as an answer doesn't make sense.

### Fixed

- The lighter week came every week from the sixth week on; now four full weeks start counting again after each lighter one.
- A picked reminder time kept by an earlier build is carried over instead of lost.
- A workout Apple Health couldn't save still counts towards earned screen time and the week.
- Tapping Start on a reminder for another day opens the week table on that day instead of doing nothing.
- "I’m home tomorrow" pressed on the lock screen takes effect at once.

### Security

- A workout moved off a meeting is announced without the meeting's title, so nothing from your calendar shows on the lock screen.
- The location prompt says every use: the forecast and nearby gyms with a location rounded to about a kilometre, and setting home and telling when you're far from it, with home kept on the phone.
- The privacy manifest declares what leaves the phone: health and fitness summaries and what you type to Gemini, an event's typed place to Apple's geocoder, and a location rounded to about a kilometre to Open-Meteo (and to Apple Maps to find gyms when rain is due). None of it is used for tracking.
