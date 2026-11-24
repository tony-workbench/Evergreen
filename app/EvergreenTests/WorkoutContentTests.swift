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
        let content = try #require(await engine.session(id: "home-1", focus: "full", minutes: 25, rules: rules, log: WorkoutLog(), turn: 0))
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
        let usual = try #require(await engine.session(id: nil, focus: "full", minutes: 40, rules: rules, log: log, turn: 0))
        log.lastPain = 4
        let eased = try #require(await engine.session(id: nil, focus: "full", minutes: 40, rules: rules, log: log, turn: 0))
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
}
