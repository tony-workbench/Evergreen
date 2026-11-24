import Foundation
import Testing
import UserNotifications
@testable import Evergreen

/// Flows through the app model that each tie two parts together: the other workouts' reminders within the day's six,
/// "I'm home tomorrow" pressed on a locked phone, the calendar after a session is done or a time picked, a far phone
/// making today a day out, a session done late in the week's count, a reminder's tap, and the Sunday week rebuilt after
/// the phone was locked. Thursday 19 November 2026, Los Angeles.
@MainActor
struct ReviewFlowTests {
    private let thursday = "2026-11-19", friday = "2026-11-20", saturday = "2026-11-21", sunday = "2026-11-22"
    private let cal = Fixture.calendar

    /// The day `dayOffset` days from Thursday: at home at 16:40 (later 18:10 and 19:10), or of another kind with no times.
    private func homeDay(_ dayOffset: Int, kind: DayKind = .home) -> HomeWeek.Day {
        let home = kind == .home, day = Fixture.dayAndWeekday(dayOffset)
        let times = [(16, 40), (18, 10), (19, 10)].map { LocalTime(Fixture.at($0.0, $0.1, dayOffset: dayOffset), in: cal.timeZone) }
        return HomeWeek.Day(day: day.iso, weekday: day.weekday, kind: kind, focus: home ? "full" : nil,
                            first: home ? times.first : nil, fallbacks: home ? Array(times.dropFirst()) : [])
    }

    /// Rules on with no rest day, today and Friday at home at 16:40 (later 18:10 and 19:10), each day's session on the
    /// plan, and nothing written to Apple Health.
    private func twoDaysAtHome(at now: Date = Clocks.morning) throws -> AppRig {
        let rig = try AppRig(.init(now: now, history: AppRig.runs(days: 0, before: now)))
        rig.model.userRules.isOn = true
        rig.model.userRules.restWeekdays = []
        rig.model.homeWeek = HomeWeek(days: [homeDay(0),
                                             homeDay(1)],
                                      homeDays: 2, trainingDays: 2, madeOn: rig.model.todayISO)
        rig.model.writeStrength = { _, _ in false }
        try rig.plan(.strength, id: "home-thu", day: 0, hour: 16, minute: 40, minutes: 25)
        try rig.plan(.strength, id: "home-fri", day: 1, hour: 16, minute: 40, minutes: 25)
        return rig
    }

    private let oneMovement = WorkoutContent(sessionId: nil, focus: "full", minutes: 20,
                                             items: [.init(movementId: "sit_to_stand", sets: 3, reps: [8, 12], rest: 60, isNew: false)])

    private func finished(_ day: String, startedAt: Date) -> WorkoutProgress {
        WorkoutProgress(day: day, content: oneMovement, results: [WorkoutResult(movementId: "sit_to_stand", sets: [10, 10, 10])],
                        startedAt: startedAt)
    }

    // MARK: The other workouts' 30-minute reminders

    @Test func otherRemindersKeepQuietHoursTheDaysSixAndTheDaysRoomOverTheWeek() throws {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        // Friday: one before 09:00 and one from 22:00 are night; noon goes.
        try rig.plan(.run, id: "fri-early", day: 1, hour: 9, minute: 15)
        try rig.plan(.run, id: "fri-noon", day: 1, hour: 12)
        try rig.plan(.run, id: "fri-late", day: 1, hour: 22, minute: 40)
        // Saturday: eight in a day, six go, the earliest first.
        for hour in 10...17 { try rig.plan(.run, id: "sat-\(hour)", day: 2, hour: hour, minutes: 30) }
        // Sunday: four already sent at once leave room for two.
        for _ in 0..<4 { NotificationBudget.recordSent(on: sunday, in: rig.settings) }
        for hour in 10...12 { try rig.plan(.run, id: "sun-\(hour)", day: 3, hour: hour, minutes: 30) }
        // Wednesday is inside the week ahead; next Thursday's reminder is past it.
        try rig.plan(.run, id: "wed", day: 6, hour: 12)
        try rig.plan(.run, id: "next-thu", day: 7, hour: 10)

        let kept = Set(rig.model.keptOtherReminders.map(\.id))
        let expected: Set<String> = ["fri-noon", "sat-10", "sat-11", "sat-12", "sat-13", "sat-14", "sat-15", "sun-10", "sun-11", "wed"]
        #expect(kept == expected)
        #expect(rig.model.roomForHomeReminders(on: saturday) == 0, "the six are taken: no day-at-home reminder that day")
        #expect(rig.model.roomForHomeReminders(on: sunday) == 0)
        #expect(rig.model.roomForHomeReminders(on: friday) == NotificationBudget.maxPerDay - 1)
    }

