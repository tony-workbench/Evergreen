import Foundation
import Testing
@testable import Evergreen

/// A day at home through the app model: a time passed without a start moves the session, Swap stays within what is
/// earned, found places are never lost, an old pick is read, "Too hard" reaches the engine, a day done another way on the
/// calendar, a session Apple Health couldn't take, the week table's four states, and a session across going offline.
/// Thursday 19 November 2026, Los Angeles.
@MainActor
struct HomeDayFlowTests {
    private let thursday = "2026-11-19", friday = "2026-11-20"
    private let cal = Fixture.calendar

    private func homeDay(_ iso: String, weekday: String, dayOffset: Int) -> HomeWeek.Day {
        HomeWeek.Day(day: iso, weekday: weekday, kind: .home, focus: "full",
                     first: LocalTime(Fixture.at(16, 40, dayOffset: dayOffset), in: cal.timeZone),
                     fallbacks: [(18, 10), (19, 10)].map { LocalTime(Fixture.at($0.0, $0.1, dayOffset: dayOffset), in: cal.timeZone) })
    }

    /// Rules on, today and Friday at home at 16:40 with later times 18:10 and 19:10, and each day's session on the plan.
    private func twoDaysAtHome(at now: Date = Clocks.morning) throws -> AppRig {
        let rig = try AppRig(.init(now: now, history: AppRig.runs(days: 0, before: now)))
        rig.model.userRules.isOn = true
        rig.model.homeWeek = HomeWeek(days: [homeDay(thursday, weekday: "Thursday", dayOffset: 0),
                                             homeDay(friday, weekday: "Friday", dayOffset: 1)],
                                      homeDays: 2, trainingDays: 2, madeOn: rig.model.todayISO)
        rig.model.writeStrength = { _, _ in false }
        try rig.plan(.strength, id: "home-thu", day: 0, hour: 16, minute: 40, minutes: 25)
        try rig.plan(.strength, id: "home-fri", day: 1, hour: 16, minute: 40, minutes: 25)
        return rig
    }

    private func start(_ rig: AppRig, _ id: String) -> Date? { rig.model.plan.first { $0.id == id }?.slot.start }

    // MARK: A time passed without a start

    @Test func aTimePassedWithoutAStartMovesThePlanAndTheCalendarToTheNextTime() throws {
        let rig = try twoDaysAtHome()
        rig.clock.now = Fixture.at(16, 59)
        rig.model.moveMissedHomeTimes()
        #expect(start(rig, "home-thu") == Fixture.at(16, 40), "not twenty minutes yet")
        rig.clock.now = Fixture.at(17, 1)
        rig.model.moveMissedHomeTimes()
        #expect(start(rig, "home-thu") == Fixture.at(18, 10))
        #expect(rig.calendar.event(for: "home-thu")?.start == Fixture.at(18, 10))
        // A notification shown with the app open looks again: 18:10 passed too.
        rig.clock.now = Fixture.at(18, 31)
        rig.model.notifier.onDelivered?()
        #expect(start(rig, "home-thu") == Fixture.at(19, 10))
        #expect(rig.calendar.event(for: "home-thu")?.start == Fixture.at(19, 10))
        // After the last time there is nowhere to go: it stays.
        rig.clock.now = Fixture.at(19, 31)
        rig.model.moveMissedHomeTimes()
        #expect(start(rig, "home-thu") == Fixture.at(19, 10))
        #expect(start(rig, "home-fri") == Fixture.at(16, 40, dayOffset: 1), "only today's session moves")
    }

    @Test func nothingMovesByItselfWithATimePickedOrTheSessionOpened() async throws {
        let rig = try twoDaysAtHome()
        rig.clock.now = Fixture.at(17, 1)
        await rig.model.pickTime("16:40", day: thursday)
        rig.model.moveMissedHomeTimes()
        #expect(start(rig, "home-thu") == Fixture.at(16, 40), "a picked time only moves on Move to …")
        await rig.model.pickTime(nil, day: thursday)
        WorkoutProgress(day: thursday, content: oneMovement, results: [WorkoutResult(movementId: "sit_to_stand")],
                        startedAt: Fixture.at(16, 45)).save(to: rig.settings)
        rig.model.moveMissedHomeTimes()
        #expect(start(rig, "home-thu") == Fixture.at(16, 40), "a session under way isn't moved")
    }

    // MARK: Swap

    @Test func swapNeverOffersAHarderMovementThatIsntEarned() async throws {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        rig.model.userRules.isOn = true
        await rig.model.refreshClosedMovements()
        let knee = try #require(rig.model.movement("knee_push_up"))
        #expect(!rig.model.swapChoices(for: knee).map(\.id).contains("push_up"), "push-up comes only after knee push-ups are passed")
        let gated = try #require(rig.model.movement("rear_foot_split_squat"))
        #expect(!rig.model.isOpen(gated))
        // The person's own "I can" opens it.
        var rules = rig.model.userRules
        rules.movements["push_up"] = .can
        await rig.model.saveRules(rules, quiet: true)
        #expect(rig.model.swapChoices(for: knee).map(\.id).contains("push_up"))
    }

