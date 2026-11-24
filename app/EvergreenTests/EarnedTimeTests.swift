import Foundation
import Testing
@testable import Evergreen

/// Workout minutes turn into minutes of videos and games at each group's rate.
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
}
