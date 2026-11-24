import Foundation
import Testing
import UserNotifications
@testable import Evergreen

/// A day at home's reminders (the evening before, before, at, after and at each later time, at most six and none
/// from 22:00), a later time picked ahead, "Already done", and the short breaks of a rainy afternoon at home. Thursday 19 November 2026, Los Angeles.
struct WorkoutRemindersTests {
    private let cal = Fixture.calendar
    private let session = WorkoutReminders.Session(focusWords: "full-body", minutes: 22, movements: 4)

    private func day(first: Date?, fallbacks: [Date], kind: DayKind = .home) -> HomeWeek.Day {
        let zone = cal.timeZone
        return HomeWeek.Day(day: "2026-11-19", weekday: "Thursday", kind: kind, focus: first == nil ? nil : "full",
                            first: first.map { LocalTime($0, in: zone) }, fallbacks: fallbacks.map { LocalTime($0, in: zone) })
    }

    private let all = WorkoutReminders.Choice()
    private func only(_ clock: String) -> WorkoutReminders.Choice { WorkoutReminders.Choice(picked: clock) }

    private var usual: HomeWeek.Day { day(first: Fixture.at(16, 40), fallbacks: [Fixture.at(18, 10), Fixture.at(19, 40)]) }
    private var eveningBefore: Date { Fixture.at(20, dayOffset: -1) }

