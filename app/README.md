# Evergreen iOS app

SwiftUI and SwiftData, iOS 18+, iPhone portrait, Swift 6. What the product does is in the [root README](../README.md), the visual rules in [DESIGN.md](../DESIGN.md), the daily loop in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md), and every shared value in [contract/AGENTS.md](../contract/AGENTS.md).

## Run it

1. Open `app/Evergreen.xcodeproj` in Xcode.
2. Choose an iPhone simulator and press Run. For a real phone, first choose your team under Signing & Capabilities for the app and its three `Earn…` extensions (the project ships with none set), and change the four bundle identifiers and the App Group `group.com.evergreentraining.app` to your own; the App Group name is also in `ScreenTimeShared/EarnedTime.swift`.
3. A fresh install opens on the tour, asks for Health, Calendar and Notifications, shows "What I noticed", and asks for a Gemini API key ("Connect your AI"; it can be put off). Then Today.

The key is kept in the Keychain. An unsigned simulator build has no Keychain, so there it is kept sealed in the app's Application Support folder (debug simulator builds only). A debug build launched with `GEMINI_API_KEY` in its environment uses that key for the run, in memory only.

## Folders

Any file added under `app/Evergreen/` or `app/EvergreenTests/` is in the build automatically (folder-synced groups).

| Folder | What is in it |
| --- | --- |
| `App/` | Entry point and root view |
| `Agent/` | The model client (`LLM/`), the router, the agents (`Agents/`), the JavaScript host (`JS/`), the hand-offs (`Handoff/`), `Orchestrator.swift` |
| `Memory/` | The memory engine's host and what the app reads from it |
| `Model/` | App state. `AppModel` is the one object the views read; it owns `PlanStore`, `WeekSuggestions`, `AskEvergreen`, `MemoryModel` and `EarnedTimeModel`. `Storage/` is SwiftData |
| `CalendarSync/` | The Evergreen calendar, and reading busy times and event places (`EventReader.swift`, an actor, off the main thread; titles are never read) |
| `Background/` | Background refresh, the rain and shoe checks (`TriggerCenter.swift`), the debug seeds |
| `Weather/`, `Gear/`, `Health/`, `Notifications/` | The forecast, shoe mileage, Apple Health, notifications |
| `Contract/` | The plan, workout and busy-time shapes behind the agent card |
| `Views/`, `Design/` | Screens and the design system |
| `Resources/` | The three engine bundles and the asset catalog |
| `ScreenTime/` | Earned screen time: its model and screen |

The exercise rules: `Model/UserRules.swift` and `HomePlace.swift` hold My rules, `CalendarSync/DayKind.swift` sorts each day into home, out or rest, `Model/HomeWeek.swift` and `AppModel+HomeWeek.swift` keep the week planned day by day, `Model/WorkoutLog.swift` and `AppModel+Workout.swift` record each session, `AppModel+WorkoutPage.swift` answers the workout page's buttons, `Views/Workout/` is the workout page (`WorkoutSessionView.swift`, with `WorkoutParts.swift`, `RestCountdown.swift` and `WorkoutFinishPage.swift`), `Views/Week/WeekTableView.swift` the week table, `Notifications/WorkoutReminders.swift` and `AppModel+Reminders.swift` a day at home's reminders, and `Weather/RainSnacks.swift` the short breaks on a rainy afternoon. `Health/WorkoutWriter.swift` saves a finished session to Apple Health as a strength workout.

Earned screen time also uses folders beside `app/Evergreen/`. `ScreenTimeShared/` holds the chosen apps, the rates and every other number (`EarnRules`), the counted workouts and spent minutes, each day's free time, the weekly escape and the comeback day, and locking and unlocking; it is built into the app and all three extensions, which share it through the App Group `group.com.evergreentraining.app`. `EarnShieldConfiguration/` draws the screen over a locked app, `EarnShieldAction/` handles its two buttons (use time, or the weekly "Unlock for 10 minutes"), and `EarnActivityMonitor/` locks the apps again when the unlocked time is up. Evergreen also locks any unlock that ran out each time it opens. Their Info.plist and entitlements files are in `ExtensionSettings/`.

## How the pieces call each other

The agents never call each other. `Agent/Orchestrator.swift` runs the daily loop and passes typed values between them; `Agent/Handoff/HandOff.swift` does the same conversions as `contract/src/adapt.mjs`.

The three engines are JavaScript bundles run in JavaScriptCore (`Agent/JS/JSBundle.swift`). They hold no web address and cannot reach the network (`OutboundHostsTests`).

| Bundle | Built from | Called from |
| --- | --- | --- |
| `Resources/Memory/memory-phone.js` | `memory-agent/` | `Memory/MemoryEngine.swift` |
| `Resources/Engines/recommend-phone.js` | `recommend-agent/` | `Agent/Agents/BundlePlanRules.swift` |
| `Resources/Engines/calendar-phone.js` | `calendar-planner/` | `Agent/Agents/BundleCalendar.swift` |

After changing an engine, run `npm run build` in its folder and copy its `dist/*.js` over the file in `Resources/`.

The model is reached only through `Agent/LLM/GeminiClient.swift` (Google's Gemini API, the person's own key in the `x-goog-api-key` header). The model id is in `Agent/LLM/AIModels.swift` (`gemini-3.8-flash`) and can be changed in Settings.

