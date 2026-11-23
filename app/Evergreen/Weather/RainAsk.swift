import Foundation

/// Rain is due on an outdoor workout: what Evergreen puts in front of the
/// person. It only asks; moving the workout is the person's yes and the
/// calendar engine's job, and going indoors is theirs to arrange.
struct RainAsk: Equatable, Sendable, Identifiable {
    struct WetHour: Equatable, Sendable {
        var start: Date
        var probability: Int
        var millimeters: Double
    }

    /// The workout the rain lands on.
    var session: PlanItem
    /// The hours of the workout with rain likely.
    var wetHours: [WetHour]
    /// The next stretch that day that is dry and free on the calendar, long enough for the workout.
    var dryWindow: DateInterval?
    /// What to ask the calendar engine for: move this workout into that window. It picks the exact time.
    var intent: CalendarIntent?
    /// Up to three indoor places nearby, nearest first.
    var places: [IndoorPlace] = []
    /// One per workout and day, so it is said once.
    var key: String

    var id: String { key }

    /// The highest chance of rain during the workout.
    var worstProbability: Int { wetHours.map(\.probability).max() ?? 0 }
}
