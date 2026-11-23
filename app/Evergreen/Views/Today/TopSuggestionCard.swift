import SwiftUI

/// Today's one large statement: the top suggestion as a sentence ("Run,
/// Monday at 7."), what else there is to say about it, a chip only for
/// what the sentence doesn't already say, and the screen's one primary
/// button. "Not now" and "Why" are quiet text. No card: the statement sits
/// on the page.
struct TopSuggestionCard: View {
    let session: WeekPlan.Session

    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The session just added, kept on screen with its Undo.
    @State private var added: WeekPlan.Session?
    @State private var showWhy = false
    @State private var adding = false

    private var shown: WeekPlan.Session { added ?? session }

    var body: some View {
        let chips = Basis.chips(model.bases(for: shown), for: shown)
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(SuggestionWords.statement(shown, calendar: model.calendar))
                .agentFont(34, relativeTo: .largeTitle)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(SuggestionWords.detail(shown))
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(chips.prefix(2)) { BasisChip(basis: $0) }
            if added != nil {
                HStack(spacing: Theme.md) {
                    Label("Added", systemImage: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.accent)
                    Button("Undo", action: undo)
                        .font(.body)
                        .foregroundStyle(Theme.textMuted)
                        .frame(minWidth: 44, minHeight: 48)
                        .accessibilityHint("Takes it off your plan")
                }
            } else {
                HStack(spacing: Theme.md) {
                    Button("Add to plan", action: add)
                        .buttonStyle(PrimaryButtonStyle())
                        .frame(maxWidth: 180)
                        .disabled(adding)
                        .accessibilityHint("Adds it to your plan and calendar")
                    Button("Not now") { Task { await model.decline(session) } }
                        .frame(minWidth: 44, minHeight: 48)
                    Button("Why") { showWhy = true }
                        .frame(minWidth: 44, minHeight: 48)
                        .accessibilityHint("Everything this suggestion is based on")
                }
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .padding(.top, Theme.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, Theme.sm)
        .sheet(isPresented: $showWhy) { BasesSheet(session: shown) }
    }

    private func add() {
        let session = session
        adding = true
        Task {
            await model.accept(session)
            adding = false
            // Added in one tap: say so with Undo for a moment. A preview that needs an answer takes the top instead.
            guard model.suggestionState(session) == .added else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { added = session }
            try? await Task.sleep(for: .seconds(4))
            if added?.id == session.id { withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) { added = nil } }
        }
    }

    private func undo() {
        if let added, let action = model.appliedActions.first(where: { $0.id == added.id }) { model.undo(action) }
        added = nil
    }
}
