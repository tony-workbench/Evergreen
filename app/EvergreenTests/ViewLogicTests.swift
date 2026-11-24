import Foundation
import Testing
@testable import Evergreen

/// What the screens decide, now in the model (Model/AppModel+ViewLogic.swift, AppModel+WorkoutPage.swift and
/// EarnedTimeModel): changing an answer in My rules and "How you train", importing a profile, finishing or skipping "How
/// you train", saying the fresh start once, what "What I remember" and Today show, how the week table names a day and
/// when it works the week out again, the workout page's questions, sets and rest, where each first-setup permission
/// stands, the Settings counts, and the debug launch arguments UI tests use.
@MainActor
struct ViewLogicTests {
    // MARK: Rules answers

    @Test func equipmentTurnsOnAndOffInTheOrderTheScreensShow() {
        var rules = UserRules()
        rules.equipment = []
        rules.setEquipment(.step, on: true)
        rules.setEquipment(.backpack, on: true)
        #expect(rules.equipment == [.backpack, .step])
        rules.setEquipment(.step, on: false)
        rules.setEquipment(.chair, on: false)
        #expect(rules.equipment == [.backpack])
        rules.setEquipment(.backpack, on: true)
        #expect(rules.equipment == [.backpack])
    }

    @Test func aMovementIsLeftOutOnceAndCanBeTakenBack() {
        var rules = UserRules()
        rules.setLeftOut("burpee", true)
        rules.setLeftOut("burpee", true)
        rules.setLeftOut("lunge", true)
        #expect(rules.avoid == ["burpee", "lunge"])
        rules.setLeftOut("burpee", false)
        rules.setLeftOut("plank", false)
        #expect(rules.avoid == ["lunge"])
    }

    @Test func theLengthChoiceSetsBothEndsAndFallsBackToTheUsualOne() {
        var rules = UserRules()
        #expect(rules.lengthChoice == UserRules.usualLengthChoice)
        rules.lengthChoice = 2
        #expect(rules.sessionMin == 30 && rules.sessionMax == 40)
        #expect(rules.lengthChoice == 2)
        rules.lengthChoice = 7
        #expect(rules.sessionMin == 30 && rules.sessionMax == 40)
        rules.sessionMin = 10
        rules.sessionMax = 12
        #expect(rules.lengthChoice == UserRules.usualLengthChoice)
        #expect(UserRules.lengthChoices.map(\.words) == ["15–20 min", "20–25 min", "30–40 min"])
    }

    @Test func theMovementsSummaryCountsWhatIsLeftOutAndWhatCantBeDoneYet() {
        var rules = UserRules()
        #expect(rules.movementsSummary == "All open")
        rules.avoid = ["burpee", "lunge"]
        #expect(rules.movementsSummary == "2 left out")
        rules.movements = ["pushup": .cannot, "squat": .can]
        #expect(rules.movementsSummary == "2 left out · 1 can’t do yet")
        rules.avoid = []
        #expect(rules.movementsSummary == "1 can’t do yet")
    }

    @Test func aRestWeekdayChipComesAndGoesKeepingMondayFirst() {
        #expect(UserRules.toggling(4, in: [2, 6]) == [2, 4, 6])
        #expect(UserRules.toggling(2, in: [2, 4, 6]) == [4, 6])
        #expect(UserRules.toggling(0, in: []) == [0])
        #expect(UserRules.toggling(0, in: [0]) == [])
    }

