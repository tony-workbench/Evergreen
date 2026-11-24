import SwiftUI

/// An empty or failed workout page: what happened and one thing to do about it.
struct WorkoutProblem: View {
    let words: String
    let action: String
    /// For UI tests.
    let id: String
    let perform: () -> Void
    @Environment(\.networkStatus) private var network

    /// The workout page works offline: the movements, the log and Apple Health are all on the phone.
    static let offlineWords = "You’re offline. Today’s workout works on this phone, and everything you do is kept."

    var body: some View {
        VStack(spacing: Theme.md) {
            if !network.isOnline { OfflineLine(words: Self.offlineWords) }
            Text(words).font(.body).foregroundStyle(Theme.text).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button(action, action: perform)
                .buttonStyle(PrimaryButtonStyle.tall)
                .accessibilityIdentifier(id)
        }
        .padding(Theme.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The top of a movement's page: where in the session, its name, the set and its target, the slow step, and what the
/// last button just did.
struct MovementHeader: View {
    let progress: WorkoutProgress
    let move: Movement
    let note: String?

    var body: some View {
        if progress.index == 0, let reason = progress.reason { AIPickedNote(reason: reason) }
        Text("\(progress.index + 1) of \(progress.content.items.count)")
            .font(.footnote).foregroundStyle(Theme.textMuted)
        Text(move.name)
            .agentFont(Theme.pageTitleSize, relativeTo: .title)
            .foregroundStyle(Theme.text)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("workout.movementName")
        Text(targetLine).font(.headline).foregroundStyle(Theme.accent)
        if let slow = progress.slowLine(for: move) {
            Label(slow, systemImage: "tortoise")
                .font(.body).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
        if let note {
            Text(note).font(.body).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("workout.note")
        }
    }

    private var targetLine: String {
        guard let item = progress.pageItem else { return "" }
        var line = "Set \(progress.shownSetNumber) of \(item.sets) · \(item.target(sides: move.sides))"
        if let load = progress.pageResult?.load ?? item.load { line += " · " + BackpackWater.words(load) }
        return line
    }
}

/// Steps are read mid-workout: body text with line spacing relative to the text size, so lines stay at least 1.4 times
/// the size apart at every Dynamic Type size.
private struct StepSpacing: ViewModifier {
    @ScaledMetric(relativeTo: .body) private var spacing = StepSpacing.bodyLineGap

    /// The gap at the default body size (17 pt): 17 × 1.4 − 17 ≈ 7 points, scaled with the text.
    static let bodyLineGap: CGFloat = 7

    func body(content: Content) -> some View {
        content.lineSpacing(spacing).fixedSize(horizontal: false, vertical: true)
    }
}

/// Every step of a movement: the setup, the numbered steps, the tempo, where to feel it, when it counts and what to watch.
struct HowToSteps: View {
    let move: Movement

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(move.setup).font(.body).foregroundStyle(Theme.text)
            ForEach(move.numberedSteps) { step in
                HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
                    Text("\(step.number).").font(.body.monospacedDigit()).foregroundStyle(Theme.textMuted)
                    Text(step.text).font(.body).foregroundStyle(Theme.text)
                }
            }
            if let tempo = move.tempoLine { Text(tempo).font(.body).foregroundStyle(Theme.text) }
            StepLine(title: "Where you should feel it", text: move.feel)
            StepLine(title: "It counts when", text: move.pass)
            StepLine(title: "Watch for", text: move.mistakes.joined(separator: " "))
        }
        .modifier(StepSpacing())
    }
}

/// From the third time: three lines, and the rest a tap away.
struct ShortHowTo: View {
    let move: Movement
    let showAll: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(move.setup).font(.body).foregroundStyle(Theme.text)
            Text("It counts when: " + move.pass).font(.body).foregroundStyle(Theme.text)
            Text("Watch for: " + (move.mistakes.first ?? move.feel)).font(.body).foregroundStyle(Theme.text)
            Button("Show all the steps", action: showAll)
                .buttonStyle(TapTargetButtonStyle())
                .accessibilityIdentifier("workout.showAllSteps")
        }
        .modifier(StepSpacing())
    }
}

private struct StepLine: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xxs) {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(Theme.textMuted)
            Text(text).font(.body).foregroundStyle(Theme.text)
        }
    }
}

/// The count of a set and the page's smaller actions. The actions sit in a row when they fit, and one under another at
/// large text sizes, each at least 44 by 44 points with 8 points between.
struct SetEntry: View {
    enum Action { case tooHard, tooEasy, swap, skip }

    let item: WorkoutContent.Item
    @Binding var count: Int
    /// "Too easy" shows only while a backpack movement's weight is being found (`AppModel.offersTooEasy`).
    let offersTooEasy: Bool
    let act: (Action) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Stepper(item.isHold ? "Seconds held: \(count)" : "Reps done: \(count)", value: $count,
                    in: item.countRange)
                .font(.body)
                .frame(minHeight: TapTargetButtonStyle.minSide)
                .accessibilityIdentifier("workout.count")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.sm) { actions }
                VStack(alignment: .leading, spacing: Theme.sm) { actions }
            }
        }
    }

    @ViewBuilder private var actions: some View {
        small("Too hard", .tooHard, id: "workout.tooHard")
        if offersTooEasy { small("Too easy", .tooEasy, id: "workout.tooEasy") }
        small("Swap", .swap, id: "workout.swap")
        small("Skip", .skip, id: "workout.skip")
    }

    private func small(_ title: String, _ action: Action, id: String) -> some View {
        Button(title) { act(action) }
            .buttonStyle(TapTargetButtonStyle(fills: true, outlined: true))
            .accessibilityIdentifier(id)
    }
}

/// The movements next to this one on its chain, one easier and one harder, that the rules leave open: never one marked
/// "can't do", left out or not unlocked yet.
struct SwapList: View {
    let choices: [Movement]
    let onPick: (Movement) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            List(choices) { move in
                Button { onPick(move) } label: {
                    VStack(alignment: .leading, spacing: Theme.xxs) {
                        Text(move.name).font(.body).foregroundStyle(Theme.text)
                        Text(move.setup).font(.footnote).foregroundStyle(Theme.textMuted)
                    }
                    .frame(minHeight: TapTargetButtonStyle.minSide)
                }
            }
            .overlay { if choices.isEmpty { empty } }
            .navigationTitle("Swap for")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) } }
        }
    }

    private var empty: some View {
        VStack(spacing: Theme.md) {
            Text("There’s no easier or harder one next to this movement with what you have.")
                .font(.body).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
            Button("Keep this one", action: onCancel).buttonStyle(GhostButtonStyle())
        }
        .padding()
    }
}
