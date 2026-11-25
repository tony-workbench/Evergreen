import SwiftUI

/// What the person told Evergreen to stop using, each with Restore. Hidden when nothing is stopped.
struct MemoryStoppedSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if !model.stoppedEntries.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Stopped")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.bottom, Theme.sm)
                rule
                ForEach(model.stoppedEntries, id: \.key) { entry in row(key: entry.key, label: entry.label) }
            }
        }
    }

    private var rule: some View { Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth) }

    @ViewBuilder private func row(key: String, label: String) -> some View {
        HStack(spacing: Theme.md) {
            Text(label)
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .strikethrough(color: Theme.textMuted)
            Spacer(minLength: Theme.sm)
            Button("Restore") { Task { await model.restore(key: key) } }
                .font(.body.weight(.medium))
                .foregroundStyle(Theme.text)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                .accessibilityLabel("Restore \(label)")
                .accessibilityIdentifier("memory.restore.\(key)")
        }
        .frame(minHeight: TapTargetButtonStyle.minSide)
        rule
    }
}