    // MARK: Found places

    struct SlowGeocoder: PlaceGeocoding {
        let places: [String: Coordinate]
        func coordinate(for text: String) async throws -> Coordinate? {
            if text == "Library" { try await Task.sleep(for: .milliseconds(200)) }
            return places[text]
        }
    }

    @Test func twoClassificationsAtOnceKeepEveryPlaceFound() async throws {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        let home = Coordinate(latitude: 40, longitude: -100)
        rig.model.userRules.isOn = true
        rig.model.userRules.home = HomePlace(place: home)
        rig.model.geocoder = SlowGeocoder(places: ["Library": Coordinate(latitude: 40.3, longitude: -100), "Office": home])
        let event = { (text: String) in Busy(start: Fixture.at(12), end: Fixture.at(13), place: .text(text)) }
        rig.model.busyCache = [event("Library")]
        let slow = Task { await rig.model.refreshDayKinds() }
        try await Task.sleep(for: .milliseconds(20))
        rig.model.busyCache = [event("Office")]
        await rig.model.refreshDayKinds()
        await slow.value
        #expect(PlaceMemory.load(from: rig.settings).map(\.text).sorted() == ["Library", "Office"])
    }

    // MARK: A time picked under the old key

    @Test func aTimePickedUnderTheOldKeyIsReadOnceAndMoved() throws {
        let rig = try AppRig()
        rig.settings.set([friday: "18:10", "2026-11-25": "16:40"], forKey: ChosenSlot.oldKey)
        rig.settings.set(["2026-11-25": "19:10"], forKey: ChosenSlot.key)
        #expect(rig.model.pickedTimes == [friday: "18:10", "2026-11-25": "19:10"], "the new key wins a day picked under both")
        #expect(rig.settings.object(forKey: ChosenSlot.oldKey) == nil)
        #expect(ChosenSlot.all(in: rig.settings, from: thursday) == [friday: "18:10", "2026-11-25": "19:10"])
    }

    // MARK: "Too hard" in the history

    @Test func tooHardReachesTheEngineAndAnOlderLogStillReads() throws {
        var log = WorkoutLog()
        var hard = WorkoutResult(movementId: "knee_push_up", sets: [12, 12, 12])
        hard.tooHard = true
        log.record(day: thursday, results: [hard, WorkoutResult(movementId: "sit_to_stand", sets: [10])], pain: nil)
        let history = try #require(log.engineHistory.array)
        #expect(history[0]["tooHard"] == .bool(true))
        #expect(history[1]["tooHard"] == nil, "written only when true")
        let old = #"{"entries":[{"movementId":"sit_to_stand","day":"2026-11-18","sets":[10]}],"loads":{},"doneDays":[],"turn":0}"#
        let read = try JSONDecoder().decode(WorkoutLog.self, from: Data(old.utf8))
        #expect(read.entries.first?.tooHard == nil && read.entries.count == 1)
    }

    // MARK: Done another way, on the calendar

    @Test func anotherDayDoneAnotherWayStaysWherePlannedMarkedDoneAndCanBeTakenBack() async throws {
        let rig = try twoDaysAtHome()
        await rig.model.handleWorkoutAction(.alreadyDone, day: friday)
        let done = try #require(rig.calendar.event(for: "home-fri"))
        #expect(done.start == Fixture.at(16, 40, dayOffset: 1), "nothing in Apple Health: it stays at its time")
        #expect(done.title.hasSuffix(CalendarEntry.doneMark))
        #expect(rig.calendar.event(for: "home-thu")?.title.hasSuffix(CalendarEntry.doneMark) == false)
        await rig.model.undoDoneAnotherWay(day: friday)
        #expect(!rig.model.workoutLog.didHomeSession(on: friday))
        #expect(rig.calendar.event(for: "home-fri")?.title.hasSuffix(CalendarEntry.doneMark) == false)
        #expect(rig.calendar.event(for: "home-fri")?.start == Fixture.at(16, 40, dayOffset: 1))
    }

    // MARK: Apple Health couldn't take it

    private let oneMovement = WorkoutContent(sessionId: nil, focus: "full", minutes: 20,
                                             items: [.init(movementId: "sit_to_stand", sets: 3, reps: [8, 12], rest: 60, isNew: false)])

