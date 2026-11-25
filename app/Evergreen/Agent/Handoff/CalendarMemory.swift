import Foundation

/// What the calendar engine knows about the person: their usual times, and the proposals they turned down.
struct CalendarMemory: Codable, Equatable, Sendable {
    struct Slot: Codable, Equatable, Sendable {
        var key: String
        var activity: ActivityKind
        /// 0 to 6, Monday 0.
        var weekday: Int
        var hour: Int
        var minutes: Int
    }

    var slots: [Slot]
    var declined: [String]?
}
