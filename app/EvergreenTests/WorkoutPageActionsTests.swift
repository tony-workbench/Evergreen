import Foundation
import Testing
@testable import Evergreen

/// The workout page's buttons as the model does them (Model/AppModel+WorkoutPage.swift): "Too hard" marks "can't do"
/// below the range and leaves the harder one out otherwise, a backpack drops a kilogram (or takes two more with "Too easy")
/// only while its weight is being found, "Not yet" goes back without marking anything, a set and moving on are kept as they
/// go, and the week table's time choices. A rule a button changes is in the model at once; `pageSaved()` waits for its save.
/// Thursday 19 November 2026, Los Angeles.
@MainActor
struct WorkoutPageActionsTests {
    private func rig() async throws -> AppRig {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        rig.model.userRules.isOn = true
        await rig.model.loadMovements()
        return rig
    }

    /// A backpack squat whose weight was found in an earlier session (kept in the log): no longer calibrating.
    private func calibrated(_ rig: AppRig, kg: Double) {
        rig.model.workoutLog.loads["backpack_squat"] = kg
    }

    private func savedRules(_ rig: AppRig) async -> UserRules {
        await rig.model.pageSaved()
        return UserRules.load(from: rig.settings)
    }

    @Test func tooHardBelowTheRangeMarksCantDoAndSwapsToTheEasierOne() async throws {
        let rig = try await rig()
        var progress = try rig.oneMovementSession("knee_push_up", sets: [3])
        let note = rig.model.tooHard(&progress, entered: 8)
        // The set done stays with the first movement; the easier one comes after it, on screen.
        #expect(progress.content.items.first?.movementId == "knee_push_up" && progress.content.items.first?.sets == 1)
        #expect(progress.pageItem?.movementId == "table_push_up")
        #expect(progress.results.first?.tooHard == true)
        #expect(note?.contains("can’t do yet") == true)
        // In the rules at once, before anything is saved: the swap list reads it now.
        #expect(rig.model.userRules.state(of: "knee_push_up") == .cannot)
        #expect(!rig.model.userRules.avoid.contains("knee_push_up"))
        #expect(await savedRules(rig).state(of: "knee_push_up") == .cannot)
    }

    @Test func tooHardInTheRangeLeavesTheHarderOneOutAndRemembers() async throws {
        let rig = try await rig()
        var progress = try rig.oneMovementSession("knee_push_up")
        _ = rig.model.tooHard(&progress, entered: 8)
        #expect(progress.pageItem?.movementId == "table_push_up")
        #expect(progress.content.items.count == 1, "nothing done yet: the easier one takes its place")
        #expect(rig.model.userRules.avoid.contains("knee_push_up"))
        #expect(rig.model.userRules.state(of: "knee_push_up") == .untried)
        let saved = await savedRules(rig)
        #expect(saved.avoid.contains("knee_push_up") && saved.state(of: "knee_push_up") == .untried)
    }

    @Test func aCantDoMovementIsNeverOfferedAsASwap() async throws {
        let rig = try await rig()
        rig.model.userRules.setState(.cannot, of: "knee_push_up")
        // Even with the harder one earned, one marked "can't do" isn't offered.
        rig.model.closedMovements = []
        let table = try #require(rig.model.movement("table_push_up"))
        #expect(!rig.model.swapChoices(for: table).map(\.id).contains("knee_push_up"))
        let push = try #require(rig.model.movement("push_up"))
        #expect(rig.model.openEasier(than: push)?.id == "table_push_up", "the easier one marked can't do is passed over")
    }

    @Test func aBackpackDropsAKiloWhileItCanThenCantDoAtTheLeastBelowTheRange() async throws {
        let rig = try await rig()
        var heavy = try rig.oneMovementSession("backpack_squat", load: 4)
        #expect(rig.model.tooHard(&heavy, entered: 2)?.contains("One litre less") == true)
        #expect(heavy.pageResult?.load == 3)
        #expect(heavy.pageItem?.movementId == "backpack_squat", "a lighter backpack, the same movement")
        var least = try rig.oneMovementSession("backpack_squat", sets: [3], load: BackpackWater.leastKg)
        _ = rig.model.tooHard(&least, entered: 8)
        #expect(least.content.items.last?.movementId == "bodyweight_squat")
        #expect(rig.model.userRules.state(of: "backpack_squat") == .cannot)
        #expect(await savedRules(rig).state(of: "backpack_squat") == .cannot)
    }

