import Foundation
import SwiftData
import Testing
@testable import Evergreen

/// The three real engine bundles behind the loop, on a person's history:
/// the memory table, a week from the rules that passes its own check, a
/// plan that the check refuses, and a session placed on the calendar.
/// No network: the model is a script, or the bundles' own rules.
@MainActor
struct EngineTests {
    /// The model with the clock stopped at `now` (see `SuggestionTests.model`).
    static func model(now: Date = Clocks.morning) async throws -> AppModel {
        let model = SuggestionTests.model(try SuggestionTests.container(now: now), now: now)
        model.memoryWithoutModel = true
        // The model can't be reached, so the week comes from the rules.
        model.scriptedModel = ScriptedModel([])
        model.aiKeyTail = "test"
        await model.syncMemory()
        return model
    }

    @Test func theBundlesLoadWithEveryFunctionTheAppCalls() async {
        #expect(await AppModel.planBundle.has(BundlePlanRules.globals))
        #expect(await AppModel.calendarBundle.has(BundleCalendar.globals))
        #expect(await !JSBundle(resource: "not-there").has([]))
        #expect(await JSBundle(resource: "not-there").call("planContext")["ok"] == .bool(false))
    }

    @Test(arguments: Clocks.all) func theDayIsConsolidatedOnceAndTheTableHasRowsWithData(now: Date) async throws {
        let model = try await Self.model(now: now)
        let loop = try #require(model.orchestrator())
        let rows = await loop.consolidate(now: model.now, outcomes: model.yesterdayOutcomes).rows
        #expect(!rows.isEmpty && rows.allSatisfy { !$0.key.isEmpty && !$0.statement.isEmpty })
        let slots = HandOff.rowsToCalendarMemory(rows).slots
        #expect(!slots.isEmpty && slots.allSatisfy { (0...6).contains($0.weekday) && (0...23).contains($0.hour) && $0.minutes >= 5 })
        // The same day again asks no model and changes nothing.
        #expect(await loop.memory.dailyRequest(now: model.now, outcomes: []) == nil)
        #expect(await loop.consolidate(now: model.now, outcomes: []).rows == rows)
    }

    @Test(arguments: Clocks.all) func theWeekFromTheRulesPassesTheCheckAndRestsOnlyOnTableKeys(now: Date) async throws {
        let model = try await Self.model(now: now)
        let plan = try await model.loadWeekPlan()
        #expect(plan.fromRules && !plan.sessions.isEmpty)
        let keys = Set(model.memoryRows.filter(\.isUsable).map(\.key))
        #expect(!keys.isEmpty && model.plannedSessions.allSatisfy { Set($0.basedOn).isSubset(of: keys) })
        #expect(model.plannedSessions.contains { !$0.basedOn.isEmpty })

        let rules = try #require(model.planRules)
        #expect(await rules.checkPlan(model.plannedSessions, summary: "", rows: model.memoryRows, now: model.now).isEmpty)
        // A made-up key and a week far over the load are refused, each with how to fix it.
        var bad = model.plannedSessions
        bad[0].basedOn = ["mem:made-up"]
        bad[0].minutes = 240
        let problems = await rules.checkPlan(bad + bad.map { var s = $0; s.id += "-b"; s.minutes = 240; return s }, summary: "", rows: model.memoryRows, now: model.now)
        #expect(problems.contains { $0.code == "unknown_memory_key" })
        #expect(problems.allSatisfy { !$0.text.isEmpty })
        let context = await rules.planContext(rows: model.memoryRows, now: model.now)
        #expect(context.isOK && context["loadCap"] != nil && context["memoryKeys"]?.array?.isEmpty == false)
    }

