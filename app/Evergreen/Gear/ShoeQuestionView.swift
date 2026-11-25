import SwiftUI

/// The one question about shoes: when the current pair was started, and its
/// name if the person wants to give one. Asked once.
struct ShoeQuestionView: View {
    /// The day, and the name (nil when left empty).
    let onAnswer: (Date, String?) -> Void
    let onSkip: () -> Void

    @State private var startedOn = Date()
    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.md) {
            Text("When did you start using your current running shoes?")
                .font(.body)
                .foregroundStyle(Theme.text)
            DatePicker("Started on", selection: $startedOn, in: ...Date(), displayedComponents: .date)
                .font(.body)
                .frame(minHeight: 44)
            Rectangle().fill(Theme.rule).frame(height: 1)
            TextField("Their name (optional)", text: $name)
                .font(.body)
                .textInputAutocapitalization(.words)
                .frame(minHeight: 44)
            Rectangle().fill(Theme.rule).frame(height: 1)
            Text("I add up your runs from Apple Health since then and tell you when the pair is nearly worn out.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
            HStack(spacing: Theme.sm) {
                Button("Save") {
                    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                    onAnswer(startedOn, trimmed.isEmpty ? nil : trimmed)
                }
                .buttonStyle(PrimaryButtonStyle())
                // Quiet text, so Save is the one button.
                Button("Not now", action: onSkip)
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
                    .frame(minWidth: 88, minHeight: 48)
            }
        }
    }
}
