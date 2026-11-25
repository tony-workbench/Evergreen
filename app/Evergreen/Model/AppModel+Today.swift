import Foundation

extension AppModel {
    /// Why this workout is on the plan: the reason it was added with, or the tour's fixed week's own.
    func reason(for item: PlanItem) -> String? {
        if let added = appliedActions.last(where: { $0.planItemId == item.id && $0.kind == .addWorkout && !isUndone($0) }) {
            return added.reason
        }
        return PinnedPlan.reason(for: item.id, key: persona)
    }

    /// The move or shrink still in effect that last changed this workout, for
    /// the "Moved" badge on its row.
    func movedAction(for item: PlanItem) -> AgentAction? {
        appliedActions.last {
            $0.planItemId == item.id && ($0.kind == .move || $0.kind == .shrink) && !isUndone($0)
        }
    }

    /// How many workouts are on the plan: "three".
    var planCountWord: String { Self.word(plan.count) }

    /// "three" for 3; numerals past ten.
    static func word(_ number: Int) -> String {
        guard (0...10).contains(number) else { return "\(number)" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .spellOut
        return formatter.string(from: number as NSNumber) ?? "\(number)"
    }

    /// The agent's own latest action in Today's hero (a moved workout). A note is
    /// shown once: after the launch it was seen on, it no longer holds the hero.
    var heroAction: AgentAction? {
        // What the person added themselves is on the plan below, not in the hero: the hero is for what the agent did.
        guard let action = feed.first(where: { !isUndone($0) && $0.kind != .addWorkout }) else { return nil }
        guard action.kind == .note else { return action }
        let seen = UserDefaults.standard.stringArray(forKey: "seen_notes") ?? []
        return seen.contains(action.id) && !notesShownNow.contains(action.id) ? nil : action
    }

    /// Records that a note was on screen.
    func noteSeen(_ action: AgentAction) {
        guard action.kind == .note, !notesShownNow.contains(action.id) else { return }
        notesShownNow.insert(action.id)
        let seen = UserDefaults.standard.stringArray(forKey: "seen_notes") ?? []
        if !seen.contains(action.id) { UserDefaults.standard.set(Array((seen + [action.id]).suffix(50)), forKey: "seen_notes") }
    }
}
