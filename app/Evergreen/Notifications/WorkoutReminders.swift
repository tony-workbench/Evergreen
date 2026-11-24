import Foundation

/// The reminders for one day at home, worked out here and scheduled by `Notifier`.
///
/// With no time picked, every time of the day reminds:
///
///   the evening before, 21:00   "Tomorrow at home"                   Only at … (each time) · I'm going out tomorrow
///   (a day out: 21:00 before)    "Tomorrow you’re out"                I'm home tomorrow
///   10 minutes before            "In 10 minutes"                      Start · Later today · Already done
///   at the time                  "Time for your workout"              Start · Later today · Already done
///   20 minutes later, not begun  "Moved to 19:30"                     Start now · Already done
///   each later time              "Time for your workout"              Start · Later today · Already done
///   the last time                "Last time today"                    Start · Already done · Skip today
///
/// With one time picked (the week table, "Only at …" on the evening reminder, "Later today", or "Move to …"), only that
/// time is kept, the first time included: 10 minutes before and at it, then 20 minutes later one question, "Move to 19:40?"
/// (Move to 19:40 · Already done · Skip today) when a later time is left. Nothing moves by itself.
/// With "Always ask me to pick one time" on, the evening reminder asks for a time, and until one is picked only the first
/// time reminds, the same way.
///
/// At most six for a day and none from 22:00 or before 06:00; with the app's other notifications, six a day in all (`NotificationBudget`). With "Keep reminding me until I've trained" off and no time picked, only the
/// first three. Once the session is done, by any way, what is left of that day's goes (`Notifier.cancelHomeReminders`,
/// `AppModel.homeReminders`).
struct WorkoutReminder: Equatable, Sendable {
    enum Kind: String, Sendable {
        case evening, soon, now, moved, later, last, ask
        /// The evening before a day out: says there's no workout, with "I'm home tomorrow" for a wrong guess.
        case outTomorrow = "out_tomorrow"
    }

    var id: String
    var kind: Kind
    var fires: Date
    var title: String
    var body: String
    /// The day of the workout, YYYY-MM-DD (the evening reminder fires the day before).
    var day: String
    /// The times a button on it picks, as clocks ("18:10"): each time of the day on the evening reminder, the next one on
    /// the question twenty minutes after a picked time.
    var choices: [String] = []
}

enum WorkoutReminders {
    static let prefix = "reminder-home-"
    static let maxPerDay = NotificationBudget.maxPerDay
    static let eveningHour = 21
    /// Nothing fires from this hour on, nor before `NotificationBudget.quietUntilHour`.
    static let quietFrom = NotificationBudget.quietFromHour
    static let soonLead: TimeInterval = 10 * 60
    static let movedAfter: TimeInterval = 20 * 60
    /// "Later today" skips a time that starts within this: too soon to get ready for.
    static let readyLead: TimeInterval = 5 * 60
    /// The evening reminder has room for three "Only at …" buttons beside "I'm going out tomorrow".
    static let maxChoices = 3

    /// What a reminder needs to say about the session.
    struct Session: Sendable {
        var focusWords: String
        var minutes: Int
        var movements: Int
    }

    /// How the person wants a day's reminders: the two switches in Settings and the time picked for that day.
    struct Choice: Sendable, Equatable {
        var keepReminding = true
        var pickEachDay = false
        /// The one time kept, by its clock ("18:10"); nil when none was picked.
        var picked: String?
    }

    /// One time of a day: its clock and the moment it stands for.
    struct Time: Equatable, Sendable {
        var clock: String
        var date: Date
    }

    private typealias Entry = (kind: WorkoutReminder.Kind, fires: Date, copy: (title: String, body: String), choices: [String])

    /// The reminders for `day`, from now on. Empty for a day with no session.
    static func plan(day: HomeWeek.Day, session: Session, choice: Choice, now: Date, calendar: Calendar) -> [WorkoutReminder] {
        guard day.trains, let first = day.first?.date else { return [] }
        let kept = keptTime(day, choice: choice, calendar: calendar)
        var out: [Entry] = []
        if let evening = evening(day, session: session, choice: choice, kept: kept, first: first, calendar: calendar) { out.append(evening) }
        if let kept {
            out += keptOnly(kept, after: later(than: kept.date, in: day), session: session)
        } else {
            out += everyTime(first, laters: day.fallbacks.compactMap(\.date), keepReminding: choice.keepReminding, session: session)
        }
        let reminders = out.enumerated().compactMap { index, entry -> WorkoutReminder? in
            guard entry.fires > now, !NotificationBudget.isQuiet(entry.fires, calendar: calendar) else { return nil }
            return WorkoutReminder(id: "\(prefix)\(day.day)-\(index + 1)", kind: entry.kind, fires: entry.fires,
                                   title: entry.copy.title, body: entry.copy.body, day: day.day, choices: entry.choices)
        }
        return Array(reminders.prefix(maxPerDay))
    }

