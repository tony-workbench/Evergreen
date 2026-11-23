import Foundation

/// A session the person confirmed: what was planned, kept so the next day can say whether it happened.
struct PlanRecord: Codable, Equatable, Sendable {
    var sessionId: String
    var day: String
    var activity: ActivityKind
    var plannedStart: LocalTime
}
