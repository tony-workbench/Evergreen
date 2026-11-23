import SwiftUI

/// A change to memory waiting for the person: "Forget everything I
/// remember?" with exactly what would be deleted, and Keep or Forget. When
/// the sentence didn't say what, the card asks "one day, or everything?"
/// first. Nothing was changed to get here, and nothing is until Forget.
struct MemoryConfirmCard: View {
    let pending: PendingMemory

    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(pending.question)
                .agentFont(22, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
            Text(pending.detail)
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            // The filled button is the safe one; the change itself is quiet text in the warning colour.
            HStack(spacing: Theme.md) {
                Button("Keep") { model.pendingMemory = nil }
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(maxWidth: 140)
                    .accessibilityHint("Changes nothing")
                if pending == .forgetWhich {
                    // Neither deletes anything: one opens the days in What I remember, the other asks again about everything.
                    Button("One day") {
                        model.pendingMemory = nil
                        model.memorySheetAsked = true
                    }
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .frame(minWidth: 44, minHeight: 48)
                    Button("Everything") { model.pendingMemory = .forgetEverything }
                        .font(.body)
                        .foregroundStyle(Theme.warning)
                        .frame(minWidth: 44, minHeight: 48)
                } else {
                    Button(pending.confirm) { Task { await model.confirmPendingMemory() } }
                        .font(.body)
                        .foregroundStyle(Theme.warning)
                        .frame(minWidth: 44, minHeight: 48)
                }
            }
            .padding(.top, Theme.sm)
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
    }
}
