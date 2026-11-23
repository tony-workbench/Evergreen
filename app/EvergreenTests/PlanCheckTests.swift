import Foundation
import Testing
@testable import Evergreen

/// `checkPlan` in the bundled plan rules, called from Swift the way the app
/// calls it: a week that passes, then the same week with one thing wrong,
/// and the one code the rules answer with. Nothing here is a stand-in for the rules.
@MainActor
struct PlanCheckTests {
    /// A person's month, their memory table, the rules over both, and the rules' own week (which passes).
    @MainActor
    struct Week {
        let rig: AppRig
        let rules: BundlePlanRules
        let rows: [MemoryRow]
        let sessions: [PlanSession]
        var now: Date { rig.model.now }

        func codes(_ sessions: [PlanSession], rows: [MemoryRow]? = nil) async -> [String] {
            await rules.checkPlan(sessions, summary: "", rows: rows ?? self.rows, now: now).map(\.code)
        }

        /// The session `days` from today.
        func index(day days: Int) throws -> Int {
            let day = LocalTime(Fixture.calendar.date(byAdding: .day, value: days, to: now)!, in: Fixture.timeZone).day
            return try #require(sessions.firstIndex { $0.day == day }, "no session \(days) days from today")
        }
    }

    static func week(history: HealthHistory? = nil) async throws -> Week {
        let rig = try AppRig(now: Clocks.morning, history: history)
        try await rig.model.loadWeekPlan()
        let week = Week(rig: rig, rules: try #require(rig.model.planRules), rows: rig.model.memoryRows, sessions: rig.model.plannedSessions)
        // Where every case starts: a week with a session today and one on each of the next days, and nothing wrong with it.
        #expect(week.sessions.count >= 5)
        #expect(await week.codes(week.sessions) == [])
        return week
    }

    /// A session moved to another start, `minutes` from now or `days` later at the same time of day.
    static func moved(_ session: PlanSession, to start: Date) -> PlanSession {
        var session = session
        session.start = LocalTime(start, in: Fixture.timeZone)
        session.day = session.start.day
        return session
    }

    @Test func aSessionThatRestsOnAStoppedMemoryIsRefused() async throws {
        let week = try await Self.week()
        let cited = try #require(week.sessions.first { !$0.basedOn.isEmpty })
        var rows = week.rows
        let stopped = try #require(rows.firstIndex { $0.key == cited.basedOn[0] })
        rows[stopped].state = "rejected"
        let found = await week.rules.checkPlan(week.sessions, summary: "", rows: rows, now: week.now)
        // The stopped row is a usual time, so both the time and the key are refused.
        #expect(found.map(\.code) == ["stopped_slot", "stopped_memory_key"])
        #expect(found.first?.sessionId == cited.id)
    }

    @Test func aWeekWithFarMoreMinutesThanUsualIsRefused() async throws {
        let week = try await Self.week()
        let long = week.sessions.map { session in var session = session; session.minutes = 170; return session }
        #expect(await week.codes(long) == ["load_over_cap", "too_many_minutes"])
    }

    @Test func aWeekWithMoreSessionsThanFitThePersonIsRefused() async throws {
        let week = try await Self.week()
        let most = try #require(await week.rules.planContext(rows: week.rows, now: week.now)["maxSessions"]?.number.map(Int.init))
        // Short easy extras in the evenings, until there is one more than the most allowed: the load stays under its cap.
        var sessions = week.sessions
        var day = 1
        while sessions.count <= most {
            let start = Fixture.calendar.date(bySettingHour: 20, minute: 0, second: 0, of: Fixture.calendar.date(byAdding: .day, value: day, to: week.now)!)!
            let time = LocalTime(start, in: Fixture.timeZone)
            sessions.append(PlanSession(id: "extra-\(day)", day: time.day, start: time, minutes: 20, activity: .stretch, intensity: "easy", reason: "", basedOn: []))
            day += 1
        }
        #expect(sessions.count == most + 1)
        // The extras take the week over its minutes too.
        #expect(await week.codes(sessions) == ["too_many_sessions", "too_many_minutes"])
        // One fewer is the most allowed, and passes.
        #expect(await week.codes(Array(sessions.dropLast())) == [])
    }

    @Test func aHardSessionTheDayAfterPoorSleepIsRefused() async throws {
        // The same month, with the last week's nights two and a half hours shorter than the three weeks before.
        var history = AppRig.month(endingBefore: Clocks.morning)
        let weekAgo = Fixture.calendar.date(byAdding: .day, value: -7, to: Fixture.storyDay)!
        history.days = history.days.map { day in
            var day = day
            day.sleepMin = day.date >= weekAgo ? 330 : 480
            return day
        }
        let week = try await Self.week(history: history)
        var sessions = week.sessions
        let tomorrow = try week.index(day: 1)
        // The rules' own week eases off; a hard one tomorrow is what is refused.
        #expect(sessions[tomorrow].intensity != "hard")
        sessions[tomorrow].intensity = "hard"
        let found = await week.rules.checkPlan(sessions, summary: "", rows: week.rows, now: week.now)
        #expect(found.map(\.code) == ["hard_when_tired"])
        #expect(found.first?.sessionId == sessions[tomorrow].id)

        // With normal sleep the same hard session is fine.
        let rested = try await Self.week()
        var same = rested.sessions
        same[try rested.index(day: 1)].intensity = "hard"
        #expect(await !rested.codes(same).contains("hard_when_tired"))
    }

    @Test func aSessionOnTheEighthDayIsRefused() async throws {
        let week = try await Self.week()
        var sessions = week.sessions
        let last = try week.index(day: 6)
        // The seventh day is the last one of the window.
        #expect(await week.codes(sessions) == [])
        sessions[last] = Self.moved(sessions[last], to: try #require(sessions[last].start.date).addingTimeInterval(86_400))
        let found = await week.rules.checkPlan(sessions, summary: "", rows: week.rows, now: week.now)
        #expect(found.map(\.code) == ["outside_window"])
        #expect(found.first?.sessionId == sessions[last].id)
    }

    @Test func aSessionStartingUnderAnHourFromNowIsRefused() async throws {
        let week = try await Self.week()
        var sessions = week.sessions
        let today = try week.index(day: 0)
        sessions[today] = Self.moved(sessions[today], to: week.now.addingTimeInterval(59 * 60))
        let found = await week.rules.checkPlan(sessions, summary: "", rows: week.rows, now: week.now)
        #expect(found.map(\.code) == ["outside_window"])
        #expect(found.first?.sessionId == sessions[today].id)
        // An hour from now is soon enough.
        sessions[today] = Self.moved(sessions[today], to: week.now.addingTimeInterval(60 * 60))
        #expect(await week.codes(sessions) == [])
    }
}

/// Under two weeks of history: a short week, within what the rules allow, with no load compared to a usual that isn't known yet.
@MainActor
struct ThinHistoryTests {
    /// The last `days` days of the made-up month, with its sleep and resting heart rate: enough for memory to work out a load.
    static func lastDays(_ days: Int) -> HealthHistory {
        var history = AppRig.month(endingBefore: Clocks.morning)
        let from = Fixture.calendar.date(byAdding: .day, value: -days, to: Fixture.storyDay)!
        history.workouts.removeAll { $0.start < from }
        return history
    }

    @Test(arguments: [1, 9, 12]) func aThinHistoryGetsAShortWeekThatPassesAndShowsNoLoad(days: Int) async throws {
        let rig = try AppRig(now: Clocks.morning, history: days == 12 ? Self.lastDays(12) : AppRig.runs(days: days, before: Clocks.morning))
        let model = rig.model
        #expect(model.historyDepth.isThin)
        try await model.loadWeekPlan()

        let rules = try #require(model.planRules)
        let allowed = try #require(await rules.planContext(rows: model.memoryRows, now: model.now)["maxSessions"]?.number.map(Int.init))
        let training = model.plannedSessions.filter { $0.activity != .rest }
        #expect(allowed <= 3 && !training.isEmpty && training.count <= allowed)
        let found = await rules.checkPlan(model.plannedSessions, summary: "", rows: model.memoryRows, now: model.now)
        // With a single workout behind them the rules plan nothing and the app offers starter walks: only as many, and as long, as pass the check.
        #expect(found == [], "\(model.plannedSessions.map { "\($0.start.text) \($0.activity.rawValue) \($0.minutes) \($0.intensity)" })")
        #expect(model.openSuggestions.count == training.count)

        // Nothing the person can read compares their load with a usual: not what is remembered, not a suggestion's reasons, not the week's one line.
        func saysLoad(_ text: String) -> Bool { text.lowercased().contains("load") || text.contains("%") || text.lowercased().contains("times the") }
        let remembered = model.remembered.map(\.text) + model.memoryBrief.lines.map(\.sentence)
        #expect(!remembered.isEmpty && !remembered.contains(where: saysLoad), "\(remembered)")
        #expect(!model.memoryRows.contains { $0.kind == "load" })
        let shown = model.openSuggestions.flatMap { session in
            [PlainWords.reason(session.reason)] + model.bases(for: session).flatMap { [$0.text, $0.detail] }
        } + [model.weekPlan?.summary ?? ""]
        #expect(!shown.contains(where: saysLoad), "\(shown)")
    }
}
