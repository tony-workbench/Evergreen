import SwiftUI

/// Today's hero when the agent has nothing to show or ask: the next workout,
/// with when, how long and why in plain words.
struct NextWorkoutCard: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            if let item = model.nextWorkout {
                Text("\(Activity.title(item.slot)) \(ActionCopy.when(item.slot.start, now: model.now)) at \(item.slot.start.clock)")
                    .agentFont(34, relativeTo: .largeTitle)
                    .foregroundStyle(Theme.accent)
                Text("\(item.slot.minutes) minutes" + (item.slot.place.map { ", \($0)" } ?? "") + ".")
                    .font(.body)
                    .foregroundStyle(Theme.text)
                if let reason = model.reason(for: item) {
                    Text(reason)
                        .font(.footnote)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text(model.plan.isEmpty ? "Nothing planned yet." : "That’s the week. Nice work.")
                    .agentFont(34, relativeTo: .largeTitle)
                    .foregroundStyle(Theme.accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, Theme.sm)
        .accessibilityElement(children: .combine)
    }
}
