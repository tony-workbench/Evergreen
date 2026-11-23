import Foundation

/// What the memory bundle needs from the app for one sync: the person, their
/// workouts, their nights and resting heart rate, and the time. Turns into the memory snapshot
/// (memory-agent/docs/CONTRACT.md) with times in the phone's time zone.
struct MemoryInput: Sendable {
    var personaKey: String
    var historyStart: Date
    var now: Date
    var workouts: [Workout]
    /// Minutes asleep and resting heart rate per day. They go into the bundle
    /// as input only: memory keeps averages, and no event carries them.
    var days: [HealthHistory.Day] = []
    var calendar: Calendar

    /// Local midnight that starts `now`'s day: rolling there describes yesterday as a completed day.
    var midnight: Date { calendar.startOfDay(for: now) }

    func timestamp(_ date: Date) -> String {
        let format = ISO8601DateFormatter()
        format.timeZone = calendar.timeZone
        format.formatOptions = [.withInternetDateTime]
        return format.string(from: date)
    }

    /// The snapshot as of `exportDate`. Every day from the history start to the
    /// day before is marked logged: the app has the person's whole history for
    /// those days, so a day without a workout really had none.
    func snapshot(exportDate: Date) -> JSONValue {
        let dayFormat = dayFormat
        var summaries: [JSONValue] = []
        let readings = Dictionary(days.map { (dayFormat.string(from: $0.date), $0) }, uniquingKeysWith: { $1 })
        var day = calendar.startOfDay(for: historyStart)
        let end = calendar.startOfDay(for: exportDate)
        while day < end {
            let date = dayFormat.string(from: day)
            var summary: [String: JSONValue] = ["date": .string(date)]
            if let rate = readings[date]?.restingHeartRate, (0...250).contains(rate) {
                summary["restingHeartRate"] = .number((rate * 100).rounded() / 100)
            }
            if let asleep = readings[date]?.sleepMin, (0...1440).contains(asleep) {
                summary["sleepMinutes"] = ["totalAsleep": .number((asleep * 100).rounded() / 100)]
            }
            summaries.append(.object(summary))
            day = calendar.date(byAdding: .day, value: 1, to: day) ?? end
        }
        return [
            "exportDate": .string(timestamp(exportDate)),
            "persona": ["key": .string(personaKey)],
            "dailySummaries": .array(summaries),
            "workouts": .array(workouts.filter { $0.end > $0.start }.map(entry)),
        ]
    }

    private var dayFormat: DateFormatter {
        let format = DateFormatter()
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyy-MM-dd"
        return format
    }

    private func entry(_ workout: Workout) -> JSONValue {
        var entry: [String: JSONValue] = [
            "id": .string("wk_" + MemoryFiles.sha256(workout.id).prefix(16)),
            "activityType": .string(workout.activityType),
            "start": .string(timestamp(workout.start)),
            "end": .string(timestamp(workout.end)),
            "durationMin": .number(min(1440, (workout.minutes * 100).rounded() / 100)),
            "source": .string(Self.source(workout.source)),
        ]
        if let effort = workout.effort, (1...10).contains(effort) {
            entry["effort"] = .number((effort * 100).rounded() / 100)
        }
        return .object(entry)
    }

    /// The memory bundle's sources are mock, phone, watch and manual.
    private static func source(_ source: Workout.Source) -> String {
        switch source {
        case .mock: "mock"
        case .health: "phone"
        case .demo: "manual"
        }
    }
}
