import SwiftUI

/// The last 4 weeks as rows of dots: a full dot for a day with a workout, a
/// small one for a day without, and the accent on the person's usual days.
/// The dots draw in column by column; all at once under Reduce Motion. A
/// one-line legend says what they are.
struct RecentWeeksGrid: View {
    let weeks: RecentWeeks

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    @State private var shown = false

    var body: some View {
        VStack(spacing: Theme.sm) {
            ForEach(Array(weeks.weeks.enumerated()), id: \.offset) { row, days in
                HStack(spacing: 0) {
                    ForEach(Array(days.enumerated()), id: \.offset) { column, active in
                        Circle()
                            .fill(active ? (weeks.usualColumns.contains(column) ? Theme.accent : Theme.text) : Theme.rule)
                            .frame(width: active ? 12 : 6, height: active ? 12 : 6)
                            .frame(maxWidth: .infinity, minHeight: 12)
                            .opacity(shown ? 1 : 0)
                            .scaleEffect(shown ? 1 : 0.4)
                            .animation(reduceMotion ? nil : .easeOut(duration: 0.25).delay(Double(column) * 0.09 + Double(row) * 0.02), value: shown)
                    }
                }
            }
            Rectangle().fill(Theme.rule).frame(height: 1)
            HStack(spacing: 0) {
                ForEach(Array(weeks.letters.enumerated()), id: \.offset) { column, letter in
                    Text(letter)
                        .font(.caption2.weight(weeks.usualColumns.contains(column) ? .semibold : .regular))
                        .foregroundStyle(weeks.usualColumns.contains(column) ? Theme.accent : Theme.textMuted)
                        .frame(maxWidth: .infinity)
                }
            }
            Text("Each dot is a workout day · last 4 weeks · green = your usual days")
                .font(.caption)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, Theme.xs)
        }
        .onAppear { shown = true }
        .accessibilityElement()
        .accessibilityLabel("Your last 4 weeks: \(weeks.workoutDays) days with a workout.")
    }
}
