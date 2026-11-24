import SwiftUI

/// The answer to "Ask Evergreen", in Today's hero slot: which agent answered
/// (a small muted label), one or two lines, and Done. While it works, the
/// buddy walks beside a quiet line.
struct AskCard: View {
    @Environment(AppModel.self) private var model

    /// The walking buddy beside "Working on it…".
    private static let buddyWidth: CGFloat = 40
    private static let buddyHeight: CGFloat = 48

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            switch model.ask {
            case .idle:
                EmptyView()
            case .working(let agent):
                working(agent?.label ?? "Evergreen")
            case .answer(let agent, let text):
                said(text, by: agent.label)
            case .problem(let text):
                said(text, by: "Evergreen")
            }
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
        .accessibilityElement(children: .contain)
    }

    private func working(_ who: String) -> some View {
        HStack(spacing: Theme.md) {
            WalkingBuddy()
                .frame(width: Self.buddyWidth, height: Self.buddyHeight)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Theme.xxs) {
                label(who)
                Text("Working on it…")
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer(minLength: Theme.sm)
            Button("Cancel", action: model.cancelAsk)
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                .accessibilityIdentifier("ask.cancel")
        }
    }

    /// An answer or a problem: who said it, the words, and Done.
    @ViewBuilder private func said(_ text: String, by who: String) -> some View {
        label(who)
        Text(text)
            .font(.body)
            .foregroundStyle(Theme.text)
            .fixedSize(horizontal: false, vertical: true)
        done
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundStyle(Theme.textMuted)
    }

    private var done: some View {
        Button("Done", action: model.dismissAsk)
            .buttonStyle(GhostButtonStyle())
            .padding(.top, Theme.sm)
            .accessibilityIdentifier("ask.done")
    }
}
