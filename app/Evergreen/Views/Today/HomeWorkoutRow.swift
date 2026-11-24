import SwiftUI

/// On a day at home with a session: what it works and how long, "Start" to
/// open the workout page, and "I did it another way". Once done, one line says so.
struct HomeWorkoutRow: View {
    @Environment(AppModel.self) private var model
    @State private var open = false

    var body: some View {
        if let focus = model.homeFocusToday {
            VStack(alignment: .leading, spacing: Theme.xs) {
                if model.homeDoneToday {
                    Text("Today’s home workout is done.")
                        .font(.body)
                        .foregroundStyle(Theme.success)
                        .frame(minHeight: 44, alignment: .leading)
                } else {
                    Text("Today at home: \(HomeWorkoutRow.words[focus] ?? "full-body"), about \(model.homeMinutesToday) minutes.")
                        .font(.body)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: Theme.lg) {
                        Button("Start") { open = true }
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.accent)
                        Button("I did it another way") { Task { await model.doneAnotherWay() } }
                            .font(.body)
                            .foregroundStyle(Theme.textMuted)
                    }
                    .frame(minHeight: 44)
                }
            }
            .fullScreenCover(isPresented: $open) { WorkoutSessionView() }
        }
    }

    /// The same words as the engine's FOCUS_WORDS.
    static let words = ["full": "full-body", "lower": "lower-body", "upper": "upper-body",
                        "full_lower": "full-body, more legs", "full_upper": "full-body, more upper body"]
}
