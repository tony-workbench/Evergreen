import SwiftUI

/// Primary button: solid accent, 48pt tall. One per screen, for the main action. Its words wrap at large text sizes.
struct PrimaryButtonStyle: ButtonStyle {
    static let standardHeight: CGFloat = 48
    /// The main buttons to hit mid-workout, and Today's "Start", pinned at the bottom in reach of the thumb.
    static let tallHeight: CGFloat = 56
    static let tall = PrimaryButtonStyle(height: tallHeight)

    var height: CGFloat = PrimaryButtonStyle.standardHeight

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.onAccent)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Theme.md)
            .padding(.vertical, Theme.sm)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Theme.accent, in: .rect(cornerRadius: Theme.radiusButton))
            .contentShape(.rect(cornerRadius: Theme.radiusButton))
            .opacity(configuration.isPressed ? Theme.pressedFilledOpacity : 1)
    }
}
