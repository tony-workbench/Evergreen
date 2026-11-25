import SwiftUI

/// After "Not true for me": a quiet line saying what is no longer used, with Undo.
struct BasisUndoRow: View {
    let key: String

    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.md) {
            Text("Got it. I won’t use \(model.title(for: key)), and planned your week again.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Theme.sm)
            Button("Undo") { Task { await model.undoRejectBasis() } }
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.text)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                .accessibilityHint("Uses it again")
        }
    }
}
