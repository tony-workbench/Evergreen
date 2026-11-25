import SwiftUI

/// Today's hero while the week is being planned: the shape of the card to come, with the buddy thinking.
struct PlanningCard: View {
    /// After six seconds, one calm line says it is still going.
    @State private var slow = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            HStack(spacing: Theme.md) {
                WalkingBuddy()
                    .frame(width: 40, height: 48)
                    .accessibilityHidden(true)
                Text("Planning your week…")
                    .agentFont(34, relativeTo: .largeTitle)
                    .foregroundStyle(Theme.accent)
            }
            Text(slow ? "Still planning…" : "From your routine, your sleep and your calendar.")
                .font(.body)
                .foregroundStyle(Theme.textMuted)
            ForEach([220.0, 170.0], id: \.self) { width in
                RoundedRectangle(cornerRadius: Theme.radiusSmall)
                    .fill(Theme.rule)
                    .frame(maxWidth: width)
                    .frame(height: 28)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, Theme.sm)
        .accessibilityElement(children: .combine)
        .task {
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { slow = true }
        }
    }
}
