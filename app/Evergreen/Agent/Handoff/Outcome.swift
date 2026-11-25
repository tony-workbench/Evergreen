import Foundation

/// Whether a planned session happened. Tomorrow's memory learns from these.
struct Outcome: Codable, Equatable, Sendable {
    var sessionId: String
    var day: String
    var activity: ActivityKind
    var plannedStart: LocalTime
    var done: Bool
    var actualStart: LocalTime?
    var actualMinutes: Int?
}
