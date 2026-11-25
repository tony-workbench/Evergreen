import SwiftUI

extension View {
    /// The agent card's surface: the card colour, 20pt continuous radius and a
    /// 1px rule. Flat: no shadow in either mode.
    func agentCardBackground() -> some View {
        background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusCard, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.radiusCard, style: .continuous)
                    .strokeBorder(Theme.rule, lineWidth: 1)
            }
    }
}
