import Foundation

/// What the calendar engine is asked to do, in its own structured form.
struct CalendarIntent: Codable, Equatable, Sendable {
    /// add, move, resize, cancel or race
    var kind: String
    var activity: ActivityKind?
    /// The name of an `other` activity.
    var title: String?
    var minutes: Int?
    /// The planned session this is for.
    var sessionId: String?
    var targetWorkoutId: String?
    var day: String?
    /// Local HH:MM bounds.
    var after: String?
    var before: String?
    var partOfDay: String?
    var raceDate: String?
    var distanceKm: Double?
    /// With `after`: at that time exactly, not merely no earlier.
    var exact: Bool?
}
