import SwiftUI

/// On a day at home with a session: what it works and how long, "Start" to
/// open the workout page, "I did it another way", and "Not now" (later today, or
/// skip today with a reason, as on the reminders). Once done, one line says so.
/// "Start" on a reminder opens the workout page from here too.
struct HomeWorkoutRow: View {
    @Environment(AppModel.self) private var model
    @State private var open = false

    var body: some View {
        if let focus = model.homeFocusToday {
            VStack(alignment: .leading, spacing: Theme.xs) {
                if model.workoutLog.didSkip(model.todayISO), !model.homeDoneToday {
                    Text("Skipped today. The next day at home picks it up.")
                        .font(.body)
                        .foregroundStyle(Theme.textMuted)
                        .frame(minHeight: 44, alignment: .leading)
                    Button("Train today after all") { Task { await model.unskipDay(model.todayISO) } }
                        .font(.body)
                        .foregroundStyle(Theme.accent)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                } else if model.homeDoneToday {
                    Text("Today’s home workout is done.")
                        .font(.body)
                        .foregroundStyle(Theme.success)
                        .frame(minHeight: 44, alignment: .leading)
                } else {
                    Text("Today at home: \(HomeWorkoutRow.words[focus] ?? "full-body"), about \(model.homeMinutesToday) minutes.")
                        .font(.body)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Theme.lg) { actions }
                        VStack(alignment: .leading, spacing: Theme.xs) { actions }
                    }
                    .frame(minHeight: 44)
                }
            }
            .fullScreenCover(isPresented: $open) { WorkoutSessionView() }
            .onAppear { openIfAsked() }
            .onChange(of: model.workoutRequested) { openIfAsked() }
        }
    }

    @ViewBuilder private var actions: some View {
        Button("Start") { open = true }
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.accent)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        Button("I did it another way") { Task { await model.doneAnotherWay() } }
            .font(.body)
            .foregroundStyle(Theme.textMuted)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        Menu("Not now") {
            Button("Later today") { Task { await model.laterToday() } }
            Section("Skip today") {
                Button("I’m out") { Task { await model.skipDay(model.todayISO, reason: "out") } }
                Button("Not feeling well") { Task { await model.skipDay(model.todayISO, reason: "unwell") } }
                Button("Not today") { Task { await model.skipDay(model.todayISO, reason: "not_today") } }
            }
        }
        .font(.body)
        .foregroundStyle(Theme.textMuted)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private func openIfAsked() {
        guard model.workoutRequested else { return }
        model.workoutRequested = false
        if !model.homeDoneToday { open = true }
    }

    /// The same words as the engine's FOCUS_WORDS.
    static let words = ["full": "full-body", "lower": "lower-body", "upper": "upper-body",
                        "full_lower": "full-body, more legs", "full_upper": "full-body, more upper body"]
}
