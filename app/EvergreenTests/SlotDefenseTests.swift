import Foundation
import Testing
@testable import Evergreen

/// Slot defense in the stand-in: a busy time that lands on an upcoming workout
/// moves it, or shrinks it, before it can be missed.
struct SlotDefenseTests {
    let agent = StandInAgent()
    let elliptical = Fixture.fridayElliptical

    private func tick(busy: [Busy], plan: [PlanItem]? = nil, actions: [AgentAction] = [],
                      undone: [String] = [], now: Date = Fixture.at(9)) -> TickResponse {
        agent.tick(Fixture.snapshot(
            now: now, plan: plan ?? [elliptical], actions: actions, undoneActionIds: undone, busy: busy
        ))
    }

    private func slot(_ start: Date, _ end: Date) -> Slot {
        Slot(start: start, end: end, activityType: "Elliptical")
    }

    @Test func aMeetingMovesTheWorkoutToRightAfter() throws {
        let meeting = Fixture.busy(Fixture.at(7, 15, dayOffset: 1), Fixture.at(8, 15, dayOffset: 1))
        let response = tick(busy: [meeting])

        let move = try #require(response.actions.first)
        #expect(response.actions.count == 1)
        #expect(move.kind == .move)
        #expect(move.planItemId == "plan-elliptical")
        #expect(move.before == elliptical.slot)
        #expect(move.after == slot(Fixture.at(8, 15, dayOffset: 1), Fixture.at(8, 40, dayOffset: 1)))
        #expect(move.id == "defend-plan-elliptical-\(Int(meeting.start.timeIntervalSince1970))")
    }

    @Test func whenAfterIsTakenItMovesToRightBefore() throws {
        let response = tick(busy: [
            Fixture.busy(Fixture.at(7, 15, dayOffset: 1), Fixture.at(8, 15, dayOffset: 1)),
            Fixture.busy(Fixture.at(8, 15, dayOffset: 1), Fixture.at(9, 30, dayOffset: 1)),
        ])

        #expect(response.actions.first?.kind == .move)
        #expect(response.actions.first?.after == slot(Fixture.at(6, 50, dayOffset: 1), Fixture.at(7, 15, dayOffset: 1)))
    }

    @Test func whenNothingFitsAtFullLengthItShrinks() throws {
        let response = tick(busy: [
            Fixture.busy(Fixture.at(6, 40, dayOffset: 1), Fixture.at(8, 15, dayOffset: 1)),
            Fixture.busy(Fixture.at(8, 30, dayOffset: 1), Fixture.at(9, 30, dayOffset: 1)),
        ])

        let shrink = try #require(response.actions.first)
        #expect(shrink.kind == .shrink)
        #expect(shrink.after == slot(Fixture.at(8, 15, dayOffset: 1), Fixture.at(8, 30, dayOffset: 1)))
    }

    @Test func whenNothingNearbyIsFreeItStaysPut() throws {
        let response = tick(busy: [Fixture.busy(Fixture.at(6, dayOffset: 1), Fixture.at(10, dayOffset: 1))])

        #expect(response.actions.isEmpty)
    }

    @Test func itDoesntMoveIntoAnotherWorkout() throws {
        let strength = PlanItem(
            id: "plan-strength",
            slot: Slot(start: Fixture.at(8, 15, dayOffset: 1), end: Fixture.at(8, 45, dayOffset: 1), activityType: "Strength")
        )
        let response = tick(
            busy: [Fixture.busy(Fixture.at(7, 15, dayOffset: 1), Fixture.at(8, 15, dayOffset: 1))],
            plan: [elliptical, strength]
        )

        #expect(response.actions.first?.after == slot(Fixture.at(8, 45, dayOffset: 1), Fixture.at(9, 10, dayOffset: 1)))
    }

    @Test func busyTimesThatDontOverlapChangeNothing() throws {
        let response = tick(busy: [Fixture.busy(Fixture.at(9, dayOffset: 1), Fixture.at(10, dayOffset: 1))])

        #expect(response.actions.isEmpty)
    }

    @Test func aWorkoutAlreadyUnderwayIsntMoved() throws {
        // The 12:00 walk with a meeting on it, checked at 12:10: too late to defend.
        let response = tick(
            busy: [Fixture.busy(Fixture.at(11, 45), Fixture.at(12, 45))],
            plan: [Fixture.lunchWalk], now: Fixture.at(12, 10)
        )

        #expect(response.actions.isEmpty)
    }

    @Test func aDefenseIsMadeOnce() throws {
        let meeting = Fixture.busy(Fixture.at(7, 15, dayOffset: 1), Fixture.at(8, 15, dayOffset: 1))
        let first = tick(busy: [meeting])
        let moved = try #require(first.actions.first?.after)
        var plan = elliptical
        plan.slot = moved

        let again = tick(busy: [meeting], plan: [plan], actions: first.actions)

        #expect(again.actions.isEmpty)
    }

    @Test func anUndoneDefenseIsntMadeAgain() throws {
        let meeting = Fixture.busy(Fixture.at(7, 15, dayOffset: 1), Fixture.at(8, 15, dayOffset: 1))
        let id = "defend-plan-elliptical-\(Int(meeting.start.timeIntervalSince1970))"

        let response = tick(busy: [meeting], undone: [id])

        #expect(response.actions.isEmpty)
    }

}