    // MARK: "I'm home tomorrow" on a locked phone

    @Test func homeTomorrowPressedLockedChangesOnlyThatDay() async throws {
        let rig = try twoDaysAtHome()
        let saturdayKept = HomeWeek.Day(day: saturday, weekday: "Saturday", kind: .home, focus: "upper",
                                        first: LocalTime(Fixture.at(7, 5, dayOffset: 2), in: cal.timeZone), fallbacks: [])
        let thursdayKept = try #require(rig.model.homeWeek?.day(thursday))
        rig.model.homeWeek = HomeWeek(days: [thursdayKept, homeDay(1, kind: .out), saturdayKept],
                                      homeDays: 2, trainingDays: 2, madeOn: thursday)
        rig.settings.set([friday], forKey: AppModel.goingOutKey)
        rig.model.unlocked = { false }

        await rig.model.handleWorkoutAction(.homeTomorrow, day: friday)

        let week = try #require(rig.model.homeWeek)
        #expect(week.day(friday)?.kind != .out, "Friday is worked out again")
        #expect(week.day(saturday) == saturdayKept, "locked, the other days stay as they were kept")
        #expect(week.day(thursday) == thursdayKept)
        #expect(!rig.model.goingOutDays.contains(friday))
    }

    // MARK: The calendar shows what happened

