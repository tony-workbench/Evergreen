import SwiftUI

/// A week as seven columns on one baseline: a letter for each day, and for
/// each workout a small block with its name ("Run"). Ahead: solid accent.
/// Done: the same with a check. Missed: muted. Today's column is marked.
struct WeekStrip: View {
    struct Mark: Equatable {
        enum State: Equatable { case planned, done, missed }

        /// "Run", "Strength", "Yoga"
        var label: String
        var state: State
    }

    struct Day: Identifiable, Equatable {
        var id: Int
        /// "M", "T", …
        var letter: String
        var marks: [Mark] = []
        var isToday = false
    }

    let days: [Day]

    static let blockHeight: CGFloat = 20
    /// Room for two blocks above the baseline.
    static let columnHeight: CGFloat = 44

    var body: some View {
        HStack(alignment: .bottom, spacing: Theme.xs) {
            ForEach(days) { day in
                VStack(spacing: Theme.xs) {
                    VStack(spacing: Theme.xs) {
                        ForEach(Array(day.marks.prefix(2).enumerated()), id: \.offset) { _, mark in
                            Self.block(mark)
                                .transition(.scale(scale: 0.2, anchor: .bottom).combined(with: .opacity))
                        }
                    }
                    .frame(height: Self.columnHeight, alignment: .bottom)
                    Rectangle().fill(day.isToday ? Theme.text : Theme.rule).frame(height: day.isToday ? 2 : 1)
                    Text(day.letter)
                        .font(.caption2.weight(day.isToday ? .bold : .regular))
                        .foregroundStyle(day.isToday ? Theme.text : Theme.textMuted)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    /// One workout block, the same shape everywhere.
    static func block(_ mark: Mark) -> some View {
        HStack(spacing: 2) {
            if mark.state == .done {
                Image(systemName: "checkmark").font(.system(size: 8, weight: .bold))
            }
            Text(mark.label)
                .font(.system(size: 10, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 3)
        .frame(maxWidth: .infinity, minHeight: blockHeight)
        .foregroundStyle(mark.state == .missed ? Theme.textMuted : Theme.onAccent)
        .background(mark.state == .missed ? Theme.rule : Theme.accent, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    /// "M T W T F S S" starting from a date's weekday.
    nonisolated static func letters(from start: Date, calendar: Calendar) -> [String] {
        (0..<7).map { offset in
            let day = calendar.date(byAdding: .day, value: offset, to: start) ?? start
            return String(calendar.veryShortWeekdaySymbols[calendar.component(.weekday, from: day) - 1])
        }
    }
}
