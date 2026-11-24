import SwiftUI

/// The days something happens on, as seven letters from Monday: a marked
/// day is filled, the others are faint. With `onTap`, a marked day can be tapped.
struct DayDots: View {
    /// Monday 0 to Sunday 6.
    let marked: Set<Int>
    var onTap: ((Int) -> Void)? = nil

    static let letters = ["M", "T", "W", "T", "F", "S", "S"]
    static let names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    /// The gap between two days, the side of a day's dot, and the width a tappable day takes.
    private static let spacing: CGFloat = 6
    private static let dotSide: CGFloat = 24
    private static let tapWidth: CGFloat = 32
    /// How faint an unmarked day's dot is.
    private static let faintOpacity = 0.5

    var body: some View {
        HStack(spacing: Self.spacing) {
            ForEach(UserRules.weekdays, id: \.self) { day in
                let on = marked.contains(day)
                let dot = Text(Self.letters[day])
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(on ? Theme.onAccent : Theme.textMuted)
                    .frame(width: Self.dotSide, height: Self.dotSide)
                    .background(on ? Theme.accent : Theme.rule.opacity(Self.faintOpacity), in: .circle)
                if let onTap, on {
                    Button { onTap(day) } label: { dot.frame(width: Self.tapWidth, height: TapTargetButtonStyle.minSide) }
                        .accessibilityLabel("\(Self.names[day]). Stop using this day")
                } else {
                    dot.frame(width: onTap == nil ? Self.dotSide : Self.tapWidth,
                              height: onTap == nil ? Self.dotSide : TapTargetButtonStyle.minSide)
                        .accessibilityLabel(on ? Self.names[day] : "")
                        .accessibilityHidden(!on)
                }
            }
        }
    }
}
