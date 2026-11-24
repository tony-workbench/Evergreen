import SwiftUI

/// Says that the AI chose these movements, and why in its own sentence, so its work is never shown as the app's own.
/// Code checked the choice against every rule before it got here.
struct AIPickedNote: View {
    let reason: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xxs) {
            Label("Movements picked by AI", systemImage: "sparkles")
                .font(.footnote.weight(.semibold)).foregroundStyle(Theme.textMuted)
            Text(reason).font(.footnote).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
