import Foundation
import Testing
@testable import Evergreen

/// The agents against the real Gemini API. Skipped unless `GEMINI_API_KEY`
/// is in the environment (`scripts/eval-real-ai.sh` passes it through; it is
/// never printed). Each case prints one line, `EVAL <section> PASS|FAIL
/// <case>: <why>`, and each section a summary with its pass and fallback rates.
/// `EVAL_SECTION=ask|seen|heldout|plan|busy|memory|days|questions|safety` runs one section.
@Suite(.serialized)
struct RealAIEval {
    struct Summary: Sendable {
        var section: String
        var passed: Int
        var total: Int
        var fallbacks: Int
        var target: Double
        /// At most this share of cases may have needed the fallback.
        var fallbackLimit: Double
        /// How long each case took, in milliseconds.
        var times: [Int] = []

        func percentile(_ p: Double) -> Int {
            let sorted = times.sorted()
            return sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))]
        }

        var passRate: Double { total == 0 ? 1 : Double(passed) / Double(total) }
        var fallbackRate: Double { total == 0 ? 0 : Double(fallbacks) / Double(total) }
        var holds: Bool { passRate >= target && fallbackRate <= fallbackLimit }
        var line: String {
            "EVAL \(section) SUMMARY passed \(passed) of \(total) (\(Int((passRate * 100).rounded()))%, target \(Int(target * 100))%), fallbacks \(fallbacks) (\(Int((fallbackRate * 100).rounded()))%, limit \(Int(fallbackLimit * 100))%)\(times.isEmpty ? "" : ", p50 \(percentile(0.5))ms p95 \(percentile(0.95))ms")"
        }
    }

    /// Against the real API: every section runs to the end whatever fails, each case and each
    /// section prints a line, and only the summaries are asserted. `EVAL_SECTION` runs one.
    @Test(.enabled(if: RealAIKey.given != nil)) func realModel() async {
        // Counted in memory only, so each case can say what it cost.
        let usage = AIUsage(defaults: nil)
        let model = GeminiClient(key: RealAIKey.given ?? "", usage: usage)
        let environment = ProcessInfo.processInfo.environment
        let only = environment["EVAL_SECTION"].flatMap { $0.isEmpty ? nil : $0 }
        // EVAL_RUNS=3 runs each section three times, to see the spread.
        let runs = max(1, environment["EVAL_RUNS"].flatMap { Int($0) } ?? 1)
        var summaries: [Summary] = []
        for run in 1...runs {
            if runs > 1 { print("EVAL run \(run) of \(runs)") }
            // "seen" shares sentences with the prompt's examples; "heldout" shares none, on another weekday with other workouts.
            if only == nil || only == "ask" || only == "seen" { summaries.append(await Self.askUnderstanding(model, set: .seen, usage: usage)) }
            if only == nil || only == "ask" || only == "heldout" { summaries.append(await Self.askUnderstanding(model, set: .heldOut, usage: usage)) }
            if only == nil || only == "plan" { summaries.append(await Self.plans(model, usage: usage)) }
            if only == nil || only == "plan" || only == "busy" { summaries.append(await Self.busyWeek(model, usage: usage)) }
            if only == nil || only == "memory" { summaries.append(await Self.dailyMemory(model, usage: usage)) }
            if only == nil || only == "memory" || only == "days" { summaries.append(await Self.memoryDays(model, usage: usage)) }
            if only == nil || only == "memory" || only == "questions" { summaries.append(await Self.memoryQuestions(model, usage: usage)) }
            if only == nil || only == "safety" { summaries.append(await Self.safety(model, usage: usage)) }
        }
        for summary in summaries {
            print(summary.line)
            #expect(summary.holds, "\(summary.line)")
        }
        // The spread across runs, per section.
        for section in Set(summaries.map(\.section)).sorted() where runs > 1 {
            let rates = summaries.filter { $0.section == section }.map { Int(($0.passRate * 100).rounded()) }
            print("EVAL \(section) SPREAD \(rates.min() ?? 0)% to \(rates.max() ?? 0)% over \(rates.count) runs")
        }
    }

    /// A model that gets everything wrong in the right shape: the wrong agent, the wrong
    /// intent, seven hard sessions on made-up memories, invented numbers. Every section must
    /// fail on it; if one passed, the eval would be measuring the guard, not the model.
    @Test func aDeliberatelyBadModelFailsEverySection() async {
        let bad = ScriptedModel { request in
            let text: String
            if request.answerSchema == Router.schema {
                text = #"{"agent":"none"}"#
            } else if request.answerSchema == PlanAgent.schema {
                let sessions = (0..<7).map { #"{"day":"2026-11-\#(23 + $0)","start":"06:00","activity":"run","minutes":240,"intensity":"hard","reason":"Go hard.","basedOn":["made-up"]}"# }
                text = #"{"sessions":[\#(sessions.joined(separator: ","))],"summary":"Seven hard days."}"#
            } else if request.answerSchema?["properties"]?["proposals"] != nil {
                text = #"{"proposals":[{"op":"ADD","slot":"routine.made.up","statement":"Runs 99 times a week.","kind":"usual_slot","evidenceIds":["none"]}]}"#
            } else {
                text = #"{"kind":"add","activity":"walk","minutes":5,"day":"","after":"","before":"","partOfDay":"none","targetWorkoutId":"","sessionId":"","title":"","raceDate":"","distanceKm":0,"more":false}"#
            }
            return ModelReply(stopReason: "end_turn", content: [["type": "text", "text": .string(text)]])
        }
        for summary in [await Self.askUnderstanding(bad, set: .seen, quiet: true), await Self.askUnderstanding(bad, set: .heldOut, quiet: true),
                        await Self.plans(bad, quiet: true), await Self.dailyMemory(bad, quiet: true)] {
            #expect(!summary.holds, "a bad model passed: \(summary.line)")
        }
    }

    /// Without a key: the same sections with a model that can't be reached, so every case
    /// takes its fallback. Proves the eval itself runs to the end, and that the fallbacks give valid results.
    @Test func everySectionRunsToTheEndWhenTheModelCannotBeReached() async {
        let down = ScriptedModel { _ in ModelReply(stopReason: "refusal", content: []) }
        let ask = await Self.askUnderstanding(down, set: .seen, quiet: true)
        #expect(ask.total == Self.asks.count && ask.total >= 40)
        #expect(AskSet.heldOut.asks.count >= 40)
        // The held-out set shares no sentence with the seen one or with the prompt's examples.
        let agent = CalendarAgent(model: down, modelId: AIModels.standard, schema: [:], now: Self.now, planned: [])
        let known = (Self.asks.map(\.sentence) + [agent.system, Router.system]).joined(separator: "\n").lowercased()
        #expect(AskSet.heldOut.asks.allSatisfy { !known.contains($0.sentence.lowercased()) })
        let plan = await Self.plans(down, quiet: true)
        // Every rules week passes the check and has something in it, also for the beginner whose only usual time is stopped.
        #expect(plan.total == 16 && plan.fallbacks == 15 && plan.passed == 16, "\(plan.line)")
        let memory = await Self.dailyMemory(down, quiet: true)
        #expect(memory.total == 3 && memory.fallbacks == 3 && memory.passed == 3, "\(memory.line)")
        let busy = await Self.busyWeek(down, quiet: true)
        #expect(busy.passed == 1 && busy.fallbacks == 1, "\(busy.line)")
        let days = await Self.memoryDays(down, quiet: true)
        #expect(days.total == 6 && days.passed == 6, "\(days.line)")
        let questions = await Self.memoryQuestions(down, quiet: true)
        #expect(questions.total == 4, "\(questions.line)")
        let safety = await Self.safety(down, quiet: true)
        #expect(safety.passed == 3, "\(safety.line)")
    }

    /// Monday, 9 AM.
    static let now = LocalTime("2026-11-23T09:00:00-08:00")!
    static func day(_ offset: Int) -> String { String(format: "2026-11-%02d", 23 + offset) }
    static let planned: [(id: String, activity: ActivityKind, start: LocalTime, minutes: Int)] = [
        ("w-run", .run, LocalTime("2026-11-24T07:00:00-08:00")!, 40),
        ("w-gym", .strength, LocalTime("2026-11-26T18:00:00-08:00")!, 45),
        ("w-long", .longRun, LocalTime("2026-11-29T08:30:00-08:00")!, 90),
    ]

    // MARK: Ask

    struct Ask: Sendable {
        var sentence: String
        var route: AgentKind
        /// The intent fields that must match (others are free).
        var intent: [String: JSONValue] = [:]
    }

    static let asks: [Ask] = [
        // add
        Ask(sentence: "Find me 45 minutes to run tonight", route: .calendar, intent: ["kind": "add", "activity": "run", "minutes": 45, "day": .string(day(0)), "partOfDay": "evening"]),
        Ask(sentence: "add a 30 min walk tomorrow morning", route: .calendar, intent: ["kind": "add", "activity": "walk", "minutes": 30, "day": .string(day(1)), "partOfDay": "morning"]),
        Ask(sentence: "yoga thursday around half past six", route: .calendar, intent: ["kind": "add", "activity": "yoga", "day": .string(day(3)), "after": "18:30"]),
        Ask(sentence: "can u fit in a swim on wednesday", route: .calendar, intent: ["kind": "add", "activity": "swim", "day": .string(day(2))]),
        Ask(sentence: "schedule strength for friday at 6ish", route: .calendar, intent: ["kind": "add", "activity": "strength", "day": .string(day(4)), "after": "18:00"]),
        Ask(sentence: "I want to go climbing on Saturday afternoon for an hour", route: .calendar, intent: ["kind": "add", "activity": "other", "minutes": 60, "day": .string(day(5)), "partOfDay": "afternoon"]),
        Ask(sentence: "book a 20 minute stretch tonite", route: .calendar, intent: ["kind": "add", "activity": "stretch", "minutes": 20, "day": .string(day(0))]),
        Ask(sentence: "put a bike ride in on sunday morning", route: .calendar, intent: ["kind": "add", "activity": "ride", "day": .string(day(6)), "partOfDay": "morning"]),
        Ask(sentence: "give me a rest day on wednesday", route: .calendar, intent: ["kind": "add", "activity": "rest", "day": .string(day(2))]),
        Ask(sentence: "add an easy run after 7pm today", route: .calendar, intent: ["kind": "add", "activity": "run", "day": .string(day(0)), "after": "19:00"]),
        // move
        Ask(sentence: "Move tomorrow's run to the afternoon", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "w-run", "partOfDay": "afternoon"]),
        Ask(sentence: "push tomorrow's run back a bit", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "w-run"]),
        Ask(sentence: "move sundays long run to saturday", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "w-long", "day": .string(day(5))]),
        Ask(sentence: "can the gym session on thursday be in the morning instead", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "w-gym", "partOfDay": "morning"]),
        Ask(sentence: "reschedule the long run to after 10", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "w-long", "after": "10:00"]),
        Ask(sentence: "tomorow run later pls, like 6pm", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "w-run", "after": "18:00"]),
        Ask(sentence: "shift strength to friday", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "w-gym", "day": .string(day(4))]),
        // resize
        Ask(sentence: "Shorten tomorrow's run to 20 minutes", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "w-run", "minutes": 20]),
        Ask(sentence: "make the long run an hour", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "w-long", "minutes": 60]),
        Ask(sentence: "I only have 30 min for the gym on thursday", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "w-gym", "minutes": 30]),
        Ask(sentence: "extend tomorrows run to 50 mins", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "w-run", "minutes": 50]),
        // cancel
        Ask(sentence: "Cancel tomorrow's run", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "w-run"]),
        Ask(sentence: "skip the gym thursday", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "w-gym"]),
        Ask(sentence: "drop sunday's long run", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "w-long"]),
        Ask(sentence: "i cant do the run tomorrow, take it off", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "w-run"]),
        // two requests in one sentence: the first is done
        Ask(sentence: "cancel tomorrow's run and add yoga on friday", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "w-run"]),
        Ask(sentence: "add a walk tonight and move the gym to friday", route: .calendar, intent: ["kind": "add", "activity": "walk", "day": .string(day(0))]),
        // race
        Ask(sentence: "I'm racing a 10k on December 6", route: .calendar, intent: ["kind": "race", "raceDate": "2026-12-06", "distanceKm": 10]),
        Ask(sentence: "i have a half marathon on dec 13th", route: .calendar, intent: ["kind": "race", "raceDate": "2026-12-13"]),
        // week
        Ask(sentence: "Plan my week", route: .week),
        Ask(sentence: "replan the whole week please", route: .week),
        // plan questions
        Ask(sentence: "Why a long run on Sunday?", route: .plan),
        Ask(sentence: "should I go hard tomorrow", route: .plan),
        Ask(sentence: "what should i do today", route: .plan),
        Ask(sentence: "how many workouts this week?", route: .plan),
        Ask(sentence: "do I need new shoes", route: .plan),
        // memory
        Ask(sentence: "What do you remember about me?", route: .memory),
        Ask(sentence: "stop planning sunday mornings", route: .memory),
        Ask(sentence: "forget last tuesday", route: .memory),
        Ask(sentence: "wat do u know abt my sleep", route: .memory),
        Ask(sentence: "delete everything you know about me", route: .memory),
        // not for Evergreen
        Ask(sentence: "What's the weather on Mars?", route: AgentKind.none),
        Ask(sentence: "book me a table for two at 8", route: AgentKind.none),
        Ask(sentence: "write a poem about my cat", route: AgentKind.none),
        Ask(sentence: "what is the capital of France", route: AgentKind.none),
    ]

    /// A set of sentences with the day and the planned workouts they are said on.
    struct AskSet: Sendable {
        var name: String
        var now: LocalTime
        var planned: [(id: String, activity: ActivityKind, start: LocalTime, minutes: Int)]
        var asks: [Ask]

        static let seen = AskSet(name: "ask-seen", now: RealAIEval.now, planned: RealAIEval.planned, asks: RealAIEval.asks)

        /// Thursday 2026-12-03, 10 AM, with a swim on Friday, a ride on Saturday and yoga on Monday.
        /// No sentence, date, weekday pairing or workout id here appears in the prompts' examples.
        static let heldOut: AskSet = {
            func day(_ offset: Int) -> JSONValue { .string(String(format: "2026-12-%02d", 3 + offset)) }
            return AskSet(name: "ask-heldout", now: LocalTime("2026-12-03T10:00:00-08:00")!, planned: [
                ("p-swim", .swim, LocalTime("2026-12-04T06:30:00-08:00")!, 45),
                ("p-ride", .ride, LocalTime("2026-12-05T09:00:00-08:00")!, 120),
                ("p-yoga", .yoga, LocalTime("2026-12-07T19:00:00-08:00")!, 60),
            ], asks: [
                // add
                Ask(sentence: "squeeze in a quick jog this evening, 25 minutes", route: .calendar, intent: ["kind": "add", "activity": "run", "minutes": 25, "day": day(0), "partOfDay": "evening"]),
                Ask(sentence: "I'd like weights on Tuesday before work, say 6:15", route: .calendar, intent: ["kind": "add", "activity": "strength", "day": day(5), "after": "06:15"]),
                Ask(sentence: "pencil in a stroll after lunch tomorrow", route: .calendar, intent: ["kind": "add", "activity": "walk", "day": day(1), "partOfDay": "afternoon"]),
                Ask(sentence: "is there room for an hour on the elliptical sunday", route: .calendar, intent: ["kind": "add", "activity": "elliptical", "minutes": 60, "day": day(3)]),
                Ask(sentence: "plz add stretching wed nite for 15 mins", route: .calendar, intent: ["kind": "add", "activity": "stretch", "minutes": 15, "day": day(6), "partOfDay": "evening"]),
                Ask(sentence: "set up a tempo run for Monday at quarter past five in the evening", route: .calendar, intent: ["kind": "add", "activity": "run", "day": day(4), "after": "17:15"]),
                Ask(sentence: "I want to play tennis Saturday around 3", route: .calendar, intent: ["kind": "add", "activity": "other", "day": day(2), "after": "15:00"]),
                Ask(sentence: "a day off on Sunday please", route: .calendar, intent: ["kind": "add", "activity": "rest", "day": day(3)]),
                Ask(sentence: "get me in the pool today sometime after 4", route: .calendar, intent: ["kind": "add", "activity": "swim", "day": day(0), "after": "16:00"]),
                Ask(sentence: "40 min spin tmrw morning", route: .calendar, intent: ["kind": "add", "activity": "ride", "minutes": 40, "day": day(1), "partOfDay": "morning"]),
                // move
                Ask(sentence: "can Friday's swim happen in the evening", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "p-swim", "partOfDay": "evening"]),
                Ask(sentence: "bump the ride to Sunday", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "p-ride", "day": day(3)]),
                Ask(sentence: "start monday's yoga after 8 at night", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "p-yoga", "after": "20:00"]),
                Ask(sentence: "slide tomorrows swim to lunchtime", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "p-swim", "partOfDay": "afternoon"]),
                Ask(sentence: "I can't ride at 9 on saturday, do it at half past two", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "p-ride", "after": "14:30"]),
                Ask(sentence: "put the yoga class on wednesday instead", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "p-yoga", "day": day(6)]),
                Ask(sentence: "the swim, later in the day pls", route: .calendar, intent: ["kind": "move", "targetWorkoutId": "p-swim"]),
                // resize
                Ask(sentence: "trim the ride down to an hour and a half", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "p-ride", "minutes": 90]),
                Ask(sentence: "only got half an hour for the swim", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "p-swim", "minutes": 30]),
                Ask(sentence: "stretch monday's yoga out to 75 minutes", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "p-yoga", "minutes": 75]),
                Ask(sentence: "cut saturday's bike to 45", route: .calendar, intent: ["kind": "resize", "targetWorkoutId": "p-ride", "minutes": 45]),
                // cancel
                Ask(sentence: "scrap the swim", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "p-swim"]),
                Ask(sentence: "not doing yoga on Monday after all", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "p-yoga"]),
                Ask(sentence: "ditch the saturday ride, weather looks awful", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "p-ride"]),
                Ask(sentence: "remove tomorrow's swim from my plan", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "p-swim"]),
                // two in one
                Ask(sentence: "scrap the swim and then book weights for Tuesday", route: .calendar, intent: ["kind": "cancel", "targetWorkoutId": "p-swim"]),
                Ask(sentence: "book a walk for sunday morning, also shorten the ride", route: .calendar, intent: ["kind": "add", "activity": "walk", "day": day(3), "partOfDay": "morning"]),
                // race
                Ask(sentence: "signed up for a marathon on January 17", route: .calendar, intent: ["kind": "race", "raceDate": "2027-01-17", "distanceKm": 42.2]),
                Ask(sentence: "there's a 5k fun run on the 12th of December I'm doing", route: .calendar, intent: ["kind": "race", "raceDate": "2026-12-12", "distanceKm": 5]),
                // week
                Ask(sentence: "redo my whole schedule for the week", route: .week),
                Ask(sentence: "give me a fresh plan for the next seven days", route: .week),
                // plan questions
                Ask(sentence: "how come there's nothing on Wednesday?", route: .plan),
                Ask(sentence: "is tomorrow meant to be easy or tough", route: .plan),
                Ask(sentence: "am I overdoing it lately?", route: .plan),
                Ask(sentence: "are my trainers worn out yet", route: .plan),
                // memory
                Ask(sentence: "show me what you've learned about my habits", route: .memory),
                Ask(sentence: "you've got my bedtime wrong, what do you have for it", route: .memory),
                Ask(sentence: "bring back the saturday routine you stopped using", route: .memory),
                Ask(sentence: "how long have you thought I ride on weekends", route: .memory),
                // not for Evergreen
                Ask(sentence: "translate good morning into Spanish", route: AgentKind.none),
                Ask(sentence: "who won the world cup in 2018", route: AgentKind.none),
                Ask(sentence: "order me a pizza", route: AgentKind.none),
                Ask(sentence: "my knee hurts when I run, what should I take for it", route: AgentKind.none),
            ])
        }()
    }

    static func askUnderstanding(_ model: any LanguageModel, set: AskSet, quiet: Bool = false, usage: AIUsage? = nil) async -> Summary {
        let schema = await AppModel.calendarBundle.call("calendarIntentSchema")
        let router = Router(model: model, modelId: AIModels.standard)
        let agent = CalendarAgent(model: model, modelId: AIModels.standard, schema: schema, now: set.now, planned: set.planned)
        var passed = 0, fallbacks = 0
        var times: [Int] = []
        let clock = ContinuousClock()
        for ask in set.asks {
            var why: [String] = []
            let started = clock.now
            let before = await usage?.day()
            // The same path as the app: the memory matcher, a planned workout named with a cancel or move verb, then the model.
            let said = " " + ask.sentence.lowercased().replacing("’", with: "'") + " "
            let command = MemoryCommand.match(ask.sentence, today: set.now.day, days: [], rows: []) != nil
            let routed = (try? await router.sort(ask.sentence, memoryCommand: command, namesPlannedWorkout: agent.target(in: said) != nil))
                ?? (kind: AgentKind.none, fellBack: true)
            if routed.fellBack { fallbacks += 1 }
            if routed.kind != ask.route { why.append("routed to \(routed.kind.rawValue), expected \(ask.route.rawValue)") }
            if ask.route == .calendar, routed.kind == .calendar {
                let read = await agent.intent(for: ask.sentence)
                if read.source == .rules { fallbacks += 1 }
                let got = read.intent.map(JSONValue.from) ?? .null
                for (field, expected) in ask.intent.sorted(by: { $0.key < $1.key }) where got[field] != expected {
                    why.append("\(field) is \(got[field]?.text ?? "missing"), expected \(expected.text)")
                }
            }
            if why.isEmpty { passed += 1 }
            let took = (clock.now - started).components
            let ms = Int(took.seconds * 1000 + took.attoseconds / 1_000_000_000_000_000)
            times.append(ms)
            if !quiet { print("EVAL \(set.name) \(why.isEmpty ? "PASS" : "FAIL") \"\(ask.sentence)\" \(ms)ms\(await Self.spent(usage, since: before))\(why.isEmpty ? "" : ": " + why.joined(separator: "; "))") }
        }
        return Summary(section: set.name, passed: passed, total: set.asks.count, fallbacks: fallbacks, target: 0.9, fallbackLimit: 0.2, times: times)
    }

    // MARK: Plan

    static let banned = ["load cap", "readiness", "acwr", "basedon", "planner", "harness", "memory key", "checkplan", "mem:"]

    static func plans(_ model: any LanguageModel, quiet: Bool = false, usage: AIUsage? = nil) async -> Summary {
        let now = Self.now.date ?? Date()
        let zone = TimeZone(secondsFromGMT: -8 * 3600) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        var passed = 0, fallbacks = 0, total = 0
        var normals: [String: PlanAgent.Week] = [:]
        var times: [Int] = []
        // Each person's normal week first, so the other situations can be compared with it.
        let situations = [PlanEvalTests.Situation.normal] + PlanEvalTests.Situation.allCases.filter { $0 != .normal }
        for person in PlanEvalTests.Person.all {
            for situation in situations {
                total += 1
                let rows = situation.apply(person).rows
                // The rules get the history the rows came from, as in the app: their own week needs it.
                let rules = BundlePlanRules(bundle: AppModel.planBundle, history: person.history(situation, now: now, calendar: calendar), busy: [], timeZone: zone)
                var agent = PlanAgent(model: model, modelId: AIModels.standard, rules: rules, rows: rows, now: now, offsetMinutes: -480)
                agent.tableText = rows.filter(\.isUsable).map { "| \($0.slot) | \($0.statement) | \($0.since) | likely |" }.joined(separator: "\n")
                let started = ContinuousClock().now
                let before = await usage?.day()
                let week = await agent.week()
                let cost = await Self.spent(usage, since: before)
                let took = (ContinuousClock().now - started).components
                times.append(Int(took.seconds * 1000 + took.attoseconds / 1_000_000_000_000_000))
                if situation == .normal { normals[person.name] = week }
                var why: [String] = []
                if week.source == .rules { fallbacks += 1 }
                // Whatever is shown must be valid: it passed the check, and rests only on keys in the table.
                let usable = Set(rows.filter(\.isUsable).map(\.key))
                let problems = await rules.checkPlan(week.sessions, summary: week.summary, rows: rows, now: now)
                if !problems.isEmpty { why.append("shown plan fails the check: \(problems.map(\.code).joined(separator: ","))") }
                // A week from the rules says which check the model's last answer failed.
                let failed = week.source == .rules ? " failed=[\((week.failed ?? []).joined(separator: ","))]" : ""
                if !week.sessions.allSatisfy({ Set($0.basedOn).isSubset(of: usable) }) { why.append("a session rests on a key that isn't usable") }
                for session in week.sessions where week.source == .agent {
                    let reason = session.reason.lowercased()
                    if reason.isEmpty || Self.banned.contains(where: reason.contains) || reason.contains("_") { why.append("reason not plain: \"\(session.reason)\"") }
                    if let untrue = Self.untrue(session, rows: rows) { why.append(untrue) }
                }
                // Beyond valid: is it this person's week?
                let training = week.sessions.filter { $0.activity != .rest }
                let rest = week.sessions.count - training.count
                let minutes = training.reduce(0) { $0 + $1.minutes }
                let usual = PlanAgent.usualSessions(person.rows)
                let usualMinutes = Int(person.rows.compactMap { $0.data["minutes"]?.number }.reduce(0, +))
                // The limits are the rules' own, worked out from this person's rows.
                let context = await rules.planContext(rows: rows, now: now)
                let maxSessions = Int(context["maxSessions"]?.number ?? Double(usual + 1)), maxMinutes = Int(context["maxMinutes"]?.number ?? 0)
                let volume = rows.first { $0.kind == "weekly_volume" }
                let limits = "workoutsPerWeek=\(volume?.data["workoutsPerWeek"]?.text ?? "none") volume=\(volume.map { "\($0.kind)/\($0.state)" } ?? "none") maxSessions=\(maxSessions) maxMinutes=\(maxMinutes)"
                // Someone who trains gets something to do: an empty week needs a stated reason (rest after poor sleep, a race).
                if usual >= 1, training.isEmpty {
                    let said = week.summary.lowercased()
                    // The rules say nothing; in a race week their only answer for a usual time on the race weekend is to leave it out.
                    let explained = week.source == .agent ? [.poorSleep, .raceWeek].contains(situation) && ["rest", "recover", "sleep", "race"].contains(where: said.contains) : situation == .raceWeek
                    if !explained { why.append("an empty week for someone who usually does \(usual)") }
                }
                if training.count > maxSessions { why.append("\(training.count) training sessions, over the limit of \(maxSessions)") }
                switch situation {
                case .highLoad:
                    if maxMinutes > 0, minutes > maxMinutes { why.append("\(minutes) minutes under a high load, over the limit of \(maxMinutes)") }
                case .poorSleep:
                    // The bad nights are behind today: nothing hard today or tomorrow.
                    let soon = [Self.day(0), Self.day(1)]
                    if training.contains(where: { soon.contains($0.day) && $0.intensity == "hard" }) { why.append("a hard session right after the bad nights") }
                case .stoppedSlot:
                    if let stopped = rows.first(where: \.isRejected), let weekday = stopped.data["weekday"]?.number, let hour = stopped.data["hour"]?.number,
                       training.contains(where: { PlanAgent.slot(of: $0).map { $0.weekday == Int(weekday) && $0.hour == Int(hour) } == true }) {
                        why.append("a session in the stopped slot")
                    }
                case .raceWeek:
                    // The race is on Sunday: nothing hard the day before, and no more than the normal week.
                    if training.contains(where: { $0.day == Self.day(5) && $0.intensity == "hard" }) { why.append("a hard session the day before the race") }
                    if let normal = normals[person.name], minutes > normal.sessions.reduce(0, { $0 + $1.minutes }) { why.append("more minutes (\(minutes)) than the normal week in a race week") }
                default:
                    break
                }
                // Rejecting a row changes the plan: nothing rests on it any more.
                if let key = week.sessions.flatMap(\.basedOn).first {
                    var without = rows
                    for index in without.indices where without[index].key == key { without[index].state = "rejected" }
                    var again = PlanAgent(model: model, modelId: AIModels.standard, rules: rules, rows: without, now: now, offsetMinutes: -480)
                    again.tableText = agent.tableText
                    let replanned = await again.week()
                    if replanned.sessions.contains(where: { $0.basedOn.contains(key) }) { why.append("still rests on \(key) after it was rejected") }
                }
                // On a fallback, the limits the model was given, to see what it missed.
                if !quiet, week.source == .rules {
                    print("EVAL plan LIMITS \(person.name)/\(situation.rawValue): \((await rules.planBrief(rows: rows, now: now)).joined(separator: " | "))")
                    print("EVAL plan RULES-WEEK \(person.name)/\(situation.rawValue): \(week.sessions.map { "\($0.day) \($0.start.clock) \($0.activity.rawValue) \($0.minutes) \($0.intensity)" }.joined(separator: "; "))")
                }
                if why.isEmpty { passed += 1 }
                if !quiet { print("EVAL plan \(why.isEmpty ? "PASS" : "FAIL") \(person.name)/\(situation.rawValue) source=\(week.source.rawValue)\(failed) revisions=\(week.revisions) training=\(training.count) rest=\(rest) minutes=\(minutes) usual=\(usual)/\(usualMinutes)min \(limits) \(times.last ?? 0)ms\(cost)\(why.isEmpty ? "" : ": " + why.joined(separator: "; "))") }
            }
        }
        // Three different people get three different weeks.
        total += 1
        let shapes = normals.values.map { week in week.sessions.filter { $0.activity != .rest }.map { "\($0.activity.rawValue)@\(PlanAgent.slot(of: $0).map { "\($0.weekday):\($0.hour)" } ?? "")" }.sorted().joined(separator: ",") }
        let distinct = Set(shapes).count == shapes.count && shapes.count == PlanEvalTests.Person.all.count
        if distinct { passed += 1 }
        if !quiet { print("EVAL plan \(distinct ? "PASS" : "FAIL") three people, three different weeks\(distinct ? "" : ": " + shapes.joined(separator: " | "))") }
        return Summary(section: "plan", passed: passed, total: total, fallbacks: fallbacks, target: 1.0, fallbackLimit: 0.2, times: times)
    }

    // MARK: Daily memory

    /// 28 days of workouts for three kinds of people.
    static func history(_ person: String, today: Date, calendar: Calendar) -> [Workout] {
        (1...28).flatMap { back -> [Workout] in
            guard let day = calendar.date(byAdding: .day, value: -back, to: today) else { return [] }
            let weekday = calendar.component(.weekday, from: day)
            func workout(_ type: String, _ hour: Int, _ minutes: Double, km: Double? = nil) -> Workout? {
                calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day).map {
                    Workout(id: "eval-\(person)-\(back)-\(type)", activityType: type, start: $0, end: $0.addingTimeInterval(minutes * 60),
                            effort: nil, avgHeartRate: 145, source: .health, distanceKm: km, indoor: false)
                }
            }
            switch person {
            case "runner": return [weekday == 1 ? workout("Running", 8, 80, km: 14) : [3, 5].contains(weekday) ? workout("Running", 6, 40, km: 7) : nil].compactMap(\.self)
            case "mixed": return [weekday == 2 ? workout("TraditionalStrengthTraining", 7, 50) : weekday == 4 ? workout("Yoga", 18, 45) : weekday == 7 ? workout("Running", 9, 35, km: 6) : nil].compactMap(\.self)
            default: return [weekday == 7 ? workout("Walking", 10, 30, km: 2.5) : nil].compactMap(\.self)
            }
        }
    }

    static func dailyMemory(_ model: any LanguageModel, quiet: Bool = false, usage: AIUsage? = nil) async -> Summary {
        let calendar = Calendar.current, today = calendar.startOfDay(for: Date()), now = Date()
        var passed = 0, fallbacks = 0
        var times: [Int] = []
        let people = ["runner", "mixed", "beginner"]
        for person in people {
            let root = FileManager.default.temporaryDirectory.appending(path: "eval-memory-\(UUID().uuidString)")
            guard let engine = MemoryEngine(root: root, secret: "eval-only-0123456789abcdef") else {
                if !quiet { print("EVAL memory FAIL \(person): the memory engine didn't start") }
                continue
            }
            let workouts = Self.history(person, today: today, calendar: calendar)
            let start = workouts.map(\.start).min() ?? today
            await engine.sync(MemoryInput(personaKey: "me", historyStart: calendar.startOfDay(for: start), now: now, workouts: workouts, days: [], calendar: calendar))
            let memory = EngineMemory(engine: engine, personaKey: "me", timeZone: calendar.timeZone)
            let loop = Orchestrator(memory: memory, rules: BundlePlanRules(bundle: AppModel.planBundle, history: HistoryPayload(workouts: [], days: [], cal: calendar), busy: [], timeZone: calendar.timeZone),
                                    calendar: BundleCalendar(bundle: AppModel.calendarBundle, busy: [], planned: [], timeZone: calendar.timeZone),
                                    writer: ClosureWriter { _ in false }, model: model, modelId: AIModels.standard)
            let started = ContinuousClock().now
            let before = await usage?.day()
            let result = await loop.consolidate(now: now, outcomes: [])
            times.append(Self.ms(since: started))
            let cost = await Self.spent(usage, since: before)
            var why: [String] = []
            if result.run.source == .rules { fallbacks += 1 }
            if result.run.source == .none { why.append("nothing was due") }
            let survived = result.run.proposals == 0 ? 0 : 1 - Double(result.run.refused.count) / Double(result.run.proposals)
            if result.run.proposals > 0, survived < 0.8 { why.append("only \(Int(survived * 100))% of proposals survived: \(result.run.refused.joined(separator: " | "))") }
            if result.run.refused.contains(where: { $0.hasPrefix("number_not_in_evidence") }) { why.append("a number not in the evidence got through the repair round") }
            // The table validates: every row decoded (the engine's count matches) and there is something in it.
            let raw = await engine.agentCall("memoryTable", personaKey: "me")
            if !raw.isOK || raw["rows"]?.array?.count != result.rows.count { why.append("the table doesn't validate") }
            if result.rows.isEmpty { why.append("the table is empty") }
            if why.isEmpty { passed += 1 }
            if !quiet { print("EVAL memory \(why.isEmpty ? "PASS" : "FAIL") \(person) source=\(result.run.source) proposals=\(result.run.proposals) refused=\(result.run.refused.count) repairs=\(result.run.repairs)\(result.run.fallback.map { " fallback=\"\($0)\"" } ?? "") rows=\(result.rows.count) \(times.last ?? 0)ms\(cost)\(why.isEmpty ? "" : ": " + why.joined(separator: "; "))") }
        }
        return Summary(section: "memory", passed: passed, total: people.count, fallbacks: fallbacks, target: 1.0, fallbackLimit: 0.2, times: times)
    }
}

/// The key for the real-API eval, from the test process's environment only.
enum RealAIKey {
    static var given: String? { ProcessInfo.processInfo.environment["GEMINI_API_KEY"].flatMap { $0.isEmpty ? nil : $0 } }
}
