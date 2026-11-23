import SwiftUI

/// Primary button: solid accent, 48pt tall. One per screen, for the main action.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.onAccent)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Theme.accent, in: .rect(cornerRadius: Theme.radiusButton))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
