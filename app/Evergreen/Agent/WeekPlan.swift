import Foundation

/// The week the planning agent proposed, as Today shows it: suggested
/// sessions the person can add to their plan or turn down.
struct WeekPlan: Equatable, Sendable {
    /// One suggested session: an `addWorkout` with a slot, or a `note` (a rest day).
    struct Session: Equatable, Identifiable, Sendable {
        var id: String
        var kind: String
        var title: String
        var after: Slot?
        var reason: String
        /// The memory keys it rests on.
        var basedOn: [String]? = nil
    }

    /// One sentence about the whole week.
    var summary: String?
    var actions: [Session]
    /// True when the week came from the rules alone, because the AI couldn't be reached or its week didn't pass the check.
    var fromRules = false

    /// Sessions in time order; notes (no slot) sort last.
    var sessions: [Session] {
        actions.sorted { ($0.after?.start ?? .distantFuture) < ($1.after?.start ?? .distantFuture) }
    }

    init(summary: String? = nil, actions: [Session], fromRules: Bool = false) {
        self.summary = summary
        self.actions = actions
        self.fromRules = fromRules
    }

    /// The agent's week as suggestions. A rest day is a note, not something to add.
    init(_ week: PlanAgent.Week) {
        summary = week.summary.isEmpty ? nil : week.summary
        fromRules = week.source == .rules
        let training = week.sessions.filter { $0.activity != .rest }
        actions = week.sessions.map { session in
            // "Longest" and the like are kept only when this week's numbers bear them out.
            let others = training.filter { $0.id != session.id }.map(\.minutes)
            let reason = Superlatives.checked(session.reason, minutes: session.minutes, others: others)
            let slot = session.activity == .rest ? nil : session.start.date.map {
                Slot(start: $0, end: $0.addingTimeInterval(Double(session.minutes) * 60), activityType: session.activity.healthType)
            }
            return Session(id: session.id, kind: slot == nil ? "note" : "addWorkout", title: session.activity.displayName,
                           after: slot, reason: reason, basedOn: session.basedOn)
        }
    }
}
