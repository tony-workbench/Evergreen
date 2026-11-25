import SwiftUI

/// The end of the workout page: how sore it is now and how it went, then "Finish", pinned at the bottom in reach of the
/// thumb, which saves the session.
struct WorkoutFinishPage: View {
    let progress: WorkoutProgress
    let onDone: () -> Void

    @Environment(AppModel.self) private var model
    @State private var soreness: SorenessAnswer?
    @State private var feeling: WorkoutFeeling?
    @State private var saving = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.lg) {
                Text("That’s the workout.")
                    .agentFont(Theme.pageTitleSize, relativeTo: .title)
                    .foregroundStyle(Theme.accent)
                    .accessibilityAddTraits(.isHeader)
                sorenessQuestion
                howItWent
                notes
            }
            .padding(Theme.md)
        }
        .safeAreaInset(edge: .bottom) {
            PinnedBar {
                Button(saving ? "Saving…" : "Finish") { finish() }
                    .buttonStyle(PrimaryButtonStyle.tall)
                    .disabled(saving)
                    .accessibilityIdentifier("workout.finish")
            }
        }
    }

    private var sorenessQuestion: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("How sore is it now, 0 to 10?").font(.headline).foregroundStyle(Theme.text)
            // The answers and what each one says come from the model (`SorenessAnswer`).
            Picker("Soreness", selection: $soreness) {
                ForEach(SorenessAnswer.allCases, id: \.self) { Text($0.title).tag(Optional($0)) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("workout.soreness")
            if let said = soreness?.followUp {
                Text(said.words)
                    .font(.body).foregroundStyle(said.warning ? Theme.warning : Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var howItWent: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("How was it?").font(.headline).foregroundStyle(Theme.text)
            Picker("How it went", selection: $feeling) {
                ForEach(WorkoutFeeling.allCases, id: \.self) { Text($0.title).tag(Optional($0)) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("workout.feeling")
        }
    }

    @ViewBuilder private var notes: some View {
        if model.workoutLog.didOtherWay(progress.day) {
            Text("You marked today as trained from a reminder. Finishing saves this session instead, once.")
                .font(.footnote).foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        Text("Finishing saves a strength workout to Apple Health and takes off today’s other reminders.")
            .font(.footnote).foregroundStyle(Theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func finish() {
        guard !saving else { return }
        saving = true
        Task {
            await model.finishWorkout(progress, pain: soreness?.rawValue, feeling: feeling)
            onDone()
        }
    }
}
