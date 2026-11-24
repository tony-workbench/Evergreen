import SwiftUI

/// "Is this right?": things the memory agent isn't sure enough about to use
/// without asking. Yes keeps one; No stops it. Empty when nothing is waiting.
struct MemoryReviewSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if !model.reviewRows.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Is this right?")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.bottom, Theme.sm)
                rule
                ForEach(model.reviewRows, id: \.memoryId) { row($0) }
            }
        }
    }

    private var rule: some View { Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth) }

    @ViewBuilder private func row(_ row: MemoryRow) -> some View {
        HStack(spacing: Theme.sm) {
            Text(RowWords.sentence(row))
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Theme.sm)
            answer(row, right: false)
            answer(row, right: true)
        }
        .padding(.vertical, Theme.xs)
        rule
    }

    /// Yes keeps the row; No stops it. Yes is the stronger of the two.
    private func answer(_ row: MemoryRow, right: Bool) -> some View {
        let sentence = RowWords.sentence(row)
        return Button(right ? "Yes" : "No") { Task { await model.answerReview(row, right: right) } }
            .font(right ? .body.weight(.semibold) : .body)
            .foregroundStyle(right ? Theme.accent : Theme.textMuted)
            .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
            .accessibilityLabel(right ? "Yes, that’s right: \(sentence)" : "No, that’s not right: \(sentence)")
            .accessibilityIdentifier("memory.review.\(right ? "yes" : "no").\(row.memoryId)")
    }
}
