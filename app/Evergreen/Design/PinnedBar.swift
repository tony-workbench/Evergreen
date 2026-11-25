import SwiftUI

/// A screen's main button, pinned at the bottom in reach of the thumb (`.safeAreaInset(edge: .bottom)`), over the
/// content that scrolls behind it. A second, quieter button may sit under it.
struct PinnedBar<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: Theme.sm) { content }
            .padding(.horizontal, Theme.md)
            .padding(.vertical, Theme.sm)
            .background(Theme.surface)
    }
}
