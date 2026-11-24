import Foundation
import Testing
@testable import Evergreen

/// Workout minutes turn into minutes of social apps, videos and games at each group's rate, after each day's free time.
struct EarnedTimeTests {
    let now = Date(timeIntervalSince1970: 1_795_000_000)

    func span(_ startMinutesAgo: Double, _ minutes: Double) -> (start: Date, end: Date) {
        let start = now.addingTimeInterval(-startMinutesAgo * 60)
        return (start, start.addingTimeInterval(minutes * 60))
    }

    @Test func onlyFinishedWorkoutsSinceTheStartCount() {
        let since = now.addingTimeInterval(-120 * 60)
        let spans = [
            span(100, 30),   // counts
            span(60, 20),    // counts
            span(300, 45),   // before the start
            span(10, 30),    // still going
        ]
        #expect(EarnMath.workoutMinutes(spans, since: since, now: now) == 50)
    }

    @Test func eachGroupBuysAtItsOwnRate() {
        #expect(EarnMath.available(credit: 50, rate: 1) == 50)
        #expect(EarnMath.available(credit: 50, rate: 0.5) == 25)
        #expect(EarnMath.available(credit: 45, rate: 0.5) == 22)
        #expect(EarnMath.available(credit: 0, rate: 2) == 0)
        #expect(EarnMath.available(credit: 10, rate: 0) == 0)
    }

    @Test func spendingFifteenMinutesCostsWorkoutMinutesAtTheRate() {
        #expect(EarnMath.cost(minutes: 15, rate: 1) == 15)
        #expect(EarnMath.cost(minutes: 15, rate: 0.5) == 30)
        #expect(EarnMath.cost(minutes: 15, rate: 3) == 5)
        // What is left after spending buys exactly what the rate says.
        let left = 50 - EarnMath.cost(minutes: 15, rate: 0.5)
        #expect(EarnMath.available(credit: left, rate: 1) == 20)
    }

    @Test func theRelockScheduleStartsWhenTheTimeIsUpAndLastsFifteenMinutes() {
        let window = EarnMath.relockWindow(now: now, minutes: 15)
        #expect(window.start == now.addingTimeInterval(15 * 60))
        #expect(window.end.timeIntervalSince(window.start) == 15 * 60)
        // A short unlock still gets a schedule Screen Time accepts.
        let short = EarnMath.relockWindow(now: now, minutes: 4)
        #expect(short.start == now.addingTimeInterval(4 * 60))
        #expect(short.end.timeIntervalSince(short.start) == 15 * 60)
    }

    @Test func ratesShowWithoutTrailingZeros() {
        #expect(EarnedTimeView.number(1) == "1")
        #expect(EarnedTimeView.number(0.5) == "0.5")
        #expect(EarnedTimeView.number(1.25) == "1.25")
    }

    // MARK: The ledger

    func workout(_ id: String, _ startMinutesAgo: Double, _ minutes: Double) -> (id: String, start: Date, end: Date) {
        let s = span(startMinutesAgo, minutes)
        return (id, s.start, s.end)
    }

    @Test func earnedTimeIsKeptAfterHealthStopsReturningTheWorkout() {
        var ledger = EarnLedger(countsFrom: now.addingTimeInterval(-3 * 3600))
        ledger.count([workout("a", 120, 30), workout("b", 60, 20)], now: now)
        #expect(ledger.earned == 50)
        // A later read no longer has "a" (older than Health's 60 days, or deleted): it stays earned.
        ledger.count([workout("b", 60, 20)], now: now)
        #expect(ledger.earned == 50)
    }

    @Test func theSameWorkoutLoggedTwiceEarnsOnce() {
        var ledger = EarnLedger(countsFrom: now.addingTimeInterval(-3 * 3600))
        ledger.count([workout("hk-1", 90, 40), workout("logged-1", 89, 38), workout("c", 30, 10)], now: now)
        #expect(ledger.earned == 50)
    }

