import Foundation

// The shapes the rules behind the agent card work with: a snapshot of the
// person's plan, workouts and busy times goes in, and actions come out.
// Dates are ISO 8601 with an offset; all calendar math uses `timeZone`.

/// A time window for one workout, before or after an agent action.
struct Slot: Codable, Hashable {
    var start: Date
    var end: Date
    var activityType: String
    /// Where it happens when that isn't the usual place; shown in the app only.
    var place: String? = nil

    var minutes: Int { Int((end.timeIntervalSince(start) / 60).rounded()) }
}

/// A time the person is busy on another calendar. Only the times leave the
/// phone, never the event's title or attendees.
struct Busy: Codable, Hashable {
    var start: Date
    var end: Date
}

/// One workout on the plan: something the person added, or the tour's fixed week.
struct PlanItem: Codable, Hashable, Identifiable {
    var id: String
    var slot: Slot
}

/// A completed workout, from Apple Health.
struct Workout: Codable, Hashable, Identifiable {
    enum Source: String, Codable { case mock, health, demo }

    var id: String
    var activityType: String
    var start: Date
    var end: Date
    /// HealthKit effort score, 1–10 (`workoutEffortScore` or the estimated one).
    var effort: Double?
    var avgHeartRate: Int?
    var source: Source
    /// From Apple Health: kilometers covered (runs, walks, rides) and whether it was indoors.
    var distanceKm: Double? = nil
    var indoor: Bool? = nil

    var minutes: Double { end.timeIntervalSince(start) / 60 }
}

/// Something done to the plan: the person added or moved a workout, or the
/// rules moved one off a meeting. The rules choose `id`, and repeat ticks
/// return the same id, so the phone never applies an action twice.
struct AgentAction: Codable, Hashable, Identifiable {
    enum Kind: String, Codable {
        case move, shrink, addWorkout
        /// A saved action of a kind this build doesn't know: shown as words only, it changes nothing on the plan.
        case note
    }

    var id: String
    var kind: Kind
    /// Headline for `note` and `addWorkout` actions; the other kinds use their verb.
    var title: String?
    /// The plan item this action creates or changes.
    var planItemId: String?
    var before: Slot?
    var after: Slot?
    var reason: String
    var createdAt: Date
}

/// A plan item finished by a workout.
struct Completion: Codable, Hashable {
    var planItemId: String
    var workoutId: String
}

/// What the rules look at on a tick.
struct TickSnapshot {
    var now: Date
    var timeZone: String
    /// The plan after every applied action, so the rules see what's booked.
    var plan: [PlanItem]
    var workouts: [Workout]
    /// Actions the phone has applied, oldest first.
    var actions: [AgentAction]
    /// Actions the person undid; the rules must not redo them.
    var undoneActionIds: [String]
    /// Busy times on the person's other calendars from the story day on, for
    /// slot defense. Empty without calendar access.
    var busy: [Busy]
}

struct TickResponse: Codable, Hashable {
    /// New actions. The phone ignores ids it already has.
    var actions: [AgentAction]
    var completions: [Completion]
}

extension JSONEncoder {
    static let contract: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
}

extension JSONDecoder {
    static let contract: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
