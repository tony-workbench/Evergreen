import SwiftUI

/// A row that dims while pressed, with no other chrome (plan rows, the planner link).
struct RowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
    }
}
