import SwiftUI

/// The days something happens on, as seven letters from Monday: a marked
/// day is filled, the others are faint. With `onTap`, a marked day can be tapped.
struct DayDots: View {
    /// Monday 0 to Sunday 6.
    let marked: Set<Int>
    var onTap: ((Int) -> Void)? = nil

    static let letters = ["M", "T", "W", "T", "F", "S", "S"]
    static let names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { day in
                let on = marked.contains(day)
                let dot = Text(Self.letters[day])
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(on ? Theme.onAccent : Theme.textMuted)
                    .frame(width: 24, height: 24)
                    .background(on ? Theme.accent : Theme.rule.opacity(0.5), in: .circle)
                if let onTap, on {
                    Button { onTap(day) } label: { dot.frame(width: 32, height: 44) }
                        .accessibilityLabel("\(Self.names[day]). Stop using this day")
                } else {
                    dot.frame(width: onTap == nil ? 24 : 32, height: onTap == nil ? 24 : 44)
                        .accessibilityLabel(on ? Self.names[day] : "")
                        .accessibilityHidden(!on)
                }
            }
        }
    }
}
