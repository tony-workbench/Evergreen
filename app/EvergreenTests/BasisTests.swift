import Foundation
import SwiftData
import Testing
@testable import Evergreen

/// The chips under a suggestion come only from its memory keys and the
/// calendar, and "Not true for me" stops the key behind one.
@MainActor
struct BasisTests {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return calendar
    }

    static func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    static let rows = [
        PlanFakes.sundayRun, PlanFakes.load,
        { var row = PlanFakes.wednesdayYoga; row.state = "rejected"; return row }(),
    ]

    static func session(basedOn: [String], reason: String = "Your usual Sunday run.") -> WeekPlan.Session {
        WeekPlan.Session(id: "wk-sun", kind: "addWorkout", title: "Run", after: Slot(start: at(29, 8, 30), end: at(29, 9, 30), activityType: "Running"),
                         reason: reason, basedOn: basedOn)
    }

    @Test func chipsAreTheSessionsMemoryRowsInTheAppsWordsThenTheCalendar() {
        let busy = [Busy(start: Self.at(29, 7), end: Self.at(29, 8)), Busy(start: Self.at(29, 11), end: Self.at(29, 12)), Busy(start: Self.at(28, 8), end: Self.at(28, 9))]
        let bases = Basis.list(for: Self.session(basedOn: ["k1", "k3", "k1", "mem:made-up", "k2"]), rows: Self.rows, busy: busy, calendar: Self.calendar)
        // One chip per usable row the session names: no chip for a made-up key or a stopped row.
        #expect(bases.map(\.source) == [Basis.Source.health, .health, .calendar])
        #expect(bases.map(\.key) == ["k1", "k3", nil])
        // The words are built from the rows' data, not from the session's text or the row's statement.
        #expect(bases[0].text == "You usually run Sunday around 8 AM.")
        #expect(bases[1].text == "This week’s training is 14% above your usual.")
        #expect(bases[0].detail == "Seen in 5 of the last 6 weeks. From your workouts and sleep in Apple Health.")
        #expect(bases[2].text == "Between your 7 AM and 11 AM meetings")
        #expect(bases[2].detail.contains("Before it, you’re busy until") && bases[2].detail.contains("After it, you’re busy from"))
    }

    @Test func aGeneralSessionOrAnOpenDayHasNoChips() {
        let general = Self.session(basedOn: [], reason: "A rest day after two hard days.")
        #expect(Basis.list(for: general, rows: Self.rows, busy: nil, calendar: Self.calendar).isEmpty)
        // An open day says nothing, and neither does a free stretch of four hours or more.
        #expect(Basis.list(for: general, rows: Self.rows, busy: [], calendar: Self.calendar).isEmpty)
        let slot = Slot(start: Self.at(29, 8, 30), end: Self.at(29, 9, 30), activityType: "Running")
        #expect(Basis.freeTime(around: slot, busy: [Busy(start: Self.at(29, 13), end: Self.at(29, 14))], calendar: Self.calendar) == nil)
        // A narrow free stretch before the day's first meeting is worth a chip.
        #expect(Basis.freeTime(around: slot, busy: [Busy(start: Self.at(29, 9, 30), end: Self.at(29, 10))], calendar: Self.calendar)?.text == "Free 6–9:30 AM Sunday")
        // None for a slot that overlaps something or sits outside the day.
        #expect(Basis.freeTime(around: slot, busy: [Busy(start: Self.at(29, 9), end: Self.at(29, 10))], calendar: Self.calendar) == nil)
        #expect(Basis.freeTime(around: Slot(start: Self.at(29, 5), end: Self.at(29, 6), activityType: "Running"), busy: [], calendar: Self.calendar) == nil)
    }

    @Test func thePersonalSuggestionIsOnTopThenTheSoonestAndAnAnsweredOneLeaves() throws {
        let model = SuggestionTests.model(try SuggestionTests.container(), memory: nil)
        let sessions = [SuggestionTests.session("Yoga", days: 3, id: "wk-yoga"), SuggestionTests.session("Swimming", days: 1, id: "wk-run"),
                        SuggestionTests.session("Cycling", days: 5, id: "wk-walk")]
        model.weekPlan = WeekPlan(actions: sessions)
        #expect(model.topSuggestion?.id == "wk-run")
        // A session that rests on what is remembered goes above sooner general ones.
        model.memoryRows = Self.rows
        model.weekPlan?.actions[2].basedOn = ["k1", "k3"]
        model.weekPlan?.actions[0].basedOn = ["k1", "k2"]   // k2 is stopped, so it counts once
        #expect(model.topSuggestion?.id == "wk-walk")
        model.addToPlan(sessions[2])
        #expect(model.topSuggestion?.id == "wk-yoga")
    }

    @Test func notTrueForMeRejectsTheRowPlansAgainAndUndoBringsItBack() async throws {
        let model = try await EngineTests.model()
        try await model.loadWeekPlan()
        let planned = try #require(model.plannedSessions.first { !$0.basedOn.isEmpty })
        let key = try #require(planned.basedOn.first)
        let session = try #require(model.weekPlan?.sessions.first { $0.id == planned.id })
        #expect(model.bases(for: session).compactMap(\.key).contains(key))

        await model.rejectBasis(key)
        #expect(model.stoppedKeys.contains(key) && model.rejectedBasis == key)
        // The week was planned again without it: no session rests on the key, and no chip shows it.
        #expect(model.plannedSessions.allSatisfy { !$0.basedOn.contains(key) })
        #expect(model.weekPlan?.sessions.allSatisfy { !model.bases(for: $0).compactMap(\.key).contains(key) } == true)

        await model.undoRejectBasis()
        #expect(!model.stoppedKeys.contains(key) && model.rejectedBasis == nil)
        #expect(model.memoryRows.first { $0.key == key }?.isUsable == true)
    }
}
