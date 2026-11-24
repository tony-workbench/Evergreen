import SwiftUI

/// Rain through the afternoon of a day at home, in Today's hero: "Rain this afternoon. Short breaks through
/// the day?" Adding puts each break on the plan and the calendar; "Not now" leaves the day as it is.
struct RainSnackCard: View {
    let snacks: RainSnacks
    let onAdd: () -> Void
    let onNotNow: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("Rain this afternoon. Short breaks through the day?")
                .agentFont(22, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(snacks.blocks.count) breaks of \(snacks.minutes) minutes at \(snacks.blocks.map { $0.start.clock }.joined(separator: ", ")), to stand in for a walk. Your strength session stays as it is.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.sm) { buttons }
                VStack(spacing: Theme.sm) { buttons }
            }
            .padding(.top, Theme.sm)
        }
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
    }

    @ViewBuilder private var buttons: some View {
        Button("Short breaks through the day", action: onAdd)
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityHint("Adds the breaks to your plan and calendar")
        Button("Not now", action: onNotNow)
            .buttonStyle(GhostButtonStyle())
    }
}

/// Today's short breaks, each with "Start" for the break page.
struct SnacksTodayRow: View {
    @Environment(AppModel.self) private var model
    @State private var open: PlanItem?

    var body: some View {
        let snacks = model.snacksToday
        if !snacks.isEmpty {
            VStack(alignment: .leading, spacing: Theme.xs) {
                Text("Short breaks today").font(.headline).foregroundStyle(Theme.text)
                ForEach(Array(snacks.enumerated()), id: \.element.id) { index, item in
                    HStack {
                        Text("\(item.slot.start.clock), \(item.slot.minutes) minutes").font(.body).foregroundStyle(Theme.text)
                        Spacer()
                        Button("Start") { open = item }
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.accent)
                            .accessibilityLabel("Start the \(item.slot.start.clock) break")
                    }
                    .frame(minHeight: 44)
                }
            }
            .task { await model.loadMovements() }
            .sheet(item: $open) { item in
                SnackView(minutes: item.slot.minutes, moves: model.snackMovements(turn: snacks.firstIndex { $0.id == item.id } ?? 0))
            }
        }
    }
}

/// One short break: two movements taking turns, a clock that counts down and ends by itself.
struct SnackView: View {
    let minutes: Int
    let moves: [Movement]
    @Environment(\.dismiss) private var dismiss
    @State private var startedAt: Date?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.md) {
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.md) {
                        Text("Take turns, about 30 seconds each, until the clock runs out.")
                            .font(.body).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
                        ForEach(moves) { move in
                            VStack(alignment: .leading, spacing: Theme.xs) {
                                Text(move.name).font(.headline).foregroundStyle(Theme.text)
                                Text(move.setup).font(.body).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
                                ForEach(move.steps, id: \.self) { step in
                                    Text(step).font(.body).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let startedAt {
                    let end = startedAt.addingTimeInterval(TimeInterval(minutes * 60))
                    Text(timerInterval: startedAt...end, countsDown: true)
                        .agentFont(56, relativeTo: .largeTitle)
                        .monospacedDigit()
                        .foregroundStyle(Theme.text)
                        .accessibilityLabel("Time left")
                        .frame(maxWidth: .infinity)
                        .task {
                            try? await Task.sleep(for: .seconds(max(0, end.timeIntervalSinceNow)))
                            if !Task.isCancelled { dismiss() }
                        }
                } else {
                    Button("Start") { startedAt = Date() }.buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(Theme.md)
            .navigationTitle("Short break")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sensoryFeedback(.success, trigger: startedAt)
        }
    }
}
