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
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    @State private var sentence = ""
    @State private var example = 0
    @FocusState private var focused: Bool

    /// The bar's height, and the round send button inside its tap target.
    private static let barHeight: CGFloat = 52
    private static let sendCircle: CGFloat = 32
    /// "Send" while there is nothing to send.
    private static let emptyOpacity = 0.3
    /// How often the example changes, and how long it takes.
    private static let exampleSeconds = 4.0
    private static let exampleFade = 0.3

    private var working: Bool {
        if case .working = model.ask { return true }
        return false
    }

    private var isEmpty: Bool { sentence.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
            HStack(spacing: Theme.sm) {
                field
                sendButton
            }
            .padding(.leading, Theme.md)
            .padding(.trailing, Theme.sm)
            .frame(minHeight: Self.barHeight)
        }
        .background(Theme.surface)
        .task { await turnExamples() }
    }

    private var field: some View {
        TextField(Self.examples[example], text: $sentence)
            .focused($focused)
            .submitLabel(.send)
            .onSubmit(send)
            .font(.body)
            .foregroundStyle(Theme.text)
            .accessibilityLabel("Ask Evergreen")
            .accessibilityHint("For example: \(Self.examples[example])")
            .accessibilityIdentifier("ask.field")
            // The whole height of the bar focuses the field, not only its line of text.
            .frame(minHeight: Self.barHeight)
            .contentShape(.rect)
            .onTapGesture { focused = true }
    }

    private var sendButton: some View {
        Button(action: send) {
            Image(systemName: "arrow.up")
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.onAccent)
                .frame(width: Self.sendCircle, height: Self.sendCircle)
                .background(Theme.accent, in: .circle)
                .frame(width: TapTargetButtonStyle.minSide, height: TapTargetButtonStyle.minSide)
        }
        .accessibilityLabel("Send")
        .accessibilityIdentifier("ask.send")
        .disabled(working || isEmpty)
        .opacity(isEmpty ? Self.emptyOpacity : 1)
    }

    /// A new example every few seconds, while nothing is typed.
    private func turnExamples() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(Self.exampleSeconds))
            guard sentence.isEmpty, !focused else { continue }
            withAnimation(reduceMotion ? nil : .easeInOut(duration: Self.exampleFade)) {
                example = (example + 1) % Self.examples.count
            }
        }
    }

    private func send() {
        let asked = sentence
        guard !working, !isEmpty else { return }
        sentence = ""
        focused = false
        model.ask(asked)
    }
}
