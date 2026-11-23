import Foundation
import Testing
@testable import Evergreen

/// Someone with a month of workouts behind them and nothing on their plan:
/// Today offers a week, the first suggestion is one of their usual times,
/// and nothing is on the plan or the calendar until they add it.
@MainActor
struct EmptyPlanTests {
    @Test(arguments: Clocks.all) func aPersonWithHistoryAndAnEmptyPlanGetsSuggestionsLedByAUsualTime(now: Date) async throws {
        let rig = try AppRig(now: now)
        let model = rig.model
        #expect(model.plan.isEmpty && model.weekPlan == nil && !model.historyDepth.isThin)

        // What Today does when it appears.
        await model.loadSuggestionsIfNeeded()
        #expect(model.openSuggestions.count >= 3)
        #expect(model.openSuggestions.allSatisfy { ($0.after?.start ?? .distantPast) > now })

        // The top one is at a time the person usually trains: the same activity, weekday and hour as a remembered usual time.
        let top = try #require(model.topSuggestion)
        let slot = try #require(top.after)
        let usual = model.bases(for: top).filter(\.isUsualTime)
        #expect(usual.count == 1)
        let row = try #require(model.memoryRows.first { $0.key == usual.first?.key })
        let parts = Fixture.calendar.dateComponents([.weekday, .hour], from: slot.start)
        #expect(row.kind == "usual_slot" && row.isUsable)
        #expect(row.data["weekday"]?.number == Double((parts.weekday! + 5) % 7) && row.data["hour"]?.number == Double(parts.hour!))
        #expect(ActivityKind(rawValue: row.data["activity"]?.string ?? "")?.healthType == slot.activityType)
        // And the person did train then: on that weekday at that hour in at least three of the last four weeks.
        let then = model.workouts.filter {
            $0.activityType == slot.activityType && Fixture.calendar.dateComponents([.weekday, .hour], from: $0.start) == parts
        }
        #expect(then.count >= 3)

        // Still only suggestions: nothing on the plan, nothing on the calendar, nothing recorded.
        await model.tick()
        #expect(model.plan.isEmpty && model.appliedActions.isEmpty && rig.calendar.events.isEmpty && rig.calendar.created.isEmpty)
        #expect(model.nextWorkout == nil)

        // Adding it is what puts it there.
        await model.accept(top)
        #expect(model.plan.map(\.id) == [top.id] && rig.calendar.events.count == 1)
        #expect(model.topSuggestion?.id != top.id)
    }

    @Test func withWeeklySuggestionsOffNothingIsPlannedUntilAsked() async throws {
        let rig = try AppRig()
        let model = rig.model
        rig.settings.set(false, forKey: Automatic.week.rawValue)
        await model.loadSuggestionsIfNeeded()
        #expect(model.weekPlan == nil && model.weeksPlanned == 0)
        // "Plan my week once" still works.
        try await model.loadWeekPlan(fresh: true)
        #expect(!model.openSuggestions.isEmpty && model.plan.isEmpty)
    }
}
