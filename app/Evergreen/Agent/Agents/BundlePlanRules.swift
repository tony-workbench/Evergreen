import Foundation

/// The plan rules from the recommend-agent bundle (`planContext`,
/// `checkPlan`, `recommendWeek`). What the rules read stays on the phone:
/// the Health history, the busy times on the calendar and the memory rows.
struct BundlePlanRules: PlanRules {
    static let resource = "recommend-phone"
    static let globals = ["planContext", "planBrief", "checkPlan", "recommendWeek"]

    let bundle: JSBundle
    /// Workouts, and sleep and resting heart rate by day.
    var history: HistoryPayload
    /// Busy times on the person's calendars: start and end only.
    var busy: [Busy]
    var timeZone: TimeZone
    /// The person's own rules; nil (or not turned on) keeps the usual week.
    var rules: UserRules? = nil
    /// Each day's kind from the phone ("home" or "out"); rest weekdays come from the rules.
    var dayKinds: [String: DayKind] = [:]
    /// What each session missed since the last plan worked ("lower", "upper", "full"…), so the week picks it up again.
    var carry: [String] = []
    /// What each day at home left this week was last planned to work, by day, so the split stays as planned.
    var queue: [String: String] = [:]
    /// Today's home session is already done, so the engine keeps today's focus to today and passes nothing of it on.
    var doneToday = false

    /// What every call is given: `planContext`'s input, which `checkPlan` takes as its `context`.
    func input(rows: [MemoryRow], now: Date) -> JSONValue {
        var fields: [String: JSONValue] = [
            "now": .string(LocalTime(now, in: timeZone).text),
            "memory": ["rows": .from(rows)],
            // The usual times the person stopped: the bundle's `stopped_slot` rule keeps sessions off them.
            "stopped": .array(HandOff.rowsToStopped(rows.filter(\.isRejected))),
            "history": .from(history),
            "calendar": .array(busy.map { ["start": .string(LocalTime($0.start, in: timeZone).text), "end": .string(LocalTime($0.end, in: timeZone).text)] }),
        ]
        // A race the person has coming, from the goal they are remembered to have: the rules' own week tapers for it too.
        if let race = Self.nextRace(in: rows, from: LocalTime(now, in: timeZone).day) { fields["raceDate"] = .string(race) }
        if let rules, rules.isOn { fields.merge(rulesFields(rules, now: now)) { _, new in new } }
        return .object(fields)
    }

    /// The date of the nearest race from `today` on, from the goals remembered and still usable.
    private static func nextRace(in rows: [MemoryRow], from today: String) -> String? {
        rows.filter { $0.kind == "goal" && $0.isUsable }.compactMap { $0.data["date"]?.string }.filter { $0 >= today }.min()
    }

    /// What the rules' own week needs besides the shared input: the rules, each day's kind and offset, and what carries over.
    private func rulesFields(_ rules: UserRules, now: Date) -> [String: JSONValue] {
        var fields: [String: JSONValue] = [
            "rules": rules.engineValue,
            "dayKinds": DayKinds.engineValue(dayKinds),
            "dayOffsets": Self.dayOffsets(from: now, timeZone: timeZone),
        ]
        if !carry.isEmpty { fields["carry"] = .array(carry.map { .string($0) }) }
        if !queue.isEmpty { fields["queue"] = .object(queue.mapValues { .string($0) }) }
        if doneToday { fields["doneToday"] = .bool(true) }
        return fields
    }

    /// Each day's UTC offset at noon, from today through the week the engine plans, so a session after a clock change keeps
    /// its own day's offset.
    /// Each day's offset is read at noon, clear of a change to or from summer time in the night.
    private static let noonHour = 12

    static func dayOffsets(from now: Date, timeZone: TimeZone) -> JSONValue {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = calendar.startOfDay(for: now)
        var out: [String: JSONValue] = [:]
        for offset in 0..<DayKinds.days {
            guard let day = calendar.date(byAdding: .day, value: offset, to: start),
                  let noon = calendar.date(bySettingHour: noonHour, minute: 0, second: 0, of: day) else { continue }
            let minutes = timeZone.secondsFromGMT(for: noon) / ClockUnits.secondsPerMinute
            let hours = abs(minutes) / ClockUnits.minutesPerHour, rest = abs(minutes) % ClockUnits.minutesPerHour
            out[LocalTime(noon, in: timeZone).day] = .string(String(format: "%@%02d:%02d", minutes < 0 ? "-" : "+", hours, rest))
        }
        return .object(out)
    }

    func planContext(rows: [MemoryRow], now: Date) async -> JSONValue {
        await bundle.call("planContext", input(rows: rows, now: now))
    }

    func planBrief(rows: [MemoryRow], now: Date) async -> [String] {
        await bundle.call("planBrief", ["context": input(rows: rows, now: now)])["lines"]?.array?.compactMap(\.string) ?? []
    }

    func checkPlan(_ sessions: [PlanSession], summary: String, rows: [MemoryRow], now: Date) async -> [PlanViolation] {
        let answer = await bundle.call("checkPlan", [
            "plan": ["sessions": .from(sessions), "summary": .string(summary)], "context": input(rows: rows, now: now),
        ])
        // A check that can't be run passes nothing.
        guard answer.isOK, let violations = answer["violations"]?.decoded([PlanViolation].self) else {
            return [PlanViolation(code: "check_failed", text: answer["error"]?["text"]?.string ?? "The plan couldn’t be checked.")]
        }
        // `hints[i]` says how to fix `violations[i]`; the agent gets both in one line.
        let hints = answer["hints"]?.array ?? []
        return violations.enumerated().map { index, violation in
            var violation = violation
            if hints.indices.contains(index), let fix = hints[index]["fix"]?.string { violation.text += " Fix: \(fix)." }
            return violation
        }
    }

    func recommendWeek(rows: [MemoryRow], now: Date) async -> [PlanSession] {
        let answer = await bundle.call("recommendWeek", input(rows: rows, now: now))
        return answer.isOK ? answer["sessions"]?.decoded([PlanSession].self) ?? [] : []
    }
}
