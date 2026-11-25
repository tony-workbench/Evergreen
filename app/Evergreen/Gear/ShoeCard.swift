import SwiftUI

/// "Time for new running shoes?" in Today's hero once the pair has gone
/// 640 km: what to look at, each source with "Open the page" (only
/// pages the search returned; with none, no button), and the two answers.
/// Evergreen never orders or pays.
struct ShoeCard: View {
    let status: ShoeStatus
    let advice: ShoeAdvice?
    let onNewPair: () -> Void
    let onLater: () -> Void

    @State private var page: ShoeAdvice.Link?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("Time for new running shoes?")
                .agentFont(22, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
            if let advice {
                Text(advice.text)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(advice.links) { link in
                    Rectangle().fill(Theme.rule).frame(height: 1)
                    HStack(spacing: Theme.sm) {
                        Text(link.title)
                            .font(.footnote)
                            .foregroundStyle(Theme.text)
                            .lineLimit(2)
                        Spacer(minLength: Theme.sm)
                        Button("Open the page") { page = link }
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(Theme.text)
                            .frame(minHeight: 44)
                            .accessibilityLabel("Open the page: \(link.title)")
                    }
                }
            } else {
                Text(status.line ?? "")
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Looking for good replacements…")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
            }
            HStack(spacing: Theme.sm) {
                Button("I have new shoes", action: onNewPair)
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityHint("Starts the new pair at zero")
                Button("Not now", action: onLater)
                    .buttonStyle(GhostButtonStyle())
            }
            .padding(.top, Theme.sm)
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
        .sheet(item: $page) { SafariView(url: $0.url).ignoresSafeArea() }
    }
}
