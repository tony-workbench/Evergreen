import Foundation
import SwiftData
import Testing
@testable import Evergreen

/// The week's suggestions in the app: "Add to plan" puts the session on the
/// plan like any agent action and Undo takes it off; "Not now" stops the
/// memory facts the suggestion rested on (or only hides it), Undo restores
/// them; answers survive a relaunch. No network: the stand-in agent.
/// The clock is stopped: each test runs mid-morning, late in the evening and just after midnight.
@MainActor
struct SuggestionTests {
    /// Kept for the whole run: a model's ticks go on after its test ends, and
    /// the model only holds the container's context.
    static var containers: [ModelContainer] = []

    /// A store for the tour's fixed three-workout week, so the plan doesn't depend on this simulator's Apple Health.
    static func container(now: Date = Clocks.morning) throws -> ModelContainer {
        let schema = Schema([Run.self, ActionRecord.self, LoggedWorkout.self])
        let container = try ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: true))
        container.mainContext.insert(Run(persona: .tour, storyDay: Fixture.calendar.startOfDay(for: now)))
        containers.append(container)
        return container
    }

    /// The app's model with the clock stopped at `now` in a fixed time zone, a month of made-up history ending the day
    /// before, and no calendar or Apple Health behind it. The same `now` as the container's.
    static func model(_ container: ModelContainer, memory: MemoryEngine? = try? MemoryEngineTests.engine(), now: Date = Clocks.morning) -> AppModel {
        let model = AppModel(context: container.mainContext, setup: AppModel.Setup(
            memory: memory, health: AppRig.month(endingBefore: now),
            calendar: Fixture.calendar, clock: { now }, calendarSync: RecordingCalendar(access: .off), healthReader: ScriptedHealth()))
        model.unlocked = { true }
        return model
    }

    /// A session `days` from today at `hour`, the way the backend sends one.
    static func session(_ type: String, days: Int, id: String, hour: Int = 12, basedOn: [String] = [], now: Date = Clocks.morning) -> WeekPlan.Session {
        let day = Fixture.calendar.date(byAdding: .day, value: days, to: Fixture.calendar.startOfDay(for: now))!
        let start = Fixture.calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day)!
        return WeekPlan.Session(id: id, kind: "addWorkout", title: "Planned a 27-minute yoga",
                                after: Slot(start: start, end: start.addingTimeInterval(27 * 60), activityType: type),
                                reason: "27 min yoga: trimmed to stay under your weekly load cap.", basedOn: basedOn)
    }

    @Test(arguments: Clocks.all) func addingASuggestionPutsItOnThePlanAndUndoTakesItOff(now: Date) throws {
        let model = Self.model(try Self.container(now: now), now: now)
        let yoga = Self.session("Yoga", days: 3, id: "wk-test-yoga", now: now)
        #expect(model.suggestionState(yoga) == .open)

        model.addToPlan(yoga)
        #expect(model.suggestionState(yoga) == .added)
        let item = try #require(model.plan.first { $0.id == yoga.id })
        #expect(item.slot == yoga.after)
        let action = try #require(model.appliedActions.last)
        #expect(action.kind == .addWorkout && action.planItemId == yoga.id)
        // The reason and the headline are in plain words.
        #expect(action.reason == "Kept short so this week stays close to your normal.")
        #expect(action.title == "Added a 27-minute yoga session")
        #expect(model.feed.first?.id == yoga.id)

        // A second tap changes nothing.
        model.addToPlan(yoga)
        #expect(model.appliedActions.filter { $0.id == yoga.id }.count == 1)

        // Undo takes it off; the suggestion is open again and can be added again.
        model.undo(action)
        #expect(!model.plan.contains { $0.id == yoga.id })
        #expect(model.suggestionState(yoga) == .open)
        model.addToPlan(yoga)
        #expect(model.plan.contains { $0.id == yoga.id })
        #expect(model.appliedActions.filter { $0.id == yoga.id }.count == 1)
    }

    /// "Not now" on a session that is one of the person's usual times and also cites other rows (as an AI's week may):
    /// only that usual time is stopped, the next week leaves it out, and Undo brings it back.
    @Test(arguments: Clocks.all) func notNowStopsOnlyTheUsualTimeTheSessionIsAndUndoRestoresIt(now: Date) async throws {
        let rig = try AppRig(now: now)
        let model = rig.model
        try await model.loadWeekPlan()
        let index = try #require(model.plannedSessions.firstIndex { planned in
            !HandOff.keysToReject(planned, rows: model.memoryRows).isEmpty
                && model.weekPlan?.sessions.first { $0.id == planned.id }.map { model.suggestionState($0) == .open } == true
        })
        let planned = model.plannedSessions[index]
        let usual = HandOff.keysToReject(planned, rows: model.memoryRows)
        let usableBefore = Set(model.memoryRows.filter(\.isUsable).map(\.key))
        let others = usableBefore.subtracting(usual)
        // The other rows include other usual times, the weekly volume and the load.
        #expect(usual.count == 1 && others.count >= 4 && model.memoryRows.contains { others.contains($0.key) && $0.kind == "usual_slot" })
        // The session cites all of them.
        model.plannedSessions[index].basedOn = usual + others.sorted()
        var session = try #require(model.weekPlan?.sessions.first { $0.id == planned.id })
        session.basedOn = usual + others.sorted()
        let slot = try #require(session.after)

        await model.decline(session)
        #expect(model.suggestionState(session) == .declined)
        // Only that usual time is stopped; everything else it cited is still in use.
        #expect(Set(model.stoppedKeys) == Set(usual))
        #expect(Set(model.memoryRows.filter(\.isUsable).map(\.key)) == others)
        #expect(model.stoppedEntries.count == 1)
        // The week planned again has nothing at that time and nothing resting on it, and still rests on the others.
        #expect(model.plannedSessions.allSatisfy { Set($0.basedOn).isDisjoint(with: usual) })
        #expect(model.openSuggestions.allSatisfy { $0.after?.start != slot.start })
        #expect(model.plannedSessions.contains { !Set($0.basedOn).isDisjoint(with: others) })
        let note = try #require(model.stopNote(for: session))

        await model.undoDecline(note.answerKey)
        #expect(model.stoppedKeys.isEmpty && Set(model.memoryRows.filter(\.isUsable).map(\.key)) == usableBefore)
        // The suggestion is back, open, at its usual time and resting on it.
        let back = try #require(model.openSuggestions.first { $0.after?.start == slot.start })
        #expect(back.basedOn == usual && model.suggestionState(back) == .open)
    }

    @Test(arguments: Clocks.all) func notNowToASuggestionFromTheRulesOnlyHidesIt(now: Date) async throws {
        let container = try Self.container(now: now)
        let model = Self.model(container, now: now)
        await model.syncMemory()
        let before = model.memoryRows
        let yoga = Self.session("Yoga", days: 3, id: "wk-test-yoga", now: now)
        let ride = Self.session("Cycling", days: 4, id: "wk-test-cycling", now: now)

        await model.decline(yoga)
        model.addToPlan(ride)
        #expect(model.suggestionState(yoga) == .declined)
        #expect(model.stoppedKeys.isEmpty)
        #expect(model.stopNote(for: yoga) == nil)
        #expect(model.memoryRows == before)
        // An answered suggestion can't be answered again.
        model.addToPlan(yoga)
        #expect(!model.plan.contains { $0.id == yoga.id })

        // Answers survive a relaunch.
        let relaunched = Self.model(container, memory: nil, now: now)
        #expect(relaunched.suggestionState(yoga) == .declined)
        #expect(relaunched.suggestionState(ride) == .added)
        #expect(relaunched.plan.contains { $0.id == ride.id })
    }

    @Test(arguments: Clocks.all) func aSessionThePlanAlreadyHasIsNotOfferedAgain(now: Date) throws {
        let model = Self.model(try Self.container(now: now), now: now)
        // The fixed week has a run tomorrow.
        #expect(model.suggestionState(Self.session("Running", days: 1, id: "wk-test-running", now: now)) == .alreadyPlanned)
        // Another activity that day, or a run on a day without one, is still offered.
        #expect(model.suggestionState(Self.session("Yoga", days: 1, id: "wk-test-yoga", now: now)) == .open)
        #expect(model.suggestionState(Self.session("Running", days: 4, id: "wk-test-later", now: now)) == .open)
    }

    @Test func aNoteHasNothingToAdd() {
        let note = WeekPlan.Session(id: "wk-race", kind: "note", title: "Race day", after: nil, reason: "Rest and fuel.")
        #expect(AppModel.action(adding: note, at: Clocks.morning) == nil)
    }
}