    @Test(arguments: Clocks.all) func rejectingARowTakesItOutOfTheNextWeek(now: Date) async throws {
        let model = try await Self.model(now: now)
        try await model.loadWeekPlan()
        let session = try #require(model.plannedSessions.first { !$0.basedOn.isEmpty })
        let loop = try #require(model.orchestrator())
        for key in HandOff.keysToReject(session, rows: model.memoryRows) { await loop.memory.reject(key: key, now: model.now) }
        try await model.loadWeekPlan()
        let rejected = Set(session.basedOn)
        #expect(model.memoryRows.filter { rejected.contains($0.key) }.allSatisfy { !$0.isUsable })
        #expect(model.plannedSessions.allSatisfy { rejected.isDisjoint(with: $0.basedOn) })
    }

    @Test(arguments: Clocks.all) func anAcceptedSessionIsPlacedAroundWhatIsOnTheCalendar(now: Date) async throws {
        let model = try await Self.model(now: now)
        try await model.loadWeekPlan()
        let session = try #require(model.plannedSessions.first { $0.activity != .rest })
        let loop = try #require(model.orchestrator())
        let result = try #require(await loop.place(session, rows: model.memoryRows, now: model.now))
        let block = try #require(result.proposed.first)
        #expect(result.kind == "add" && block.sessionId == session.id && block.start.day == session.day)
        #expect(block.activity == session.activity && block.minutes == session.minutes)
        #expect(result.raw != nil)

        #expect(await model.calendarEngine?.intentSchema()["properties"]?["kind"] != nil)
    }

    /// Dragging a previewed session, with a calendar that is known: tomorrow is free except a meeting from 10:00 to 11:00.
    @Test(arguments: Clocks.all) func draggingAPreviewIntoFreeTimeMovesItThereAndOntoAMeetingPutsItRightAfter(now: Date) async throws {
        let rig = try AppRig(now: now)
        let model = rig.model
        let tomorrow = Fixture.calendar.date(byAdding: .day, value: 1, to: Fixture.calendar.startOfDay(for: now))!
        func at(_ hour: Int, _ minute: Int = 0) -> Date { Fixture.calendar.date(bySettingHour: hour, minute: minute, second: 0, of: tomorrow)! }
        rig.calendar.meetings = [Busy(start: at(10), end: at(11))]
        try await model.loadWeekPlan()
        // The day's memory update runs behind the first week and may plan it again: wait for the week to settle.
        await model.memoryTask?.value
        // Tomorrow's usual 6 AM run, previewed where it was suggested.
        let session = try #require(model.plannedSessions.first { $0.start.date == at(6) })
        let loop = try #require(model.orchestrator())
        let placed = try #require(await loop.place(session, rows: model.memoryRows, now: model.now))
        let block = try #require(placed.proposed.first)
        #expect(placed.proposed.count == 1 && block.start.date == at(6) && placed.question == nil)
        model.placement = Placement(sessionKey: nil, result: placed)

        // Into free time: it is proposed exactly there, the same length, with nothing to ask.
        await model.dragPlacement(block.id, to: at(8))
        let free = try #require(model.placement?.result)
        #expect(free.question == nil && free.proposed.count == 1)
        #expect(free.proposed.first?.start.date == at(8) && free.proposed.first?.end.date == at(8, session.minutes) && free.proposed.first?.sessionId == session.id)

        // Onto the meeting: it goes to right after the meeting instead, again with nothing to ask.
        await model.dragPlacement(block.id, to: at(10, 15))
        let busy = try #require(model.placement?.result)
        #expect(busy.question == nil && busy.proposed.count == 1)
        #expect(busy.proposed.first?.start.date == at(11) && busy.proposed.first?.end.date == at(11, session.minutes) && busy.proposed.first?.sessionId == session.id)
        // Nothing is on the plan or the calendar through any of this.
        #expect(model.plan.isEmpty && rig.calendar.events.isEmpty)
    }
}

