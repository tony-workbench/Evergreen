import SwiftUI

/// The home workout page: one movement per screen, in words only, with what to
/// do, where it should be felt and when a rep counts; a rest countdown between
/// sets; "Too hard", "Swap" and "Done with this set"; and, at the end, how
/// sore it is and how it went. What is done is kept as it goes, so leaving and
/// coming back the same day picks up where it stopped. What each button does to
/// the session lives in the model (AppModel+WorkoutPage.swift).
struct WorkoutSessionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.networkStatus) private var network

    @State private var progress: WorkoutProgress?
    @State private var loading = true
    @State private var count = 0
    @State private var restUntil: Date?
    @State private var finishing = false
    @State private var swapping = false
    /// Goes up with each set done, for a light tap of feedback.
    @State private var setsLogged = 0
    /// The session couldn't be worked out (not the same as no session today).
    @State private var failed = false
    /// What "Too hard", "Too easy" or "Not yet" just did, said on the page.
    @State private var swappedNote: String?
    /// The full steps of a movement done twice before, opened from its short version.
    @State private var showAllSteps = false
    @State private var showWeek = false

    var body: some View {
        NavigationStack {
            page
                .background(Theme.surface)
                .toolbar { closeButton }
                .navigationBarTitleDisplayMode(.inline)
        }
        .sensoryFeedback(.success, trigger: setsLogged)
        .sensoryFeedback(.success, trigger: finishing) { _, now in now }
        .sensoryFeedback(.error, trigger: failed) { _, now in now }
        .task { await load() }
        .sheet(isPresented: $showWeek) { WeekTableView() }
    }

    @ViewBuilder private var page: some View {
        if loading {
            ProgressView("Getting today’s workout…").frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("workout.loading")
        } else if failed {
            WorkoutProblem(words: "Today’s workout couldn’t be worked out just now.", action: "Try again", id: "workout.retry") {
                Task { await load() }
            }
        } else if progress == nil {
            noWorkout
        } else if finishing, let progress {
            WorkoutFinishPage(progress: progress) { dismiss() }
        } else if let restUntil {
            RestCountdown(until: restUntil, next: model.nextSetLine(progress)) { self.restUntil = $0 } onDone: { self.restUntil = nil }
        } else {
            movementPage
        }
    }

    @ToolbarContentBuilder private var closeButton: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Close") { dismiss() }
                .accessibilityHint("What you’ve done is kept for today")
                .accessibilityIdentifier("workout.close")
        }
    }

    private func load() async {
        loading = true
        apply(await model.workoutToday())
    }

    private func apply(_ today: AppModel.TodayWorkout) {
        progress = today.progress
        failed = today.failed
        loading = false
        resetCount()
    }

    /// No session today: why, and something to do about it. A day without one can still train ("Train anyway", the rules'
    /// full-body session); a day already done can look at the week ahead.
    @ViewBuilder private var noWorkout: some View {
        if model.homeDoneToday {
            WorkoutProblem(words: model.noWorkoutWords, action: "See this week", id: "workout.seeWeek") { showWeek = true }
        } else {
            WorkoutProblem(words: model.noWorkoutWords, action: "Train anyway", id: "workout.trainAnyway") {
                Task { loading = true; apply(await model.extraWorkoutToday()) }
            }
        }
    }

    // MARK: One movement

    @ViewBuilder private var movementPage: some View {
        if let progress, let item = progress.pageItem, let move = model.movement(item.movementId) {
            movementScreen(progress, item, move)
        } else {
            unreadableMovement
        }
    }

    /// A movement whose words couldn't be read: said, with a way on. Nothing moves by itself, so the page can't stall.
    private var unreadableMovement: some View {
        let last = progress?.isLastMovement ?? true
        return WorkoutProblem(words: "This movement couldn’t be read, so it’s left out today.",
                              action: last ? "Finish the workout" : "Next movement", id: "workout.skipUnreadable") { advance() }
            .task { await model.loadMovements() }
    }

    private func movementScreen(_ progress: WorkoutProgress, _ item: WorkoutContent.Item, _ move: Movement) -> some View {
        let asks = model.asksFirst(progress, move: move)
        return ScrollView {
            VStack(alignment: .leading, spacing: Theme.md) {
                if !network.isOnline { OfflineLine(words: WorkoutProblem.offlineWords) }
                MovementHeader(progress: progress, move: move, note: swappedNote)
                if asks {
                    Text("This one is new. Try one rep first: can you do it?").font(.body).foregroundStyle(Theme.text)
                    HowToSteps(move: move)
                } else {
                    steps(move)
                    entry(progress, item)
                }
            }
            .padding(Theme.md)
        }
        .safeAreaInset(edge: .bottom) { mainButtons(asks: asks, move: move) }
        .sheet(isPresented: $swapping) { SwapList(choices: model.swapChoices(for: move)) { replace(with: $0) } onCancel: { swapping = false } }
    }

    /// The main button stays at the bottom, in reach of the thumb, while the steps scroll.
    private func mainButtons(asks: Bool, move: Movement) -> some View {
        PinnedBar {
            if asks {
                Button("Yes, I can") { Task { await model.answerCanDo(move.id, can: true) } }
                    .buttonStyle(PrimaryButtonStyle.tall)
                    .accessibilityIdentifier("workout.yesICan")
                Button("Not yet") { notYet(move) }
                    .buttonStyle(GhostButtonStyle())
                    .accessibilityIdentifier("workout.notYet")
            } else {
                Button("Done with this set") { doneWithSet() }
                    .buttonStyle(PrimaryButtonStyle.tall)
                    .accessibilityIdentifier("workout.doneWithSet")
            }
        }
    }

    @ViewBuilder private func steps(_ move: Movement) -> some View {
        if model.showsShortSteps(move.id) && !showAllSteps {
            ShortHowTo(move: move) { showAllSteps = true }
        } else {
            HowToSteps(move: move)
        }
    }

    private func entry(_ progress: WorkoutProgress, _ item: WorkoutContent.Item) -> some View {
        SetEntry(item: item, count: $count, offersTooEasy: model.offersTooEasy(progress)) { action in
            switch action {
            case .tooHard: change { model.tooHard(&$0, entered: count) }
            case .tooEasy: change { model.tooEasy(&$0) }
            case .swap: swapping = true
            case .skip: advance()
            }
        }
    }

    // MARK: Changing what's on screen

    /// Runs one of the model's changes on the session on screen, and says what it did.
    private func change(_ edit: (inout WorkoutProgress) -> String?) {
        guard var current = progress else { return }
        let note = edit(&current)
        progress = current
        swappedNote = note
        resetCount()
    }

    private func resetCount() {
        count = progress?.pageItem?.low ?? 0
    }

    private func doneWithSet() {
        guard var current = progress, let item = current.pageItem else { return }
        let last = model.logSet(&current, count: count)
        progress = current
        setsLogged += 1
        swappedNote = nil
        if last { advance() } else { restUntil = model.restEnd(after: item); resetCount() }
    }

    private func notYet(_ move: Movement) {
        guard var current = progress else { return }
        guard let note = model.notYet(&current, move: move) else { advance(); return }
        progress = current
        swappedNote = note
        resetCount()
    }

    private func replace(with move: Movement) {
        guard var current = progress else { return }
        model.swapMovement(&current, to: move)
        progress = current
        swapping = false
        showAllSteps = false
        resetCount()
    }

    private func advance() {
        guard var current = progress else { return }
        restUntil = nil
        finishing = model.advance(&current)
        progress = current
        swappedNote = nil
        showAllSteps = false
        resetCount()
    }
}
