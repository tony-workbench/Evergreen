import Foundation
import Testing
@testable import Evergreen

/// How the plan becomes Evergreen calendar events, and what a sync
/// creates, moves and deletes. EventKit itself is checked on the phone.
struct CalendarSyncTests {
    private let eveningWalk = PlanItem(
        id: "evening-walk",
        slot: Slot(start: Fixture.at(18, 30), end: Fixture.at(18, 45), activityType: "Walking")
    )

    private func entries(_ plan: [PlanItem]) -> [CalendarEntry] {
        CalendarEntry.entries(.init(plan: plan, storyDay: Fixture.storyDay, calendar: Fixture.calendar))
    }

    // MARK: Entries

    @Test func eachPlanItemIsKeyedByStoryDayAndId() {
        let keys = entries([Fixture.lunchWalk, eveningWalk]).map(\.key.absoluteString)

        #expect(keys == [
            "evergreen://plan/2026-11-19/plan-walk",
            "evergreen://plan/2026-11-19/evening-walk",
        ])
    }

    @Test func theTitleIsTheActivity() {
        #expect(entries([Fixture.lunchWalk, Fixture.fridayElliptical]).map(\.title) == ["Walk", "Elliptical"])
    }

    @Test func notesSayOnlyThatEvergreenPlannedIt() {
        let entry = entries([eveningWalk])[0]

        // Only that: the reason stays in the app, and nothing about the person is written into the calendar.
        #expect(entry.notes == "Planned by Evergreen.")
        #expect(entry.start == Fixture.at(18, 30))
        #expect(entry.end == Fixture.at(18, 45))
    }

    // MARK: Changes

    @Test func missingEventsAreCreated() {
        let changes = CalendarChanges<Int>(desired: entries([Fixture.lunchWalk, eveningWalk]), existing: [])

        #expect(changes.create.map(\.title) == ["Walk", "Walk"])
        #expect(changes.update.isEmpty)
        #expect(changes.delete.isEmpty)
    }

    @Test func matchingEventsAreLeftAlone() {
        let current = entries([Fixture.lunchWalk, eveningWalk])
        let changes = CalendarChanges(desired: current, existing: [(id: 0, entry: current[0]), (id: 1, entry: current[1])])

        #expect(changes.isEmpty)
    }

    @Test func aMovedItemUpdatesItsEvent() {
        let before = entries([eveningWalk])[0]
        var moved = eveningWalk
        moved.slot = Slot(start: Fixture.at(20, 30), end: Fixture.at(20, 45), activityType: "Walking")
        let after = entries([moved])

        let changes = CalendarChanges(desired: after, existing: [(id: 7, entry: before)])

        #expect(changes.update == [.init(event: 7, entry: after[0])])
        #expect(changes.create.isEmpty)
        #expect(changes.delete.isEmpty)
    }

    @Test func aWorkoutTakenOffThePlanDeletesItsEvent() {
        let current = entries([Fixture.lunchWalk, eveningWalk])
        let changes = CalendarChanges(
            desired: entries([Fixture.lunchWalk]),
            existing: [(id: 0, entry: current[0]), (id: 1, entry: current[1])]
        )

        #expect(changes.delete == [1])
        #expect(changes.create.isEmpty)
        #expect(changes.update.isEmpty)
    }

    @Test func aDuplicateEventIsDeleted() {
        let walk = entries([Fixture.lunchWalk])
        let changes = CalendarChanges(desired: walk, existing: [(id: 0, entry: walk[0]), (id: 1, entry: walk[0])])

        #expect(changes.delete == [1])
        #expect(changes.create.isEmpty)
    }

    @Test func anotherStoryDaysEventIsReplaced() {
        let yesterday = CalendarEntry.entries(.init(
            plan: [Fixture.lunchWalk],
            storyDay: Fixture.calendar.date(byAdding: .day, value: -1, to: Fixture.storyDay)!,
            calendar: Fixture.calendar
        ))
        let changes = CalendarChanges(desired: entries([Fixture.lunchWalk]), existing: [(id: 3, entry: yesterday[0])])

        #expect(changes.delete == [3])
        #expect(changes.create.map(\.key.absoluteString) == ["evergreen://plan/2026-11-19/plan-walk"])
    }

    /// Events written before the rename from Tracker++ are still the app's own:
    /// a sync deletes the old-key event and writes the new one, so nothing doubles.
    @Test func anEventFromBeforeTheRenameIsReplaced() throws {
        let walk = entries([Fixture.lunchWalk])[0]
        let oldKey = try #require(URL(string: "trackerplusplus://plan/2026-11-19/plan-walk"))
        #expect(CalendarEntry.isAppKey(oldKey))
        #expect(!CalendarEntry.isAppKey(URL(string: "https://example.com")))

        let old = CalendarEntry(key: oldKey, title: walk.title, notes: walk.notes, start: walk.start, end: walk.end)
        let changes = CalendarChanges(desired: [walk], existing: [(id: 7, entry: old)])

        #expect(changes.delete == [7])
        #expect(changes.create == [walk])
    }
}
