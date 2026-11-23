import SwiftUI

/// What the person added this week, one row each; tapping one moves it. Nothing when nothing is added: the week picture already says so.
struct TodayPlanSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(model.plan) { item in
                PlanRow(item: item)
                Rectangle().fill(Theme.rule).frame(height: 1)
            }
        }
    }
}
