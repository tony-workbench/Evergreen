import SwiftUI

/// The answer to "Ask Evergreen", in Today's hero slot: which agent answered
/// (a small muted label), one or two lines, and Done. While it works, the
/// buddy walks beside a quiet line.
struct AskCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            switch model.ask {
            case .idle:
                EmptyView()
            case .working(let agent):
                HStack(spacing: Theme.md) {
                    WalkingBuddy()
                        .frame(width: 40, height: 48)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        label(agent?.label ?? "Evergreen")
                        Text("Working on it…")
                            .font(.body)
                            .foregroundStyle(Theme.textMuted)
                    }
                    Spacer(minLength: Theme.sm)
                    Button("Cancel", action: model.cancelAsk)
                        .font(.body)
                        .foregroundStyle(Theme.textMuted)
                        .frame(minWidth: 44, minHeight: 44)
                }
            case .answer(let agent, let text):
                label(agent.label)
                Text(text)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                done
            case .problem(let text):
                label("Evergreen")
                Text(text)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                done
            }
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
        .accessibilityElement(children: .contain)
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundStyle(Theme.textMuted)
    }

    private var done: some View {
        Button("Done", action: model.dismissAsk)
            .buttonStyle(GhostButtonStyle())
            .padding(.top, Theme.sm)
    }
}
