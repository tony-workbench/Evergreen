import Foundation
import Testing
@testable import Evergreen

/// The loop that connects the agents: remember, recommend, place, confirm.
struct OrchestratorTests {
    typealias F = PlanFakes

    /// A memory engine that keeps rows and a log of what was asked of it.
    actor FakeMemory: MemoryConsolidating {
        var rows: [MemoryRow]
        var due = true
        var log: [String] = []
        var outcomes: [Outcome] = []

        init(_ rows: [MemoryRow]) { self.rows = rows }

        func dailyRequest(now: Date, outcomes: [Outcome]) async -> DailyRequest? {
            self.outcomes = outcomes
            guard due else { return nil }
            return ("2026-11-21", "Consolidate.", "Evidence: e1", ["type": "object", "properties": ["proposals": ["type": "array"]], "required": ["proposals"], "additionalProperties": false],
                    [["id": "e1", "text": "Ran 4 times in 28 days."]])
        }
        nonisolated var goesWithoutModel: Bool { false }
        func rulesAnswer(now: Date, outcomes: [Outcome]) async -> JSONValue? { ["proposals": []] }
        func apply(day: String, answer: JSONValue, now: Date) async -> [String]? {
            due = false
            log.append("apply \(day) \(answer.text)")
            return []
        }
        func table() async -> [MemoryRow] { rows }
        func tableText() async -> String { "| Slot | What |" }
        func reviewQueue() async -> [MemoryRow] { rows.filter { $0.state == "review" } }
        func reject(key: String, now: Date) async { set(key, "rejected") }
        func restore(key: String, now: Date) async { set(key, "saved") }
        func confirm(key: String, now: Date) async { set(key, "confirmed") }
        private func set(_ key: String, _ state: String) {
            log.append("\(state) \(key)")
            for index in rows.indices where rows[index].key == key { rows[index].state = state }
        }
    }

    actor FakeCalendar: CalendarPlanning, CalendarWriting {
        var intents: [(intent: CalendarIntent, memory: CalendarMemory)] = []
        var written: [PreviewBlock] = []
        var writes = true

        func refuseWrites() { writes = false }

        func plan(_ intent: CalendarIntent, memory: CalendarMemory, now: Date) async -> CalendarResult? {
            intents.append((intent, memory))
            guard let activity = intent.activity, let day = intent.day, let after = intent.after else { return nil }
            let block = PreviewBlock(id: "b1", sessionId: intent.sessionId, activity: activity, title: activity.displayName, start: F.time(day, after),
                                     end: F.time(day, "09:30"), minutes: intent.minutes ?? 0, status: "new", reason: "Free then.")
            return CalendarResult(kind: "add", message: "That works.", proposed: [block])
        }

        func plan(request: String, memory: CalendarMemory, now: Date) async -> CalendarResult? { nil }
        func replan(_ last: CalendarResult, change: JSONValue, memory: CalendarMemory, now: Date) async -> CalendarResult? { last }
        func intentSchema() async -> JSONValue { ["type": "object"] }

        func write(_ blocks: [PreviewBlock]) async -> Bool {
            if writes { written += blocks }
            return writes
        }
    }

    /// The week the AI writes is read in the zone the loop was given, not the device's: here Tokyo, in a week with no clock change.
    @Test func anAIWrittenWeekIsReadInTheInjectedTimeZone() async throws {
        let tokyo = try #require(TimeZone(identifier: "Asia/Tokyo"))
        var loop = Self.orchestrator(FakeMemory(PlanFakes.rows), FakeCalendar(), ScriptedModel([PlanFakes.answer([("2026-11-25", "18:00", "yoga", 40, ["k2"])])]))
        loop.timeZone = tokyo
        let week = await loop.recommend(rows: PlanFakes.rows, now: PlanFakes.now)
        let session = try #require(week.sessions.first)
        #expect(week.source == .agent && session.start.text == "2026-11-25T18:00:00+09:00")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = tokyo
        #expect(session.start.date.map { calendar.component(.hour, from: $0) } == 18)
        // And in a zone with a clock change inside the week, each session carries the offset of its own day.
        loop = Self.orchestrator(FakeMemory(PlanFakes.rows), FakeCalendar(), ScriptedModel([PlanFakes.answer([("2026-11-25", "18:00", "yoga", 40, ["k2"])])]))
        loop.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        #expect(await loop.recommend(rows: PlanFakes.rows, now: PlanFakes.now).sessions.first?.start.text == "2026-11-25T18:00:00-05:00")
    }

