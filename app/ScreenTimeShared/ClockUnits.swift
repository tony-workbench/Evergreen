import Foundation

/// How the clock and the calendar count, named once for the app and its Screen Time extensions.
enum ClockUnits {
    static let secondsPerMinute = 60
    static let minutesPerHour = 60
    static let hoursPerDay = 24
    static let daysPerWeek = 7
    static let secondsPerHour = secondsPerMinute * minutesPerHour
    static let secondsPerDay = secondsPerHour * hoursPerDay
    /// A day written YYYY-MM-DD has three parts: year, month and day.
    static let dayKeyParts = 3
    /// Calendar weekdays run 1 (Sunday) to 7 (Saturday): Monday is this one.
    static let mondayWeekday = 2
    /// An "HH:MM" time has two parts: hour and minute.
    static let clockParts = 2
    /// The same counts as time intervals, for adding to a `Date`.
    static let minute: TimeInterval = TimeInterval(secondsPerMinute)
    static let hour: TimeInterval = TimeInterval(secondsPerHour)
    static let day: TimeInterval = TimeInterval(secondsPerDay)
}
