import Foundation
import os

/// A suggestion's answer key, and the action that adds it to the plan.
extension AppModel {
    /// One suggestion is a session at a time: the same day's session at another
    /// time (after its usual time was stopped) is a new suggestion.
    static func answerKey(_ session: WeekPlan.Session) -> String {
        "\(session.id)|\(Int(session.after?.start.timeIntervalSince1970 ?? 0))"
    }

    /// The action "Add to plan" applies; nil for a note (race day), which has no slot.
    static func action(adding session: WeekPlan.Session, at now: Date) -> AgentAction? {
        guard session.kind == "addWorkout", let slot = session.after else { return nil }
        return AgentAction(id: session.id, kind: .addWorkout,
                           title: "Added a \(slot.minutes)-minute \(Activity.noun(slot))", planItemId: session.id,
                           after: slot, reason: PlainWords.reason(session.reason), createdAt: now)
    }
}

/// The week's suggestions as the views and the other parts of the app model reach them (WeekSuggestions.swift).
extension AppModel {
    var weekPlan: WeekPlan? {
        get { week.weekPlan }
        set { week.weekPlan = newValue }
    }

    var planning: Bool {
        get { week.planning }
        set { week.planning = newValue }
    }

    var planProblem: String? {
        get { week.planProblem }
        set { week.planProblem = newValue }
    }

    var planTask: Task<WeekPlan?, Never>? {
        get { week.planTask }
        set { week.planTask = newValue }
    }

    var planGeneration: Int {
        get { week.planGeneration }
        set { week.planGeneration = newValue }
    }

    var plannedSessions: [PlanSession] {
        get { week.plannedSessions }
        set { week.plannedSessions = newValue }
    }

    var weekCache: WeekCache? {
        get { week.weekCache }
        set { week.weekCache = newValue }
    }

    var weeksPlanned: Int {
        get { week.weeksPlanned }
        set { week.weeksPlanned = newValue }
    }

    var busyForBases: [Busy] {
        get { week.busyForBases }
        set { week.busyForBases = newValue }
    }

    var sentToAI: String {
        get { week.sentToAI }
        set { week.sentToAI = newValue }
    }

    var lastDecline: StopNote? {
        get { week.lastDecline }
        set { week.lastDecline = newValue }
    }

    var rejectedBasis: String? {
        get { week.rejectedBasis }
        set { week.rejectedBasis = newValue }
    }

    var placement: Placement? {
        get { week.placement }
        set { week.placement = newValue }
    }

    var topSuggestion: WeekPlan.Session? { week.topSuggestion }

    func bases(for session: WeekPlan.Session) -> [Basis] { week.bases(for: session) }

    func rejectBasis(_ key: String) async { await week.rejectBasis(key) }

    func undoRejectBasis() async { await week.undoRejectBasis() }

    func accept(_ session: WeekPlan.Session) async { await week.accept(session) }

    func acceptAll() async { await week.acceptAll() }

    func confirmPlacement() async { await week.confirmPlacement() }

    func cancelPlacement() { week.cancelPlacement() }

    func answerPlacement(_ answerId: String) async { await week.answerPlacement(answerId) }

    func dragPlacement(_ blockId: String, to start: Date) async { await week.dragPlacement(blockId, to: start) }

    func dragWorkout(_ item: PlanItem, to start: Date) async { await week.dragWorkout(item, to: start) }

    var calendarMemory: CalendarMemory { week.calendarMemory }

    @discardableResult
    func loadWeekPlan(fresh: Bool = false, quiet: Bool = false) async throws(PlanFailure) -> WeekPlan { try await week.loadWeekPlan(fresh: fresh, quiet: quiet) }

    /// The week planned again where it can be; why it couldn't goes to the log.
    @discardableResult
    func planIfPossible(fresh: Bool = false, quiet: Bool = false) async -> WeekPlan? {
        await week.planIfPossible(fresh: fresh, quiet: quiet)
    }

    func checkedStarters(rows: [MemoryRow]) async -> [PlanSession] { await week.checkedStarters(rows: rows) }

    func starterSessions(minutes: Int) -> [PlanSession] { week.starterSessions(minutes: minutes) }

    func loadSuggestionsIfNeeded() async { await week.loadSuggestionsIfNeeded() }

    var openSuggestions: [WeekPlan.Session] { week.openSuggestions }

    func suggestionState(_ session: WeekPlan.Session) -> SuggestionState { week.suggestionState(session) }

    /// A plan's suggestions that have a time and are still open, in the plan's order.
    func answerableSuggestions(in plan: WeekPlan) -> [WeekPlan.Session] {
        plan.sessions.filter { $0.after != nil && suggestionState($0) == .open }
    }

    func addToPlan(_ session: WeekPlan.Session) { week.addToPlan(session) }

    func decline(_ session: WeekPlan.Session) async { await week.decline(session) }

    func decline(all sessions: [WeekPlan.Session]) async { await week.decline(all: sessions) }

    func rejectableKeys(for session: WeekPlan.Session) -> [String] { week.rejectableKeys(for: session) }

    func stopNote(for session: WeekPlan.Session) -> (text: String, answerKey: String)? { week.stopNote(for: session) }

    func undoDecline(_ answerKey: String) async { await week.undoDecline(answerKey) }
}
