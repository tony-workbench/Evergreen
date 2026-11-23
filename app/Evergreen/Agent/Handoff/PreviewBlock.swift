import Foundation

/// A block the calendar engine proposes. Nothing is written until the person confirms.
struct PreviewBlock: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var sessionId: String?
    var activity: ActivityKind
    var title: String
    var start: LocalTime
    var end: LocalTime
    var minutes: Int
    /// new, moved, resized or cancelled
    var status: String
    var reason: String
    /// Set on a rest day.
    var allDay: Bool?
}
