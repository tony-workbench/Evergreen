import Foundation

/// A memory row in the app's own words for the person, built from the
/// row's data. A row whose data can't be read is said as its statement.
enum RowWords {
    /// "You usually run Sunday around 8 AM."
    static func sentence(_ row: MemoryRow) -> String {
        said(row) ?? row.statement
    }

    /// The row in the app's words; nil when its data can't be read.
    private static func said(_ row: MemoryRow) -> String? {
        switch row.kind {
        case "usual_slot": usualSlot(row)
        case "weekly_volume": number(row, "workoutsPerWeek").map { "You do about \(oneDecimal($0)) workouts a week." }
        case "load": number(row, "ratioToUsual").map(loadWords)
        case "sleep": number(row, "hours7d").map { "You’ve slept about \(oneDecimal($0)) hours a night this week." }
        case "resting_hr": number(row, "bpm7d").map { "Your resting heart rate is \(Int($0.rounded())) bpm this week." }
        case "training_place": row.data["place"]?.string == "home" ? "You train at home, without gym equipment." : nil
        default: workoutsByActivity(row.statement)
        }
    }

    private static func number(_ row: MemoryRow, _ name: String) -> Double? { row.data[name]?.number }

    private static func oneDecimal(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0...1))) }

    private static func usualSlot(_ row: MemoryRow) -> String? {
        guard let slot = slot(row) else { return nil }
        let doing = verb(slot.activity, label: row.data["label"]?.string)
        return "You usually \(doing) \(PlainWords.weekdays[slot.weekday]) around \(PlainWords.clock(slot.hour))."
    }

    /// A ratio as a percentage.
    private static let percentScale = 100.0
    /// Within this many percent of the usual, the week's training is "about your usual".
    private static let usualLoadPercent = 5

    private static func loadWords(_ ratio: Double) -> String {
        let percent = Int((abs(ratio - 1) * percentScale).rounded())
        return percent < usualLoadPercent
            ? "This week’s training is about your usual."
            : "This week’s training is \(percent)% \(ratio > 1 ? "above" : "below") your usual."
    }

    /// "Workouts by activity over the last 28 days: running 28, yoga 4." said as a person would.
    private static func workoutsByActivity(_ statement: String) -> String? {
        guard let found = statement.wholeMatch(of: /Workouts by activity over the last (\d+) days: (.+)\./),
              let days = Int(found.1) else { return nil }
        let parts = found.2.split(separator: ", ").compactMap(timesWords)
        guard !parts.isEmpty else { return nil }
        let week = ClockUnits.daysPerWeek
        return "Your last \(days % week == 0 ? "\(days / week) weeks" : "\(days) days"): \(parts.joined(separator: ", "))."
    }

    /// "running 28" as "running 28 times"; nil for a part that doesn't end in a count.
    private static func timesWords(_ part: Substring) -> String? {
        guard let space = part.lastIndex(of: " "), let count = Int(part[part.index(after: space)...]) else { return nil }
        return "\(part[..<space]) \(count) \(count == 1 ? "time" : "times")"
    }

    /// A few words for "I won't use …": "Sunday 8 AM runs", "Sleep".
    static func title(_ row: MemoryRow) -> String {
        switch row.kind {
        case "usual_slot":
            guard let slot = slot(row) else { return "that" }
            let name = slot.activity == .other ? (row.data["label"]?.string ?? "workout").lowercased() : slot.activity.displayName.lowercased()
            return "\(PlainWords.weekdays[slot.weekday]) \(PlainWords.clock(slot.hour)) \(name)s"
        case "weekly_volume": return "your workouts per week"
        case "load": return "your training load"
        case "sleep": return "your sleep"
        case "resting_hr": return "your resting heart rate"
        case "training_place": return "training at home"
        default: return "that"
        }
    }

    /// One muted line on where a row comes from: since when, and how often it was seen.
    static func support(_ row: MemoryRow) -> String {
        var parts: [String] = []
        let day = Date.ISO8601FormatStyle(timeZone: .current).year().month().day()
        // How often it was seen says more than the day it was first written down, and the two read as a contradiction side by side.
        if row.kind == "training_place", let weeks = row.data["weeks"]?.number {
            parts.append("No elliptical or stair-climber workouts in the last \(Int(weeks)) weeks.")
        } else if let seen = row.data["weeksSeen"]?.number, let total = row.data["weeksTotal"]?.number {
            parts.append("Seen in \(Int(seen)) of the last \(Int(total)) weeks.")
        } else if let since = try? day.parse(row.since) {
            parts.append("Remembered since \(since.formatted(.dateTime.month(.wide).day())).")
        }
        parts.append("From your workouts and sleep in Apple Health.")
        return parts.joined(separator: " ")
    }

    private static func slot(_ row: MemoryRow) -> (activity: ActivityKind, weekday: Int, hour: Int)? {
        guard let activity = row.data["activity"]?.string.flatMap(ActivityKind.init(rawValue:)),
              let weekday = row.data["weekday"]?.number.map(Int.init), PlainWords.weekdays.indices.contains(weekday),
              let hour = row.data["hour"]?.number.map(Int.init)
        else { return nil }
        return (activity, weekday, hour)
    }

    private static func verb(_ activity: ActivityKind, label: String?) -> String {
        switch activity {
        case .run, .longRun: "run"
        case .walk: "walk"
        case .ride: "ride"
        case .swim: "swim"
        case .strength: "lift"
        case .yoga: "do yoga"
        case .stretch: "stretch"
        case .elliptical: "use the elliptical"
        case .rest: "rest"
        case .other: "do \(label?.lowercased() ?? "a workout")"
        }
    }
}
