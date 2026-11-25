import SwiftUI

/// The agent's voice: General Sans Semibold at a DESIGN.md size, scaled with
/// Dynamic Type relative to a text style. `@ScaledMetric` reads the view's own
/// text size, so it updates when the setting changes while the app is open.
struct AgentFont: ViewModifier {
    @ScaledMetric private var size: Double

    init(size: Double, relativeTo style: Font.TextStyle) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: style)
    }

    func body(content: Content) -> some View {
        content.font(Theme.hasAgentFont
            ? .custom(Theme.agentFontName, fixedSize: size)
            : .system(size: size, weight: .semibold))
    }
}

extension View {
    func agentFont(_ size: Double, relativeTo style: Font.TextStyle) -> some View {
        modifier(AgentFont(size: size, relativeTo: style))
    }
}
