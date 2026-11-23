import Foundation
import Testing
@testable import Evergreen

/// The hand-offs between agents and the values they pass, against the
/// contract's own fixtures (`contract/fixtures/swift/`): every file decodes,
/// and the four hand-off functions give exactly the results in `handoffs.json`.
struct HandOffTests {
    typealias F = PlanFakes

    static let fixtures = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "contract/fixtures/swift")

    static func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(contentsOf: fixtures.appending(path: "\(name).json")))
    }

    struct Table: Decodable { var ok: Bool; var rows: [MemoryRow] }
    struct Plan: Decodable { var ok: Bool; var sessions: [PlanSession]; var summary: String }
    struct Check: Decodable { var ok: Bool; var pass: Bool; var violations: [PlanViolation] }
    struct Failure: Decodable { struct Detail: Decodable { var code: String; var text: String }; var ok: Bool; var error: Detail }
    struct HandOffs: Decodable {
        struct ToIntent: Decodable { var session: PlanSession; var intent: CalendarIntent }
        struct ToMemory: Decodable { var rows: [MemoryRow]; var memory: CalendarMemory }
        struct ToKeys: Decodable { var session: PlanSession; var rows: [MemoryRow]; var keys: [String] }
        struct ToOutcomes: Decodable { var planRecords: [PlanRecord]; var healthWorkouts: [HealthWorkout]; var days: [String]; var outcomes: [Outcome] }
        var sessionToIntent: ToIntent
        var rowsToCalendarMemory: ToMemory
        var keysToReject: ToKeys
        struct ToStopped: Decodable { var rows: [MemoryRow]; var stopped: [JSONValue] }
        var rowsToStopped: ToStopped
        var outcomesFor: ToOutcomes
    }

    @Test func everyFixtureFileDecodes() throws {
        let files = try FileManager.default.contentsOfDirectory(atPath: Self.fixtures.path).filter { $0.hasSuffix(".json") }.sorted()
        // A new fixture file must get a line below.
        #expect(files == ["activity.json", "calendar-intent.json", "calendar-result.json", "error.json", "handoffs.json", "memory-row.json",
                          "memory-table.json", "outcome.json", "plan-check.json", "plan.json", "preview-block.json", "session.json", "stopped-slot.json"])
        #expect(try Self.load("stopped-slot", as: [JSONValue].self).allSatisfy { $0["activity"]?.string != nil && $0["weekday"]?.number != nil && $0["hour"]?.number != nil })
        #expect(try !Self.load("activity", as: [ActivityKind].self).isEmpty)
        #expect(try !Self.load("calendar-intent", as: [CalendarIntent].self).isEmpty)
        #expect(try !Self.load("calendar-result", as: [CalendarResult].self).isEmpty)
        #expect(try Self.load("error", as: [Failure].self).allSatisfy { !$0.ok && !$0.error.text.isEmpty })
        #expect(try !Self.load("memory-row", as: [MemoryRow].self).isEmpty)
        #expect(try Self.load("memory-table", as: [Table].self).allSatisfy(\.ok))
        #expect(try !Self.load("outcome", as: [Outcome].self).isEmpty)
        #expect(try Self.load("plan-check", as: [Check].self).allSatisfy { $0.pass == $0.violations.isEmpty })
        #expect(try Self.load("plan", as: [Plan].self).allSatisfy { !$0.sessions.isEmpty })
        #expect(try !Self.load("preview-block", as: [PreviewBlock].self).isEmpty)
        #expect(try !Self.load("session", as: [PlanSession].self).isEmpty)
        #expect(try !Self.load("handoffs", as: [HandOffs].self).isEmpty)
    }

    @Test func theHandOffsGiveTheContractsResults() throws {
        let cases = try Self.load("handoffs", as: [HandOffs].self)
        #expect(cases.count >= 3)
        for one in cases {
            #expect(HandOff.sessionToIntent(one.sessionToIntent.session, rows: one.rowsToCalendarMemory.rows) == one.sessionToIntent.intent)
            #expect(HandOff.rowsToCalendarMemory(one.rowsToCalendarMemory.rows) == one.rowsToCalendarMemory.memory)
            #expect(HandOff.keysToReject(one.keysToReject.session, rows: one.keysToReject.rows) == one.keysToReject.keys)
            #expect(HandOff.rowsToStopped(one.rowsToStopped.rows) == one.rowsToStopped.stopped)
            let outcomes = one.outcomesFor.days.flatMap { HandOff.outcomesFor(one.outcomesFor.planRecords, workouts: one.outcomesFor.healthWorkouts, day: $0) }
            #expect(outcomes == one.outcomesFor.outcomes)
        }
    }

    @Test func valuesEncodeBackToWhatTheyWere() throws {
        // What the app hands an engine must be what the contract wrote, field for field.
        for name in ["session", "memory-row", "outcome", "preview-block", "calendar-intent"] {
            let original = try #require(JSONValue.parse(String(contentsOf: Self.fixtures.appending(path: "\(name).json"), encoding: .utf8))?.array)
            let again: [JSONValue] = switch name {
            case "session": try Self.load(name, as: [PlanSession].self).map(JSONValue.from)
            case "memory-row": try Self.load(name, as: [MemoryRow].self).map(JSONValue.from)
            case "outcome": try Self.load(name, as: [Outcome].self).map(JSONValue.from)
            case "preview-block": try Self.load(name, as: [PreviewBlock].self).map(JSONValue.from)
            default: try Self.load(name, as: [CalendarIntent].self).map(JSONValue.from)
            }
            #expect(again == original, "\(name) changed on the way through")
        }
    }

    @Test func aRestSessionAndRepeatedKeysAreHandled() {
        let rest = F.session("2026-11-30", "00:00", .rest, 0)
        #expect(rest.id == "s-2026-11-30-rest")
        #expect(HandOff.sessionToIntent(rest) == CalendarIntent(kind: "add", activity: .rest, sessionId: rest.id, day: "2026-11-30"))
        // An accepted session is placed at exactly its time.
        #expect(HandOff.sessionToIntent(F.session("2026-11-29", "07:00", .run, 40)) == CalendarIntent(kind: "add", activity: .run, minutes: 40, sessionId: "s-2026-11-29-run-0700", day: "2026-11-29", after: "07:00", exact: true))
        // "Not now" rejects only the usual time the session is: not the load it cites, not another day's slot, not a key it merely names.
        let sunday = F.session("2026-11-29", "08:20", .longRun, 60, basedOn: ["k3", "k2", "made-up"])
        #expect(HandOff.keysToReject(sunday, rows: F.rows) == ["k1"])
        #expect(HandOff.keysToReject(F.session("2026-11-29", "10:00", .longRun, 60, basedOn: ["k1"]), rows: F.rows).isEmpty)
        #expect(HandOff.keysToReject(F.session("2026-11-25", "18:00", .run, 40, basedOn: ["k2"]), rows: F.rows).isEmpty)
        #expect(HandOff.citedKeys(F.session("2026-11-29", "08:00", .run, 30, basedOn: ["k1", "k3", "k1"])) == ["k1", "k3"])
        // A long run is done by a Health run; a workout of another kind doesn't count.
        let record = PlanRecord(sessionId: "a", day: "2026-11-21", activity: .longRun, plannedStart: F.time("2026-11-21", "08:00"))
        let run = HealthWorkout(activityType: "Running", start: "2026-11-21T08:10:00.123456-08:00", durationMin: 61.5)
        let yoga = HealthWorkout(activityType: "Yoga", start: "2026-11-21T08:00:00-08:00", durationMin: 30)
        #expect(HandOff.outcomesFor([record], workouts: [yoga], day: "2026-11-21").map(\.done) == [false])
        let done = HandOff.outcomesFor([record], workouts: [yoga, run], day: "2026-11-21")
        #expect(done.first?.actualStart?.text == "2026-11-21T08:10:00.123-08:00" && done.first?.actualMinutes == 62)
    }

    @Test func timesKeepTheirLocalDayAndRefuseZ() throws {
        let time = try #require(LocalTime("2026-11-29T23:30:00.250-08:00"))
        #expect(time.day == "2026-11-29" && time.clock == "23:30")
        #expect(time.date == ISO8601DateFormatter().date(from: "2026-11-30T07:30:00Z")?.addingTimeInterval(0.25))
        #expect(LocalTime("2026-11-29T23:30:00Z") == nil && LocalTime("2026-11-29 23:30") == nil)
        #expect(LocalTime(day: "2026-11-29", time: "06:05", offsetMinutes: 330)?.text == "2026-11-29T06:05:00+05:30")
        #expect(LocalTime(Date(timeIntervalSince1970: 0), in: TimeZone(identifier: "UTC")!).text == "1970-01-01T00:00:00+00:00")
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalTime.self, from: Data(#""2026-11-29T23:30:00Z""#.utf8)) }
    }

    @Test func everyActivityHasANameAndAHealthType() {
        #expect(ActivityKind.allCases.allSatisfy { !$0.displayName.isEmpty && !$0.displayName.contains("_") })
        for (type, activity) in [("Running", ActivityKind.run), ("Hiking", .walk), ("FunctionalStrengthTraining", .strength), ("Pilates", .yoga),
                                 ("Cycling", .ride), ("Swimming", .swim), ("Elliptical", .elliptical), ("Cooldown", .stretch)] {
            #expect(ActivityKind(healthType: type) == activity)
        }
        #expect(ActivityKind(healthType: "Bowling") == .other)
        #expect(ActivityKind.allCases.filter { $0 != .rest && $0 != .longRun && $0 != .other }.allSatisfy { ActivityKind(healthType: $0.healthType) == $0 })
    }
}
