import Foundation
import Testing
@testable import Evergreen

/// A meeting lands on a planned workout, through the app as a whole: the
/// calendar says it changed, the app looks again, moves the workout once to
/// the nearest free time, says so once, and leaves it alone after an Undo.
@MainActor
struct MeetingMoveTests {
    /// Tomorrow's 7:00 run on the plan, and a meeting from 6:45 to 7:45 that lands on it.
    static func rigWithARun() async throws -> (rig: AppRig, run: PlanItem, meeting: Busy) {
        let rig = try AppRig()
        rig.wireTriggers()
        let run = try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        await rig.model.tick()
        #expect(rig.model.plan.first?.slot == run.slot && rig.notices.sent.isEmpty)
        let meeting = Busy(start: run.slot.start.addingTimeInterval(-15 * 60), end: run.slot.start.addingTimeInterval(45 * 60))
        return (rig, run, meeting)
    }

    static func moves(_ model: AppModel) -> [AgentAction] {
        model.appliedActions.filter { $0.planItemId == "the-run" && ($0.kind == .move || $0.kind == .shrink) }
    }

    @Test func aMeetingOnAWorkoutMovesItOnceAndSaysSoOnceAndUndoIsFinal() async throws {
        let (rig, run, meeting) = try await Self.rigWithARun()
        let model = rig.model

        // The meeting appears on the person's calendar, and the calendar says something changed.
        rig.calendar.meetings = [meeting]
        rig.calendar.onChange?()
        try await rig.wait("the move") { !Self.moves(model).isEmpty }
        try await rig.wait("the announcement") { !rig.notices.sent.isEmpty }

        // One move, to right after the meeting, the same length; the calendar entry follows.
        let move = try #require(Self.moves(model).first)
        let after = Slot(start: meeting.end, end: meeting.end.addingTimeInterval(40 * 60), activityType: "Running")
        #expect(Self.moves(model).count == 1 && move.kind == .move && move.before == run.slot && move.after == after)
        let moved = try #require(model.plan.first)
        #expect(model.plan.map(\.slot) == [after] && model.movedAction(for: moved)?.id == move.id)
        #expect(rig.calendar.event(for: "the-run")?.start == meeting.end && rig.calendar.events.count == 1)
        #expect(model.heroAction?.id == move.id)

        // Looking again (another calendar change, the app coming forward) moves nothing more and says nothing more.
        rig.calendar.onChange?()
        await model.tick()
        await model.tick()
        try await Task.sleep(for: .milliseconds(1300))
        #expect(Self.moves(model).count == 1 && model.plan.map(\.slot) == [after])
        #expect(rig.notices.sent.count == 1)
        #expect(rig.notices.sent.first?.body.contains(run.slot.start.clock) == true && rig.notices.sent.first?.body.contains(meeting.end.clock) == true)

        // Undo puts it back, and it is not moved again while the meeting is still there.
        model.undo(move)
        #expect(model.plan.map(\.slot) == [run.slot])
        await model.tick()
        rig.calendar.onChange?()
        try await Task.sleep(for: .milliseconds(1300))
        await model.tick()
        #expect(model.plan.map(\.slot) == [run.slot] && Self.moves(model).count == 1 && model.isUndone(move))
        #expect(rig.calendar.event(for: "the-run")?.start == run.slot.start)
        #expect(rig.notices.sent.count == 1)
    }

    @Test func withMovingAroundMeetingsOffNothingMoves() async throws {
        let (rig, run, meeting) = try await Self.rigWithARun()
        let model = rig.model
        rig.settings.set(false, forKey: Automatic.meetings.rawValue)

        rig.calendar.meetings = [meeting]
        rig.calendar.onChange?()
        try await Task.sleep(for: .milliseconds(1300))
        await model.tick()
        #expect(Self.moves(model).isEmpty && model.plan.map(\.slot) == [run.slot])
        #expect(rig.calendar.event(for: "the-run")?.start == run.slot.start && rig.calendar.updated.isEmpty)
        #expect(rig.notices.sent.isEmpty && model.heroAction == nil)

        // Turned back on, the same meeting moves it.
        rig.settings.set(true, forKey: Automatic.meetings.rawValue)
        await model.tick()
        #expect(Self.moves(model).count == 1 && model.plan.first?.slot.start == meeting.end)
    }
}
