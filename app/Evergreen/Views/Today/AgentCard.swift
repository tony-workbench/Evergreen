import SwiftUI

/// The agent's latest action on Today: headline (accent, agent face),
/// before → after, why, what it keeps, then Undo and Pick another time.
struct AgentCard: View {
    let action: AgentAction

    @Environment(AppModel.self) private var model
    @State private var picking = false

    private var item: PlanItem? {
        guard let id = action.planItemId else { return nil }
        return model.plan.first { $0.id == id }
    }

    /// Once the workout this action set up is done, the card stops asking.
    private var finished: Completion? {
        item.flatMap { model.completion(for: $0) }
    }

    private var isMove: Bool { action.kind == .move || action.kind == .shrink }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(ActionCopy.headline(action))
                .agentFont(24, relativeTo: .title2)
                .foregroundStyle(Theme.accent)

            if isMove {
                if let change = ActionCopy.moveChange(action) {
                    change.font(.body).foregroundStyle(Theme.text)
                }
                Text(ActionCopy.moveReason(action)).font(.body).foregroundStyle(Theme.text)
                Text(ActionCopy.moveKeep(action, countWord: model.planCountWord))
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
            } else {
                if let change = ActionCopy.beforeAfter(action) {
                    change.font(.body).foregroundStyle(Theme.text)
                }
                Text(action.reason)
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
            }

            if finished != nil {
                Label("Done.", systemImage: "checkmark.circle.fill")
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.success)
            }

            if action.kind != .note && finished == nil {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Theme.sm) { buttons }
                    VStack(spacing: Theme.sm) { buttons }
                }
                .padding(.top, Theme.sm)
            }
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ActionCopy.spoken(action))
        .accessibilityActions {
            // Named actions, not the default double-tap: opening the card
            // shouldn't cancel what the agent did.
            if action.kind != .note && finished == nil {
                Button("Undo") { model.undo(action) }
            }
            if item != nil && finished == nil {
                Button("Pick another time") { picking = true }
            }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        Button("Undo") { model.undo(action) }
            .buttonStyle(GhostButtonStyle())
        if let item {
            PickAnotherTimeButton(item: item, isPresented: $picking)
        }
    }
}