    @Test func theSameWorkoutCountsItsLongerCopyInEitherOrder() {
        var ledger = EarnLedger(countsFrom: now.addingTimeInterval(-3 * 3600))
        ledger.count([workout("logged", 91, 20)], now: now)     // the short copy arrives first
        ledger.count([workout("hk", 90, 40)], now: now)         // then the Health record
        #expect(ledger.earned == 40)
        #expect(Set(ledger.counted.keys) == ["hk"])
        // A later read with both never brings the short copy back.
        ledger.count([workout("logged", 91, 20), workout("hk", 90, 40)], now: now)
        #expect(ledger.earned == 40)
    }

    @Test func oneLongWorkoutReplacesEveryShortCopyItCovers() {
        var ledger = EarnLedger(countsFrom: now.addingTimeInterval(-3 * 3600))
        ledger.count([workout("a", 60, 10), workout("b", 50, 10)], now: now)
        #expect(ledger.earned == 20)
        ledger.count([workout("hk", 60, 20)], now: now)
        #expect(Set(ledger.counted.keys) == ["hk"])
        #expect(ledger.earned == 20)
    }

    @Test func onlyFinishedWorkoutsFromTheStartCount() {
        var ledger = EarnLedger(countsFrom: now.addingTimeInterval(-120 * 60))
        ledger.count([
            workout("before", 150, 45),     // started before counting began
            workout("straddles", 125, 20),  // started before too
            workout("atStart", 120, 10),    // starts exactly at the start
            workout("endsNow", 15, 15),     // ends exactly now
            workout("going", 10, 30),       // still going
            workout("empty", 50, 0),        // no length
        ], now: now)
        #expect(Set(ledger.counted.keys) == ["atStart", "endsNow"])
        #expect(ledger.earned == 25)
    }

