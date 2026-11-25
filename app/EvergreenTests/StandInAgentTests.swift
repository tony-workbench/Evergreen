import Foundation
import Testing
@testable import Evergreen

/// The rules behind the agent card: which planned workouts are done, and
/// which workouts count as one.
struct StandInAgentTests {
    let agent = StandInAgent()

    // MARK: Misses and completions

    @Test func aMissedWorkoutGetsNoAction() {
        let response = agent.tick(Fixture.snapshot(now: Fixture.at(13, 30), plan: [Fixture.lunchWalk]))

        #expect(response.actions.isEmpty)
        #expect(response.completions.isEmpty)
    }

    @Test func finishingAPlannedWorkoutCompletesIt() {
        let walk = Fixture.workout("demo-walk", at: Fixture.at(12), minutes: 30, source: .demo)

        let response = agent.tick(Fixture.snapshot(
            now: Fixture.at(12, 40), plan: [Fixture.lunchWalk], workouts: Fixture.samHistory + [walk]
        ))

        #expect(response.completions == [Completion(planItemId: Fixture.lunchWalk.id, workoutId: "demo-walk")])
    }

    // MARK: Duplicates

    @Test func overlappingSameTypeWorkoutsCountOnceKeepingTheLonger() {
        let watch = Fixture.workout("watch", at: Fixture.at(19), minutes: 30)
        let phone = Fixture.workout("phone", at: Fixture.at(19, 5), minutes: 20)

        #expect(StandInAgent.mergeDuplicates([phone, watch]).map(\.id) == ["watch"])
    }

    @Test func overlappingDifferentTypesBothCount() {
        let walk = Fixture.workout("walk", at: Fixture.at(19), minutes: 30)
        let strength = Fixture.workout("strength", at: Fixture.at(19, 5), minutes: 20, type: "TraditionalStrengthTraining")

        #expect(Set(StandInAgent.mergeDuplicates([walk, strength]).map(\.id)) == ["walk", "strength"])
    }
}