    // MARK: Calibrating a backpack (plan 5.C)

    @Test func whileCalibratingTooHardDropsAKiloAndMarksNothing() async throws {
        let rig = try await rig()
        var progress = try rig.oneMovementSession("backpack_squat", sets: [3], load: 5)
        let result = try #require(progress.pageResult)
        #expect(rig.model.isCalibrating(result), "no weight kept from an earlier session")
        #expect(rig.model.tooHard(&progress, entered: 2)?.contains("One litre less") == true)
        #expect(progress.pageResult?.load == 4)
        #expect(rig.model.userRules.state(of: "backpack_squat") == .untried && !rig.model.userRules.avoid.contains("backpack_squat"))
    }

    @Test func whileCalibratingTooEasyAddsTwoKilos() async throws {
        let rig = try await rig()
        var progress = try rig.oneMovementSession("backpack_squat", load: 4)
        #expect(rig.model.offersTooEasy(progress))
        #expect(rig.model.tooEasy(&progress)?.contains("Two litres more") == true)
        #expect(progress.pageResult?.load == 6 && progress.pageResult?.tooEasy == true)
    }

    @Test func afterCalibrationTooHardBelowTheRangeMarksCantDo() async throws {
        let rig = try await rig()
        calibrated(rig, kg: 5)
        var progress = try rig.oneMovementSession("backpack_squat", sets: [3], load: 5)
        let result = try #require(progress.pageResult)
        #expect(!rig.model.isCalibrating(result))
        let low = try #require(progress.pageItem).low
        let note = rig.model.tooHard(&progress, entered: low - 1)
        #expect(note?.contains("can’t do yet") == true, "no kilogram dropped once the weight was found")
        #expect(progress.results.first?.load == 5)
        #expect(progress.pageItem?.movementId == "bodyweight_squat")
        #expect(rig.model.userRules.state(of: "backpack_squat") == .cannot)
        #expect(await savedRules(rig).state(of: "backpack_squat") == .cannot)
    }

    @Test func afterCalibrationTooHardInTheRangeSwapsToTheEasierOneAndLeavesItOut() async throws {
        let rig = try await rig()
        calibrated(rig, kg: 5)
        var progress = try rig.oneMovementSession("backpack_squat", load: 5)
        let low = try #require(progress.pageItem).low
        _ = rig.model.tooHard(&progress, entered: low)
        #expect(progress.pageItem?.movementId == "bodyweight_squat")
        #expect(rig.model.userRules.avoid.contains("backpack_squat"))
        #expect(rig.model.userRules.state(of: "backpack_squat") == .untried)
        #expect(await savedRules(rig).avoid.contains("backpack_squat"))
    }

    @Test func tooEasyIsHiddenOnceTheWeightWasFound() async throws {
        let rig = try await rig()
        calibrated(rig, kg: 5)
        var progress = try rig.oneMovementSession("backpack_squat", load: 5)
        #expect(!rig.model.offersTooEasy(progress))
        #expect(rig.model.tooEasy(&progress) == nil)
        #expect(progress.pageResult?.load == 5)
        // A movement without a backpack never offers it.
        let push = try rig.oneMovementSession("knee_push_up")
        #expect(!rig.model.offersTooEasy(push))
    }

    @Test func calibratingIsDecidedWhenTheSessionStarts() async throws {
        let rig = try await rig()
        let content = try rig.oneMovementSession("backpack_squat", load: 4).content
        let started = try #require(rig.model.startingResults(content).first)
        #expect(started.calibrating == true)
        // A weight kept during the session (another session finished meanwhile) doesn't end this session's calibrating.
        calibrated(rig, kg: 4)
        #expect(rig.model.isCalibrating(started))
        #expect(rig.model.startingResults(content).first?.calibrating == false, "the next session starts with the weight found")
    }

