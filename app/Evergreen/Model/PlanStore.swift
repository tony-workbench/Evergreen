import Foundation
import Observation
import SwiftData

/// The saved plan: the run, every action applied to it and which of them
/// were undone, the plan those add up to, the person's answers to
/// suggestions, and the Evergreen calendar that follows the plan.
@Observable
@MainActor
final class PlanStore {
    @ObservationIgnored private let context: ModelContext
    /// The saved run (see Storage.swift). SwiftData models are observable, so
    /// views that read through this class update when the run changes.
    let run: Run
    @ObservationIgnored let calendarSync: any PlanCalendar
    /// Whether the plan is also on the Evergreen calendar.
    private(set) var calendarAccess: CalendarAccess

    // Copied out of SwiftData on every save, so views depend on this class
    // rather than on individual records. Without the copy, undoing a move
    // changed the stored record but Today didn't redraw until the next answer
    // from the rules differed from the last one.

    /// Every applied action, oldest first, undone ones included.
    private(set) var appliedActions: [AgentAction] = []
    private(set) var undoneIds: Set<String> = []
    private(set) var loggedWorkouts: [Workout] = []
    /// The person's answers to the planner's suggestions, by suggestion id.
    private(set) var suggestionAnswers: [String: SuggestionAnswer] = [:]

    /// Opens the saved run, or begins one on `today`.
    init(context: ModelContext, today: Date, calendarSync: any PlanCalendar) {
        self.context = context
        self.calendarSync = calendarSync
        let saved = (try? context.fetch(FetchDescriptor<Run>()))?.first
        let run = saved ?? Run(persona: .me, storyDay: today)
        if saved == nil { context.insert(run) }
        self.run = run
        calendarAccess = calendarSync.access
    }

    // MARK: The plan

    func isUndone(_ action: AgentAction) -> Bool { undoneIds.contains(action.id) }

    /// `base` with every applied, not-undone action on top: the sessions the
    /// person added and the moves of them. Undoing an action just drops it
    /// from this replay.
    func plan(on base: [PlanItem], calendar: Calendar) -> [PlanItem] {
        var items = base
        for action in appliedActions where !isUndone(action) {
            guard let id = action.planItemId, let after = action.after else { continue }
            switch action.kind {
            case .move, .shrink:
                if let index = items.firstIndex(where: { $0.id == id }) { items[index].slot = after }
            case .addWorkout:
                items.append(PlanItem(id: id, slot: after))
            case .note:
                break
            }
        }
        // Days gone by drop off the plan; yesterday stays one more day, to see whether it happened.
        let from = calendar.date(byAdding: .day, value: -1, to: run.storyDay) ?? run.storyDay
        return items.filter { $0.slot.start >= from }.sorted { $0.slot.start < $1.slot.start }
    }

    // MARK: Changes (each is kept by the `save()` that follows it)

    /// The ids of every action in the log, saved or not yet.
    var recordedIds: Set<String> { Set(run.actions.map(\.actionId)) }

    /// Appends an action to the log, after everything already applied.
    func record(_ action: AgentAction) {
        let next = (run.actions.map(\.sequence).max() ?? -1) + 1
        let record = ActionRecord(action, sequence: next)
        context.insert(record)
        run.actions.append(record)
    }

    /// Adds a workout. One that was added before and taken off again comes
    /// back as the same plan item, at this action's time.
    func add(_ action: AgentAction) {
        if let record = run.actions.first(where: { $0.actionId == action.id }) {
            record.undone = false
            record.after = action.after
        } else {
            record(action)
        }
    }

    /// Marks an action undone. False when it isn't in the log or was undone already.
    func undo(_ action: AgentAction) -> Bool {
        guard let record = run.actions.first(where: { $0.actionId == action.id }), !record.undone else { return false }
        record.undone = true
        forgetAnswer(toAction: action.id)
        return true
    }

    /// Takes a workout off the plan for good: the action that added it and every move of it since.
    func takeOff(_ item: PlanItem) {
        for record in run.actions where record.planItemId == item.id || record.actionId == item.id { record.undone = true }
        forgetAnswer(toAction: item.id)
    }

    /// Keeps the person's answer to a suggestion; nil takes the answer back.
    func answer(_ answerKey: String, _ answer: SuggestionAnswer?) {
        run.suggestionAnswers[answerKey] = answer
    }

    /// Undo on an added session takes it off the plan; the suggestion is open again.
    private func forgetAnswer(toAction id: String) {
        for (key, answer) in suggestionAnswers where key.hasPrefix("\(id)|") && answer.accepted {
            run.suggestionAnswers[key] = nil
        }
    }

    /// Moves on to a new day. What the person added, moved and answered is
    /// kept (a run added on Monday for Thursday is still there on Tuesday);
    /// only the day's own state starts again.
    func startDay(_ day: Date) {
        run.storyDay = day
        run.clockMinutes = nil
        run.lastResponse = nil
    }

    /// Saves the run and refreshes what views read.
    func save() {
        do {
            try context.save()
        } catch {
            assertionFailure("Couldn't save the run: \(error)")
        }
        let records = run.actions.sorted { $0.sequence < $1.sequence }
        appliedActions = records.map(\.action)
        undoneIds = Set(records.filter(\.undone).map(\.actionId))
        loggedWorkouts = run.workouts.map(\.workout).sorted { $0.start < $1.start }
        suggestionAnswers = run.suggestionAnswers
    }

    // MARK: The Evergreen calendar

    /// Asks for calendar access (onboarding, and "Turn on Calendar" before anyone has been asked).
    func requestCalendarAccess() async {
        await calendarSync.requestAccess()
    }

    /// Puts the plan on the calendar. Without access the plan stays in the app.
    func syncCalendar(_ plan: [PlanItem], calendar: Calendar) {
        calendarAccess = calendarSync.access
        guard calendarAccess == .on else { return }
        let entries = CalendarEntry.entries(for: plan, storyDay: run.storyDay, calendar: calendar)
        calendarSync.sync(entries, from: run.storyDay)
    }
}
