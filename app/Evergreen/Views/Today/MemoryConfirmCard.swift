import SwiftUI

/// A change to memory waiting for the person: "Forget everything I
/// remember?" with exactly what would be deleted, and Keep or Forget. When
/// the sentence didn't say what, the card asks "one day, or everything?"
/// first. Nothing was changed to get here, and nothing is until Forget.
struct MemoryConfirmCard: View {
    let pending: PendingMemory

    @Environment(AppModel.self) private var model

    /// How wide the filled Keep button grows, so the quiet choice beside it keeps its room.
    private static let keepMaxWidth: CGFloat = 140

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(pending.question)
                .agentFont(Theme.questionTitleSize, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
            Text(pending.detail)
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            answers.padding(.top, Theme.sm)
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
    }

    /// The filled button is the safe one; the change itself is quiet text in the warning colour.
    private var answers: some View {
        HStack(spacing: Theme.md) {
            Button("Keep") { model.pendingMemory = nil }
                .buttonStyle(PrimaryButtonStyle())
                .frame(maxWidth: Self.keepMaxWidth)
                .accessibilityHint("Changes nothing")
                .accessibilityIdentifier("memoryConfirm.keep")
            if pending == .forgetWhich { whichAnswers } else {
                choice(pending.confirm, id: "memoryConfirm.forget") { Task { await model.confirmPendingMemory() } }
                    .foregroundStyle(Theme.warning)
            }
        }
    }

    /// Neither deletes anything: one opens the days in What I remember, the other asks again about everything.
    @ViewBuilder private var whichAnswers: some View {
        choice("One day", id: "memoryConfirm.oneDay") {
            model.pendingMemory = nil
            model.memorySheetAsked = true
        }
        .foregroundStyle(Theme.text)
        choice("Everything", id: "memoryConfirm.everything") { model.pendingMemory = .forgetEverything }
            .foregroundStyle(Theme.warning)
    }

    /// A quiet text choice; the caller gives its colour.
    private func choice(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.body)
            .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: PrimaryButtonStyle.standardHeight)
            .accessibilityIdentifier(id)
    }
}
