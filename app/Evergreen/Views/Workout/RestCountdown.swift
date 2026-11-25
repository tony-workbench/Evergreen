import SwiftUI

/// The rest between sets: a countdown, 15 seconds more or less, and Skip. VoiceOver reads "Rest left" and then the
/// seconds left, which it reads again as they change.
struct RestCountdown: View {
    /// How often what VoiceOver reads is brought up to date.
    private static let tick: TimeInterval = 1
    let until: Date
    let next: String
    let change: (Date) -> Void
    let onDone: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: Theme.lg) {
            Text("Rest").font(.headline).foregroundStyle(Theme.textMuted)
            timer
            Text(next).font(.body).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.lg) { steps }
                VStack(spacing: Theme.sm) { steps }
            }
            Button("Skip rest", action: onDone)
                .buttonStyle(GhostButtonStyle())
                .accessibilityIdentifier("workout.skipRest")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Theme.md)
        .task(id: until) { await waitOut() }
    }

    /// The seconds left, read by VoiceOver as "Rest left" and its value, brought up to date every second.
    private var timer: some View {
        TimelineView(.periodic(from: model.now, by: Self.tick)) { context in
            Text(timerInterval: context.date...max(until, context.date), countsDown: true)
                .agentFont(Theme.bigNumberSize, relativeTo: .largeTitle)
                .monospacedDigit()
                .foregroundStyle(Theme.text)
                .accessibilityLabel("Rest left")
                .accessibilityValue(AppModel.restWords(until.timeIntervalSince(context.date)))
                .accessibilityIdentifier("workout.restLeft")
        }
    }

    @ViewBuilder private var steps: some View {
        Button("−15 s") { change(AppModel.rest(until, longer: false)) }
            .buttonStyle(TapTargetButtonStyle(color: Theme.text, weight: .medium))
            .accessibilityLabel("15 seconds less rest")
        Button("+15 s") { change(AppModel.rest(until, longer: true)) }
            .buttonStyle(TapTargetButtonStyle(color: Theme.text, weight: .medium))
            .accessibilityLabel("15 seconds more rest")
    }

    private func waitOut() async {
        let wait = model.timeLeft(until: until)
        if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
        if !Task.isCancelled { onDone() }
    }
}