/// The week is planned once for a day, a memory table and a calendar, and
/// the load isn't compared with a baseline that isn't there yet.
@MainActor
struct WeekCacheTests {
    @Test func theSameDayMemoryAndCalendarDoNotAskTheAIAgain() async throws {
        let model = try await EngineTests.model()
        // The AI answers with a week of its own (an empty one passes every check), so it is kept.
        model.scriptedModel = ScriptedModel { _ in try! ScriptedModel.text(#"{"sessions":[],"summary":"A quiet week."}"#).get() }
        let first = try await model.loadWeekPlan()
        #expect(model.weeksPlanned == 1 && !first.fromRules)
        // Opening Today again, or another screen reloading, costs nothing.
        #expect(try await model.loadWeekPlan() == first)
        #expect(try await model.loadWeekPlan() == first)
        #expect(model.weeksPlanned == 1)

        // A stopped row is another table: the week is planned again, once.
        let key = try #require(model.memoryRows.first { $0.isUsable }?.key)
        await model.rejectBasis(key)
        #expect(model.weeksPlanned == 2)
        try await model.loadWeekPlan()
        #expect(model.weeksPlanned == 2)

        // Asking for it plans again.
        try await model.loadWeekPlan(fresh: true)
        #expect(model.weeksPlanned == 3)
    }

    @Test func aWeekFromTheRulesIsNotKeptAndARefusedKeyIsSaid() async throws {
        let model = try await EngineTests.model()
        model.scriptedModel = ScriptedModel { _ in ModelReply(stopReason: "refusal", content: []) }
        try await model.loadWeekPlan()
        try await model.loadWeekPlan()
        // Each time the AI is asked again: a rules week is a stand-in, not the plan to keep.
        #expect(model.weeksPlanned == 2 && model.weekPlan?.fromRules == true && model.weekCache == nil)
        #expect(model.fallbacks["plan"] == 2 && model.planProblem == nil)

        // A refused key is told to the person, and the week still comes from the rules.
        model.scriptedModel = ScriptedModel([.failure(.keyRefused)])
        try await model.loadWeekPlan()
        #expect(model.planProblem == "Your AI key was refused. Check it in Settings." && model.weekPlan?.fromRules == true)
    }

    @Test func twoCallersShareOnePlanning() async throws {
        let model = try await EngineTests.model()
        model.scriptedModel = ScriptedModel { _ in try! ScriptedModel.text(#"{"sessions":[],"summary":"A quiet week."}"#).get() }
        async let one = model.loadWeekPlan()
        async let two = model.loadWeekPlan()
        let both = try await (one, two)
        #expect(both.0 == both.1 && model.weeksPlanned == 1 && !model.planning)
    }

    @Test func theKeyChangesWithTheDayTheRowsAndTheCalendar() {
        let rows = PlanFakes.rows
        let busy = [Busy(start: Date(timeIntervalSince1970: 1000), end: Date(timeIntervalSince1970: 2000))]
        let key = WeekCache.key(day: "2026-11-22", rows: rows, busy: busy)
        #expect(key == WeekCache.key(day: "2026-11-22", rows: rows.reversed(), busy: busy))
        #expect(key != WeekCache.key(day: "2026-11-23", rows: rows, busy: busy))
        #expect(key != WeekCache.key(day: "2026-11-22", rows: rows, busy: []))
        var stopped = rows
        stopped[0].state = "rejected"
        #expect(key != WeekCache.key(day: "2026-11-22", rows: stopped, busy: busy))
    }

    @Test func withUnderTwoWeeksOfWorkoutsNoLoadIsComparedWithTheUsual() throws {
        let thin = try #require(UITestSeed.launch(arguments: ["Evergreen", "-uiTest", "thin"]))
        SuggestionTests.containers.append(thin.container)
        #expect(thin.model.historyDepth.isThin)
        #expect(thin.model.shown(PlanFakes.rows).map(\.key) == ["k1", "k2"])
        let full = try #require(UITestSeed.launch(arguments: ["Evergreen", "-uiTest", "runner"]))
        SuggestionTests.containers.append(full.container)
        #expect(!full.model.historyDepth.isThin && full.model.shown(PlanFakes.rows).count == 3)
    }
}
