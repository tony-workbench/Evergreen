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
                Rectangle().fill(Theme.rule).frame(height: 1)
                ForEach(model.stoppedEntries, id: \.key) { entry in
                    HStack(spacing: Theme.md) {
                        Text(entry.label)
                            .font(.body)
                            .foregroundStyle(Theme.textMuted)
                            .strikethrough(color: Theme.textMuted)
                        Spacer(minLength: Theme.sm)
                        Button("Restore") { Task { await model.restore(key: entry.key) } }
                            .font(.body.weight(.medium))
                            .foregroundStyle(Theme.text)
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("Restore \(entry.label)")
                    }
                    .frame(minHeight: 44)
                    Rectangle().fill(Theme.rule).frame(height: 1)
                }
            }
        }
    }
}
