# How Evergreen works

Everything runs on the phone. Three agents think with the person's own Gemini key; code checks what they propose and is the only thing that writes.

## The parts

| Part | Folder | What it does |
| --- | --- | --- |
| App | `app/` | SwiftUI. Holds the plan, writes the calendar, keeps the key, shows the screens, passes values between the agents, and locks the apps picked for earned screen time through Screen Time (three extensions) |
| Memory | `memory-agent/` | Turns Apple Health data into exact facts each day. Once a day the model proposes what to remember; code keeps only what the facts support |
| Recommendations | `recommend-agent/` | Computes what the model needs to plan a week and checks every proposed week against safety rules |
| Calendar | `calendar-planner/` | Finds where a session fits around real events and re-plans when something moves. Built on [Plan Calendar](https://github.com/tony-workbench/plan-calendar) |
| Contract | `contract/` | The shapes every part agrees on, and a test that runs the three engines together |

The three engines are JavaScript bundles run in JavaScriptCore. They make no network calls.

## One day

1. **Facts.** After midnight the memory engine rolls the day that ended into facts with numbers.
2. **Remember.** The model reads those facts and proposes changes to memory: add, merge, replace or ask the person. Code drops any proposal whose numbers are not in the facts. The result is a short table.
3. **Recommend.** The model reads the table and a few plain lines of limits written by code, and proposes the week. Code checks it: weekly load, rest after poor sleep, race taper, the calendar, how many sessions. A week that fails goes back to the model with the reason, once. If it still fails, code keeps the sessions that pass, or uses a rule-built week.
4. **Place.** When the person adds a session, the calendar engine finds its time. If nothing else has to move it is added at once; otherwise the person sees a preview and confirms.
5. **Feedback.** "Not now" stops the habit that session came from. Done and missed sessions become tomorrow's facts.

A sentence typed in Ask goes to the agent it belongs to. Requests to forget or delete are recognised by code and always ask first.

## Rules that hold everywhere

- A model proposes; code checks and executes.
- Memory comes only from data, never from what was recommended.
- Nothing is on the calendar until the person adds it, except moving an added workout out of the way of a new meeting, which can be undone and turned off.
- Every suggestion names what it is based on, and only things that are true.
- Forgetting deletes.

## Checking the model

`app/scripts/eval-real-ai.sh` runs the agents against the real model: typed sentences the prompts have never seen, weeks for different people in different situations, and daily memory updates. Where the model falls short the fix is more checking and clearer instructions around it, not a larger model.
