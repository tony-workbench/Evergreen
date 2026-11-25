import Foundation
import Testing
@testable import Evergreen

/// The home workout: the engine's movements and session read on the phone,
/// the log kept as the person left it, and finishing marking the day done.
struct WorkoutContentTests {
    let engine = BundleContent(bundle: AppModel.planBundle)

    @Test func everyMovementHasItsWordsAndNoPictureYet() async {
        let library = await engine.library()
        #expect(library.count >= 40)
        for move in library {
            #expect(!move.name.isEmpty && !move.setup.isEmpty && !move.pass.isEmpty && !move.feel.isEmpty, "\(move.id)")
            #expect((1...4).contains(move.steps.count), "\(move.id)")
            #expect((move.dose.reps == nil) != (move.dose.seconds == nil), "\(move.id)")
        }
    }

    @Test func aFirstSessionFitsTheRulesAndUsesOnlyWhatThePersonHas() async throws {
        var rules = UserRules()
        rules.isOn = true
        rules.equipment = []
        let library = await engine.library()
        let content = try #require(await engine.session(.init(id: "home-1", focus: "full", minutes: 25), basis: .init(rules: rules, log: WorkoutLog()), turn: 0))
        #expect(content.sessionId == "home-1")
        #expect(content.minutes <= 25)
        #expect(content.items.count >= 3)
        for item in content.items {
            let move = try #require(library.first { $0.id == item.movementId })
            #expect(move.equipment.allSatisfy { ["floor", "wall"].contains($0) }, "\(move.id)")
            #expect(!item.isNew)
        }
    }

    @Test func soreAtFourTakesASetOff() async throws {
        var rules = UserRules()
        rules.isOn = true
        var log = WorkoutLog()
        let usual = try #require(await engine.session(.init(id: nil, focus: "full", minutes: 40), basis: .init(rules: rules, log: log), turn: 0))
        log.lastPain = 4
        let eased = try #require(await engine.session(.init(id: nil, focus: "full", minutes: 40), basis: .init(rules: rules, log: log), turn: 0))
        #expect(eased.items.map(\.sets) == usual.items.map { max(1, $0.sets - 1) })
    }

    @Test func theLogComesBackAndMarksTheDayDone() throws {
        let defaults = try #require(UserDefaults(suiteName: "WorkoutContentTests"))
        defaults.removePersistentDomain(forName: "WorkoutContentTests")
        var log = WorkoutLog()
        log.record(day: "2026-11-30", results: [WorkoutResult(movementId: "sit_to_stand", sets: [12, 12, 11]),
                                                WorkoutResult(movementId: "backpack_row", sets: [], load: 4)], pain: 2)
        log.save(to: defaults)
        let back = WorkoutLog.load(from: defaults)
        #expect(back == log)
        #expect(back.entries.count == 1, "a movement with no sets done isn't logged")
        #expect(back.didHomeSession(on: "2026-11-30"))
        #expect(back.lastPain == 2)
        #expect(back.engineHistory.array?.first?["sets"]?.array?.count == 3)
    }

    @Test func halfDoneWorkIsKeptForTheSameDayOnly() throws {
        let defaults = try #require(UserDefaults(suiteName: "WorkoutProgressTests"))
        defaults.removePersistentDomain(forName: "WorkoutProgressTests")
        let content = WorkoutContent(sessionId: nil, focus: "full", minutes: 20,
                                     items: [.init(movementId: "sit_to_stand", sets: 3, reps: [8, 12], rest: 60, isNew: false)])
        WorkoutProgress(day: "2026-11-30", content: content, index: 0, results: [WorkoutResult(movementId: "sit_to_stand", sets: [10])],
                        startedAt: Date(timeIntervalSince1970: 0)).save(to: defaults)
        #expect(WorkoutProgress.load(from: defaults, day: "2026-11-30")?.results.first?.sets == [10])
        #expect(WorkoutProgress.load(from: defaults, day: "2026-12-01") == nil)
    }

    @Test func aMovementsTargetReadsPlainly() {
        let item = WorkoutContent.Item(movementId: "side_plank", sets: 2, seconds: [20, 30], rest: 45, isNew: false)
        #expect(item.target(sides: 2) == "20–30 seconds each side")
        #expect(WorkoutContent.Item(movementId: "x", sets: 3, reps: [8, 12], rest: 60, isNew: false).target(sides: 1) == "8–12 reps")
    }

