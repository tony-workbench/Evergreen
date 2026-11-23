import SwiftUI

/// Today's hero until an AI key is connected: one calm card and its button.
struct ConnectCard: View {
    let connect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("Connect your AI key to get your plan")
                .agentFont(24, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
            Text("Your calendar and what I remember are still here.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
            Button("Connect", action: connect)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.top, Theme.sm)
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
    }
}