    @Test func aClockAnswerBecomesAPickerTimeAndBack() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let day = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 24, hour: 3)))
        let evening = UserRules.date(ofClock: "18:45", on: day, calendar: calendar)
        #expect(calendar.isDate(evening, inSameDayAs: day))
        #expect(calendar.component(.hour, from: evening) == 18 && calendar.component(.minute, from: evening) == 45)
        #expect(UserRules.clock(of: evening, calendar: calendar) == "18:45")
        let unreadable = UserRules.date(ofClock: "late", on: day, calendar: calendar)
        #expect(UserRules.clock(of: unreadable, calendar: calendar) == "12:00")
        let early = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 24, hour: 6, minute: 5)))
        #expect(UserRules.clock(of: early, calendar: calendar) == "06:05")
    }

    @Test func myRulesGroupsTheLibrarysMovementsByWhatTheyWork() async throws {
        let rig = try AppRig()
        await rig.model.loadMovements()
        let core = rig.model.movements(working: "core")
        #expect(!core.isEmpty)
        #expect(core.allSatisfy { $0.pattern == "core" })
        #expect(core.map(\.id) == rig.model.movements.filter { $0.pattern == "core" }.map(\.id))
        #expect(rig.model.movements(working: "no_such_pattern").isEmpty)
    }

    // MARK: How you train

    @Test func continuingAtHomeTurnsTheAnswersOnAndKeepsThem() throws {
        let rig = try AppRig()
        var answers = UserRules()
        answers.restWeekdays = [0]
        answers.lengthChoice = 0
        rig.model.answerHowYouTrain(answers, atHome: true)
        #expect(rig.model.userRules.isOn && rig.model.userRules.restWeekdays == [0])
        #expect(UserRules.load(from: rig.settings) == rig.model.userRules)
    }

    @Test func continuingFromSomewhereElseLeavesTheRulesAsTheyWere() throws {
        let rig = try AppRig()
        let before = rig.model.userRules
        var answers = UserRules()
        answers.restWeekdays = [0]
        rig.model.answerHowYouTrain(answers, atHome: false)
        #expect(rig.model.userRules == before)
        #expect(rig.settings.data(forKey: UserRules.storeKey) == nil)
    }

    @Test func skippingTurnsOnTheUsualRules() throws {
        let rig = try AppRig()
        rig.model.skipHowYouTrain()
        var usual = UserRules()
        usual.isOn = true
        #expect(rig.model.userRules == usual)
        #expect(UserRules.load(from: rig.settings) == usual)
    }

    // MARK: Fresh start

    @Test func theFreshStartLineGoesAndIsRememberedInTheModelsSettings() throws {
        let rig = try AppRig()
        rig.model.startedFreshNotice = true
        rig.model.dismissFreshStartNotice()
        #expect(!rig.model.startedFreshNotice)
        #expect(rig.settings.bool(forKey: AppModel.freshStartSaidKey))
    }

    // MARK: The week table

    @Test func aPastDayIsNamedByItsWeekdayAndMonthAndDay() {
        #expect(AppModel.EarlierDay(day: "2026-11-30", focus: nil, outcome: .done).title == "Monday 11-30")
        #expect(AppModel.EarlierDay.title("2028-02-29") == "Tuesday 02-29")
        #expect(AppModel.EarlierDay.title("not a day") == "not a day")
        #expect(AppModel.EarlierDay.title("2026-11") == "2026-11")
    }

    @Test func aComingDayIsNamedByItsWeekdayAndMonthAndDay() {
        let day = HomeWeek.Day(day: "2026-12-01", weekday: "Tuesday", kind: .out, focus: nil, first: nil, fallbacks: [])
        #expect(day.title == "Tuesday 12-01")
    }

    // MARK: First-setup permissions

    @Test func aPermissionIsOnOffOrStillToAsk() {
        #expect(PermissionState(on: true, asked: true) == .on)
        #expect(PermissionState(on: true, asked: false) == .on)
        #expect(PermissionState(on: false, asked: true) == .off)
        #expect(PermissionState(on: false, asked: false) == .ask)
    }

    @Test func theCalendarRowFollowsTheCalendarsAccess() throws {
        #expect(try AppRig(.init(calendarAccess: .on)).model.permissionState(.calendar, asked: []) == .on)
        #expect(try AppRig(.init(calendarAccess: .notAsked)).model.permissionState(.calendar, asked: []) == .ask)
        #expect(try AppRig(.init(calendarAccess: .off)).model.permissionState(.calendar, asked: [.calendar]) == .off)
    }

    @Test func healthNeverSaysSoAnAnsweredPromptCountsAsAsked() throws {
        let rig = try AppRig()
        #expect(rig.model.permissionState(.health, asked: []) == .ask)
        #expect(rig.model.permissionState(.health, asked: [.health]) == .asked)
        #expect(rig.model.permissionState(.notifications, asked: []) == .ask)
    }

    @Test func thePageAsksForFourPermissionsWithScreenTimeLast() {
        #expect(SetupPermission.allCases == [.calendar, .health, .notifications, .screenTime])
        #expect(!AppModel.fakesPermissionAnswers)
    }

    // MARK: UI-test launch arguments

    #if DEBUG
    private static let seeded = ["Evergreen", "-uiTest", "home"]

    @Test func aRouteIsReadOnlyOnASeededLaunch() {
        #expect(UITestArguments.route(in: Self.seeded + ["-uiTestRoute", "session"]) == .session)
        #expect(UITestArguments.route(in: Self.seeded + ["-uiTestRoute", "week:2026-11-26"]) == .week(day: "2026-11-26"))
        #expect(UITestArguments.route(in: Self.seeded + ["-uiTestRoute", "week:26-11-2026"]) == nil)
        #expect(UITestArguments.route(in: Self.seeded + ["-uiTestRoute", "week:2026-1a-26"]) == nil)
        #expect(UITestArguments.route(in: Self.seeded + ["-uiTestRoute"]) == nil)
        #expect(UITestArguments.route(in: ["Evergreen", "-uiTestRoute", "session"]) == nil)
    }

    @Test func offlineTimeFakeAnswersAndReducedMotionNeedASeededLaunch() {
        #expect(UITestArguments.offlineSeconds(in: Self.seeded + ["-uiOfflineFor", "20"]) == 20)
        #expect(UITestArguments.offlineSeconds(in: Self.seeded + ["-uiOfflineFor", "0"]) == nil)
        #expect(UITestArguments.offlineSeconds(in: Self.seeded + ["-uiOfflineFor", "soon"]) == nil)
        #expect(UITestArguments.offlineSeconds(in: ["Evergreen", "-uiOfflineFor", "20"]) == nil)
        #expect(UITestArguments.fakesPermissions(in: Self.seeded + ["-uiFakePermissions"]))
        #expect(!UITestArguments.fakesPermissions(in: ["Evergreen", "-uiFakePermissions"]))
        #expect(UITestArguments.reducesMotion(in: Self.seeded + ["-reduceMotion"]))
        #expect(!UITestArguments.reducesMotion(in: ["Evergreen", "-reduceMotion"]))
        #expect(!UITestArguments.reducesMotion(in: Self.seeded))
    }

    @Test func screenQuestionAndYesFlagsNeedASeededLaunch() {
        #expect(UITestArguments.isSeeded(in: Self.seeded) && !UITestArguments.isSeeded(in: ["Evergreen"]))
        #expect(UITestArguments.screen(in: Self.seeded + ["-uiScreen", "memory"]) == "memory")
        #expect(UITestArguments.screen(in: ["Evergreen", "-uiScreen", "memory"]) == nil)
        #expect(UITestArguments.question(in: Self.seeded + ["-uiAsk", "Move Friday"]) == "Move Friday")
        #expect(UITestArguments.question(in: Self.seeded) == nil)
        #expect(UITestArguments.staysWithoutKey(in: Self.seeded + ["-uiNoKey", "YES"]))
        #expect(!UITestArguments.staysWithoutKey(in: Self.seeded + ["-uiNoKey", "NO"]))
        #expect(!UITestArguments.staysWithoutKey(in: ["Evergreen", "-uiNoKey", "YES"]))
        #expect(UITestArguments.answersSuggestions(in: Self.seeded + ["-uiAnswers", "1"]))
        #expect(!UITestArguments.answersSuggestions(in: Self.seeded))
    }
    #endif

    @Test func aLaunchAnswersOnlyOpenSuggestionsWithATime() async throws {
        let model = try await EngineTests.model()
        try await model.loadWeekPlan()
        let plan = try #require(await model.planIfPossible())
        let open = model.answerableSuggestions(in: plan)
        #expect(open.allSatisfy { $0.after != nil && model.suggestionState($0) == .open })
        let first = try #require(open.first)
        await model.accept(first)
        #expect(!model.answerableSuggestions(in: plan).contains { $0.id == first.id })
    }

    @Test func motionIsReducedWhenTheSystemSaysSo() {
        // The test run itself has no `-uiTest` seed, so only the system setting counts.
        #expect(Motion.reduced(true))
        #expect(!Motion.reduced(false))
    }

    // MARK: My rules, once more

    @Test func theSessionSteppersStayWithinTheRulesAndEachOther() {
        var rules = UserRules()
        rules.sessionMax = 25
        #expect(rules.shortestRange == UserRules.shortestSession...25)
        rules.sessionMax = UserRules.shortestSession - UserRules.sessionStep
        #expect(rules.shortestRange == UserRules.shortestSession...UserRules.shortestSession)
        rules.sessionMin = 30
        #expect(rules.longestRange == 30...UserRules.longestSession)
        rules.sessionMin = UserRules.longestSession + UserRules.sessionStep
        #expect(rules.longestRange == UserRules.longestSession...UserRules.longestSession)
    }

    @Test func aSectionShowsOnlyItsOwnProblemsAndTheTogglesReadTheRules() {
        var rules = UserRules()
        rules.restWeekdays = [7]
        #expect(rules.shownProblems([.restDays]) == [.restDays])
        #expect(rules.shownProblems([.clock, .window, .movements]).isEmpty)
        rules.equipment = [.backpack]
        rules.setLeftOut("burpee", true)
        #expect(rules.has(.backpack) && !rules.has(.step))
        #expect(rules.isLeftOut("burpee") && !rules.isLeftOut("plank"))
    }

    @Test func aProfileIsImportedOrSaysWhyNothingChanged() throws {
        let rig = try AppRig()
        let rules = UserRules()
        guard case .imported(let taken) = rig.model.importProfile(Data(#"{"restWeekdays":[6,2]}"#.utf8), onto: rules) else {
            Issue.record("the profile wasn't taken")
            return
        }
        #expect(taken.isOn && taken.restWeekdays == [2, 6])
        #expect(rig.model.importProfile(Data(#"{"restWeekdays":[7]}"#.utf8), onto: rules) == .problem(ProfileImport.outOfRange))
        #expect(rig.model.importProfile(Data("not json".utf8), onto: rules) == .problem(ProfileImport.unreadable))
    }

    @Test func aPickedProfileFileIsReadAndNothingPickedSaysNothing() throws {
        let rig = try AppRig()
        let rules = UserRules()
        #expect(rig.model.importProfile(from: .failure(CocoaError(.userCancelled)), onto: rules) == nil)
        let missing = FileManager.default.temporaryDirectory.appending(path: "no-profile-\(UUID().uuidString).json")
        #expect(rig.model.importProfile(from: .success(missing), onto: rules) == .problem(ProfileImport.unreadable))
        let file = FileManager.default.temporaryDirectory.appending(path: "profile-\(UUID().uuidString).json")
        try Data(#"{"restWeekdays":[0]}"#.utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        guard case .imported(let taken)? = rig.model.importProfile(from: .success(file), onto: rules) else {
            Issue.record("the file wasn't taken")
            return
        }
        #expect(taken.restWeekdays == [0])
    }

    // MARK: What I remember

    @Test func beforeATableTheBriefsLinesStandInAndTheThinLineSaysTheDays() async throws {
        let rig = try AppRig()
        await rig.model.memoryTask?.value
        rig.model.memoryRows = []
        rig.model.memoryBrief = MemoryBriefTests.full
        #expect(rig.model.memoryShown(.body).sentences.map(\.key) == ["load", "sleep", "resting_hr"])
        #expect(rig.model.memoryShown(.routine).sentences.count == MemoryBriefTests.full.lines(.routine).count)
        rig.model.memoryBrief = MemoryBrief(lines: [.init(group: .routine, id: "thin", key: nil, text: "9 days of data, fewer than 14.")])
        let thin = rig.model.memoryShown(.routine).sentences
        #expect(thin.map(\.text) == [rig.model.thinMemoryWords] && thin.first?.key == nil)
        #expect(rig.model.memoryEmptyWords(.routine) == "Nothing here. I learn this from your workouts.")
    }

    @Test func rowsGoToTheirGroupAndAFigureIsntSaidAgain() async throws {
        let rig = try AppRig()
        await rig.model.memoryTask?.value
        rig.model.memoryRows = [PlanFakes.load, MemoryBriefTests.home]
        let routine = rig.model.memoryShown(.routine)
        #expect(routine.sentences.map(\.key) == [MemoryBriefTests.home.key])
        let body = rig.model.memoryShown(.body)
        #expect(!body.isEmpty)
        #expect(!body.sentences.contains { line in body.figures.contains { $0.key == line.key } })
        #expect(!body.sentences.contains { $0.key == MemoryBriefTests.home.key })
    }

    // MARK: Today

    @Test func todaysOtherLinesLeaveOutTheTopOneAndListEachNotNowOnce() async throws {
        let (rig, session, _) = try await DeclineAndRestoreTests.ready()
        let model = rig.model
        let groups = model.otherSuggestionGroups(except: session)
        #expect(!groups.flatMap(\.sessions).contains { $0.id == session.id })
        #expect(groups.flatMap(\.sessions).allSatisfy { ($0.after?.start ?? .distantPast) > model.now })
        #expect(model.cardChips(for: session).count <= Basis.mostOnCard)
        #expect(model.cardChips(for: session) == Array(Basis.chips(model.bases(for: session), for: session).prefix(Basis.mostOnCard)))
        await model.decline(session)
        let keys = model.olderStopNotes.map(\.answerKey)
        #expect(keys == Array(Set(keys)).sorted())
        #expect(!keys.contains { $0 == model.lastDecline?.answerKey })
        #expect(!model.hasRunOnPlan, "nothing is on the plan yet")
    }

    @Test func aGroupsButtonsCountItsSessionsAndAddAllNeedsMoreThanOne() async throws {
        let (rig, session, _) = try await DeclineAndRestoreTests.ready()
        let one = SuggestionGroup(sessions: [session]), three = SuggestionGroup(sessions: Array(repeating: session, count: 3))
        #expect(!one.isSeveral && one.addLabel == "Add" && one.notNowLabel == "Not now")
        #expect(one.addHint == "Adds it to your plan and calendar")
        #expect(three.isSeveral && three.addLabel == "Add 3" && three.notNowLabel == "Not now, all 3")
        #expect(three.addHint == "Adds them to your plan and calendar")
        #expect(rig.model.offersAddAll == (rig.model.aiConnected && rig.model.openSuggestions.count > 1))
        let noAI = try AppRig(.init(connected: false))
        #expect(!noAI.model.offersAddAll, "no AI, no Add all")
    }

    @Test func aProposalListLeavesOutTheLeadAndABreakEndsOnTime() {
        let zone = Fixture.calendar.timeZone
        let start = Clocks.morning
        func block(_ id: String) -> PreviewBlock {
            PreviewBlock(id: id, sessionId: nil, activity: .run, title: "Run", start: LocalTime(start, in: zone),
                         end: LocalTime(start.addingTimeInterval(1800), in: zone), minutes: 30, status: "new", reason: "Free then.")
        }
        let result = CalendarResult(kind: "add", message: "That works.", proposed: [block("a"), block("b")])
        #expect(result.otherProposals(than: block("a")).map(\.id) == ["b"])
        #expect(result.otherProposals(than: nil).map(\.id) == ["a", "b"])
        #expect(AppModel.breakEnd(from: start, minutes: 5) == start.addingTimeInterval(300))
        let later = start.addingTimeInterval(7200)
        let snacks = RainSnacks(day: start, blocks: [DateInterval(start: start, duration: 600), DateInterval(start: later, duration: 600)],
                                worstProbability: 80, key: "rain")
        #expect(snacks.offerDetail.hasPrefix("2 breaks of \(snacks.minutes) minutes at \(start.clock), \(later.clock), to stand in for a walk."))
    }

    @Test func aBreaksMovementsTakeTurnsByItsPlaceAmongTodaysBreaks() async throws {
        let rig = try AppRig()
        await rig.model.loadMovements()
        let first = rig.model.snackMovements(turn: 0)
        #expect(first.count <= AppModel.movementsPerSnack)
        let notToday = PlanItem(id: "not-a-break-today", slot: Slot(start: Clocks.morning, end: Clocks.morning.addingTimeInterval(600), activityType: "Other"))
        #expect(rig.model.snackMovements(for: notToday) == first)
    }

    // MARK: The workout page

    @Test func theSlowStepLineComesFromTheModel() async throws {
        let rig = try AppRig()
        await rig.model.loadMovements()
        let move = try #require(rig.model.movements.first { $0.tempo != nil })
        let tempo = try #require(move.tempo)
        let slow = WorkoutContent.Item(movementId: move.id, sets: 3, reps: [8, 12], rest: 60, isNew: false, slow: true)
        var progress = WorkoutProgress(day: rig.model.todayISO, content: WorkoutContent(focus: "full", minutes: 20, items: [slow]),
                                       results: [WorkoutResult(movementId: move.id, sets: [])], startedAt: rig.model.now)
        let down = tempo.down + WorkoutContent.slowExtraSeconds
        #expect(progress.slowLine(for: move) == "Slower this time: lower in \(down) seconds instead of \(tempo.down).")
        progress.content.items[0].slow = nil
        #expect(progress.slowLine(for: move) == nil)
        var noTempo = move
        noTempo.tempo = nil
        progress.content.items[0].slow = true
        #expect(progress.slowLine(for: noTempo) == nil)
    }

    @Test func thePageAsksFirstAndSaysTheNextSetFromTheModel() async throws {
        let rig = try AppRig()
        await rig.model.loadMovements()
        let move = try #require(rig.model.movements.first)
        let item = WorkoutContent.Item(movementId: move.id, sets: 3, reps: [8, 12], rest: 60, isNew: true)
        var progress = WorkoutProgress(day: rig.model.todayISO, content: WorkoutContent(focus: "full", minutes: 20, items: [item]),
                                       results: [WorkoutResult(movementId: move.id, sets: [])], startedAt: rig.model.now)
        #expect(rig.model.asksFirst(progress, move: move))
        #expect(rig.model.nextSetLine(progress) == "Next: \(move.name), set 1 of 3.")
        #expect(progress.isLastMovement && progress.shownSetNumber == 1)
        progress.results[0].sets = [10, 10, 10]
        #expect(!rig.model.asksFirst(progress, move: move))
        #expect(progress.nextSetNumber == 4 && progress.shownSetNumber == 3)
        rig.model.userRules.movements[move.id] = .can
        progress.results[0].sets = []
        #expect(!rig.model.asksFirst(progress, move: move), "the rules already know")
        #expect(rig.model.nextSetLine(nil) == "")
    }

    @Test func theRestCountsDownByTheModelsClock() throws {
        let rig = try AppRig()
        let item = WorkoutContent.Item(movementId: "x", sets: 3, reps: [8, 12], rest: 60, isNew: false)
        let end = rig.model.restEnd(after: item)
        #expect(end == rig.model.now.addingTimeInterval(60))
        #expect(rig.model.timeLeft(until: end) == 60)
        #expect(AppModel.rest(end, longer: true) == end.addingTimeInterval(AppModel.restStep))
        #expect(AppModel.rest(end, longer: false) == end.addingTimeInterval(-AppModel.restStep))
        #expect(AppModel.restWords(40) == "40 seconds")
        #expect(AppModel.restWords(65) == "1 minute 5 seconds")
        #expect(AppModel.restWords(120) == "2 minutes")
        #expect(AppModel.restWords(0.2) == "1 second")
        #expect(AppModel.restWords(-3) == "0 seconds")
        #expect(item.countRange == 0...WorkoutContent.Item.leastCount)
        let long = WorkoutContent.Item(movementId: "x", sets: 3, reps: [20, 25], rest: 60, isNew: false)
        #expect(long.countRange == 0...50)
    }

    @Test func eachSorenessAnswerIsKeptAsItsValueAndSaysWhatComesNext() {
        #expect(SorenessAnswer.allCases.map(\.rawValue) == [2, 4, 5])
        #expect(SorenessAnswer.allCases.map(\.title) == ["0–3", "4", "5 or more"])
        #expect(SorenessAnswer.low.followUp == nil)
        #expect(SorenessAnswer.fewerSets.followUp?.words == "Next time has one set fewer.")
        #expect(SorenessAnswer.fewerSets.followUp?.warning == false)
        #expect(SorenessAnswer.rest.followUp?.warning == true)
    }

    @Test func aMovementsStepsAreNumberedAndKeepTheirOwnIdentity() async throws {
        #expect(TextIdentity.ids(["Breathe in.", "Lift.", "Breathe in."]) == ["Breathe in.", "Lift.", "Breathe in.#1"])
        let rig = try AppRig()
        await rig.model.loadMovements()
        let move = try #require(rig.model.movements.first { $0.steps.count > 1 })
        #expect(move.numberedSteps.map(\.text) == move.steps)
        #expect(move.numberedSteps.map(\.number) == Array(1...move.steps.count))
        #expect(Set(move.numberedSteps.map(\.id)).count == move.steps.count)
        #expect(WorkoutContent.Item(movementId: "x", sets: 2, seconds: [20, 30], rest: 45, isNew: false).target(sides: Movement.bothSides)
            == "20–30 seconds each side")
    }

    // MARK: Earned time, the week table and Settings

    @Test func earnedMinutesAddTodaysFreeTimeOnceOn() {
        #expect(EarnedTimeModel.usable(minutes: 12, baseLeft: 30, isOn: true) == 42)
        #expect(EarnedTimeModel.usable(minutes: 12, baseLeft: 30, isOn: false) == 12)
        #expect(EarnedTimeModel.usable(minutes: 12, baseLeft: nil, isOn: true) == 12)
    }

    @Test func theWeekTableReloadsOnlyWhenThePhoneComesBackOnline() throws {
        let rig = try AppRig()
        rig.model.homeWeekLoad = .ready
        #expect(rig.model.reloadsWeek(wasOnline: false, online: true))
        #expect(!rig.model.reloadsWeek(wasOnline: nil, online: true), "opening the table loads it anyway")
        #expect(!rig.model.reloadsWeek(wasOnline: true, online: true) && !rig.model.reloadsWeek(wasOnline: true, online: false))
        #expect(rig.model.weekIsOffline(online: false) && !rig.model.weekIsOffline(online: true))
        rig.model.homeWeekLoad = .loading
        #expect(!rig.model.reloadsWeek(wasOnline: false, online: true))
        rig.model.homeWeekLoad = .offline
        #expect(rig.model.weekIsOffline(online: true))
        let none: NetworkStatus? = nil
        #expect(none.isOnline, "outside the app's root a screen counts as online")
    }

    @Test func settingsCountsAndListsComeFromTheModel() throws {
        let rig = try AppRig()
        rig.model.fallbacks = ["plan": 2, "memory": 3]
        #expect(rig.model.fallbackCount == 5)
        rig.model.aiModels = ["b-model", "a-model"]
        #expect(rig.model.modelChoices(keeping: "a-model") == ["a-model", "b-model"])
        #expect(rig.model.modelChoices(keeping: "c-model") == ["a-model", "b-model", "c-model"])
        rig.model.deviceLocation = { _ in FakeLocation(.denied) }
        #expect(!rig.model.locationAllowed)
        rig.model.deviceLocation = { _ in FakeLocation(.allowed) }
        #expect(rig.model.locationAllowed)
    }
}
