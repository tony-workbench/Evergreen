import Foundation
import Testing
import UserNotifications
@testable import Evergreen

/// The workout page's states (none today, worked out, couldn't be worked out, done), "Swap" and "Too hard" on the
/// movement chain, and a tap on a reminder opening the page. Thursday 19 November 2026, Los Angeles.
@MainActor
struct WorkoutPageTests {
    private func rig(focus: String?, kind: DayKind = .home) throws -> AppRig {
        let rig = try AppRig(history: AppRig.runs(days: 0, before: Clocks.morning))
        rig.model.userRules.isOn = true
        rig.model.dayKinds = [rig.model.todayISO: kind]
        if let focus { rig.settings.set([rig.model.todayISO: focus], forKey: AppModel.homeFocusKey) }
        return rig
    }

    @Test func aDayOutHasNoWorkoutAndIsNotAnError() async throws {
        let today = try await rig(focus: "full", kind: .out).model.workoutToday()
        #expect(today.progress == nil && !today.failed)
    }

    @Test func aDayAtHomeGetsItsSessionAndKeepsIt() async throws {
        let rig = try rig(focus: "full")
        let first = await rig.model.workoutToday()
        #expect(first.progress?.content.items.isEmpty == false && !first.failed)
        let again = await rig.model.workoutToday()
        #expect(again.progress == first.progress, "opening the page again picks up the same session")
    }

    @Test func aSessionThatCantBeWorkedOutSaysSoSoThePageOffersTryAgain() async throws {
        let today = try await rig(focus: "not_a_focus").model.workoutToday()
        #expect(today.progress == nil && today.failed)
    }

    @Test func aDayAlreadyDoneHasNothingToStart() async throws {
        let rig = try rig(focus: "full")
        rig.model.workoutLog.markDoneAnotherWay(rig.model.todayISO)
        let today = await rig.model.workoutToday()
        #expect(today.progress == nil && !today.failed)
    }

    @Test func swapOffersOnlyTheNeighboursOnTheChain() async throws {
        let rig = try rig(focus: "full")
        await rig.model.loadMovements()
        let middle = try #require(rig.model.movements.first { $0.easier != nil && $0.harder != nil })
        let choices = rig.model.swapChoices(for: middle).map(\.id)
        #expect(Set(choices).isSubset(of: [middle.easier, middle.harder].compactMap { $0 }))
        #expect(choices.allSatisfy { id in rig.model.movement(id).map(rig.model.isOpen) == true })
    }

    @Test func tooHardLeavesTheHarderOneOutFromNowOn() async throws {
        let rig = try rig(focus: "full")
        await rig.model.leaveOut("push_up")
        #expect(rig.model.userRules.avoid.contains("push_up"))
        await rig.model.leaveOut("push_up")
        #expect(rig.model.userRules.avoid.filter { $0 == "push_up" }.count == 1)
    }

    @Test func theWeekTableKeepsTheDaysAlreadyPastThisWeek() async throws {
        let rig = try rig(focus: "full")
        PlannedDays(days: ["2026-11-14", "2026-11-16", "2026-11-17", "2026-11-18"]).save(to: rig.settings)
        rig.settings.set(["2026-11-16": "lower", "2026-11-17": "upper"], forKey: AppModel.homeFocusKey)
        rig.model.workoutLog.markDoneAnotherWay("2026-11-16")
        rig.model.workoutLog.skip("2026-11-17", reason: "not_today")
        let earlier = rig.model.earlierThisWeek
        #expect(earlier.map(\.day) == ["2026-11-16", "2026-11-17", "2026-11-18"], "Monday to yesterday, not last week")
        #expect(earlier.map(\.outcome) == [.done, .skipped, .missed])
        #expect(earlier.first?.focus == "lower")
    }

    @Test func aSkipTappedOnAReminderAfterMidnightCanBeTakenBack() async throws {
        let rig = try rig(focus: "full")
        PlannedDays(days: ["2026-11-18"]).save(to: rig.settings)
        // Wednesday's last reminder, skipped from the lock screen early on Thursday.
        await rig.model.handleWorkoutAction(.skipNotToday, day: "2026-11-18")
        #expect(rig.model.earlierThisWeek.map(\.outcome) == [.skipped])
        await rig.model.unskipDay("2026-11-18")
        #expect(!rig.model.workoutLog.didSkip("2026-11-18"))
        #expect(rig.model.earlierThisWeek.map(\.outcome) == [.missed])
    }

    @Test func aTapOnAReminderOpensTheWorkoutPage() async throws {
        let tap = UNNotificationDefaultActionIdentifier
        #expect(Notifier.route(action: tap, day: "2026-11-19", kind: "now", move: nil) == .workout(.start, day: "2026-11-19"))
        #expect(Notifier.route(action: tap, day: "2026-11-19", kind: "ask", move: nil) == .workout(.start, day: "2026-11-19"))
        #expect(Notifier.route(action: tap, day: "2026-11-20", kind: "evening", move: nil) == .open)
        #expect(Notifier.route(action: tap, day: nil, kind: nil, move: nil) == .open)
        #expect(Notifier.route(action: "pick|18:10", day: "2026-11-19", kind: "evening", move: nil) == .pick("18:10", day: "2026-11-19"))
        #expect(Notifier.route(action: "already_done", day: "2026-11-19", kind: "now", move: nil) == .workout(.alreadyDone, day: "2026-11-19"))
        // Start on today's reminder asks Today to open the page; on another day's it doesn't.
        let rig = try rig(focus: "full")
        await rig.model.handleWorkoutAction(.start, day: "2026-11-20")
        #expect(!rig.model.workoutRequested)
        await rig.model.handleWorkoutAction(.start, day: rig.model.todayISO)
        #expect(rig.model.workoutRequested)
    }
}
