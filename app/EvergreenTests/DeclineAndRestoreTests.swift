import Foundation
import Testing
@testable import Evergreen

/// "Not now", its line with Undo, Restore from What I remember, and what a
/// plan row says about a suggestion that was added: checked on the app as a
/// whole, with the real engines and the week from the rules.
@MainActor
struct DeclineAndRestoreTests {
    /// The app with its week planned, and an open suggestion that is one of the person's usual times.
    static func ready() async throws -> (rig: AppRig, session: WeekPlan.Session, key: String) {
        let rig = try AppRig()
        try await rig.model.loadWeekPlan()
        await rig.model.memoryTask?.value
        let session = try #require(rig.model.openSuggestions.first { !rig.model.week.rejectableKeys(for: $0).isEmpty })
        return (rig, session, try #require(rig.model.week.rejectableKeys(for: session).first))
    }

    @Test func notNowLeavesItsLineWithUndoWhateverTheNextWeekHolds() async throws {
        let (rig, session, key) = try await Self.ready()
        let model = rig.model, start = try #require(session.after?.start)
        let title = model.title(for: key)
        await model.decline(session)

        // The habit is stopped and the week planned again without the session…
        #expect(model.memoryRows.first { $0.key == key }?.isRejected == true)
        #expect(model.openSuggestions.contains { $0.after?.start == start } == false)
        // …and the line is there all the same, naming what was stopped.
        let note = try #require(model.lastDecline)
        #expect(note.text == "Got it. I won’t plan around \(title)." && !title.isEmpty && title != key)

        // Undo: the habit is used again, the suggestion is back, the line is gone.
        await model.undoDecline(note.answerKey)
        #expect(model.memoryRows.first { $0.key == key }?.isUsable == true)
        #expect(model.openSuggestions.contains { $0.after?.start == start })
        #expect(model.lastDecline == nil && model.suggestionAnswers[note.answerKey] == nil)
    }

    @Test func theLineGoesWhenThePersonDoesSomethingElse() async throws {
        let (rig, session, _) = try await Self.ready()
        let model = rig.model
        await model.decline(session)
        #expect(model.lastDecline != nil)
        let other = try #require(model.openSuggestions.first)
        model.addToPlan(other)
        #expect(model.lastDecline == nil)
    }

    @Test func restoreInWhatIRememberBringsTheSuggestionBack() async throws {
        let (rig, session, key) = try await Self.ready()
        let model = rig.model, start = try #require(session.after?.start)
        await model.decline(session)
        #expect(model.openSuggestions.contains { $0.after?.start == start } == false)

        // Restore, as the row in What I remember does it.
        await model.restore(key: key)
        #expect(model.memoryRows.first { $0.key == key }?.isUsable == true)
        #expect(model.suggestionAnswers.values.contains { !$0.accepted && $0.stopped.contains(key) } == false)
        #expect(model.openSuggestions.contains { $0.after?.start == start })
        #expect(model.lastDecline == nil)
    }

    @Test func anAddedSuggestionKeepsItsOwnReasonInItsRow() async throws {
        let (rig, session, _) = try await Self.ready()
        let model = rig.model
        let planned = try #require(model.plannedSessions.first { $0.id == session.id })
        await model.accept(session)
        let added = try #require(model.appliedActions.last { $0.after?.start == session.after?.start })
        #expect(added.reason == planned.reason && !planned.reason.isEmpty)
        #expect(!added.reason.contains("as you asked"))
    }

    @Test func whyThisSaysAUsualTimeOnceAndHowOftenItWasSeen() {
        let usual = Basis(id: "b1", source: .health, text: "You usually run Tuesday around 7 AM.", detail: "", key: "k1", isUsualTime: true)
        #expect(Basis.restates("Your usual Tuesday 7 AM run.", [usual]))
        // A reason that says more, more than one basis, or a calendar gap: the reason stays.
        #expect(!Basis.restates("Kept short because this week’s training is above your usual.", [usual, usual]))
        #expect(!Basis.restates("An easy day after a short night.", [usual]))
        #expect(!Basis.restates("Your usual Tuesday 7 AM run.", [Basis(id: "b2", source: .calendar, text: "Free 6–9 AM Tuesday", detail: "", key: nil, isUsualTime: false)]))

        // Seen in four of four weeks: said without the day the line was first written down.
        let seen = RowWords.support(PlanFakes.sundayRun)
        #expect(seen.hasPrefix("Seen in 5 of the last 6 weeks.") && !seen.contains("Since") && !seen.contains("October"))
        #expect(RowWords.support(PlanFakes.load).hasPrefix("Remembered since October 1."))
    }

    /// The thin seed's nine mornings of runs are ten days of history on Today: the first run's day through today.
    @Test func nineMorningsOfRunsAreTenDaysOfHistory() {
        let now = Fixture.at(9)
        let runs = (1...9).map { Fixture.workout("r\($0)", at: Fixture.calendar.date(byAdding: .day, value: -$0, to: Fixture.at(7))!, minutes: 40) }
        #expect(HistoryDepth(workouts: runs, now: now, calendar: Fixture.calendar).days == 10)
    }
}
