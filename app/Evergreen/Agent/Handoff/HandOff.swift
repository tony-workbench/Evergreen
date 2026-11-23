import Foundation

/// The four hand-offs between agents, the same as `contract/src/adapt.mjs`
/// (the contract's fixtures pin the results). The agents never call each
/// other: the app turns one agent's output into the next one's input with these.
enum HandOff {
    /// An accepted session as the calendar engine's intent: add it that day at exactly its start
    /// (the person accepted that time; the engine only moves it when something is in the way).
    /// An `other` session is named after the first of its memory rows that has a label.
    static func sessionToIntent(_ session: PlanSession, rows: [MemoryRow] = []) -> CalendarIntent {
        if session.activity == .rest { return CalendarIntent(kind: "add", activity: .rest, sessionId: session.id, day: session.day) }
        let label = session.activity != .other ? nil : session.basedOn.lazy
            .compactMap { key in rows.first { $0.key == key }?.data["label"]?.string }.first { !$0.isEmpty }
        return CalendarIntent(kind: "add", activity: session.activity, title: label.map { String($0.prefix(60)) }, minutes: session.minutes,
                              sessionId: session.id, day: session.day, after: session.start.clock, exact: true)
    }

    /// The person's usual times for the calendar engine: one for each saved
    /// or confirmed `usual_slot` row, copied from the row's data, never read from its key.
    static func rowsToCalendarMemory(_ rows: [MemoryRow]) -> CalendarMemory {
        CalendarMemory(slots: rows.filter { $0.kind == "usual_slot" && $0.isUsable }.compactMap { row in
            guard let activity = row.data["activity"]?.string.flatMap(ActivityKind.init(rawValue:)),
                  let weekday = row.data["weekday"]?.number, let hour = row.data["hour"]?.number, let minutes = row.data["minutes"]?.number
            else { return nil }
            return .init(key: row.key, activity: activity, weekday: Int(weekday), hour: Int(hour), minutes: Int(minutes))
        })
    }

    /// One outcome for each planned session of that day except rest, in
    /// order of planned start. A session is done when a Health workout of
    /// its activity started that local day; each workout counts once, the
    /// closest planned and actual starts first. A Health run counts for a long run.
    static func outcomesFor(_ records: [PlanRecord], workouts: [HealthWorkout], day: String) -> [Outcome] {
        let thatDay = workouts.filter { $0.start.prefix(10) == day }
        let planned = records.filter { $0.day == day && $0.activity != .rest }.sorted {
            let a = $0.plannedStart.date ?? .distantPast, b = $1.plannedStart.date ?? .distantPast
            return a != b ? a < b : $0.sessionId < $1.sessionId
        }
        let pairs = planned.indices.flatMap { p in
            thatDay.indices.compactMap { w -> (gap: TimeInterval, planned: Int, workout: Int)? in
                guard ActivityKind(healthType: thatDay[w].activityType) == planned[p].activity.recordedAs,
                      let a = planned[p].plannedStart.date, let b = date(thatDay[w].start)
                else { return nil }
                return (abs(a.timeIntervalSince(b)), p, w)
            }
        }.sorted { ($0.gap, $0.planned, $0.workout) < ($1.gap, $1.planned, $1.workout) }

        var match = [Int: Int](), used = Set<Int>()
        for pair in pairs where match[pair.planned] == nil && !used.contains(pair.workout) {
            match[pair.planned] = pair.workout
            used.insert(pair.workout)
        }
        return planned.indices.map { p in
            let record = planned[p], workout = match[p].map { thatDay[$0] }
            return Outcome(sessionId: record.sessionId, day: record.day, activity: record.activity, plannedStart: record.plannedStart,
                           done: workout != nil, actualStart: workout.flatMap { LocalTime(contractTime($0.start)) },
                           actualMinutes: workout.map { Int($0.durationMin.rounded(.toNearestOrAwayFromZero)) })
        }
    }

    /// The memory keys a "Not now" rejects, the same as `adapt.mjs`. Code
    /// decides, not the model's list: every `usual_slot` row whose activity,
    /// weekday and hour are the session's own, whether or not the session
    /// named it. Rows about volume, sleep or load are never rejected by
    /// declining a session; those are stopped from What I remember.
    static func keysToReject(_ session: PlanSession, rows: [MemoryRow]) -> [String] {
        guard let at = PlanAgent.slot(of: session) else { return [] }
        var seen = Set<String>()
        return rows.filter { row in
            row.kind == "usual_slot" && row.data["activity"]?.string == session.activity.rawValue
                && row.data["weekday"]?.number.map(Int.init) == at.weekday && row.data["hour"]?.number.map(Int.init) == at.hour
        }.map(\.key).filter { seen.insert($0).inserted }
    }

    /// The usual times the person rejected, as the `stopped` list for `planContext`, `checkPlan`
    /// and `recommendWeek`, the same as `adapt.mjs`: rejected rows are not in the table, so the app passes them.
    static func rowsToStopped(_ rejected: [MemoryRow]) -> [JSONValue] {
        rejected.filter { $0.kind == "usual_slot" }.map { row in
            ["key": .string(row.key), "activity": row.data["activity"] ?? .null, "weekday": row.data["weekday"] ?? .null, "hour": row.data["hour"] ?? .null]
        }
    }

    /// Every key a session names, once (for checking them against the table).
    static func citedKeys(_ session: PlanSession) -> [String] {
        var seen = Set<String>()
        return session.basedOn.filter { seen.insert($0).inserted }
    }

    /// A Health time in the contract's form: at most 3 fractional digits.
    static func contractTime(_ time: String) -> String {
        time.replacing(/(\.\d{3})\d+/) { String($0.1) }
    }

    private static func date(_ time: String) -> Date? {
        LocalTime(contractTime(time))?.date
    }
}
