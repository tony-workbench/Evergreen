import SwiftUI

/// The heads-up about worn shoes: one line and "I have new shoes", which starts
/// the count again today. Nothing is sold or linked.
struct ShoeHeadsUpLine: View {
    let status: ShoeStatus
    let onNewPair: () -> Void

    var body: some View {
        if let line = status.line {
            VStack(alignment: .leading, spacing: Theme.xs) {
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button("I have new shoes", action: onNewPair)
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                    .accessibilityHint("Starts the count again from today")
            }
            .padding(.vertical, Theme.sm)
            .overlay(alignment: .top) { Rectangle().fill(Theme.rule).frame(height: 1) }
        }
    }
}