    @Test func turningOnAgainKeepsTheStartAndWhatWasCounted() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var ledger = EarnLedger()
        ledger.count([workout("a", 60, 30)], now: now)
        #expect(ledger.earned == 0)   // nothing counts before the first turn-on
        ledger.start(now: now, calendar: calendar)
        #expect(ledger.countsFrom == calendar.startOfDay(for: now))
        ledger.count([workout("a", 60, 30)], now: now)
        ledger.start(now: now.addingTimeInterval(86_400 * 3), calendar: calendar)
        #expect(ledger.countsFrom == calendar.startOfDay(for: now))
        #expect(ledger.earned == 30)
    }

    // MARK: Unlocking

    @Test func anUnlockOpensAtMostFifteenMinutesAndCostsAtTheRate() {
        #expect(EarnMath.spend(credit: 50, rate: 0.5, block: 15)! == (15, 30))
        #expect(EarnMath.spend(credit: 10, rate: 1, block: 15)! == (10, 10))
        #expect(EarnMath.spend(credit: 0.9, rate: 1, block: 15) == nil)
        #expect(EarnMath.spend(credit: 15, rate: 0.2, block: 15)! == (3, 15))
        #expect(EarnMath.spend(credit: -5, rate: 1, block: 15) == nil)
    }

    @Test func aRelockAfterMidnightIsSetForTheNextDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let lateEvening = calendar.date(from: DateComponents(year: 2026, month: 11, day: 23, hour: 23, minute: 52))!
        let window = EarnMath.relockWindow(now: lateEvening, minutes: 15)
        let parts = EarnMath.scheduleParts(window.start, calendar: calendar)
        #expect(parts.day == 24 && parts.hour == 0 && parts.minute == 7)
        #expect(EarnMath.scheduleParts(window.end, calendar: calendar).minute == 22)
    }

    @Test func onlyUnlocksThatRanOutAreLockedAgain() {
        let open: [FunGroup: Date] = [.videos: now.addingTimeInterval(-1), .games: now.addingTimeInterval(60)]
        #expect(EarnMath.expired(open, now: now) == [.videos])
        #expect(EarnMath.expired([.games: now], now: now) == [.games])
        #expect(EarnMath.expired([:], now: now).isEmpty)
    }

    // MARK: Free time each day, the weekly escape and the comeback day

    @Test func socialAppsEarnTwiceAsMuchAndEachGroupHasItsOwnFreeTime() {
        #expect(FunGroup.allCases == [.social, .videos, .games])
        #expect(FunGroup.social.defaultRate == 2 && FunGroup.videos.defaultRate == 1 && FunGroup.games.defaultRate == 0.5)
        #expect(FunGroup.social.baseMinutes == 60 && FunGroup.videos.baseMinutes == 30 && FunGroup.games.baseMinutes == 30)
        #expect(EarnRules.block == 15 && EarnedTime.block == EarnRules.block)
        #expect(EarnMath.available(credit: 20, rate: FunGroup.social.defaultRate) == 40)
    }

    @Test func anUnlockSpendsTodaysFreeTimeBeforeTheCredit() {
        // Plenty of free time: none of the credit goes.
        #expect(EarnMath.unlock(baseLeft: 60, credit: 50, rate: 2, block: 15) == .init(minutes: 15, fromBase: 15, cost: 0))
        // 5 free minutes left: the other 10 come from the credit, at the group's rate.
        #expect(EarnMath.unlock(baseLeft: 5, credit: 50, rate: 2, block: 15) == .init(minutes: 15, fromBase: 5, cost: 5))
        // No free time: all from the credit, as before.
        #expect(EarnMath.unlock(baseLeft: 0, credit: 50, rate: 0.5, block: 15) == .init(minutes: 15, fromBase: 0, cost: 30))
        // A little of each that doesn't fill the block.
        #expect(EarnMath.unlock(baseLeft: 3, credit: 2, rate: 1, block: 15) == .init(minutes: 5, fromBase: 3, cost: 2))
        #expect(EarnMath.unlock(baseLeft: 0, credit: 0.4, rate: 1, block: 15) == nil)
    }

    @Test func freeTimeStartsAgainEachDayAndIsNotCarriedOver() {
        let used = ["2026-11-23": 45, "2026-11-24": 20]
        #expect(EarnMath.baseLeft(.social, used: used, day: "2026-11-24", comeback: false) == 40)
        #expect(EarnMath.baseLeft(.social, used: used, day: "2026-11-25", comeback: false) == 60)
        // Nothing left over from a quiet day is added to the next.
        #expect(EarnMath.baseLeft(.games, used: [:], day: "2026-11-25", comeback: false) == 30)
        #expect(EarnMath.baseLeft(.videos, used: ["2026-11-24": 40], day: "2026-11-24", comeback: false) == 0)
        // The comeback day adds 15 to the day's free time.
        #expect(EarnMath.baseLeft(.videos, used: ["2026-11-24": 30], day: "2026-11-24", comeback: true) == 15)
    }

    @Test func theDayChangesAtLocalMidnightAndTheWeekOnMonday() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let late = calendar.date(from: DateComponents(year: 2026, month: 11, day: 22, hour: 23, minute: 59))!
        #expect(EarnMath.dayKey(late, calendar: calendar) == "2026-11-22")
        #expect(EarnMath.dayKey(late.addingTimeInterval(120), calendar: calendar) == "2026-11-23")
        // Sunday 22 November still belongs to the week of Monday 16; Monday 23 starts a new one.
        #expect(EarnMath.weekKey(late, calendar: calendar) == "2026-11-16")
        #expect(EarnMath.weekKey(late.addingTimeInterval(120), calendar: calendar) == "2026-11-23")
        // A calendar whose weeks start on Sunday still resets the escape on Monday.
        calendar.firstWeekday = 1
        #expect(EarnMath.weekKey(late, calendar: calendar) == "2026-11-16")
    }

    @Test func aWorkoutAfterAMissedTrainingDayIsAComeback() {
        let planned = ["2026-11-17", "2026-11-19", "2026-11-21"]
        #expect(EarnMath.isComeback(today: "2026-11-21", planned: planned, done: ["2026-11-17"]))
        #expect(!EarnMath.isComeback(today: "2026-11-21", planned: planned, done: ["2026-11-17", "2026-11-19"]))
        // The first training day of a new week looks at the last done day instead.
        #expect(EarnMath.isComeback(today: "2026-11-24", planned: ["2026-11-24"], done: ["2026-11-14"]))
        #expect(!EarnMath.isComeback(today: "2026-11-24", planned: ["2026-11-24"], done: ["2026-11-21"]))
        // Never trained before: nothing to come back from.
        #expect(!EarnMath.isComeback(today: "2026-11-24", planned: [], done: []))
    }
}