    static func orchestrator(_ memory: FakeMemory, _ calendar: FakeCalendar, _ model: ScriptedModel) -> Orchestrator {
        Orchestrator(memory: memory, rules: CapRules(), calendar: calendar, writer: calendar, model: model, modelId: AIModels.standard)
    }

    @Test func theDayIsRememberedOnceAndTheWeekIsPlannedFromTheTable() async throws {
        let memory = FakeMemory(F.rows), calendar = FakeCalendar()
        let model = ScriptedModel([ScriptedModel.text(#"{"proposals":[]}"#), F.answer([("2026-11-29", "08:00", "long_run", 60, ["k1"])])])
        let loop = Self.orchestrator(memory, calendar, model)
        let records = [PlanRecord(sessionId: "a", day: "2026-11-21", activity: .run, plannedStart: F.time("2026-11-21", "07:00"))]
        let rows = await loop.consolidate(now: F.now, outcomes: HandOff.outcomesFor(records, workouts: [], day: "2026-11-21")).rows
        let week = await loop.recommend(rows: rows, now: F.now)

        #expect(await memory.log == [#"apply 2026-11-21 {"proposals":[]}"#])
        // Yesterday's missed run reached the memory agent as an outcome.
        #expect(await memory.outcomes.map(\.done) == [false])
        #expect(rows == F.rows && week.source == .agent && week.sessions.first?.basedOn == ["k1"])
        #expect(await model.requests.count == 2)

        // Later the same day: no second consolidation, so one model call (the plan) at most.
        let again = ScriptedModel([F.answer([])])
        _ = await Self.orchestrator(memory, calendar, again).consolidate(now: F.now, outcomes: [])
        #expect(await again.requests.isEmpty)
    }

    @Test func whenTheModelIsDownMemoryKeepsYesterdaysTableAndTheRulesPlan() async {
        let memory = FakeMemory(F.rows)
        let loop = Self.orchestrator(memory, FakeCalendar(), ScriptedModel([.failure(.unreachable), .failure(.unreachable)]))
        let rows = await loop.consolidate(now: F.now, outcomes: []).rows
        let week = await loop.recommend(rows: rows, now: F.now)
        // The engine's own rules made the day's proposals instead, and the week came from the plan rules.
        #expect(await memory.log == [#"apply 2026-11-21 {"proposals":[]}"#])
        #expect(rows == F.rows && week.source == .rules)
    }

    @Test func anAcceptedSessionIsPlacedAsAPreviewAndOnlyConfirmingWritesIt() async throws {
        let memory = FakeMemory(F.rows), calendar = FakeCalendar()
        let loop = Self.orchestrator(memory, calendar, ScriptedModel([]))
        let session = F.session("2026-11-29", "08:30", .longRun, 60, basedOn: ["k1"])

        let preview = try #require(await loop.place(session, rows: F.rows, now: F.now))
        let asked = try #require(await calendar.intents.first)
        #expect(asked.intent == CalendarIntent(kind: "add", activity: .longRun, minutes: 60, sessionId: session.id, day: "2026-11-29", after: "08:30", exact: true))
        #expect(asked.memory.slots.map(\.key) == ["k1", "k2"])
        #expect(await calendar.written.isEmpty)

        let records = await loop.confirm(preview)
        #expect(await calendar.written == preview.proposed)
        #expect(records == [PlanRecord(sessionId: session.id, day: "2026-11-29", activity: .longRun, plannedStart: F.time("2026-11-29", "08:30"))])

        // A write that fails records nothing.
        await calendar.refuseWrites()
        #expect(await loop.confirm(preview) == nil)
    }

    @Test func notNowRejectsTheRowsTheSessionRestedOnAndTheNextPlanCannotUseThem() async throws {
        let memory = FakeMemory(F.rows)
        let model = ScriptedModel([F.answer([("2026-11-28", "10:00", "run", 40, [])])])
        let loop = Self.orchestrator(memory, FakeCalendar(), model)
        // The Sunday 8 AM long run is rejected because the session is that usual time; the load row it also cites is not.
        for key in HandOff.keysToReject(F.session("2026-11-29", "08:30", .longRun, 60, basedOn: ["k3", "k1"]), rows: F.rows) {
            await memory.reject(key: key, now: F.now)
        }
        #expect(await memory.log == ["rejected k1"])

        let rows = await memory.table()
        _ = await loop.recommend(rows: rows, now: F.now)
        let brief = try #require(await model.requests.first?.messages.first?["content"]?.string)
        #expect(!brief.contains("Sunday mornings") && brief.contains("Stopped keys (never cite these): k1"))
        #expect(HandOff.rowsToCalendarMemory(rows).slots.map(\.key) == ["k2"])
    }

    @Test func aNumberThatIsNotInTheEvidenceGoesBackOnceBeforeAnythingIsApplied() async throws {
        let memory = FakeMemory(F.rows)
        let wrong = #"{"proposals":[{"statement":"Ran 5 times in 28 days.","evidenceIds":["e1"]}]}"#
        let right = #"{"proposals":[{"statement":"Ran 4 times in 28 days.","evidenceIds":["e1"]}]}"#
        let model = ScriptedModel([ScriptedModel.text(wrong), ScriptedModel.text(right)])
        let result = await Self.orchestrator(memory, FakeCalendar(), model).consolidate(now: F.now, outcomes: [])
        #expect(result.run == MemoryRun(source: .model, proposals: 1, refused: [], repairs: 1))
        #expect(await memory.log == ["apply 2026-11-21 \(try #require(JSONValue.parse(right)).text)"])
        let second = try #require(await model.requests.last?.messages.last?["content"]?.string)
        #expect(second.contains("Proposal 1: 5 in \"Ran 5 times in 28 days.\" is not in the evidence it cites"))

        // Nonsense from the model: the engine's rules are used, and that is counted as a fallback.
        let other = FakeMemory(F.rows)
        let fallback = await Self.orchestrator(other, FakeCalendar(), ScriptedModel([ScriptedModel.text("Sure! Here you go.")])).consolidate(now: F.now, outcomes: [])
        #expect(fallback.run.source == .rules)
        #expect(MemoryRun.strayNumbers(in: try #require(JSONValue.parse(right)), evidence: [["id": "e1", "text": "Ran 4 times in 28 days."]]).isEmpty)
    }

    @Test func theNumberCheckAllowsWhatTheEngineAllows() throws {
        let evidence: [JSONValue] = [["id": "e1", "text": "Sleep 7.25 hours a night over 7 days.", "numbers": ["avg": 7.25, "days": 7, "hour": 18]]]
        func stray(_ statement: String) -> [String] {
            MemoryRun.strayNumbers(in: ["proposals": [["statement": .string(statement), "evidenceIds": ["e1"]]]], evidence: evidence)
        }
        // Rounded to 0, 1 or 2 places; numbers from any field; "6 PM" as hour 18; dates left alone.
        #expect(stray("Sleeps about 7.3 hours a night.").isEmpty && stray("Sleeps about 7 hours a night over 7 days.").isEmpty)
        #expect(stray("Usually trains at 6 PM.").isEmpty && stray("Since 2026-11-01, sleeps 7.25 hours.").isEmpty)
        #expect(stray("Sleeps 8 hours a night.").count == 1 && stray("Usually trains at 7 PM.").count == 1)
        // A malformed answer goes back once before the rules take over.
        #expect(MemoryRun.canon("40.0") == "40" && MemoryRun.canon("7.50") == "7.5")
    }

    @Test func aMalformedMemoryAnswerGetsOneRepairRound() async throws {
        let memory = FakeMemory(F.rows)
        let model = ScriptedModel([ScriptedModel.text("Here you go!"), ScriptedModel.text(#"{"proposals":[]}"#)])
        let result = await Self.orchestrator(memory, FakeCalendar(), model).consolidate(now: F.now, outcomes: [])
        #expect(result.run.source == .model && result.run.repairs == 1)
        #expect(await model.requests.last?.messages.last?["content"]?.string?.contains("That wasn't the JSON asked for") == true)
    }
}
