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
                .agentFont(Theme.questionTitleSize, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
            Text(snacks.offerDetail)
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
                ForEach(snacks) { item in row(item) }
            }
            .task { await model.loadMovements() }
            .sheet(item: $open) { item in
                SnackView(minutes: item.slot.minutes, moves: model.snackMovements(for: item))
            }
        }
    }

    private func row(_ item: PlanItem) -> some View {
        HStack {
            Text("\(item.slot.start.clock), \(item.slot.minutes) minutes").font(.body).foregroundStyle(Theme.text)
            Spacer()
            Button("Start") { open = item }
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.accent)
                .accessibilityLabel("Start the \(item.slot.start.clock) break")
                .accessibilityIdentifier("snacks.start.\(item.id)")
        }
        .frame(minHeight: TapTargetButtonStyle.minSide)
    }
}

/// One short break: two movements taking turns, a clock that counts down and ends by itself.
struct SnackView: View {
    let minutes: Int
    let moves: [Movement]
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var startedAt: Date?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Theme.md) {
                ScrollView { steps }
                if let startedAt { clock(from: startedAt) } else {
                    Button("Start") { self.startedAt = model.now }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("snack.start")
                }
            }
            .padding(Theme.md)
            .navigationTitle("Short break")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("snack.done") } }
            .sensoryFeedback(.success, trigger: startedAt)
        }
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: Theme.md) {
            Text("Take turns, about 30 seconds each, until the clock runs out.")
                .font(.body).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
            ForEach(moves) { move in
                VStack(alignment: .leading, spacing: Theme.xs) {
                    Text(move.name).font(.headline).foregroundStyle(Theme.text)
                    Text(move.setup).font(.body).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
                    ForEach(move.numberedSteps) { step in
                        Text(step.text).font(.body).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The time left, counting down; the page closes by itself when it runs out.
    private func clock(from start: Date) -> some View {
        let end = AppModel.breakEnd(from: start, minutes: minutes)
        return Text(timerInterval: start...end, countsDown: true)
            .agentFont(Theme.statementSize, relativeTo: .largeTitle)
            .monospacedDigit()
            .foregroundStyle(Theme.text)
            .accessibilityLabel("Time left")
            .frame(maxWidth: .infinity)
            .task {
                try? await Task.sleep(for: .seconds(max(0, model.timeLeft(until: end))))
                if !Task.isCancelled { dismiss() }
            }
    }
}