    @Test func aSessionAppleHealthCouldntTakeStillCounts() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(17, 10))
        let progress = WorkoutProgress(day: thursday, content: oneMovement,
                                       results: [WorkoutResult(movementId: "sit_to_stand", sets: [10, 10, 10])], startedAt: Fixture.at(16, 45))
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        #expect(rig.model.loggedWorkouts.map(\.id) == ["page-\(thursday)"])
        #expect(rig.model.trainedStrength(on: thursday))
        #expect(rig.model.earnedTime.weekMinutes >= 25, "the 25 minutes count towards earned time")
        // Finished again by mistake: still one.
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        #expect(rig.model.loggedWorkouts.count == 1)
    }

    @Test func aSessionAppleHealthTookIsNotKeptTwice() async throws {
        let rig = try twoDaysAtHome(at: Fixture.at(17, 10))
        rig.model.writeStrength = { _, _ in true }
        let progress = WorkoutProgress(day: thursday, content: oneMovement,
                                       results: [WorkoutResult(movementId: "sit_to_stand", sets: [10, 10, 10])], startedAt: Fixture.at(16, 45))
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        #expect(rig.model.loggedWorkouts.isEmpty)
    }

    // MARK: The week table's states

    @Test func theWeekTableLoadsReadyOfflineOrFailed() async throws {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        #expect(rig.model.homeWeekLoad == .loading, "before anything is worked out")
        // Rules off: no week can be worked out.
        await rig.model.loadHomeWeek()
        #expect(rig.model.homeWeekLoad == .failed)
        // Rules on, the AI out of reach: the rules' week, said as offline, not as a failure.
        rig.model.userRules.isOn = true
        rig.model.scriptedModel = ScriptedModel([.failure(.unreachable)])
        await rig.model.loadHomeWeek()
        #expect(rig.model.homeWeekLoad == .offline)
        #expect(rig.model.homeWeek != nil && !rig.model.homeWeekContent.isEmpty && rig.model.homeWeekReasons.isEmpty)
        // Any other AI failure leaves the rules' week quietly.
        rig.model.scriptedModel = ScriptedModel([.failure(.keyRefused)])
        await rig.model.loadHomeWeek()
        #expect(rig.model.homeWeekLoad == .ready)
    }

    // MARK: The calendar changes during the day

    @Test func aCalendarChangeDuringTheDayWorksTheWeekOutAgainForTheDaysItChanges() async throws {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        rig.model.userRules.isOn = true
        await rig.model.loadHomeWeek()
        rig.settings.set(rig.model.todayISO, forKey: AppModel.checkedDayKey)   // the day's first look is done
        let before = try #require(rig.model.homeWeek)
        #expect(before.day(friday)?.kind == .home)
        // An all-day event away on Friday lands on the calendar: no new day, so only the changed days move.
        rig.calendar.placed = [Busy(start: cal.startOfDay(for: Fixture.at(9, dayOffset: 1)), end: cal.startOfDay(for: Fixture.at(9, dayOffset: 2)),
                                    place: .text("Conference centre"))]
        await rig.model.checkHomeWeek()
        let after = try #require(rig.model.homeWeek)
        #expect(after.day(friday)?.kind == .out)
        #expect(after.day(thursday) == before.day(thursday), "today is as it was")
        // Nothing changed since: the week is left as it is.
        await rig.model.checkHomeWeek()
        #expect(rig.model.homeWeek == after)
    }

    // MARK: Offline in the middle of a session

    /// The rules' own content for every day of the week, as an AI answer that passes every check.
    private func echo(_ content: [String: WorkoutContent]) -> String {
        let days = content.sorted { $0.key < $1.key }.map { day, content -> JSONValue in
            ["day": .string(day), "reason": "A steady mix for the week.",
             "items": .array(content.items.map { ["movementId": .string($0.movementId), "sets": .number(Double($0.sets))] })]
        }
        return JSONValue.object(["days": .array(days)]).text
    }

    /// Offline (the AI can't be reached), Thursday at home, with its session under way: a set done and the next movement open.
    private func offlineSessionUnderWay() async throws -> (rig: AppRig, progress: WorkoutProgress) {
        let rig = try AppRig(.init(history: AppRig.runs(days: 0, before: Clocks.morning)))
        rig.model.userRules.isOn = true
        rig.model.writeStrength = { _, _ in false }
        rig.model.scriptedModel = ScriptedModel([.failure(.unreachable)])
        await rig.model.loadHomeWeek()
        rig.model.dayKinds[thursday] = .home
        rig.settings.set([thursday: "full"], forKey: AppModel.homeFocusKey)
        var progress = try #require(await rig.model.workoutToday().progress)
        progress.results[0].sets = [10]
        progress.index = 1
        rig.model.saveProgress(progress)
        return (rig, progress)
    }

    @Test func goingOfflineMidSessionLosesNothingAndComingBackDoesntDuplicateIt() async throws {
        let (rig, progress) = try await offlineSessionUnderWay()
        // Offline: the page opens again where it stopped.
        #expect(await rig.model.workoutToday().progress == progress)
        // Back online: the AI's week comes in, and the session under way stays the one on the page.
        rig.model.scriptedModel = ScriptedModel([ScriptedModel.text(echo(rig.model.homeWeekContent))])
        await rig.model.loadHomeWeek()
        #expect(rig.model.homeWeekLoad == .ready)
        #expect(await rig.model.workoutToday().progress == progress)
        rig.clock.now = Fixture.at(9, 20)
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        await rig.model.finishWorkout(progress, pain: nil, feeling: nil)
        #expect(rig.model.workoutLog.doneDays == [thursday])
        #expect(rig.model.workoutLog.entries.filter { $0.day == thursday }.count == 1)
        #expect(rig.model.loggedWorkouts.count == 1)
    }
}
