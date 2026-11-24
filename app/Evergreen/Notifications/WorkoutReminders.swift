import Foundation

/// The reminders for one day at home, worked out here and scheduled by `Notifier`:
///
///   the evening before, 21:00   "Tomorrow at home"                   I'm going out tomorrow
///   10 minutes before            "In 10 minutes"                      Start · Later today
///   at the time                  "Time for your workout"              Start · Later today
///   20 minutes later, not begun  "Moved to 19:30"                     Start now
///   each later time              "Time for your workout"              Start · Later today
///   the last time                "Last time today"                    Start · Skip today
///
/// At most six for a day and none from 22:00. With "Keep reminding me until I've trained" off, only the first three.
/// A later time picked ahead in the week table is the only later time kept (`keeping(_:picked:)`).
/// Whichever time the session is done at, the rest of that day's go: finishing the workout, "I already trained"
/// on a reminder, or a strength workout in Health (`Notifier.cancelHomeReminders`, `AppModel.homeReminders`).
struct WorkoutReminder: Equatable, Sendable {
    enum Kind: String, Sendable {
        case evening, soon, now, moved, later, last
    }

    var id: String
    var kind: Kind
    var fires: Date
    var title: String
    var body: String
    /// The day of the workout, YYYY-MM-DD (the evening reminder fires the day before).
    var day: String
}

enum WorkoutReminders {
    static let prefix = "reminder-home-"
    static let maxPerDay = 6
    static let eveningHour = 21
    /// Nothing fires from this hour on.
    static let quietFrom = 22
    static let soonLead: TimeInterval = 10 * 60
    static let movedAfter: TimeInterval = 20 * 60

    /// What a reminder needs to say about the session.
    struct Session: Sendable {
        var focusWords: String
        var minutes: Int
        var movements: Int
    }

    /// The reminders for `day`, from now on. Empty for a day with no session.
    static func plan(day: HomeWeek.Day, session: Session, keepReminding: Bool, now: Date, calendar: Calendar) -> [WorkoutReminder] {
        guard day.trains, let first = day.first?.date else { return [] }
        let laters = day.fallbacks.compactMap(\.date)
        var out: [(kind: WorkoutReminder.Kind, fires: Date, copy: (title: String, body: String))] = []

        if let start = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: first)),
           let evening = calendar.date(bySettingHour: eveningHour, minute: 0, second: 0, of: start) {
            out.append((.evening, evening, NotificationCopy.homeTomorrow(session, at: first)))
        }
        out.append((.soon, first.addingTimeInterval(-soonLead), NotificationCopy.homeSoon(session)))
        let onlyOne = !keepReminding || laters.isEmpty
        out.append((onlyOne && keepReminding ? .last : .now, first, NotificationCopy.homeNow(session, last: onlyOne && keepReminding, at: first)))
        if keepReminding, let next = laters.first {
            out.append((.moved, first.addingTimeInterval(movedAfter), NotificationCopy.homeMoved(to: next)))
            for (index, time) in laters.enumerated() {
                let last = index == laters.count - 1
                out.append((last ? .last : .later, time, NotificationCopy.homeNow(session, last: last, at: time)))
            }
        }

        let reminders = out.enumerated().compactMap { index, entry -> WorkoutReminder? in
            guard entry.fires > now, calendar.component(.hour, from: entry.fires) < quietFrom else { return nil }
            return WorkoutReminder(id: "\(prefix)\(day.day)-\(index + 1)", kind: entry.kind, fires: entry.fires,
                                   title: entry.copy.title, body: entry.copy.body, day: day.day)
        }
        return Array(reminders.prefix(maxPerDay))
    }

    /// The day with only the later time picked ahead for it, by its clock ("18:10"). No pick, or a pick that is no
    /// longer one of the day's later times (the week was worked out again), keeps them all.
    static func keeping(_ day: HomeWeek.Day, picked: String?) -> HomeWeek.Day {
        guard let picked, day.fallbacks.contains(where: { $0.clock == picked }) else { return day }
        var day = day
        day.fallbacks = day.fallbacks.filter { $0.clock == picked }
        return day
    }

    /// Which of `ids` are the reminders of the session on `day`, and only those.
    static func ids(_ ids: [String], day: String) -> [String] {
        ids.filter { $0.hasPrefix("\(prefix)\(day)-") }
    }

    /// The next later time after `now` on a day, for "Later today"; nil when none is left.
    static func nextLater(_ day: HomeWeek.Day, after now: Date) -> Date? {
        ([day.first] + day.fallbacks.map(Optional.some)).compactMap { $0?.date }.sorted().first { $0 > now.addingTimeInterval(5 * 60) }
    }
}