    /// The evening before a day out, so a day taken for a day out by mistake is put right with one tap. Nil once it has passed.
    static func outEvening(day: String, now: Date, calendar: Calendar) -> WorkoutReminder? {
        guard let morning = date(day, clock: "00:00", calendar: calendar),
              let before = calendar.date(byAdding: .day, value: -1, to: morning),
              let fires = calendar.date(bySettingHour: eveningHour, minute: 0, second: 0, of: before), fires > now else { return nil }
        let copy = NotificationCopy.outTomorrow
        return WorkoutReminder(id: "\(prefix)\(day)-out", kind: .outTomorrow, fires: fires, title: copy.title, body: copy.body, day: day)
    }

    /// The first time and the later times of a day, in order.
    static func times(of day: HomeWeek.Day) -> [Time] {
        ([day.first].compactMap { $0 } + day.fallbacks).compactMap { time in time.date.map { Time(clock: time.clock, date: $0) } }
            .sorted { $0.date < $1.date }
    }

    /// The one time a day keeps: the picked one (even when the week was worked out again without it), or the first time
    /// with "Always ask me to pick one time" on and nothing picked yet. Nil when every time reminds.
    static func keptTime(_ day: HomeWeek.Day, choice: Choice, calendar: Calendar) -> Time? {
        if let picked = choice.picked, let date = date(day.day, clock: picked, calendar: calendar) { return Time(clock: picked, date: date) }
        guard choice.pickEachDay, let first = day.first, let date = first.date else { return nil }
        return Time(clock: first.clock, date: date)
    }

    /// The moment of a clock ("18:10") on a day ("2026-11-19") in the calendar's time zone; nil for a clock that isn't one.
    static func date(_ day: String, clock: String, calendar: Calendar) -> Date? {
        let parts = (day.split(separator: "-") + clock.split(separator: ":")).compactMap { Int($0) }
        guard parts.count == 5, (0..<24).contains(parts[3]), (0..<60).contains(parts[4]) else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: parts[3], minute: parts[4]))
    }

    /// The next time of a day after `date`, for the question twenty minutes after a picked time.
    static func later(than date: Date, in day: HomeWeek.Day) -> Time? {
        times(of: day).first { $0.date > date }
    }

    private static func evening(_ day: HomeWeek.Day, session: Session, choice: Choice, kept: Time?, first: Date,
                                calendar: Calendar) -> Entry? {
        guard let start = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: first)),
              let fires = calendar.date(bySettingHour: eveningHour, minute: 0, second: 0, of: start) else { return nil }
        let all = times(of: day)
        let copy = choice.pickEachDay && choice.picked == nil
            ? NotificationCopy.homePickTomorrow(session, times: all.map(\.date))
            : NotificationCopy.homeTomorrow(session, at: kept?.date ?? first)
        return (.evening, fires, copy, Array(all.map(\.clock).prefix(maxChoices)))
    }

    /// Only the kept time: before it, at it, and one question twenty minutes later when a later time is left.
    private static func keptOnly(_ kept: Time, after next: Time?, session: Session) -> [Entry] {
        var out: [Entry] = [(.soon, kept.date.addingTimeInterval(-soonLead), NotificationCopy.homeSoon(session), [])]
        out.append((next == nil ? .last : .now, kept.date, NotificationCopy.homeNow(session, last: next == nil, at: kept.date), []))
        if let next { out.append((.ask, kept.date.addingTimeInterval(movedAfter), NotificationCopy.homeAsk(next: next.date), [next.clock])) }
        return out
    }

    /// Every time of the day, with the move twenty minutes after the first.
    private static func everyTime(_ first: Date, laters: [Date], keepReminding: Bool, session: Session) -> [Entry] {
        var out: [Entry] = [(.soon, first.addingTimeInterval(-soonLead), NotificationCopy.homeSoon(session), [])]
        let onlyOne = !keepReminding || laters.isEmpty
        out.append((onlyOne && keepReminding ? .last : .now, first, NotificationCopy.homeNow(session, last: onlyOne && keepReminding, at: first), []))
        guard keepReminding, let next = laters.first else { return out }
        out.append((.moved, first.addingTimeInterval(movedAfter), NotificationCopy.homeMoved(to: next), []))
        for (index, time) in laters.enumerated() {
            let last = index == laters.count - 1
            out.append((last ? .last : .later, time, NotificationCopy.homeNow(session, last: last, at: time), []))
        }
        return out
    }

    /// Which of `ids` are the reminders of the session on `day`, and only those.
    static func ids(_ ids: [String], day: String) -> [String] {
        ids.filter { $0.hasPrefix("\(prefix)\(day)-") }
    }

    /// The next time after `now` on a day, for "Later today"; nil when none is left.
    static func nextLater(_ day: HomeWeek.Day, after now: Date) -> Time? {
        times(of: day).first { $0.date > now.addingTimeInterval(readyLead) }
    }
}
