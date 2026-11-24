import SwiftUI

/// A text button whose whole frame, at least 44 by 44 points, takes the tap, not only its words.
struct TapTargetButtonStyle: ButtonStyle {
    static let minSide: CGFloat = 44
    var color: Color = Theme.accent
    var weight: Font.Weight = .regular
    /// Fills the width it is given, for buttons side by side.
    var fills = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(weight))
            .foregroundStyle(color)
            .frame(minWidth: Self.minSide, maxWidth: fills ? .infinity : nil, minHeight: Self.minSide)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