    @Test func theBackpackIsSaidInLitresOfWater() {
        #expect(BackpackWater.words(4) == "4 litres of water in the backpack (two 2-litre bottles)")
        #expect(BackpackWater.words(3) == "3 litres of water in the backpack (one 2-litre bottle and one 1-litre bottle)")
        #expect(BackpackWater.words(1) == "1 litre of water in the backpack")
    }

    @Test func tooHardKeepsOneKiloOffTooEasyAddsTwoAndAnythingElseLetsTheUsualStepCarryOn() {
        var log = WorkoutLog()
        log.loads["backpack_row"] = 3
        var hard = WorkoutResult(movementId: "backpack_squat", sets: [8], load: 3)
        hard.tooHard = true
        log.settleLoads([hard, WorkoutResult(movementId: "backpack_row", sets: [12, 12], load: 3)], feeling: .right)
        #expect(log.loads["backpack_squat"] == 3)      // the page already took the kilogram off: not two
        #expect(log.loads["backpack_row"] == nil)      // used once, so the usual step up applies again
        let finding = WorkoutResult(movementId: "backpack_press", sets: [10], load: 11, calibrating: true)
        log.settleLoads([finding], feeling: .easy)
        #expect(log.loads["backpack_press"] == 12)     // no more than a backpack holds
    }

    @Test func tooEasyAtTheEndRaisesTheBackpackOnlyWhileItsWeightIsBeingFound() {
        var log = WorkoutLog()
        let finding = WorkoutResult(movementId: "backpack_squat", sets: [10], load: 3, calibrating: true)
        let known = WorkoutResult(movementId: "backpack_row", sets: [12], load: 3, calibrating: false)
        log.settleLoads([finding, known], feeling: .easy)
        #expect(log.loads["backpack_squat"] == 5, "the first time with the backpack: two kilograms more")
        #expect(log.loads["backpack_row"] == nil, "after that only the usual kilogram a session, from the engine")
    }

    @Test func aBackpackWeightIsKeptFromTheLogOnceASessionLoggedIt() {
        var log = WorkoutLog()
        #expect(log.savedLoad("backpack_squat") == nil)
        log.record(day: "2026-11-18", results: [WorkoutResult(movementId: "backpack_squat", sets: [10], load: 4)], pain: nil)
        #expect(log.savedLoad("backpack_squat") == 4)
        log.loads["backpack_squat"] = 3
        #expect(log.savedLoad("backpack_squat") == 3, "the weight set for next time comes first")
    }

    @Test func tooEasyOnOneBackpackMovementRaisesOnlyThatOne() {
        var log = WorkoutLog()
        var easy = WorkoutResult(movementId: "backpack_row", sets: [15, 15], load: 5)
        easy.tooEasy = true                             // the page already added two kilograms: 3 became 5
        log.settleLoads([easy, WorkoutResult(movementId: "backpack_squat", sets: [10], load: 4)], feeling: .right)
        #expect(log.loads["backpack_row"] == 5)
        #expect(log.loads["backpack_squat"] == nil, "the other backpack movement isn't raised")
        log.settleLoads([easy], feeling: .easy)
        #expect(log.loads["backpack_row"] == 5, "the end-of-session answer doesn't add two more on top")
    }

    @Test func tooHardAndTooEasyChangeTheBackpackOnTheMovementOnScreen() {
        let item = WorkoutContent.Item(movementId: "backpack_row", sets: 3, reps: [8, 12], load: 3, rest: 60, isNew: false)
        var progress = WorkoutProgress(day: "2026-11-19", content: WorkoutContent(sessionId: nil, focus: "upper", minutes: 20, items: [item]),
                                       results: [WorkoutResult(movementId: "backpack_row")], startedAt: Date())
        #expect(progress.backpackLoad == 3)
        #expect(progress.backpackTooHard() == 2 && progress.results[0].tooHard)
        #expect(progress.backpackTooHard() == 1 && progress.backpackTooHard() == 1, "never below a litre")
        #expect(progress.backpackTooEasy() == 3 && progress.results[0].tooEasy == true && !progress.results[0].tooHard)
        progress.results[0].load = 12
        #expect(progress.backpackTooEasy() == nil && progress.results[0].load == 12, "no more than a backpack holds")
        var bodyweight = progress
        bodyweight.content.items[0].load = nil
        bodyweight.results[0].load = nil
        #expect(bodyweight.backpackTooHard() == nil)
    }
}
