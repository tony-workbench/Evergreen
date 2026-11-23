import SwiftUI

/// What's left of a suggestion after "Not now" stopped the usual time behind
/// it: "Got it. I won't plan around Sunday 6 AM runs." and Undo.
struct StopNoteRow: View {
    let text: String
    let answerKey: String

    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.md) {
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Theme.sm)
            Button("Undo") { Task { await model.undoDecline(answerKey) } }
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.text)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityHint("Plans around it again")
        }
        .padding(.vertical, Theme.xs)
    }
}
