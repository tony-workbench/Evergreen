import SwiftUI

/// Primary button: solid accent, 48pt tall. One per screen, for the main action.
struct PrimaryButtonStyle: ButtonStyle {
    /// 48pt by default; the workout page's main buttons are 56pt (`tall`), to hit mid-workout.
    var height: CGFloat = 48
    static let tall = PrimaryButtonStyle(height: 56)

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.onAccent)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Theme.accent, in: .rect(cornerRadius: Theme.radiusButton))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
