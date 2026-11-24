import Foundation
import Testing
@testable import Evergreen

/// A day at home's reminders (the evening before, before, at, after and at each later time, at most six and none
/// from 22:00), a later time picked ahead, "I already trained", and the short breaks of a rainy afternoon at home. Thursday 19 November 2026, Los Angeles.
struct WorkoutRemindersTests {
    private let cal = Fixture.calendar
    private let session = WorkoutReminders.Session(focusWords: "full-body", minutes: 22, movements: 4)

    private func day(first: Date?, fallbacks: [Date], kind: DayKind = .home) -> HomeWeek.Day {
        let zone = cal.timeZone
        return HomeWeek.Day(day: "2026-11-19", weekday: "Thursday", kind: kind, focus: first == nil ? nil : "full",
                            first: first.map { LocalTime($0, in: zone) }, fallbacks: fallbacks.map { LocalTime($0, in: zone) })
    }

    private var usual: HomeWeek.Day { day(first: Fixture.at(16, 40), fallbacks: [Fixture.at(18, 10), Fixture.at(19, 40)]) }
    private var eveningBefore: Date { Fixture.at(20, dayOffset: -1) }

    @Test func aDayWithTwoLaterTimesGetsSixRemindersInOrder() {
        let reminders = WorkoutReminders.plan(day: usual, session: session, keepReminding: true, now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .now, .moved, .later, .last])
        #expect(reminders.map(\.fires) == [Fixture.at(21, dayOffset: -1), Fixture.at(16, 30), Fixture.at(16, 40),
                                           Fixture.at(17, 0), Fixture.at(18, 10), Fixture.at(19, 40)])
        #expect(reminders.map(\.id) == (1...6).map { "reminder-home-2026-11-19-\($0)" })
        #expect(reminders.allSatisfy { $0.day == "2026-11-19" })
        #expect(reminders[0].title == "Tomorrow at home" && reminders[0].body.hasPrefix("Full-body at ") && reminders[0].body.hasSuffix("about 22 minutes."))
        #expect(reminders[3].title.hasPrefix("Moved to "))
        #expect(reminders[5].title == "Last time today")
    }

    @Test func withKeepRemindingOffOnlyTheFirstThreeGo() {
        let reminders = WorkoutReminders.plan(day: usual, session: session, keepReminding: false, now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .now])
    }

    @Test func withoutALaterTimeTheTimeItselfIsTheLast() {
        let reminders = WorkoutReminders.plan(day: day(first: Fixture.at(16, 40), fallbacks: []), session: session, keepReminding: true,
                                              now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .last])
    }

    @Test func nothingPastFiresAndNothingFiresFromTen() {
        let afternoon = WorkoutReminders.plan(day: usual, session: session, keepReminding: true, now: Fixture.at(17, 30), calendar: cal)
        #expect(afternoon.map(\.kind) == [.later, .last])
        let late = WorkoutReminders.plan(day: day(first: Fixture.at(20, 30), fallbacks: [Fixture.at(22, 0)]), session: session,
                                         keepReminding: true, now: eveningBefore, calendar: cal)
        #expect(!late.contains { cal.component(.hour, from: $0.fires) >= 22 })
        #expect(late.count <= WorkoutReminders.maxPerDay)
    }

    @Test func aDayOutOrWithoutASessionHasNone() {
        #expect(WorkoutReminders.plan(day: day(first: nil, fallbacks: [], kind: .out), session: session, keepReminding: true,
                                      now: eveningBefore, calendar: cal).isEmpty)
    }

    @Test func laterTodayGoesToTheNextLaterTimeAndStopsAtTheLast() {
        #expect(WorkoutReminders.nextLater(usual, after: Fixture.at(16, 45)) == Fixture.at(18, 10))
        #expect(WorkoutReminders.nextLater(usual, after: Fixture.at(18, 8)) == Fixture.at(19, 40))
        #expect(WorkoutReminders.nextLater(usual, after: Fixture.at(19, 50)) == nil)
    }

    @Test func aSkipKeepsItsReasonAndAnOlderLogStillReads() throws {
        var log = WorkoutLog()
        log.skip("2026-11-19", reason: "unwell")
        #expect(log.didSkip("2026-11-19") && !log.didSkip("2026-11-20"))
        let old = #"{"entries":[],"loads":{},"doneDays":[],"turn":0}"#
        #expect(try JSONDecoder().decode(WorkoutLog.self, from: Data(old.utf8)).skipped == nil)
        #expect(Notifier.WorkoutAction.skipOut.skipReason == "out" && Notifier.WorkoutAction.later.skipReason == nil)
    }

    // MARK: A rainy afternoon at home

    private func forecast(wet: Range<Int>?) -> Forecast {
        let hours = (0..<48).map { index -> Forecast.Hour in
            let start = Fixture.at(0).addingTimeInterval(Double(index) * 3600)
            let hour = cal.component(.hour, from: start)
            let isWet = wet.map { $0.contains(hour) && cal.isDate(start, inSameDayAs: Fixture.storyDay) } ?? false
            return Forecast.Hour(start: start, probability: isWet ? 80 : 5, millimeters: isWet ? 2 : 0)
        }
        return Forecast(hours: hours, fetchedAt: Fixture.at(8), place: Coordinate(latitude: 40, longitude: -100))
    }

    private let session1640 = DateInterval(start: Fixture.at(16, 40), duration: 25 * 60)

    @Test func aWetAfternoonAtHomeGetsTwoOrThreeShortBreaksSpreadOut() throws {
        let found = RainCheck.snacks(days: [RainHomeDay(day: Fixture.storyDay, session: session1640)], plan: [], forecast: forecast(wet: 12..<20),
                                     busy: [], now: Fixture.at(8), calendar: cal)
        let snacks = try #require(found.first)
        let blocks = snacks.blocks
        #expect((2...3).contains(blocks.count))
        for block in blocks {
            #expect(block.duration == TimeInterval(RainCheck.snackMinutes * 60))
            #expect(block.start >= Fixture.at(12) && block.end <= Fixture.at(20))
            #expect(block.end <= session1640.start.addingTimeInterval(-3600) || block.start >= session1640.end.addingTimeInterval(3600))
        }
        for (a, b) in zip(blocks, blocks.dropFirst()) { #expect(b.start.timeIntervalSince(a.end) >= 3600) }
        #expect(snacks.key == "snacks|2026-11-19" && snacks.worstProbability == 80)
    }

    @Test func aDryAfternoonOrADayFullOfMeetingsGetsNone() {
        let home = [RainHomeDay(day: Fixture.storyDay, session: nil)]
        #expect(RainCheck.snacks(days: home, plan: [], forecast: forecast(wet: nil), busy: [], now: Fixture.at(8), calendar: cal).isEmpty)
        // Rain only in the morning doesn't count.
        #expect(RainCheck.snacks(days: home, plan: [], forecast: forecast(wet: 7..<11), busy: [], now: Fixture.at(6), calendar: cal).isEmpty)
        // Room for one break only: none at all.
        let meetings = [Busy(start: Fixture.at(12), end: Fixture.at(19, 30))]
        #expect(RainCheck.snacks(days: home, plan: [], forecast: forecast(wet: 12..<20), busy: meetings, now: Fixture.at(8), calendar: cal).isEmpty)
    }

    @Test func theBreaksStayOffThePlanAndThePast() {
        let walk = PlanItem(id: "walk", slot: Slot(start: Fixture.at(12, 30), end: Fixture.at(13, 0), activityType: "Walking"))
        let blocks = RainCheck.snackBlocks(on: Fixture.storyDay, session: nil, plan: [walk], busy: [], now: Fixture.at(12, 10), calendar: cal)
        #expect(!blocks.isEmpty)
        for block in blocks {
            #expect(block.start >= Fixture.at(12, 40))
            #expect(!(block.start < walk.slot.end && walk.slot.start < block.end))
        }
    }

    @Test func finishingADayTakesOffOnlyThatDaysReminders() {
        let pending = ["reminder-home-2026-11-19-2", "reminder-home-2026-11-19-3", "reminder-home-2026-11-20-1",
                       "reminder-walk-1763600000", "week-ahead"]
        #expect(WorkoutReminders.ids(pending, day: "2026-11-19") == ["reminder-home-2026-11-19-2", "reminder-home-2026-11-19-3"])
    }

    @Test func aLaterTimePickedAheadIsTheOnlyLaterTime() {
        let picked = WorkoutReminders.keeping(usual, picked: "19:40")
        let reminders = WorkoutReminders.plan(day: picked, session: session, keepReminding: true, now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .now, .moved, .last])
        #expect(reminders.map(\.fires).suffix(2) == [Fixture.at(17, 0), Fixture.at(19, 40)])
        #expect(reminders[3].title == NotificationCopy.homeMoved(to: Fixture.at(19, 40)).title)
        // "Later today" goes straight to it, past the 18:10 that was not picked.
        #expect(WorkoutReminders.nextLater(picked, after: Fixture.at(16, 45)) == Fixture.at(19, 40))
        // No pick, or a time that is no longer one of the day's, keeps them all.
        #expect(WorkoutReminders.keeping(usual, picked: nil) == usual)
        #expect(WorkoutReminders.keeping(usual, picked: "20:15") == usual)
    }

    // MARK: The reminders of the whole app

    private func homeDay(_ iso: String, weekday: String, at hour: Int, dayOffset: Int) -> HomeWeek.Day {
        HomeWeek.Day(day: iso, weekday: weekday, kind: .home, focus: "full",
                     first: LocalTime(Fixture.at(hour, 40, dayOffset: dayOffset), in: cal.timeZone),
                     fallbacks: [18, 19].map { LocalTime(Fixture.at($0, 10, dayOffset: dayOffset), in: cal.timeZone) })
    }

    /// Thursday 19 November at 9:00, rules on, today and Friday at home with a session at 16:40 and later times 18:10 and 19:10.
    @MainActor private func twoDaysAtHome() throws -> AppRig {
        let rig = try AppRig(now: Clocks.morning)
        rig.model.userRules.isOn = true
        rig.model.homeWeek = HomeWeek(days: [homeDay("2026-11-19", weekday: "Thursday", at: 16, dayOffset: 0),
                                             homeDay("2026-11-20", weekday: "Friday", at: 16, dayOffset: 1)],
                                      homeDays: 2, trainingDays: 2, madeOn: rig.model.todayISO)
        return rig
    }

    @MainActor @Test func pickingALaterTimeAheadKeepsOnlyThatOneForThatDay() async throws {
        let rig = try twoDaysAtHome()
        #expect(rig.model.homeReminders().filter { $0.day == "2026-11-20" }.map(\.kind) == [.evening, .soon, .now, .moved, .later, .last])
        await rig.model.pickLater("19:10", day: "2026-11-20")
        let friday = rig.model.homeReminders().filter { $0.day == "2026-11-20" }
        #expect(friday.map(\.kind) == [.evening, .soon, .now, .moved, .last])
        #expect(friday.last?.fires == Fixture.at(19, 10, dayOffset: 1))
        // Today's are untouched, and the pick can be taken back.
        #expect(rig.model.homeReminders().filter { $0.day == "2026-11-19" }.count == 5)
        await rig.model.pickLater(nil, day: "2026-11-20")
        #expect(rig.model.homeReminders().filter { $0.day == "2026-11-20" }.count == 6)
    }

    @MainActor @Test func alreadyTrainedOnAReminderEndsThatDaysRemindersOnly() async throws {
        let rig = try twoDaysAtHome()
        #expect(!rig.model.homeReminders().filter { $0.day == "2026-11-19" }.isEmpty)
        await rig.model.handleWorkoutAction(.alreadyDone, day: "2026-11-19")
        #expect(rig.model.workoutLog.didHomeSession(on: "2026-11-19"))
        #expect(WorkoutLog.load(from: rig.settings).didHomeSession(on: "2026-11-19"))
        let left = rig.model.homeReminders()
        #expect(!left.contains { $0.day == "2026-11-19" })
        #expect(left.filter { $0.day == "2026-11-20" }.count == 6)
        #expect(Notifier.WorkoutAction(rawValue: "already_done") == .alreadyDone && Notifier.WorkoutAction.alreadyDone.skipReason == nil)
    }

    @MainActor @Test func onceAnyTimeIsMetTheOtherTimesThatDayAreSilent() async throws {
        let rig = try twoDaysAtHome()
        // Done at the first time, 16:40: nothing at 17:00, 18:10 or 19:10 that day.
        rig.clock.now = Fixture.at(17, 5)
        #expect(rig.model.homeReminders().filter { $0.day == "2026-11-19" }.map(\.kind) == [.later, .last])
        rig.model.workoutLog.markDone("2026-11-19")
        #expect(!rig.model.homeReminders().contains { $0.day == "2026-11-19" })
        // Done at a later time instead, on Friday at 18:10: the 19:10 doesn't fire either. Thursday's are still gone.
        rig.clock.now = Fixture.at(18, 30, dayOffset: 1)
        rig.model.workoutLog.markDone("2026-11-20")
        #expect(rig.model.homeReminders().isEmpty)
    }

    @Test func theWeekEndsOnSunday() {
        let days = (0..<7).map { offset in
            AppModel.daysToSunday(Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: 30 + offset, hour: 9))!,
                                  calendar: Fixture.calendar)
        }
        #expect(days == [6, 5, 4, 3, 2, 1, 0])
    }
}
