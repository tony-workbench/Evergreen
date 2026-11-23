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
                Rectangle().fill(Theme.rule).frame(height: 1)
                ForEach(model.reviewRows, id: \.memoryId) { row in
                    HStack(spacing: Theme.sm) {
                        Text(RowWords.sentence(row))
                            .font(.body)
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: Theme.sm)
                        Button("No") { Task { await model.answerReview(row, right: false) } }
                            .font(.body)
                            .foregroundStyle(Theme.textMuted)
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("No, that’s not right: \(RowWords.sentence(row))")
                        Button("Yes") { Task { await model.answerReview(row, right: true) } }
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.accent)
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("Yes, that’s right: \(RowWords.sentence(row))")
                    }
                    .padding(.vertical, Theme.xs)
                    Rectangle().fill(Theme.rule).frame(height: 1)
                }
            }
        }
    }
}
