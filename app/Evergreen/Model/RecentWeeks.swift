import Foundation

/// The person's last 4 weeks as a grid of days, for the first look at what
/// Evergreen noticed: which days had a workout, and which weekdays are usual.
struct RecentWeeks: Equatable {
    /// Four rows of seven days, oldest week first; true where a workout of 10 minutes or more was done.
    var weeks: [[Bool]]
    /// A letter for each column's weekday.
    var letters: [String]
    /// Columns whose weekday has a usual time in memory.
    var usualColumns: Set<Int>

    var workoutDays: Int { weeks.joined().filter(\.self).count }

    /// The 28 days ending yesterday. `usualWeekdays` are 1 (Monday) to 7 (Sunday).
    init(workouts: [Workout], usualWeekdays: Set<Int>, today: Date, calendar: Calendar) {
        let end = calendar.startOfDay(for: today)
        let start = calendar.date(byAdding: .day, value: -28, to: end) ?? end
        let active = Set(workouts.filter { $0.minutes >= 10 && $0.start >= start && $0.start < end }
            .map { calendar.dateComponents([.day], from: start, to: calendar.startOfDay(for: $0.start)).day ?? -1 })
        weeks = (0..<4).map { week in (0..<7).map { active.contains(week * 7 + $0) } }
        letters = WeekStrip.letters(from: start, calendar: calendar)
        usualColumns = Set((0..<7).filter { column in
            let day = calendar.date(byAdding: .day, value: column, to: start) ?? start
            return usualWeekdays.contains((calendar.component(.weekday, from: day) + 5) % 7 + 1)
        })
    }
}
