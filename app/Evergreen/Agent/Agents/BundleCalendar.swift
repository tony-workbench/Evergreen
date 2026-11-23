import Foundation

/// The calendar engine from the calendar-planner bundle (`calendarPlan`,
/// `calendarReplan`, `calendarIntentSchema`). Event titles stay out of it:
/// the engine gets when the person is busy, not what for.
struct BundleCalendar: CalendarPlanning {
    static let resource = "calendar-phone"
    static let globals = ["calendarPlan", "calendarReplan", "calendarIntentSchema"]

    let bundle: JSBundle
    /// Busy times on the person's other calendars.
    var busy: [Busy]
    /// The workouts already on the plan.
    var planned: [PlanItem]
    var timeZone: TimeZone

    private func week(memory: CalendarMemory, now: Date) -> [String: JSONValue] {
        func time(_ date: Date) -> JSONValue { .string(LocalTime(date, in: timeZone).text) }
        return [
            "now": time(now),
            "tzOffsetMinutes": .number(Double(timeZone.secondsFromGMT(for: now) / 60)),
            "events": .array(busy.enumerated().map { index, event in
                ["id": .string("busy-\(index)"), "title": "Busy", "start": time(event.start), "end": time(event.end), "fixed": true]
            }),
            "workouts": .array(planned.map { item in
                let activity = ActivityKind(healthType: item.slot.activityType)
                return ["id": .string(item.id), "sessionId": .string(item.id), "activity": .string(activity.rawValue),
                        "start": time(item.slot.start), "end": time(item.slot.end), "minutes": .number(Double(item.slot.minutes))]
            }),
            "memory": .from(memory),
        ]
    }

    private func result(_ answer: JSONValue) -> CalendarResult? {
        guard answer.isOK, var result = answer.decoded(CalendarResult.self) else { return nil }
        result.raw = answer
        return result
    }

    func plan(_ intent: CalendarIntent, memory: CalendarMemory, now: Date) async -> CalendarResult? {
        var arguments = week(memory: memory, now: now)
        arguments["intent"] = .from(intent)
        return result(await bundle.call("calendarPlan", .object(arguments)))
    }

    func plan(request: String, memory: CalendarMemory, now: Date) async -> CalendarResult? {
        var arguments = week(memory: memory, now: now)
        arguments["request"] = .string(request)
        return result(await bundle.call("calendarPlan", .object(arguments)))
    }

    func replan(_ last: CalendarResult, change: JSONValue, memory: CalendarMemory, now: Date) async -> CalendarResult? {
        var arguments = week(memory: memory, now: now)
        arguments["plan"] = last.raw ?? .from(last)
        arguments["change"] = change
        return result(await bundle.call("calendarReplan", .object(arguments)))
    }

    func intentSchema() async -> JSONValue {
        await bundle.call("calendarIntentSchema")
    }
}