    @Test func finishingMarksABackpackBelowTheRangeOnlyOnceItsWeightWasFound() async throws {
        let rig = try await rig()
        rig.model.writeStrength = { _, _ in false }
        var finding = try rig.oneMovementSession("backpack_squat", sets: [1], load: 5)
        finding.results[0].calibrating = true
        await rig.model.finishWorkout(finding, pain: nil, feeling: nil)
        #expect(rig.model.userRules.state(of: "backpack_squat") == .untried, "while finding the weight, a low set lowers the weight")

        let later = try await self.rig()
        later.model.writeStrength = { _, _ in false }
        calibrated(later, kg: 5)
        let found = try later.oneMovementSession("backpack_squat", sets: [1], load: 5)
        await later.model.finishWorkout(found, pain: nil, feeling: nil)
        #expect(later.model.userRules.state(of: "backpack_squat") == .cannot)
    }

    @Test func stepsComeAsThreeShortLinesFromTheThirdTime() async throws {
        let rig = try await rig()
        #expect(!rig.model.showsShortSteps("glute_bridge"))
        rig.model.workoutLog.record(day: "2026-11-16", results: [WorkoutResult(movementId: "glute_bridge", sets: [12])], pain: nil)
        #expect(!rig.model.showsShortSteps("glute_bridge"), "done once")
        rig.model.workoutLog.record(day: "2026-11-17", results: [WorkoutResult(movementId: "glute_bridge", sets: [12, 12])], pain: nil)
        #expect(rig.model.showsShortSteps("glute_bridge"), "done twice before: the third time is short")
    }

    @Test func notYetGoesBackWithoutCountingAsAFailure() async throws {
        let rig = try await rig()
        var progress = try rig.oneMovementSession("push_up")
        let move = try #require(rig.model.movement("push_up"))
        #expect(rig.model.notYet(&progress, move: move) != nil)
        #expect(progress.pageItem?.movementId == "knee_push_up")
        #expect(progress.pageResult?.swappedFrom == "push_up")
        #expect(progress.results.allSatisfy { !$0.tooHard })
        #expect(rig.model.userRules.state(of: "push_up") == .untried && !rig.model.userRules.avoid.contains("push_up"))
    }

    @Test func aSetLoggedAndMovingOnAreKeptAsTheyGo() async throws {
        let rig = try await rig()
        var progress = try rig.oneMovementSession("glute_bridge")
        #expect(!rig.model.logSet(&progress, count: 12))
        #expect(WorkoutProgress.load(from: rig.settings, day: rig.model.todayISO)?.results.first?.sets == [12])
        #expect(rig.model.advance(&progress), "the only movement: the page goes to the end")
    }

    @Test func theWeekTablesTimeChoicesKeepAPickNoLongerAmongTheTimes() throws {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        let zone = Fixture.calendar.timeZone
        let day = HomeWeek.Day(day: rig.model.todayISO, weekday: "Thursday", kind: .home, focus: "full",
                               first: LocalTime(Clocks.morning.addingTimeInterval(3600), in: zone),
                               fallbacks: [LocalTime(Clocks.morning.addingTimeInterval(7200), in: zone)])
        let times = rig.model.pickableTimes(day, picked: nil)
        #expect(times.count == 2)
        #expect(rig.model.pickableTimes(day, picked: times[0]) == times, "a pick among the times adds nothing")
        #expect(rig.model.pickableTimes(day, picked: "23:59") == times + ["23:59"])
        rig.model.workoutLog.skip(day.day, reason: "not_today")
        #expect(rig.model.pickableTimes(day, picked: nil).isEmpty, "a skipped day has nothing to pick")
    }
}

private extension AppRig {
    /// A session holding just `id`, at its own dose, with `sets` already done.
    /// The calibrating mark is left out (nil), as in a session saved by an older build: it is then read from the log.
    func oneMovementSession(_ id: String, sets: [Int] = [], load: Double? = nil) throws -> WorkoutProgress {
        let move = try #require(model.movement(id))
        let item = WorkoutContent.Item(movementId: id, sets: move.dose.sets, reps: move.dose.reps, seconds: move.dose.seconds,
                                       load: load, rest: move.rest, isNew: false)
        return WorkoutProgress(day: model.todayISO, content: WorkoutContent(focus: "full", minutes: 20, items: [item]),
                               results: [WorkoutResult(movementId: id, sets: sets, load: load)], startedAt: model.now)
    }
}
