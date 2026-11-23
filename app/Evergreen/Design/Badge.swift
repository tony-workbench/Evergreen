import SwiftUI

/// "Moved": accent outline, 8pt radius.
struct Badge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, Theme.sm)
            .padding(.vertical, Theme.xs)
            .overlay {
                RoundedRectangle(cornerRadius: Theme.radiusSmall)
                    .strokeBorder(Theme.accent, lineWidth: 1)
            }
    }
}