| Step | Code | What checks the answer |
| --- | --- | --- |
| Sort a typed sentence | `Agent/Router.swift` | A keyword router takes over when the model can't be reached |
| Forget or stop something | `Agent/Agents/MemoryCommand.swift` | Read by code before any model; always asks first |
| Calendar sentence to intent | `Agent/Agents/CalendarAgent.swift` | The calendar engine's intent schema, then `calendarPlan` |
| Plan the week | `Agent/Agents/PlanAgent.swift` | `checkPlan`; problems go back once, then code keeps what passes or uses `recommendWeek` |
| Questions about the plan or memory | `Agent/Agents/PlanTalk.swift`, `MemoryAgent.swift` | Function calling over the app's own data |
| Daily memory update | `Agent/Orchestrator.swift`, `Memory/EngineMemory.swift` | `memoryDailyApply` drops what the facts don't support |
| Replacement shoes | `Agent/Agents/ShoeSearch.swift` | Shown only as "Name: why", with the https pages the search returned |

Three checks run when the app comes forward, when the calendar changes and in a background refresh (`Background/Refresh.swift`); each can be turned off in Settings:

- A meeting lands on an added workout: it moves to the nearest free time, with Undo (`Agent/StandInAgent+SlotDefense.swift`).
- Rain is due on an outdoor workout in the next 48 hours (`Weather/`, forecast from Open-Meteo).
- Running distance on the shoes reaches 480 km, then 640 km (`Gear/`).

## Tests

⌘U in Xcode, or from the repository root:

```sh
xcodebuild test -project app/Evergreen.xcodeproj -scheme Evergreen \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO
```

The scheme runs two targets. `EvergreenTests` holds the unit and flow tests, including the view logic kept in the model (`ViewLogicTests`) and the flows from the last review (`ReviewFlowTests`). `EvergreenUITests` drives the app on the `-uiTest home` seed: the key path (start, every set, finish; "Too hard"; skip today and take it back; pick a time in the week table; My rules saying what is wrong at once), every permission row on the first-setup page, a reminder opening today's workout page or another day's week, the week table offline and then reloading online, the onboarding lines appearing at once with Reduce Motion, Xcode's accessibility audit on Today, the workout page, the week table and My rules in light and dark, the key path again at the largest accessibility text size, and the rest countdown read out by VoiceOver. Run one target with `-only-testing:EvergreenTests` or `-only-testing:EvergreenUITests`.

No test uses the network. The model is a script (`ScriptedModel.swift`) or a fake network with Gemini-shaped answers (`FakeAPI.swift`, `ScriptedNetwork.swift`); the three engine bundles are the real ones. `AppRig.swift` builds the whole app for a test with a clock the test sets, a fixed time zone, a calendar that records what is written to it and scripted Apple Health. `HandOffTests` decodes every file in `contract/fixtures/swift/`.

## Real-model eval

`RealAIEval` runs the agents against the real Gemini API: typed sentences, weeks for different people, daily memory updates and safety cases. It is skipped in a normal test run. It spends from your key and never prints it.

```sh
xcrun simctl list devices booted            # find the simulator's id
GEMINI_API_KEY=... app/scripts/eval-real-ai.sh "<simulator id>"
```

Instead of the environment, the key can come from a file of `NAME=value` lines that only its owner can read (`chmod 600`):

```sh
EVERGREEN_SECRETS=/path/to/keys.env app/scripts/eval-real-ai.sh "<simulator id>"
```

With neither set, the script looks in `~/.config/secrets/keys.env`. The file is parsed, never sourced.

`EVAL_SECTION=ask|seen|heldout|plan|busy|memory|days|questions|safety` runs one section. The script prints one line per case, then a SUMMARY line per section, and exits 1 when a section didn't finish or missed its target.

## Debug launch arguments

Debug builds only. `-uiTest <name>` starts the app on a throwaway in-memory store with made-up history and a scripted AI: no key, no network, nothing read from or written to the device.

```sh
xcrun simctl launch booted com.evergreentraining.app -uiTest runner -uiScreen settings
```

| `-uiTest` | Starts with |
| --- | --- |
| `empty` | No workouts |
| `thin` | Nine days of runs |
| `runner` | Four weeks of morning runs, 212 km on the shoes, tomorrow's run on the plan |
| `rain` | The same, with rain due on tomorrow's run and three gyms nearby |
| `shoes` | The same, with 492 km on the shoes |
| `home` | My rules on with no equipment, a day at home with rain through the afternoon, then a day out |

With a seed, these also work:

- `-uiScreen memory|settings|permissions|noticed|connect|earned` opens that screen.
- `-uiAsk "sentence"` asks Evergreen that sentence.
- `-uiNoKey YES` stays without a key, to see the connect card.
- `-uiAnswers YES` adds the top suggestion and says "Not now" to the next.
- `-uiFakePermissions` makes the first-setup "Allow" buttons answer yes at once, with no system prompt.
- `-uiTestRoute session` opens today's workout page, and `-uiTestRoute week:YYYY-MM-DD` the week table on that day, as a reminder's tap does.
- `-uiOfflineFor <seconds>` counts the phone as offline for that long after launch, then online.
- `-reduceMotion` moves the screens as with Reduce Motion on.

A normal launch takes none of these.
