import Foundation

/// One event on the Evergreen calendar, as the plan says it should be.
/// The key goes in the event's URL field, so each plan item maps to one event
/// across launches and repeated ticks. `eventIdentifier` is
/// never used as a key.
struct CalendarEntry: Equatable, Sendable {
    static let scheme = "evergreen"
    /// The scheme events carried before the rename from Tracker++. They're
    /// still read as the app's own, so a sync replaces them instead of leaving
    /// a duplicate next to each new event.
    static let legacySchemes: Set<String> = ["trackerplusplus"]

    /// Whether an event URL is one of the app's plan keys, new or from before the rename.
    static func isAppKey(_ url: URL?) -> Bool {
        guard let scheme = url?.scheme else { return false }
        return scheme == Self.scheme || legacySchemes.contains(scheme)
    }

    let key: URL
    let title: String
    let notes: String
    let start: Date
    let end: Date

    /// What a day's strength event carries beyond the plan: the movements of a home session, by day (YYYY-MM-DD), and the
    /// days whose home session is done, whose event says so in its title, at the time it was done when that is known,
    /// else where it was planned.
    struct Marks: Equatable, Sendable {
        var notes: [String: String] = [:]
        var done: Set<String> = []
    }

    /// What the entries are made from: the plan, the story day (in each key, because pinned plan ids repeat from day to
    /// day), the calendar the days are read in, and the marks of the home sessions.
    struct Request {
        var plan: [PlanItem]
        var storyDay: Date
        var calendar: Calendar
        var marks = Marks()
    }

    /// One entry per plan item, keyed by the story day and the item's id. A rest day is never written to the calendar.
    static func entries(_ request: Request) -> [CalendarEntry] {
        let calendar = request.calendar
        let day = Date.ISO8601FormatStyle(timeZone: calendar.timeZone).year().month().day().format(request.storyDay)
        return request.plan.compactMap { item in
            guard Activity.kind(item.slot.activityType) != .rest, let key = URL(string: "\(scheme)://plan/\(day)/\(item.id)") else { return nil }
            return CalendarEntry(
                key: key,
                title: title(item, marks: request.marks, calendar: calendar),
                notes: ["Planned by Evergreen.", homeNotes(item, marks: request.marks, calendar: calendar)].compactMap { $0 }.joined(separator: "\n"),
                start: item.slot.start,
                end: item.slot.end
            )
        }
    }

    /// The words that mark a done session's event.
    static let doneMark = " (done)"

    private static func title(_ item: PlanItem, marks: Marks, calendar: Calendar) -> String {
        let isDone = Activity.kind(item.slot.activityType) == .strength && marks.done.contains(LocalTime(item.slot.start, in: calendar.timeZone).day)
        return Activity.title(item.slot) + (isDone ? doneMark : "")
    }

    private static func homeNotes(_ item: PlanItem, marks: Marks, calendar: Calendar) -> String? {
        guard Activity.kind(item.slot.activityType) == .strength else { return nil }
        return marks.notes[LocalTime(item.slot.start, in: calendar.timeZone).day]
    }
}