    @Test func aFinishedSessionMovesItsEventToWhenItWasDone() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(17, 10))
        await rig.model.finishWorkout(finished(thursday, startedAt: Fixture.at(16, 45)), pain: nil, feeling: nil)
        let event = try #require(rig.calendar.event(for: "home-thu"))
        #expect(event.start == Fixture.at(16, 45) && event.end == Fixture.at(17, 10))
    }

    @Test func todayDoneAnotherWayMovesItsEventToTheSessionsLengthUpToNow() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(18, 0))
        await rig.model.doneAnotherWay()
        let event = try #require(rig.calendar.event(for: "home-thu"))
        #expect(event.start == Fixture.at(17, 35) && event.end == Fixture.at(18, 0), "the 25-minute session, ending now")
        #expect(event.title.hasSuffix(CalendarEntry.doneMark))
    }

    @Test func aLaterTimePickedMovesTheSessionAndItsEvent() async throws {
        let rig = try twoDaysAtHome()
        await rig.model.pickTime("19:10", day: thursday)
        #expect(rig.model.plan.first { $0.id == "home-thu" }?.slot.start == Fixture.at(19, 10))
        #expect(rig.calendar.event(for: "home-thu")?.start == Fixture.at(19, 10))
        #expect(rig.calendar.event(for: "home-fri")?.start == Fixture.at(16, 40, dayOffset: 1), "only that day's session moves")
    }

    // MARK: Far from home

    @Test func aPhoneFarFromHomeMakesTodayADayOutAndOneNearHomeDoesnt() async throws {
        let home = Coordinate(latitude: 37.7712, longitude: -122.4194)
        let near = try twoDaysAtHome()
        near.model.userRules.home = HomePlace(place: home)
        let nearby = FakeLocation(.allowed, place: Coordinate(latitude: 37.7720, longitude: -122.4190))
        near.model.deviceLocation = { _ in nearby }
        await near.model.checkFarFromHome()
        #expect(near.settings.string(forKey: AppModel.farDayKey) == nil)
        #expect(!near.model.isGoingOutToday, "near home, today stays a day at home")

        let far = try twoDaysAtHome()
        far.model.userRules.home = HomePlace(place: home)
        let away = FakeLocation(.allowed, place: Coordinate(latitude: 38.6, longitude: -122.4194))
        far.model.deviceLocation = { _ in away }
        await far.model.checkFarFromHome()
        #expect(far.settings.string(forKey: AppModel.farDayKey) == thursday)
        #expect(far.model.isGoingOutToday)
    }

    @Test func imHomeSaidTodayStandsWhenThePhoneIsFarLater() async throws {
        let rig = try twoDaysAtHome()
        rig.model.userRules.home = HomePlace(place: Coordinate(latitude: 37.7712, longitude: -122.4194))
        await rig.model.setGoingOut(false)
        let away = FakeLocation(.allowed, place: Coordinate(latitude: 38.6, longitude: -122.4194))
        rig.model.deviceLocation = { _ in away }
        await rig.model.checkFarFromHome()
        #expect(rig.settings.string(forKey: AppModel.farDayKey) == nil, "\"I'm home\" said today stands")
        #expect(!rig.model.isGoingOutToday)
    }

    // MARK: Done late

    @Test func aSessionDoneLateStillCountsInTheWeeksLine() async throws {
        let rig = try AppRig(.init(now: Fixture.at(23, 0), history: AppRig.runs(days: 0, before: Fixture.at(23, 0))))
        rig.model.userRules.isOn = true
        rig.model.writeStrength = { _, _ in false }
        // Worked out this late, today has no time left: a day at home that no longer trains.
        let today = HomeWeek.Day(day: thursday, weekday: "Thursday", kind: .home, focus: "full", first: nil, fallbacks: [])
        let week = HomeWeek(days: [today], homeDays: 1, trainingDays: 0, madeOn: thursday)
        #expect(rig.model.weekSummary(week).contains("0 done"))
        await rig.model.finishWorkout(finished(thursday, startedAt: Fixture.at(22, 30)), pain: nil, feeling: nil)
        #expect(rig.model.weekSummary(week).contains("1 done"))
    }

    // MARK: A reminder's tap

    @Test func startOnAReminderOpensTodaysSessionOrAnotherDaysWeekTable() async throws {
        let rig = try twoDaysAtHome()
        await rig.model.notifier.handle(Notifier.Tap(action: Notifier.WorkoutAction.start.rawValue, day: thursday, kind: "soon"))
        #expect(rig.model.workoutRoute == .session)
        rig.model.workoutRoute = nil
        await rig.model.notifier.handle(Notifier.Tap(action: Notifier.WorkoutAction.start.rawValue, day: friday, kind: "evening"))
        #expect(rig.model.workoutRoute == .week(day: friday))
        rig.model.workoutRoute = nil
        // The notification itself tapped, on the day: the same as Start.
        await rig.model.notifier.handle(Notifier.Tap(action: UNNotificationDefaultActionIdentifier, day: thursday, kind: "now"))
        #expect(rig.model.workoutRoute == .session)
    }

    // MARK: Sunday's week ahead, locked

    @Test func theWeekAheadSkippedWhileLockedIsBuiltOnceThePhoneIsUnlocked() async throws {
        let sundayEvening = Fixture.at(20, 30, dayOffset: 3)
        let rig = try AppRig(.init(now: sundayEvening, history: AppRig.runs(days: 0, before: sundayEvening)))
        rig.model.userRules.isOn = true
        // The day was looked at earlier; only the week ahead is due.
        rig.settings.set(sunday, forKey: AppModel.checkedDayKey)
        rig.model.unlocked = { false }

        await rig.model.checkHomeWeek()
        #expect(rig.model.homeWeekRebuildPending)
        #expect(rig.settings.string(forKey: AppModel.weekAheadKey) == nil, "nothing is built locked")

        rig.model.unlocked = { true }
        await rig.model.deviceDidUnlock()
        #expect(rig.settings.string(forKey: AppModel.weekAheadKey) == sunday)
        #expect(!rig.model.homeWeekRebuildPending)
        await rig.model.deviceDidUnlock()
        #expect(rig.settings.string(forKey: AppModel.weekAheadKey) == sunday, "once built, an unlock does nothing more")
    }

    @Test func theWeekAheadSkippedWhileLockedIsBuiltAtTheNextRun() async throws {
        let sundayEvening = Fixture.at(20, 30, dayOffset: 3)
        let rig = try AppRig(.init(now: sundayEvening, history: AppRig.runs(days: 0, before: sundayEvening)))
        rig.model.userRules.isOn = true
        rig.settings.set(sunday, forKey: AppModel.checkedDayKey)
        rig.model.unlocked = { false }
        await rig.model.checkHomeWeek()
        rig.clock.now = Fixture.at(21, 30, dayOffset: 3)
        rig.model.unlocked = { true }
        await rig.model.checkHomeWeek()
        #expect(rig.settings.string(forKey: AppModel.weekAheadKey) == sunday)
        #expect(!rig.model.homeWeekRebuildPending)
    }
}
