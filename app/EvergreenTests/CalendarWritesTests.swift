import Foundation
import Testing
@testable import Evergreen

/// What lands on the Evergreen calendar when the person adds, undoes, moves,
/// cancels and resizes a workout. The calendar is a recording one that keeps
/// its events the way the device's does; nothing touches EventKit.
@MainActor
struct CalendarWritesTests {
    @Test func addToPlanCreatesOneEntryASecondTapCreatesNoneAndUndoDeletesIt() async throws {
        let rig = try AppRig()
        let model = rig.model, calendar = rig.calendar
        try await model.loadWeekPlan()
        let session = try #require(model.topSuggestion)
        // A suggestion alone writes nothing.
        #expect(calendar.events.isEmpty && calendar.created.isEmpty)

        await model.accept(session)
        let item = try #require(model.plan.first { $0.id == session.id })
        #expect(calendar.created.count == 1 && calendar.events.count == 1)
        let event = try #require(calendar.event(for: item.id))
        #expect(event.start == item.slot.start && event.end == item.slot.end && event.title == "Run")

        // A second tap on the same suggestion.
        await model.accept(session)
        model.addToPlan(session)
        await model.tick()
        #expect(calendar.created.count == 1 && calendar.events.count == 1 && calendar.updated.isEmpty && calendar.deleted.isEmpty)

        // Undo.
        model.undo(try #require(model.appliedActions.last { $0.id == session.id }))
        #expect(calendar.events.isEmpty && calendar.deleted.map(\.key) == [event.key])
        #expect(calendar.created.count == 1)
    }

    @Test func aConfirmedMoveUpdatesTheEntryAndNothingChangesBeforeConfirm() async throws {
        let rig = try AppRig()
        let model = rig.model, calendar = rig.calendar
        let run = try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        let before = try #require(calendar.event(for: run.id))
        #expect(calendar.created.count == 1 && before.start == run.slot.start)

        let later = run.slot.start.addingTimeInterval(3 * 3600)
        await model.dragWorkout(run, to: later)
        // A preview only: the calendar still has it at 7.
        #expect(model.placement != nil && calendar.event(for: run.id) == before && calendar.updated.isEmpty)

        await model.confirmPlacement()
        let after = try #require(calendar.event(for: run.id))
        #expect(after.start == later && after.end == later.addingTimeInterval(40 * 60) && after.key == before.key)
        #expect(calendar.updated.count == 1 && calendar.events.count == 1 && calendar.created.count == 1 && calendar.deleted.isEmpty)
    }

    @Test func aConfirmedCancelDeletesTheEntry() async throws {
        let rig = try AppRig()
        let model = rig.model, calendar = rig.calendar
        let run = try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        let event = try #require(calendar.event(for: run.id))
        model.askWithoutModel = true

        await model.askEvergreen("Cancel tomorrow’s run")
        // Asked, not confirmed: still on the calendar.
        #expect(model.placement != nil && calendar.events == [event] && calendar.deleted.isEmpty)

        await model.confirmPlacement()
        #expect(calendar.events.isEmpty && calendar.deleted == [event] && calendar.updated.isEmpty && calendar.created.count == 1)
    }

    @Test func aConfirmedResizeChangesTheEntrysEndAndLeavesItsStart() async throws {
        let rig = try AppRig()
        let model = rig.model, calendar = rig.calendar
        let run = try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        model.askWithoutModel = true

        await model.askEvergreen("Shorten tomorrow’s run to 20 minutes")
        #expect(calendar.event(for: run.id)?.end == run.slot.end)
        await model.confirmPlacement()
        let event = try #require(calendar.event(for: run.id))
        #expect(event.start == run.slot.start && event.end == run.slot.start.addingTimeInterval(20 * 60))
        #expect(calendar.updated.count == 1 && calendar.events.count == 1 && calendar.created.count == 1 && calendar.deleted.isEmpty)
    }

    @Test func withCalendarAccessOffThePlanStaysInTheAppAndNothingIsWritten() async throws {
        let rig = try AppRig(.init(calendarAccess: .off))
        let run = try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        #expect(rig.model.plan.map(\.id) == [run.id] && rig.model.calendarAccess == .off)
        #expect(rig.calendar.events.isEmpty && rig.calendar.created.isEmpty)
        // Turning it on puts the plan there.
        await rig.model.requestCalendarAccess()
        #expect(rig.calendar.events.count == 1 && rig.calendar.event(for: run.id)?.start == run.slot.start)
    }
}
