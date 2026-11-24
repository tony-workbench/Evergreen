import Foundation

/// Every notification's words, in one place. Same voice as the app: an encouraging coach that
/// says why, never guilt, streaks or points.
enum NotificationCopy {
    /// 30 minutes before a planned workout.
    static func reminder(_ item: PlanItem) -> (title: String, body: String) {
        ("\(Activity.title(item.slot)) at \(item.slot.start.clock)",
         "\(item.slot.minutes) minutes. You planned it, now go get it!")
    }

    /// The agent moved a workout off a meeting.
    static func moved(before: Slot, after: Slot, meeting: (title: String, start: Date)?) -> (title: String, body: String) {
        let noun = Activity.noun(before)
        let what = meeting.map { "\($0.title) at \($0.start.clock)" } ?? "A meeting"
        return ("\(meeting?.title ?? "A meeting") landed on your \(noun)",
                "\(what) overlaps your \(before.start.clock) \(noun), so I moved it to \(after.start.clock). Still on track!")
    }

    /// Sunday evening, for the person who plans by their rules.
    static let weekAhead = (title: "Your week ahead", body: "Open Evergreen to see which days are at home and what each one holds.")

    // MARK: A day at home (see WorkoutReminders)

    /// 21:00 the evening before.
    static func homeTomorrow(_ session: WorkoutReminders.Session, at start: Date) -> (title: String, body: String) {
        ("Tomorrow at home", "\(session.focusWords.capitalizedFirst) at \(start.clock), about \(session.minutes) minutes.")
    }

    /// 21:00 the evening before a day out.
    static let outTomorrow = (title: "Tomorrow you’re out", body: "No workout tomorrow. If you’ll be home after all, tap “I’m home tomorrow”.")

    /// 21:00 the evening before, with "Always ask me to pick one time" on and no time picked yet.
    static func homePickTomorrow(_ session: WorkoutReminders.Session, times: [Date]) -> (title: String, body: String) {
        let clocks = times.map(\.clock)
        let list = clocks.count > 1 ? clocks.dropLast().joined(separator: ", ") + " or " + (clocks.last ?? "") : (clocks.first ?? "")
        return ("Tomorrow at home: pick a time",
                "\(session.focusWords.capitalizedFirst), about \(session.minutes) minutes, at \(list). Only the time you pick reminds you.")
    }

    /// Ten minutes before.
    static func homeSoon(_ session: WorkoutReminders.Session) -> (title: String, body: String) {
        ("In 10 minutes", "\(session.movements) movements, about \(session.minutes) minutes.")
    }

    /// At the time, at each later time, and the last time of the day.
    static func homeNow(_ session: WorkoutReminders.Session, last: Bool, at start: Date) -> (title: String, body: String) {
        last ? ("Last time today", "\(session.focusWords.capitalizedFirst) at \(start.clock). Start now, or skip today and pick it up next time.")
             : ("Time for your workout", "\(session.focusWords.capitalizedFirst), about \(session.minutes) minutes. Start when you’re ready.")
    }

    /// Twenty minutes after the time with nothing started: the later time it now waits for.
    static func homeMoved(to next: Date) -> (title: String, body: String) {
        ("Moved to \(next.clock)", "No rush. Your workout waits for \(next.clock), or start now if you have the time.")
    }

    /// Twenty minutes after a picked time with nothing started: asked once, nothing moves by itself.
    static func homeAsk(next: Date) -> (title: String, body: String) {
        ("Move to later today?", "Not started yet. Move today’s workout to \(next.clock), or start now if you have the time.")
    }

    /// Rain all afternoon on a day at home.
    static func rainSnacks(count: Int, minutes: Int) -> (title: String, body: String) {
        ("Rain this afternoon", "\(count) short breaks of \(minutes) minutes could stand in for a walk. Open Evergreen to add them.")
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