    @Test func aDayWithTwoLaterTimesGetsSixRemindersInOrder() {
        let reminders = WorkoutReminders.plan(day: usual, session: session, choice: all, now: eveningBefore, calendar: cal)
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
        let reminders = WorkoutReminders.plan(day: usual, session: session, choice: WorkoutReminders.Choice(keepReminding: false), now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .now])
    }

    @Test func withoutALaterTimeTheTimeItselfIsTheLast() {
        let reminders = WorkoutReminders.plan(day: day(first: Fixture.at(16, 40), fallbacks: []), session: session, choice: all,
                                              now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .last])
    }

    @Test func nothingPastFiresAndNothingFiresFromTen() {
        let afternoon = WorkoutReminders.plan(day: usual, session: session, choice: all, now: Fixture.at(17, 30), calendar: cal)
        #expect(afternoon.map(\.kind) == [.later, .last])
        let late = WorkoutReminders.plan(day: day(first: Fixture.at(20, 30), fallbacks: [Fixture.at(22, 0)]), session: session,
                                         choice: all, now: eveningBefore, calendar: cal)
        #expect(!late.contains { cal.component(.hour, from: $0.fires) >= 22 })
        #expect(late.count <= WorkoutReminders.maxPerDay)
    }

    @Test func aDayOutOrWithoutASessionHasNone() {
        #expect(WorkoutReminders.plan(day: day(first: nil, fallbacks: [], kind: .out), session: session, choice: all,
                                      now: eveningBefore, calendar: cal).isEmpty)
    }

    @Test func laterTodayGoesToTheNextLaterTimeAndStopsAtTheLast() {
        #expect(WorkoutReminders.nextLater(usual, after: Fixture.at(16, 45))?.date == Fixture.at(18, 10))
        #expect(WorkoutReminders.nextLater(usual, after: Fixture.at(18, 8))?.date == Fixture.at(19, 40))
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

    // MARK: One time picked

    @Test func theEveningReminderOffersEachTimeOfTheDay() {
        let evening = WorkoutReminders.plan(day: usual, session: session, choice: all, now: eveningBefore, calendar: cal)[0]
        #expect(evening.kind == .evening && evening.choices == ["16:40", "18:10", "19:40"])
        #expect(Notifier.category(of: evening) == "home_tomorrow|16:40,18:10,19:40")
        #expect(Notifier.pickedClock(Notifier.pickAction("18:10")) == "18:10")
        #expect(Notifier.pickedClock(Notifier.WorkoutAction.later.rawValue) == nil)
    }

    @Test func pickingTheFirstTimeKeepsOnlyItAndAsksOnceBeforeMoving() {
        let reminders = WorkoutReminders.plan(day: usual, session: session, choice: only("16:40"), now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .now, .ask])
        #expect(reminders.map(\.fires) == [Fixture.at(21, dayOffset: -1), Fixture.at(16, 30), Fixture.at(16, 40), Fixture.at(17, 0)])
        // Nothing at 18:10 or 19:40 and no "Moved to": the question names the next time and moves only on its button.
        let ask = reminders[3]
        #expect(ask.choices == ["18:10"] && ask.title == "Move to later today?")
        #expect(Notifier.category(of: ask) == "workout_ask|18:10")
    }

    @Test func onceThePickedTimeHasPassedNothingNewTurnsUp() {
        // After the question twenty minutes later, nothing more that day, whether the time was the first or a later one.
        for (clock, after) in [("16:40", Fixture.at(17, 1)), ("18:10", Fixture.at(18, 31)), ("19:40", Fixture.at(19, 41))] {
            #expect(WorkoutReminders.plan(day: usual, session: session, choice: only(clock), now: after, calendar: cal).isEmpty)
        }
    }

    @Test func pickingALaterTimeKeepsOnlyIt() {
        let middle = WorkoutReminders.plan(day: usual, session: session, choice: only("18:10"), now: eveningBefore, calendar: cal)
        #expect(middle.map(\.kind) == [.evening, .soon, .now, .ask])
        #expect(middle.map(\.fires).dropFirst() == [Fixture.at(18, 0), Fixture.at(18, 10), Fixture.at(18, 30)])
        #expect(middle[0].body.contains(Fixture.at(18, 10).clock), "the evening before names the picked time")
        // The last time of the day: nothing to move to, so no question, and it reads as the last time.
        let last = WorkoutReminders.plan(day: usual, session: session, choice: only("19:40"), now: eveningBefore, calendar: cal)
        #expect(last.map(\.kind) == [.evening, .soon, .last])
        #expect(last.last?.fires == Fixture.at(19, 40))
    }

    @Test func aPickStandsWhenTheWeekIsWorkedOutAgainWithOtherTimes() {
        let moved = day(first: Fixture.at(17, 0), fallbacks: [Fixture.at(18, 40), Fixture.at(19, 40)])
        let reminders = WorkoutReminders.plan(day: moved, session: session, choice: only("18:10"), now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.fires).dropFirst() == [Fixture.at(18, 0), Fixture.at(18, 10), Fixture.at(18, 30)])
        #expect(reminders.last?.choices == ["18:40"])
    }

    @Test func pickingEachDayAsksTheEveningBeforeAndKeepsTheFirstTimeUntilThen() {
        let choice = WorkoutReminders.Choice(pickEachDay: true)
        let reminders = WorkoutReminders.plan(day: usual, session: session, choice: choice, now: eveningBefore, calendar: cal)
        #expect(reminders.map(\.kind) == [.evening, .soon, .now, .ask])
        #expect(reminders[0].title == "Tomorrow at home: pick a time" && reminders[0].choices == ["16:40", "18:10", "19:40"])
        // Once a time is picked the evening reminder says it, and only that time reminds.
        var picked = choice
        picked.picked = "19:40"
        let after = WorkoutReminders.plan(day: usual, session: session, choice: picked, now: eveningBefore, calendar: cal)
        #expect(after.map(\.kind) == [.evening, .soon, .last] && after[0].title == "Tomorrow at home")
    }

    // MARK: The reminders of the whole app

    private func homeDay(_ iso: String, weekday: String, dayOffset: Int, first: (Int, Int) = (16, 40),
                         later: [(Int, Int)] = [(18, 10), (19, 10)]) -> HomeWeek.Day {
        HomeWeek.Day(day: iso, weekday: weekday, kind: .home, focus: "full",
                     first: LocalTime(Fixture.at(first.0, first.1, dayOffset: dayOffset), in: cal.timeZone),
                     fallbacks: later.map { LocalTime(Fixture.at($0.0, $0.1, dayOffset: dayOffset), in: cal.timeZone) })
    }

    /// Thursday 19 November at 9:00, no workouts before, rules on, today and Friday at home with a session at 16:40 and later times 18:10 and 19:10.
    @MainActor private func twoDaysAtHome(at now: Date = Clocks.morning) throws -> AppRig {
        let rig = try AppRig(now: now, history: AppRig.runs(days: 0, before: now))
        rig.model.userRules.isOn = true
        rig.model.homeWeek = HomeWeek(days: [homeDay(thursday, weekday: "Thursday", dayOffset: 0),
                                             homeDay(friday, weekday: "Friday", dayOffset: 1)],
                                      homeDays: 2, trainingDays: 2, madeOn: rig.model.todayISO)
        rig.model.writeStrength = { _, _ in false }
        return rig
    }

    private let thursday = "2026-11-19", friday = "2026-11-20"

    @MainActor private func kinds(_ rig: AppRig, _ day: String) -> [WorkoutReminder.Kind] {
        rig.model.homeReminders().filter { $0.day == day }.map(\.kind)
    }

    @MainActor @Test func aTimePickedAheadIsTheOnlyOneThatDayAndCanBeTakenBack() async throws {
        let rig = try twoDaysAtHome()
        #expect(kinds(rig, friday) == [.evening, .soon, .now, .moved, .later, .last])
        await rig.model.pickTime("16:40", day: friday)
        #expect(kinds(rig, friday) == [.evening, .soon, .now, .ask])
        #expect(kinds(rig, thursday) == [.soon, .now, .moved, .later, .last], "today's are untouched")
        await rig.model.pickTime(nil, day: friday)
        #expect(kinds(rig, friday).count == 6)
    }

    @MainActor @Test func aPickIsKeptWhenTheWeekIsWorkedOutAgain() async throws {
        let rig = try twoDaysAtHome()
        await rig.model.pickTime("18:10", day: friday)
        rig.model.homeWeek?.days[1] = homeDay(friday, weekday: "Friday", dayOffset: 1, first: (17, 0), later: [(18, 40)])
        let friday = rig.model.homeReminders().filter { $0.day == self.friday }
        #expect(friday.map(\.fires).dropFirst() == [Fixture.at(18, 0, dayOffset: 1), Fixture.at(18, 10, dayOffset: 1),
                                                     Fixture.at(18, 30, dayOffset: 1)])
        #expect(rig.model.pickedTimes[self.friday] == "18:10")
    }

    @MainActor @Test func laterTodayPicksTheNextTimeAndNothingMovesByItself() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(16, 45))
        await rig.model.handleWorkoutAction(.later, day: thursday)
        #expect(rig.model.pickedTimes[thursday] == "18:10")
        #expect(kinds(rig, thursday) == [.soon, .now, .ask])
        // "Move to 19:10" on the question picks that time the same way.
        rig.clock.now = Fixture.at(18, 31)
        await rig.model.pickTime("19:10", day: thursday)
        #expect(kinds(rig, thursday) == [.soon, .last])
    }

    @MainActor @Test func finishingOnThePageLeavesNothingToRemindThatDay() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(16, 50))
        let progress = WorkoutProgress(day: thursday, content: oneMovement,
                                       results: [WorkoutResult(movementId: "sit_to_stand", sets: [10, 10, 10])], startedAt: Fixture.at(16, 41))
        #expect(!kinds(rig, thursday).isEmpty)
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        #expect(kinds(rig, thursday).isEmpty)
        #expect(kinds(rig, friday).count == 6)
    }

    @MainActor @Test func pickingEachDayKeepsOnlyTheFirstTimeUntilOneIsPicked() throws {
        let rig = try twoDaysAtHome()
        rig.settings.set(true, forKey: Automatic.pickEachDay.rawValue)
        #expect(kinds(rig, friday) == [.evening, .soon, .now, .ask])
        #expect(rig.model.homeReminders().first { $0.day == friday }?.title == "Tomorrow at home: pick a time")
    }

    @MainActor @Test func alreadyTrainedOnAReminderEndsThatDaysRemindersOnlyAndCanBeTakenBack() async throws {
        let rig = try twoDaysAtHome()
        WorkoutProgress(day: thursday, content: oneMovement, results: [WorkoutResult(movementId: "sit_to_stand", sets: [10])],
                        startedAt: Fixture.at(8)).save(to: rig.settings)
        await rig.model.handleWorkoutAction(.alreadyDone, day: thursday)
        #expect(rig.model.workoutLog.didHomeSession(on: thursday) && rig.model.workoutLog.didOtherWay(thursday))
        #expect(WorkoutLog.load(from: rig.settings).didHomeSession(on: thursday))
        #expect(kinds(rig, thursday).isEmpty)
        #expect(kinds(rig, friday).count == 6, "other days' reminders stay")
        #expect(WorkoutProgress.load(from: rig.settings, day: thursday) != nil, "half-done work is kept")
        await rig.model.undoDoneAnotherWay(day: thursday)
        #expect(!rig.model.workoutLog.didHomeSession(on: thursday) && kinds(rig, thursday).count == 5)
        #expect(Notifier.WorkoutAction(rawValue: "already_done") == .alreadyDone && Notifier.WorkoutAction.alreadyDone.skipReason == nil)
    }

    private let oneMovement = WorkoutContent(sessionId: nil, focus: "full", minutes: 20,
                                             items: [.init(movementId: "sit_to_stand", sets: 3, reps: [8, 12], rest: 60, isNew: false)])

    @MainActor @Test func finishingAfterAlreadyTrainedCountsOnceAndWritesHealthOnce() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(17, 10))
        let writes = CallCounter()
        rig.model.writeStrength = { _, _ in await writes.add(); return false }
        let progress = WorkoutProgress(day: thursday, content: oneMovement,
                                       results: [WorkoutResult(movementId: "sit_to_stand", sets: [10, 10, 10])], startedAt: Fixture.at(16, 45))
        await rig.model.handleWorkoutAction(.alreadyDone, day: thursday)
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        #expect(await writes.count == 1)
        #expect(kinds(rig, thursday).isEmpty, "nothing left to remind that day")
        #expect(rig.model.workoutLog.entries.filter { $0.day == thursday }.count == 1)
        #expect(!rig.model.workoutLog.didOtherWay(thursday) && rig.model.workoutLog.doneDays == [thursday])
    }

    @MainActor @Test func onceAnyTimeIsMetTheOtherTimesThatDayAreSilent() async throws {
        let rig = try twoDaysAtHome()
        // Done at the first time, 16:40: nothing at 17:00, 18:10 or 19:10 that day.
        rig.clock.now = Fixture.at(17, 5)
        #expect(kinds(rig, thursday) == [.later, .last])
        rig.model.workoutLog.markDone(thursday)
        #expect(kinds(rig, thursday).isEmpty)
        // Done at a later time instead, on Friday at 18:10: the 19:10 doesn't fire either.
        rig.clock.now = Fixture.at(18, 30, dayOffset: 1)
        rig.model.workoutLog.markDone(friday)
        #expect(rig.model.homeReminders().isEmpty)
    }

    @MainActor @Test func goingOutTomorrowTakesItsRemindersOffAtOnce() async throws {
        let rig = try twoDaysAtHome()
        await rig.model.handleWorkoutAction(.goingOut, day: friday)
        #expect(rig.model.goingOutDays.contains(friday))
        #expect(kinds(rig, friday) == [.outTomorrow], "only the evening word that Friday is out")
    }

    @MainActor @Test func aSessionUnderWayQuietsTodaysRemindersWhileItRuns() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(16, 45))
        #expect(kinds(rig, thursday) == [.moved, .later, .last])
        // Opened at 16:41: 17:00 falls inside its 20 minutes and the half hour after, so it isn't sent; 18:10 still is.
        let progress = WorkoutProgress(day: thursday, content: oneMovement, results: [WorkoutResult(movementId: "sit_to_stand", sets: [])],
                                       startedAt: Fixture.at(16, 41))
        rig.model.saveProgress(progress)
        #expect(kinds(rig, thursday) == [.later, .last])
        #expect(kinds(rig, friday).count == 6, "other days are untouched")
    }

    @MainActor @Test func everyNotificationSharesTheDaysSixAndNoneComeAtNight() async throws {
        let rig = try twoDaysAtHome()
        // Rain and a move sent at once this morning: Thursday's reminders make room, the later time and the move go first.
        await rig.model.notifyNow(("Rain", "This afternoon"), id: "rain-test")
        await rig.model.notifyNow(("Moved", "Your run"), id: "move-test")
        #expect(NotificationBudget.sent(on: thursday, in: rig.settings) == 2)
        #expect(kinds(rig, thursday) == [.soon, .now, .last])
        #expect(kinds(rig, friday) == [.evening, .soon, .now, .moved, .later, .last], "Friday's own day still has six")
        // Nothing at night: held back, not counted.
        rig.clock.now = Fixture.at(23)
        await rig.model.notifyNow(("Rain", "Tomorrow"), id: "rain-night")
        #expect(NotificationBudget.sent(on: thursday, in: rig.settings) == 2)
        #expect(NotificationBudget.isQuiet(Fixture.at(5, 50), calendar: cal) && !NotificationBudget.isQuiet(Fixture.at(6), calendar: cal))
    }

    @Test func makingRoomKeepsTheTimeTheLastAndTheEveningWord() {
        let at = { (kind: WorkoutReminder.Kind, hour: Int) in
            WorkoutReminder(id: "\(kind.rawValue)-\(hour)", kind: kind, fires: Fixture.at(hour), title: "", body: "", day: "2026-11-19")
        }
        let day = [at(.soon, 16), at(.now, 16), at(.moved, 17), at(.later, 18), at(.last, 19), at(.evening, 21)]
        #expect(NotificationBudget.fit(day, room: { _ in 6 }, calendar: cal) == day)
        #expect(NotificationBudget.fit(day, room: { _ in 3 }, calendar: cal).map(\.kind) == [.now, .last, .evening])
        #expect(NotificationBudget.fit(day, room: { _ in -1 }, calendar: cal).isEmpty)
    }

    @MainActor @Test func theWeekTableShowsADaysShortBreaksForRainOnceAdded() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(8))
        #expect(rig.model.rainBreaks(on: thursday) == nil)
        let snacks = try #require(RainCheck.snacks(days: [RainHomeDay(day: Fixture.storyDay, session: session1640)], plan: [],
                                                   forecast: forecast(wet: 12..<20), busy: [], now: Fixture.at(8), calendar: cal).first)
        rig.model.addRainSnacks(snacks)
        let added = try #require(rig.model.rainBreaks(on: thursday))
        #expect(added.added && added.clocks == snacks.blocks.map(\.start.clock))
        #expect(rig.model.rainBreaks(on: friday) == nil)
    }

    @MainActor @Test func theEveningBeforeADayOutSaysSoAndOneTapPutsItRight() async throws {
        let rig = try twoDaysAtHome()
        rig.model.homeWeek?.days[1].kind = .out
        let evening = try #require(rig.model.homeReminders().first { $0.day == friday })
        #expect(evening.kind == .outTomorrow && evening.fires == Fixture.at(21) && evening.title == "Tomorrow you’re out")
        #expect(Notifier.category(of: evening) == Notifier.outTomorrowCategory)
        #expect(Notifier.route(action: UNNotificationDefaultActionIdentifier, day: friday, kind: "out_tomorrow", move: nil) == .open)
        #expect(Notifier.route(action: "home_tomorrow", day: friday, kind: "out_tomorrow", move: nil) == .workout(.homeTomorrow, day: friday))
        await rig.model.handleWorkoutAction(.homeTomorrow, day: friday)
        #expect(rig.model.stayingHomeDays.contains(friday) && !rig.model.goingOutDays.contains(friday))
        // Past 21:00 there is nothing left to say.
        rig.clock.now = Fixture.at(21, 30)
        rig.model.homeWeek?.days[1].kind = .out
        #expect(!rig.model.homeReminders().contains { $0.kind == .outTomorrow })
    }

    @MainActor @Test func aMissedDaysFocusIsPassedOnOnce() throws {
        let rig = try twoDaysAtHome()
        rig.settings.set([rig.model.dayISO(offset: -1): "lower"], forKey: AppModel.homeFocusKey)
        #expect(rig.model.carry == ["lower"])
        rig.model.markCarried()
        #expect(rig.model.carry.isEmpty, "once the week holds it, working the week out again doesn't pass it on again")
    }

    @Test func theWeekEndsOnSunday() {
        let days = (0..<7).map { offset in
            AppModel.daysToSunday(Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: 30 + offset, hour: 9))!,
                                  calendar: Fixture.calendar)
        }
        #expect(days == [6, 5, 4, 3, 2, 1, 0])
    }
}

/// Counts calls made from anywhere.
actor CallCounter {
    private(set) var count = 0
    func add() { count += 1 }
}

/// Coming back after a missed day at home, for earned screen time's comeback minutes. Thursday 19 November 2026.
@MainActor
struct ComebackTests {
    @Test func aMissedDayBeforeTodayIsSeenEvenThoughTheWeekStartsToday() throws {
        let rig = try AppRig(history: AppRig.runs(days: 0, before: Clocks.morning))
        rig.model.userRules.isOn = true
        let wednesday = rig.model.dayISO(offset: -1), today = rig.model.todayISO
        rig.settings.set([wednesday: "lower", today: "upper"], forKey: AppModel.homeFocusKey)
        #expect(rig.model.plannedTrainingDays.contains(wednesday))
        #expect(EarnMath.isComeback(today: today, planned: rig.model.plannedTrainingDays, done: []))
        rig.model.workoutLog.markDone(wednesday)
        #expect(!EarnMath.isComeback(today: today, planned: rig.model.plannedTrainingDays, done: rig.model.workoutLog.doneDays))
    }
}
