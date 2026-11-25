import SwiftUI

/// Today with no key and nothing planned: what connecting a key gives, in
/// three calm lines beside the buddy. It fills the place of the empty week
/// and has no button of its own; "Connect" on the card above is the one.
struct ConnectGivesSection: View {
    private static let lines = [
        "A week planned around your usual days and what’s on your calendar.",
        "A reason for every suggestion, from your own Apple Health.",
        "Ask in your own words: “find me 30 minutes to walk tomorrow”.",
    ]

    /// The buddy above the lines.
    private static let buddySide: CGFloat = 160

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.md) {
            WavingBuddy(loops: false)
                .frame(width: Self.buddySide, height: Self.buddySide)
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)
            Text("With a key")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .accessibilityAddTraits(.isHeader)
            lines
            Text("The key stays on this phone and is sent only to Google’s Gemini.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, Theme.md)
    }

    /// What a key gives, one ruled line each.
    private var lines: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
            ForEach(Self.lines, id: \.self) { line in
                Text(line)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
                    .padding(.vertical, Theme.sm)
                Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
            }
        }
    }
}
