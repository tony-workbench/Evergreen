import Foundation

/// The one place a planned workout gets its name: the calendar entry, the
/// week picture, the rows and the notifications all ask here. A plan slot
/// carries Apple Health's type; a run of an hour or more is the long run, and
/// a type the list doesn't know is called by its own name.
enum Activity {
    /// The activity a slot is.
    static func kind(_ type: String, minutes: Int = 0) -> ActivityKind {
        let kind = ActivityKind(healthType: type)
        return kind == .run && minutes >= 60 ? .longRun : kind
    }

    /// "Run", "Long run", "Stretch"; for a type outside the list its own name ("Rowing"), else "Workout".
    static func title(_ type: String, minutes: Int = 0) -> String {
        let kind = kind(type, minutes: minutes)
        return kind == .other ? label(type) ?? "Workout" : kind.displayName
    }

    static func title(_ slot: Slot) -> String { title(slot.activityType, minutes: slot.minutes) }

    /// The same in a sentence: "run", "long run", "strength session".
    static func noun(_ type: String, minutes: Int = 0) -> String {
        switch kind(type, minutes: minutes) {
        case .strength: "strength session"
        case .yoga: "yoga session"
        case .elliptical: "elliptical session"
        case .rest: "rest day"
        case .other: label(type)?.lowercased() ?? "workout"
        case let kind: kind.displayName.lowercased()
        }
    }

    static func noun(_ slot: Slot) -> String { noun(slot.activityType, minutes: slot.minutes) }

    /// A type's own name as words ("MixedCardio" → "Mixed cardio"); nil when it says nothing.
    static func label(_ type: String) -> String? {
        let words = type.replacing(/([a-z])([A-Z])/) { "\($0.1) \($0.2)" }.trimmingCharacters(in: .whitespaces)
        guard !words.isEmpty, !["other", "workout"].contains(words.lowercased()) else { return nil }
        return words.prefix(1).uppercased() + words.dropFirst().lowercased()
    }

    static func symbol(_ type: String) -> String {
        switch type {
        case "Walking": "figure.walk"
        case "Running": "figure.run"
        case "Elliptical": "figure.elliptical"
        case "TraditionalStrengthTraining", "FunctionalStrengthTraining": "dumbbell"
        case "Yoga": "figure.yoga"
        case "Cycling": "figure.outdoor.cycle"
        case "Swimming": "figure.pool.swim"
        case "Flexibility": "figure.flexibility"
        default: "figure.mixed.cardio"
        }
    }
}

extension Date {
    /// "12:00 PM"
    var clock: String { formatted(date: .omitted, time: .shortened) }
}

extension Slot {
    /// "12:00 PM, 30 min"
    var summary: String { "\(start.clock), \(minutes) min" + (place.map { ", \($0)" } ?? "") }
}
