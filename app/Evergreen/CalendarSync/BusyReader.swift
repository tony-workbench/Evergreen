import EventKit

/// Reads the person's busy times from their other calendars. EventKit's fetch
/// is synchronous and slow on a full calendar, so this runs off the main
/// thread; the event store allows fetches from any thread.
struct BusyReader: @unchecked Sendable {
    let store: EKEventStore

    /// Timed events not marked free, on every calendar but the app's own. Only
    /// start and end leave this function; titles stay on the phone.
    func busy(from start: Date, days: Int, except appCalendar: String) -> [Busy] {
        let others = store.calendars(for: .event).filter { $0.title != appCalendar }
        guard !others.isEmpty else { return [] }
        let end = Calendar.current.date(byAdding: .day, value: days, to: start) ?? start
        return store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: others))
            .filter { !$0.isAllDay && $0.availability != .free && !CalendarEntry.isAppKey($0.url) }
            .map { Busy(start: $0.startDate, end: $0.endDate) }
            .sorted { $0.start < $1.start }
    }
}
