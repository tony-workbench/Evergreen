import SwiftUI

/// Today's one large statement: the top suggestion as a sentence ("Run,
/// Monday at 7."), what else there is to say about it, a chip only for
/// what the sentence doesn't already say, and the screen's one primary
/// button. "Not now" and "Why" are quiet text. No card: the statement sits
/// on the page.
struct TopSuggestionCard: View {
    let session: WeekPlan.Session

    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    /// The session just added, kept on screen with its Undo.
    @State private var added: WeekPlan.Session?
    @State private var showWhy = false
    @State private var adding = false

    private var shown: WeekPlan.Session { added ?? session }

    /// The widest "Add to plan" gets, so "Not now" and "Why" stay beside it.
    private static let addMaxWidth: CGFloat = 180
    /// How long "Added" and its Undo stay, and how long they take to come and go.
    private static let addedSeconds = 4.0
    private static let addedIn = 0.2
    private static let addedOut = 0.25

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(SuggestionWords.statement(shown, calendar: model.calendar))
                .agentFont(Theme.heroTitleSize, relativeTo: .largeTitle)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(SuggestionWords.detail(shown))
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(model.cardChips(for: shown)) { BasisChip(basis: $0) }
            if added != nil { addedRow } else { answers }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, Theme.sm)
        .sheet(isPresented: $showWhy) { BasesSheet(session: shown) }
    }

    /// "Added", with Undo for a moment.
    private var addedRow: some View {
        HStack(spacing: Theme.md) {
            Label("Added", systemImage: "checkmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.accent)
            Button("Undo", action: undo)
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: PrimaryButtonStyle.standardHeight)
                .accessibilityHint("Takes it off your plan")
                .accessibilityIdentifier("top.undo")
        }
    }

    /// "Add to plan", then "Not now" and "Why" as quiet text.
    private var answers: some View {
        HStack(spacing: Theme.md) {
            Button("Add to plan", action: add)
                .buttonStyle(PrimaryButtonStyle())
                .frame(maxWidth: Self.addMaxWidth)
                .disabled(adding)
                .accessibilityHint("Adds it to your plan and calendar")
                .accessibilityIdentifier("top.add")
            Button("Not now") { Task { await model.decline(session) } }
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: PrimaryButtonStyle.standardHeight)
                .accessibilityIdentifier("top.notNow")
            Button("Why") { showWhy = true }
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: PrimaryButtonStyle.standardHeight)
                .accessibilityHint("Everything this suggestion is based on")
                .accessibilityIdentifier("top.why")
        }
        .font(.body)
        .foregroundStyle(Theme.textMuted)
        .padding(.top, Theme.xs)
    }

    private func add() {
        let session = session
        adding = true
        Task {
            await model.accept(session)
            adding = false
            // Added in one tap: say so with Undo for a moment. A preview that needs an answer takes the top instead.
            guard model.suggestionState(session) == .added else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: Self.addedIn)) { added = session }
            try? await Task.sleep(for: .seconds(Self.addedSeconds))
            if added?.id == session.id { withAnimation(reduceMotion ? nil : .easeInOut(duration: Self.addedOut)) { added = nil } }
        }
    }

    private func undo() {
        if let added, let action = model.appliedActions.first(where: { $0.id == added.id }) { model.undo(action) }
        added = nil
    }
}
