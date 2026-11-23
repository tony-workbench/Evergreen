import SwiftUI

/// Tour scene 1, "A plan that fits your week": Today's date line, the week
/// picture, whose blocks drop onto their days one after another, and the
/// plan's row for each.
struct PlanScene: View {
    /// Asks the buddy beside the caption for its reaction to this scene.
    let react: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var demo = TourDemo()
    @State private var rows = 0

    var body: some View {
        // The picture and its three rows fill the frame at this width.
        TourPhone(layoutWidth: 400) {
            VStack(alignment: .leading, spacing: Theme.md) {
                Text(demo.dateLine)
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                // The week picture, its blocks dropping in one by one.
                WeekPicture(limit: rows)
                // The same workouts as the plan's rows, each arriving with its block.
                VStack(alignment: .leading, spacing: 0) {
                    // Rows are there from the start so nothing shifts; each fades in with its block.
                    ForEach(Array(demo.model.plan.prefix(3).enumerated()), id: \.element.id) { index, item in
                        VStack(alignment: .leading, spacing: 0) {
                            PlanRow(item: item)
                            Rectangle().fill(Theme.rule).frame(height: 1)
                        }
                        .opacity(index < rows ? 1 : 0)
                    }
                }
            }
            .environment(demo.model)
        }
        .accessibilityElement()
        .accessibilityLabel("Today in Evergreen: the week as a picture, its three workouts dropping onto their days one by one.")
        .task {
            let script = TourScript(reduceMotion: reduceMotion)
            await script.wait(0.5)
            react()
            for row in 1...max(1, demo.model.plan.count) {
                script.change { rows = row }
                await script.wait(0.35)
            }
        }
    }
}
