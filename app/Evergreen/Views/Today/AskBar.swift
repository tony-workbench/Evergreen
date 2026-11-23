import SwiftUI

/// "Ask Evergreen": the one field at the bottom of Today. Its placeholder
/// goes through examples of what the three agents do.
struct AskBar: View {
    static let examples = [
        "Find me 45 minutes to run tonight",
        "Move Sunday’s run to the afternoon",
        "What do you remember about me?",
    ]

    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sentence = ""
    @State private var example = 0
    @FocusState private var focused: Bool

    private var working: Bool {
        if case .working = model.ask { return true }
        return false
    }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.rule).frame(height: 1)
            HStack(spacing: Theme.sm) {
                TextField(Self.examples[example], text: $sentence)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .accessibilityLabel("Ask Evergreen")
                    .accessibilityHint("For example: \(Self.examples[example])")
                    // The whole height of the bar focuses the field, not only its line of text.
                    .frame(minHeight: 52)
                    .contentShape(.rect)
                    .onTapGesture { focused = true }
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(width: 32, height: 32)
                        .background(Theme.accent, in: .circle)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Send")
                .disabled(working || sentence.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(sentence.trimmingCharacters(in: .whitespaces).isEmpty ? 0.3 : 1)
            }
            .padding(.leading, Theme.md)
            .padding(.trailing, Theme.sm)
            .frame(minHeight: 52)
        }
        .background(Theme.surface)
        .task {
            // A new example every few seconds, while nothing is typed.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(4))
                guard sentence.isEmpty, !focused else { continue }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                    example = (example + 1) % Self.examples.count
                }
            }
        }
    }

    private func send() {
        let asked = sentence
        guard !working, !asked.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        sentence = ""
        focused = false
        model.ask(asked)
    }
}
