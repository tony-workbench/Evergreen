import Foundation
import Testing
@testable import Evergreen

/// Before an AI key is connected: nothing is asked of any model, Today and
/// Ask say to connect one, and the plan, the calendar and what is remembered still work.
@MainActor
struct NoKeyTests {
    @Test func withNoKeyNoModelIsAskedAndTodayAndAskSayToConnect() async throws {
        let rig = try AppRig(connected: false)
        let model = rig.model
        // If anything were sent it would arrive here.
        let network = ScriptedNetwork.session([])
        model.aiSession = network.session

        await model.loadSuggestionsIfNeeded()
        await model.tick()
        // Today: the connect card has the hero, and there is no week and nothing saying the week failed.
        #expect(!model.aiConnected && !model.plannerAvailable)
        #expect(model.weekPlan == nil && model.openSuggestions.isEmpty && model.topSuggestion == nil && model.planProblem == nil && !model.planning)

        // Ask: every kind of sentence is answered with "connect your key", and nothing is previewed or changed.
        for sentence in ["Plan my week", "Add a 30 minute walk tomorrow evening", "Why this week?", "Forget everything"] {
            await model.askEvergreen(sentence)
            guard case .problem = model.ask else {
                Issue.record("\(sentence): expected the connect state, got \(model.ask)")
                continue
            }
            #expect(model.placement == nil && model.pendingMemory == nil)
        }
        #expect(model.plan.isEmpty && model.weeksPlanned == 0)
        await #expect(throws: PlanFailure.notConnected) { try await model.loadWeekPlan(fresh: true) }
        #expect(network.script.requests.isEmpty)
    }

    @Test func aModelThatCouldAnswerIsStillNotAskedForSuggestionsWithoutAKey() async throws {
        let rig = try AppRig(connected: false)
        let model = rig.model
        let reachable = ScriptedModel { _ in try! ScriptedModel.text(#"{"sessions":[],"summary":"A quiet week."}"#).get() }
        model.scriptedModel = reachable
        model.memoryWithoutModel = false

        await model.loadSuggestionsIfNeeded()
        await model.tick()
        await #expect(throws: PlanFailure.notConnected) { try await model.loadWeekPlan() }
        #expect(await reachable.requests.isEmpty)
        #expect(model.weekPlan == nil && model.weeksPlanned == 0 && model.lastMemoryUpdate == nil)
    }

    @Test func withNoKeyThePlanTheCalendarAndWhatIsRememberedStillWork() async throws {
        let rig = try AppRig(connected: false)
        let model = rig.model, calendar = rig.calendar
        await model.tick()
        // What is remembered is still there to read.
        #expect(!model.remembered.isEmpty)

        // A workout on the plan is on the calendar, can be moved, and can be taken off.
        let run = try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        #expect(model.plan.map(\.id) == ["the-run"] && calendar.event(for: "the-run")?.start == run.slot.start)
        #expect(model.nextWorkout?.id == "the-run")
        let later = run.slot.start.addingTimeInterval(2 * 3600)
        model.move(run, to: later)
        #expect(model.plan.first?.slot.start == later && calendar.event(for: "the-run")?.start == later && calendar.events.count == 1)
        model.remove(try #require(model.plan.first))
        #expect(model.plan.isEmpty && calendar.events.isEmpty)
    }
}
