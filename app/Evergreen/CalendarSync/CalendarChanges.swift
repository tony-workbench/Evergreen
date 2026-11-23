import Foundation

/// What it takes to make the calendar match the plan. `EventID` points at an
/// event loaded for this one sync; it's never stored.
struct CalendarChanges<EventID: Hashable>: Equatable {
    struct Update: Equatable {
        let event: EventID
        let entry: CalendarEntry
    }

    private(set) var create: [CalendarEntry] = []
    private(set) var update: [Update] = []
    private(set) var delete: [EventID] = []

    var isEmpty: Bool { create.isEmpty && update.isEmpty && delete.isEmpty }

    /// `existing` is the app's own events (the ones with its URL scheme) in the
    /// synced window. An event whose key the plan no longer has is deleted, and
    /// so is any second event with the same key.
    init(desired: [CalendarEntry], existing: [(id: EventID, entry: CalendarEntry)]) {
        let wanted = Set(desired.map(\.key))
        var kept: [URL: (id: EventID, entry: CalendarEntry)] = [:]
        for event in existing {
            if wanted.contains(event.entry.key), kept[event.entry.key] == nil {
                kept[event.entry.key] = event
            } else {
                delete.append(event.id)
            }
        }
        for entry in desired {
            if let current = kept[entry.key] {
                if current.entry != entry { update.append(Update(event: current.id, entry: entry)) }
            } else {
                create.append(entry)
            }
        }
    }
}
