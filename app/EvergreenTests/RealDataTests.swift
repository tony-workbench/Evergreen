import Foundation
import SwiftData
import Testing
@testable import Evergreen

/// The only data is the person's own: with nothing in Apple Health and an
/// empty calendar the app still stands, and the only way to start it on
/// made-up data is a Debug launch argument.
@MainActor
struct RealDataTests {
    static func emptyModel() throws -> AppModel {
        let schema = Schema([Run.self, ActionRecord.self, LoggedWorkout.self])
        let container = try ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: true))
        SuggestionTests.containers.append(container)
        return AppModel(context: container.mainContext, setup: AppModel.Setup(memory: nil, onDevice: false, health: HealthHistory()))
    }

    // MARK: Nothing in Health, nothing on the calendar

    @Test func anEmptyHistoryAndCalendarBookNothing() async throws {
        let model = try Self.emptyModel()
        #expect(model.persona == .me)
        #expect(model.workouts.isEmpty)
        #expect(model.historyDepth == HistoryDepth(days: 0))
        #expect(model.historyDepth.isEmpty && model.historyDepth.isThin)
        await model.tick()
        // Nothing is booked for them: the plan is empty until they add a suggestion.
        #expect(model.plan.isEmpty && model.appliedActions.isEmpty)
        // With an AI connected, the week is two general starter walks to add or not: suggestions, not bookings.
        let seeded = try #require(UITestSeed.launch(arguments: ["Evergreen", "-uiTest", "empty"]))
        SuggestionTests.containers.append(seeded.container)
        let fresh = seeded.model
        fresh.scriptedModel = ScriptedModel([])
        fresh.memoryWithoutModel = true
        fresh.aiKeyTail = "test"
        try await fresh.loadWeekPlan()
        #expect(fresh.plan.isEmpty && fresh.openSuggestions.count == 2)
        #expect(fresh.openSuggestions.allSatisfy { $0.after?.activityType == "Walking" && $0.after?.minutes == 30 && ($0.basedOn ?? []).isEmpty })
        #expect(fresh.topSuggestion.map { fresh.bases(for: $0).contains { $0.key != nil } } == false)
        #expect(model.recentWeeks.workoutDays == 0)
        #expect(!model.shouldAskAboutShoes)
        #expect(model.triggers.rainAsks.isEmpty && model.triggers.shoes == nil)
        // The checks do nothing until they are wired, and never crash.
        await model.triggers.checkAll(now: Date(), mayAsk: true)
        await model.checkTriggers(foreground: true)
        #expect(model.triggers.firstTimeLine(.rain) == nil)
    }

    @Test func aStoreFromAnOlderBuildOpensAsThePersonsOwn() throws {
        let schema = Schema([Run.self, ActionRecord.self, LoggedWorkout.self])
        let container = try ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: true))
        SuggestionTests.containers.append(container)
        let old = Run(persona: .me, storyDay: Calendar.current.startOfDay(for: Date()))
        old.persona = "jordan"
        container.mainContext.insert(old)
        let model = AppModel(context: container.mainContext, setup: AppModel.Setup(memory: nil, onDevice: false, health: HealthHistory()))
        #expect(model.persona == .me)
    }

    @Test func aFixedClockIsNeverReadOnTheDevice() async throws {
        // A model on the device, as the app makes it; under test it wires no triggers.
        let model = AppModel(context: try SuggestionTests.container().mainContext, setup: AppModel.Setup(memory: nil, health: HealthHistory()))
        model.run.clockMinutes = 16 * 60
        model.save()
        await model.tick()
        #expect(abs(model.now.timeIntervalSinceNow) < 5)
        #expect(!model.triggers.isSetUp)
    }

    @Test func historyDepthCountsDaysSinceTheFirstWorkout() {
        let cal = Fixture.calendar
        let now = Fixture.at(13)
        #expect(HistoryDepth(workouts: [], now: now, calendar: cal).days == 0)
        #expect(HistoryDepth(workouts: [Fixture.workout("today", at: Fixture.at(7), minutes: 30)], now: now, calendar: cal).days == 1)
        let nine = HistoryDepth(workouts: [Fixture.workout("a", at: Fixture.at(19, dayOffset: -8), minutes: 30),
                                           Fixture.workout("b", at: Fixture.at(19, dayOffset: -2), minutes: 30)], now: now, calendar: cal)
        #expect(nine.days == 9 && nine.isThin && !nine.isEmpty)
        let month = HistoryDepth(workouts: Fixture.samHistory, now: now, calendar: cal)
        #expect(month.days == 28 && !month.isThin)
        // A workout dated in the future doesn't count.
        #expect(HistoryDepth(workouts: [Fixture.workout("later", at: Fixture.at(7, dayOffset: 2), minutes: 30)], now: now, calendar: cal).days == 0)
    }

    @MainActor static var tours: [TourDemo] = []

    @Test func theTourPlaysItsFixedWeekOnItsOwnThrowawayModel() async throws {
        let tour = TourDemo()
        // Kept for the whole run: the model's ticks go on after the test ends.
        Self.tours.append(tour)
        #expect(!tour.model.onDevice && tour.model.persona == .tour)
        #expect(tour.model.workouts.isEmpty && !tour.model.triggers.isSetUp)
        #expect(tour.model.plan.count == 3 && tour.tonight != nil)
        #expect(tour.moveTonight()?.kind == .move)
        // Its rain scene is the real rain ask, with no business named and no price.
        let rain = try #require(tour.rainAsk())
        let headline = RainWords.headline(rain, now: tour.model.now, calendar: tour.model.calendar)
        #expect(headline.hasPrefix("Rain at ") && headline.hasSuffix("tomorrow. Move to 2 PM, or go indoors?"))
        #expect(rain.places.map(\.name) == ["A gym nearby"] && !headline.contains("$"))
        let dry = try #require(rain.dryWindow)
        #expect(tour.move(rain.session, to: dry.start).slot.start == dry.start)
    }

    @Test func aStoreThatCannotBeReadIsSetAsideAndTheAppStillOpens() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: "store-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: "Evergreen.store")
        try Data("this is not a database".utf8).write(to: url)
        let container = Storage.container(at: url)
        SuggestionTests.containers.append(container)
        // No crash: a working store, the unreadable file kept under another name, and the flag set so the person is told once.
        #expect(Storage.startedFresh)
        try container.mainContext.save()
        let names = try FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))
        #expect(names.contains { $0.hasPrefix("Evergreen.store.unreadable-") })
    }

    static let app = UserFacingWordsTests.app

    static func source(_ path: String) throws -> String {
        try String(contentsOf: app.appending(path: path), encoding: .utf8)
    }

    @Test func theSeedingArgumentIsCompiledOnlyInDebug() throws {
        // The whole file is inside `#if DEBUG`…
        let seed = try Self.source("Background/UITestSeed.swift").trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(seed.hasPrefix("#if DEBUG") && seed.hasSuffix("#endif"))
        #expect(seed.components(separatedBy: "#if ").count == 2 && seed.components(separatedBy: "#endif").count == 2)
        // …and so is its one use, in the app's entry point.
        let entry = try Self.source("App/EvergreenApp.swift")
        let uses = entry.components(separatedBy: "UITestSeed.launch").count - 1
        #expect(uses == 1)
        let before = try #require(entry.components(separatedBy: "UITestSeed.launch").first)
        #expect(before.components(separatedBy: "#if DEBUG").count - before.components(separatedBy: "#endif").count == 1)
        // The debug openers, a debug-only file as a whole, run only on a seeded launch.
        let openers = try Self.source("Views/Debug/DebugLaunch.swift").trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(openers.hasPrefix("#if DEBUG") && openers.hasSuffix("#endif") && openers.contains("guard UITestArguments.isSeeded()"))
        // The launch arguments the openers read are debug-only as a whole too, and take nothing unless the launch is seeded.
        let arguments = try Self.source("Views/Debug/UITestArguments.swift").trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(arguments.hasPrefix("#if DEBUG") && arguments.hasSuffix("#endif") && arguments.contains("UITestSeed.name(in:"))
        // Nothing else in the app names it.
        let all = try #require(FileManager.default.enumerator(at: Self.app, includingPropertiesForKeys: nil))
        for case let file as URL in all where file.pathExtension == "swift"
            && !["UITestSeed.swift", "EvergreenApp.swift", "DebugLaunch.swift", "UITestArguments.swift"].contains(file.lastPathComponent) {
            #expect(!(try String(contentsOf: file, encoding: .utf8)).contains("UITestSeed"), "\(file.lastPathComponent)")
        }
    }

    #if DEBUG
    @Test func theArgumentPicksASeedByName() {
        #expect(UITestSeed.name(in: ["Evergreen"]) == nil)
        #expect(UITestSeed.name(in: ["Evergreen", "-uiTest"]) == nil)
        #expect(UITestSeed.name(in: ["Evergreen", "-uiTest", "nobody"]) == nil)
        #expect(UITestSeed.name(in: ["Evergreen", "-other", "YES", "-uiTest", "rain"]) == .rain)
        #expect(UITestSeed.launch(arguments: ["Evergreen"]) == nil)
    }

    @Test func aSeededLaunchRunsOnMadeUpDataInMemory() async throws {
        let seeded = try #require(UITestSeed.launch(arguments: ["Evergreen", "-uiTest", "rain"]))
        SuggestionTests.containers.append(seeded.container)
        let model = seeded.model
        #expect(model.onboarded && !model.onDevice && model.persona == .me)
        let inMemory = seeded.container.configurations.allSatisfy { $0.isStoredInMemoryOnly }
        #expect(inMemory)
        #expect(model.workouts.count == 28 && model.historyDepth.days == 29)
        #expect(model.workouts.allSatisfy { $0.id.hasPrefix("ui-test-") })
        // The seed has tomorrow's 7 AM run on the plan, as if the person added it, and the seeded forecast rains on it.
        await model.triggers.checkAll(now: Date(), mayAsk: true)
        let ask = try #require(model.triggers.rainAsks.first)
        #expect(ask.session.slot.activityType == "Running" && ask.worstProbability == 85)
        #expect(ask.intent?.kind == "move" && ask.intent?.after == "12:00")
        #expect(ask.places.count == 3 && ask.places.first?.name == "Corner Gym")
        #expect(model.triggers.shoes?.km == 212 && model.triggers.shoes?.event == nil)

        let shoes = UITestSeed.make(.shoes)
        SuggestionTests.containers.append(shoes.container)
        await shoes.model.triggers.checkShoes(now: Date())
        #expect(shoes.model.triggers.shoes?.event == .headsUp)

        let empty = UITestSeed.make(.empty)
        SuggestionTests.containers.append(empty.container)
        #expect(empty.model.workouts.isEmpty && empty.model.historyDepth.isEmpty && !empty.model.shouldAskAboutShoes)
        let thin = UITestSeed.make(.thin)
        SuggestionTests.containers.append(thin.container)
        #expect(thin.model.historyDepth.days == 10 && thin.model.historyDepth.isThin && thin.model.shouldAskAboutShoes)
    }
    #endif
}
