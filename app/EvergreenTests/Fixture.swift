import Foundation
@testable import Evergreen

/// Snapshots on a fixed story day in a fixed time zone, so the rules don't
/// depend on when or where the tests run. The story day is Thursday
/// 19 November 2026; its week starts Monday the 16th (3 days earlier).
enum Fixture {
    static let timeZone = TimeZone(identifier: "America/Los_Angeles")!

    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }()

    static let storyDay = calendar.date(from: DateComponents(year: 2026, month: 11, day: 19))!

    /// A time on the story day, or `dayOffset` days from it.
    static func at(_ hour: Int, _ minute: Int = 0, dayOffset: Int = 0) -> Date {
        let day = calendar.date(byAdding: .day, value: dayOffset, to: storyDay)!
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day)!
    }

    static func workout(
        _ id: String, at start: Date, minutes: Int, type: String = "Walking", source: Workout.Source = .mock
    ) -> Workout {
        Workout(id: id, activityType: type, start: start, end: start.addingTimeInterval(Double(minutes) * 60),
                effort: nil, avgHeartRate: nil, source: source)
    }

    /// Sam's shape: 8 evening workouts in the last 4 weeks, 25 minutes each at
    /// 7 PM. The first is on Monday of the story week.
    static let samHistory: [Workout] = [3, 6, 10, 13, 17, 20, 24, 27].map { daysAgo in
        workout("history-\(daysAgo)", at: at(19, dayOffset: -daysAgo), minutes: 25)
    }

    /// Sam's 12:00 lunchtime walk on the story day.
    static let lunchWalk = PlanItem(
        id: "plan-walk",
        slot: Slot(start: at(12), end: at(12, 30), activityType: "Walking")
    )

    /// Sam's Friday 7:30 AM elliptical, the workout a meeting lands on.
    static let fridayElliptical = PlanItem(
        id: "plan-elliptical",
        slot: Slot(start: at(7, 30, dayOffset: 1), end: at(7, 55, dayOffset: 1), activityType: "Elliptical")
    )

    static func busy(_ start: Date, _ end: Date) -> Busy {
        Busy(start: start, end: end)
    }

    static func snapshot(
        now: Date,
        plan: [PlanItem] = [],
        workouts: [Workout] = samHistory,
        actions: [AgentAction] = [],
        undoneActionIds: [String] = [],
        busy: [Busy] = []
    ) -> TickSnapshot {
        TickSnapshot(
            now: now,
            timeZone: timeZone.identifier,
            plan: plan,
            workouts: workouts,
            actions: actions,
            undoneActionIds: undoneActionIds,
            busy: busy
        )
    }
}
