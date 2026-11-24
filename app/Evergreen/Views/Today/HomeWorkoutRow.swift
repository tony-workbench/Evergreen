import SwiftUI

/// On a day at home with a session: what it works and how long, "I did it another way", and "Not now" (later today, or
/// skip today with a reason, as on the reminders). "Start" itself is pinned at the bottom of Today, in reach of the thumb
/// (StartWorkoutBar), and opens the workout page from there, also from "Start" on a reminder. Once done, one line says
/// so; a day done another way (here or "Already done" on a reminder) can be taken back, like a skip.
struct HomeWorkoutRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let focus = model.homeFocusToday {
            VStack(alignment: .leading, spacing: Theme.xs) {
                if model.workoutLog.didSkip(model.todayISO), !model.homeDoneToday {
                    skipped
                } else if model.homeDoneToday {
                    done
                } else {
                    Text("Today at home: \(HomeWorkoutRow.words[focus] ?? "full-body"), about \(model.homeMinutesToday) minutes.")
                        .font(.body)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Theme.lg) { actions }
                        VStack(alignment: .leading, spacing: Theme.sm) { actions }
                    }
                }
            }
        }
    }

    @ViewBuilder private var skipped: some View {
        Text("Skipped today. The next day at home picks it up.")
            .font(.body)
            .foregroundStyle(Theme.textMuted)
            .frame(minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
        Button("Train today after all") { Task { await model.unskipDay(model.todayISO) } }
            .buttonStyle(TapTargetButtonStyle())
            .accessibilityIdentifier("today.unskip")
    }

    @ViewBuilder private var done: some View {
        Text(model.workoutLog.didOtherWay(model.todayISO) ? "Today’s home workout is done another way." : "Today’s home workout is done.")
            .font(.body)
            .foregroundStyle(Theme.success)
            .frame(minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
            .accessibilityIdentifier("today.done")
        if model.workoutLog.didOtherWay(model.todayISO) {
            Button("Undo: I haven’t trained yet") { Task { await model.undoDoneAnotherWay() } }
                .buttonStyle(TapTargetButtonStyle())
                .accessibilityHint("Brings back today’s workout and its reminders")
                .accessibilityIdentifier("today.undoDone")
        }
    }

    @ViewBuilder private var actions: some View {
        Button("I did it another way") { Task { await model.doneAnotherWay() } }
            .buttonStyle(TapTargetButtonStyle(color: Theme.textMuted))
            .accessibilityHint("Marks today done. You can undo it.")
            .accessibilityIdentifier("today.otherWay")
        Menu {
            Button("Later today") { Task { await model.laterToday() } }
            Section("Skip today") {
                Button("I’m out") { Task { await model.skipDay(model.todayISO, reason: "out") } }
                Button("Not feeling well") { Task { await model.skipDay(model.todayISO, reason: "unwell") } }
                Button("Not today") { Task { await model.skipDay(model.todayISO, reason: "not_today") } }
                    .accessibilityIdentifier("today.skip.notToday")
            }
        } label: {
            Text("Not now")
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                .contentShape(Rectangle())
        }
        .accessibilityIdentifier("today.notNow")
    }

    /// The same words as the engine's FOCUS_WORDS.
    static let words = ["full": "full-body", "lower": "lower-body", "upper": "upper-body",
                        "full_lower": "full-body, more legs", "full_upper": "full-body, more upper body"]
}

/// Today's "Start", pinned at the bottom of Today in reach of the thumb (56 points, like "Done with this set"), while
/// today has a home session still to do.
struct StartWorkoutBar: View {
    @Environment(AppModel.self) private var model
    let start: () -> Void

    var body: some View {
        PinnedBar {
            Button("Start today’s workout", action: start)
                .buttonStyle(PrimaryButtonStyle.tall)
                .accessibilityHint("About \(model.homeMinutesToday) minutes at home")
                .accessibilityIdentifier("today.start")
        }
    }
}
