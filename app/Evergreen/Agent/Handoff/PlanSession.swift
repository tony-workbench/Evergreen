import Foundation

/// One session of a proposed week, as it passes between the planning agent,
/// the check, the calendar agent and the screen.
struct PlanSession: Codable, Equatable, Identifiable, Sendable {
    /// Stable for the same day, activity and start.
    var id: String
    /// YYYY-MM-DD
    var day: String
    var start: LocalTime
    /// 0 for a rest day, else 5 to 240.
    var minutes: Int
    var activity: ActivityKind
    /// easy, steady or hard
    var intensity: String
    /// One sentence, in plain words.
    var reason: String
    /// The keys of the memory rows it rests on.
    var basedOn: [String]

    /// The id of a session the app builds itself: "s-2026-11-09-run-1800", "s-2026-11-14-rest".
    static func id(day: String, activity: ActivityKind, start: LocalTime) -> String {
        activity == .rest ? "s-\(day)-rest" : "s-\(day)-\(activity.rawValue)-\(start.clock.replacing(":", with: ""))"
    }
}
