import Foundation

/// Remembered usual times that are the same thing on different days (the
/// same activity at the same hour) as one line with its days: "You usually
/// run at 7 AM" and S M T W T F S, where each marked day is its own row and
/// can be stopped by itself.
struct MemoryPattern: Identifiable, Equatable {
    var activity: ActivityKind
    var label: String?
    var hour: Int
    /// The row for each weekday that has one, Monday 0 to Sunday 6.
    var days: [Int: MemoryRow]

    var id: String { "\(activity.rawValue)-\(label ?? "")-\(hour)" }

    /// "You usually run at 7 AM."
    var sentence: String {
        let verb: String = switch activity {
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
        return "You usually \(verb) at \(PlainWords.clock(hour))."
    }

    /// The usable usual-time rows as patterns, and every other usable row left as it is.
    static func split(_ rows: [MemoryRow]) -> (patterns: [MemoryPattern], others: [MemoryRow]) {
        var order: [String] = [], byId: [String: MemoryPattern] = [:], others: [MemoryRow] = []
        for row in rows where row.isUsable {
            guard row.kind == "usual_slot", let activity = row.data["activity"]?.string.flatMap(ActivityKind.init(rawValue:)),
                  let weekday = row.data["weekday"]?.number.map(Int.init), (0...6).contains(weekday),
                  let hour = row.data["hour"]?.number.map(Int.init)
            else {
                others.append(row)
                continue
            }
            // A long run is a run for the pattern's sake.
            var pattern = MemoryPattern(activity: activity.recordedAs, label: row.data["label"]?.string, hour: hour, days: [:])
            if let existing = byId[pattern.id] { pattern = existing } else { order.append(pattern.id) }
            pattern.days[weekday] = row
            byId[pattern.id] = pattern
        }
        return (order.compactMap { byId[$0] }, others)
    }
}
