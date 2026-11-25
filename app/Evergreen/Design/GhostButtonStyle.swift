import SwiftUI

/// Ghost button: an outline at least 3:1 against the surface, 48pt tall like the primary. Its words wrap at large text
/// sizes instead of running out of the button.
struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(Theme.text)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Theme.md)
            .padding(.vertical, Theme.sm)
            .frame(maxWidth: .infinity, minHeight: PrimaryButtonStyle.standardHeight)
            .background {
                RoundedRectangle(cornerRadius: Theme.radiusButton)
                    .strokeBorder(Theme.controlBorder, lineWidth: Theme.borderWidth)
            }
            .contentShape(.rect(cornerRadius: Theme.radiusButton))
            .opacity(configuration.isPressed ? Theme.pressedOpacity : 1)
    }
}
