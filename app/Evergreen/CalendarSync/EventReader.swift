import EventKit

/// Reads the person's other calendars for busy times and places. EventKit's fetch is synchronous and slow on a full
/// calendar, so it runs on this actor, off the main thread. The actor makes and keeps its own event store, so no event
/// or store crosses between threads: only start, end and where the event is (`Busy`) leave it. Titles stay unread.
/// It is only asked once calendar access is on (`CalendarSync`), so its store always sees the calendars.
actor EventReader {
    private var store: EKEventStore?

    /// Timed events not marked free, on every calendar but the app's own. The place is used on the phone alone, to tell
    /// days out from days at home.
    func busy(from start: Date, days: Int, except appCalendar: String) -> [Busy] {
        events(from: start, days: days, except: appCalendar)
            .filter { !$0.isAllDay && $0.availability != .free }
            .map { Busy(start: $0.startDate, end: $0.endDate, place: Self.place(of: $0)) }
            .sorted { $0.start < $1.start }
    }

    /// Events with a place that `busy` leaves out: all-day events and events marked free. They make no busy time, but an
    /// all-day or several-day event away from home still makes each of its days a day out (plan 5.B.1).
    func placed(from start: Date, days: Int, except appCalendar: String) -> [Busy] {
        events(from: start, days: days, except: appCalendar)
            .filter { $0.isAllDay || $0.availability == .free }
            .compactMap { event in Self.place(of: event).map { Busy(start: event.startDate, end: event.endDate, place: $0) } }
            .sorted { $0.start < $1.start }
    }

    /// The events of every calendar but the app's own, without the app's own events.
    private func events(from start: Date, days: Int, except appCalendar: String) -> [EKEvent] {
        let store = self.store ?? EKEventStore()
        self.store = store
        let others = store.calendars(for: .event).filter { $0.title != appCalendar }
        guard !others.isEmpty else { return [] }
        let end = Calendar.current.date(byAdding: .day, value: days, to: start) ?? start
        return store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: others))
            .filter { !CalendarEntry.isAppKey($0.url) }
    }

    /// The coordinate the calendar kept for the event's place, or the place's text when it has none.
    private static func place(of event: EKEvent) -> EventPlace? {
        if let point = event.structuredLocation?.geoLocation?.coordinate {
            return .coordinate(Coordinate(latitude: point.latitude, longitude: point.longitude))
        }
        let text = event.location?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : .text(text)
    }
}
