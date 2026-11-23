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

    /// One entry per plan item, keyed by the story day and the item's id. The
    /// story day is in the key because pinned plan ids repeat from day to day.
    static func entries(for plan: [PlanItem], storyDay: Date, calendar: Calendar) -> [CalendarEntry] {
        let day = Date.ISO8601FormatStyle(timeZone: calendar.timeZone).year().month().day().format(storyDay)
        return plan.compactMap { item in
            // A rest day is never written to the calendar.
            guard Activity.kind(item.slot.activityType) != .rest, let key = URL(string: "\(scheme)://plan/\(day)/\(item.id)") else { return nil }
            return CalendarEntry(
                key: key,
                title: Activity.title(item.slot),
                notes: "Planned by Evergreen.",
                start: item.slot.start,
                end: item.slot.end
            )
        }
    }
}
