import EventKit
import os

/// Keeps the plan on the app's own Evergreen calendar:
/// creates the calendar on iCloud, or on the phone without iCloud, and makes
/// its events match the plan from the story day on. It only ever touches
/// events that carry the app's URL key, and never the person's other calendars.
@MainActor
final class CalendarSync {
    static let calendarTitle = "Evergreen"
    /// How far ahead a sync looks. The pinned plan covers the story week.
    private static let window = 21

    private static let log = Logger(subsystem: "com.evergreentraining.app", category: "calendar")

    private var store = EKEventStore()
    /// A store made before access was granted doesn't see any calendars, so
    /// it's replaced the first time a sync runs with access.
    private var storeHasAccess = EKEventStore.authorizationStatus(for: .event) == .fullAccess
    /// Set when the prompt grants access. `authorizationStatus` keeps reporting
    /// "not determined" for the rest of the launch after a grant (seen on the
    /// iOS 27 simulator), so the request's own answer is trusted too. A change
    /// made in Settings restarts the app, so it never needs this.
    private var grantedThisLaunch = false

    /// Called when anything on the phone's calendars changes, such as a meeting
    /// landing on a workout, so the agent can look again.
    var onChange: (@MainActor () -> Void)?

    init() {
        // CalendarSync lives as long as the app, so the observer is never removed.
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.onChange?() }
        }
    }

    var access: CalendarAccess {
        if grantedThisLaunch { return .on }
        return switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: .on
        case .notDetermined: .notAsked
        default: .off
        }
    }

    /// Full access, because slot defense has to read other calendars:
    /// write-only access can't see a meeting that lands on a workout. Returns whether access is on afterwards.
    @discardableResult
    func requestAccess() async -> Bool {
        do {
            grantedThisLaunch = try await EKEventStore().requestFullAccessToEvents()
        } catch {
            Self.log.error("Access request failed: \(error.localizedDescription)")
        }
        Self.log.info("Calendar access request granted: \(self.grantedThisLaunch)")
        return access == .on
    }

    /// Makes the calendar match `entries` from `storyDay` on: creates, moves and
    /// removes the app's events. Earlier days stay as history.
    func sync(_ entries: [CalendarEntry], from storyDay: Date) {
        guard prepareStore() else { return }
        do {
            let calendar = try trackerCalendar()
            let events = appEvents(in: calendar, from: storyDay, days: Self.window)
            let changes = CalendarChanges(
                desired: entries,
                existing: events.indices.map { (id: $0, entry: CalendarEntry(events[$0])) }
            )
            guard !changes.isEmpty else { return }
            for entry in changes.create {
                let event = EKEvent(eventStore: store)
                event.calendar = calendar
                event.apply(entry)
                try store.save(event, span: .thisEvent, commit: false)
            }
            for update in changes.update {
                events[update.event].apply(update.entry)
                try store.save(events[update.event], span: .thisEvent, commit: false)
            }
            for index in changes.delete {
                try store.remove(events[index], span: .thisEvent, commit: false)
            }
            try store.commit()
            Self.log.info("Synced: \(changes.create.count) created, \(changes.update.count) moved, \(changes.delete.count) removed")
        } catch {
            // The plan stays in the app either way; the next sync tries again.
            store.reset()
            Self.log.error("Calendar sync failed: \(error.localizedDescription)")
        }
    }

    /// Removes every event the app made in the month around the story day, and
    /// any test meeting an older build left, so a fresh start has a clean calendar.
    func removeAllEvents(around storyDay: Date) {
        guard prepareStore() else { return }
        let start = Calendar.current.date(byAdding: .day, value: -30, to: storyDay) ?? storyDay
        let end = Calendar.current.date(byAdding: .day, value: 60, to: start) ?? start
        let testMeetings = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
            .filter { $0.url?.scheme == Self.testMeetingScheme || $0.url?.scheme == Self.legacyTestMeetingScheme }
        let planEvents = existingTrackerCalendar().map { appEvents(in: $0, from: start, days: 60) } ?? []
        do {
            for event in planEvents + testMeetings {
                try store.remove(event, span: .thisEvent, commit: false)
            }
            try store.commit()
        } catch {
            store.reset()
            Self.log.error("Couldn't clear the calendar: \(error.localizedDescription)")
        }
    }

    // MARK: Slot defense

    /// The person's busy times on their other calendars for the synced window,
    /// for slot defense. The fetch runs off the main thread.
    func busyTimes(from storyDay: Date) async -> [Busy] {
        guard prepareStore() else { return [] }
        let reader = BusyReader(store: store)
        let days = Self.window, title = Self.calendarTitle
        return await Task.detached { reader.busy(from: storyDay, days: days, except: title) }.value
    }

    static let testMeetingScheme = "evergreen-demo"
    /// The schemes older builds marked their test meeting with, so one left behind is still cleared.
    static let legacyTestMeetingScheme = "trackerplusplus-demo"

    // MARK: Store and calendar

    private func prepareStore() -> Bool {
        guard access == .on else { return false }
        if !storeHasAccess {
            store = EKEventStore()
            storeHasAccess = true
        }
        return true
    }

    private func existingTrackerCalendar() -> EKCalendar? {
        store.calendars(for: .event).first { $0.title == Self.calendarTitle && $0.allowsContentModifications }
    }

    private func trackerCalendar() throws -> EKCalendar {
        if let calendar = existingTrackerCalendar() { return calendar }
        guard let source = preferredSource() else { throw CalendarSyncError.noSource }
        let calendar = EKCalendar(for: .event, eventStore: store)
        calendar.title = Self.calendarTitle
        calendar.source = source
        // DESIGN.md accent, light mode.
        calendar.cgColor = CGColor(srgbRed: 0x1F / 255, green: 0x6F / 255, blue: 0x5C / 255, alpha: 1)
        try store.saveCalendar(calendar, commit: true)
        Self.log.info("Created the Evergreen calendar on \(source.title)")
        return calendar
    }

    /// iCloud first, so the calendar shows on the person's other devices, then
    /// on the phone itself.
    private func preferredSource() -> EKSource? {
        store.sources.first { $0.sourceType == .calDAV && $0.title == "iCloud" }
            ?? store.sources.first { $0.sourceType == .local }
            ?? store.defaultCalendarForNewEvents?.source
    }

    private func appEvents(in calendar: EKCalendar, from start: Date, days: Int) -> [EKEvent] {
        let end = Calendar.current.date(byAdding: .day, value: days, to: start) ?? start
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: [calendar])
        return store.events(matching: predicate).filter { CalendarEntry.isAppKey($0.url) }
    }
}

private extension CalendarEntry {
    /// The entry an existing app event currently matches.
    init(_ event: EKEvent) {
        self.init(
            key: event.url ?? URL(filePath: "/"),
            title: event.title ?? "",
            notes: event.notes ?? "",
            start: event.startDate,
            end: event.endDate
        )
    }
}

private extension EKEvent {
    func apply(_ entry: CalendarEntry) {
        url = entry.key
        title = entry.title
        notes = entry.notes
        startDate = entry.start
        endDate = entry.end
    }
}
