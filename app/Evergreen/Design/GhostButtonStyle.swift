import SwiftUI

/// Ghost button: 1px rule border, 48pt tall like the primary.
struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(Theme.text)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, Theme.md)
            .background {
                RoundedRectangle(cornerRadius: Theme.radiusButton)
                    .strokeBorder(Theme.rule, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Theme.radiusButton))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
