import Foundation
@testable import Evergreen

/// Rules for tests: a weekly cap in minutes, and a fixed week of their own.
struct CapRules: PlanRules {
    var capMinutes = 240
    var fallback: [PlanSession] = [PlanFakes.session("2026-11-23", "07:00", .walk, 30, reason: "An easy walk to start the week.")]

    func planContext(rows: [MemoryRow], now: Date) async -> JSONValue {
        ["ok": true, "capMinutes": .number(Double(capMinutes)), "usableKeys": .array(rows.filter(\.isUsable).map { .string($0.key) })]
    }

    func planBrief(rows: [MemoryRow], now: Date) async -> [String] {
        ["At most \(capMinutes) minutes this week.", "Usual: " + rows.filter(\.isUsable).map(\.key).joined(separator: " ")]
    }

    func checkPlan(_ sessions: [PlanSession], summary: String, rows: [MemoryRow], now: Date) async -> [PlanViolation] {
        let total = sessions.reduce(0) { $0 + $1.minutes }
        return total > capMinutes ? [PlanViolation(code: "load_cap", text: "The week is \(total) minutes; the cap is \(capMinutes).")] : []
    }

    func recommendWeek(rows: [MemoryRow], now: Date) async -> [PlanSession] { fallback }
}

enum PlanFakes {
    static let now = ISO8601DateFormatter().date(from: "2026-11-22T09:00:00-08:00")!
    static let offset = -480

    static func time(_ day: String, _ clock: String) -> LocalTime { LocalTime(day: day, time: clock, offsetMinutes: offset)! }

    static func session(_ day: String, _ clock: String, _ activity: ActivityKind, _ minutes: Int, reason: String = "", basedOn: [String] = []) -> PlanSession {
        let start = time(day, clock)
        return PlanSession(id: PlanSession.id(day: day, activity: activity, start: start), day: day, start: start, minutes: minutes,
                           activity: activity, intensity: "easy", reason: reason, basedOn: basedOn)
    }

    static func row(_ key: String, kind: String = "usual_slot", statement: String, data: JSONValue = [:], state: String = "saved") -> MemoryRow {
        // The group the memory engine gives each kind (contract/schemas/memory-row.schema.json).
        let group = ["usual_slot": "routine", "weekly_volume": "routine", "mix": "routine", "sleep": "body", "resting_hr": "body"][kind] ?? kind
        return MemoryRow(memoryId: "m-\(key)", key: key, slot: "s-\(key)", group: group, kind: kind,
                  statement: statement, data: data, state: state, confidence: 0.8, since: "2026-10-01", updated: "2026-11-22")
    }

    /// Keys are opaque on purpose: nothing may read the slot out of them.
    static let sundayRun = row("k1", statement: "You usually run on Sunday mornings.", data: ["activity": "long_run", "weekday": 6, "hour": 8, "minutes": 60, "weeksSeen": 5, "weeksTotal": 6])
    static let wednesdayYoga = row("k2", statement: "You usually do yoga on Wednesday evenings.", data: ["activity": "yoga", "weekday": 2, "hour": 18, "minutes": 40, "weeksSeen": 4, "weeksTotal": 6])
    static let load = row("k3", kind: "load", statement: "Training is 14% above your usual.", data: ["minutes7d": 260, "ratioToUsual": 1.14])
    static let rows = [sundayRun, wednesdayYoga, load]

    /// The model's answer for a week, in the shape the planning agent asks for.
    static func answer(_ sessions: [(day: String, start: String, activity: String, minutes: Int, basedOn: [String])], summary: String = "A normal week.") -> Result<ModelReply, ModelFailure> {
        let items = sessions.map { s -> JSONValue in
            ["day": .string(s.day), "start": .string(s.start), "activity": .string(s.activity), "minutes": .number(Double(s.minutes)),
             "intensity": "easy", "reason": "Your usual time.", "basedOn": .array(s.basedOn.map { .string($0) })]
        }
        return ScriptedModel.text((["sessions": .array(items), "summary": .string(summary)] as JSONValue).text)
    }

    static func agent(_ model: ScriptedModel, rules: CapRules = CapRules(), rows: [MemoryRow] = rows) -> PlanAgent {
        PlanAgent(model: model, modelId: AIModels.standard, rules: rules, rows: rows, now: now, offsetMinutes: offset)
    }
}
