import SwiftUI

/// A text button whose whole frame, at least `minSide` by `minSide` points, takes the tap, not only its words.
struct TapTargetButtonStyle: ButtonStyle {
    /// The smallest side of anything tapped (Apple's 44 points).
    static let minSide: CGFloat = 44
    var color: Color = Theme.accent
    var weight: Font.Weight = .regular
    /// Fills the width it is given, for buttons side by side.
    var fills = false
    /// Drawn with an outline (a secondary action on the workout page), at least 3:1 against the surface.
    var outlined = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(weight))
            .foregroundStyle(color)
            .multilineTextAlignment(.center)
            .padding(.horizontal, outlined ? Theme.sm : 0)
            .frame(minWidth: Self.minSide, maxWidth: fills ? .infinity : nil, minHeight: Self.minSide)
            .background {
                if outlined {
                    RoundedRectangle(cornerRadius: Theme.radiusButton).strokeBorder(Theme.controlBorder, lineWidth: Theme.borderWidth)
                }
            }
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? Theme.pressedOpacity : 1)
    }
}
