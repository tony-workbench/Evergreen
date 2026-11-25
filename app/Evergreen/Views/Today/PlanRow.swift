import SwiftUI

/// One planned workout: the day (with a "Moved" badge when the agent moved
/// it), what and how long, and the time. Tapping an upcoming one picks another
/// time. Missed ones are muted, never red.
struct PlanRow: View {
    let item: PlanItem

    @Environment(AppModel.self) private var model
    @State private var picking = false

    var body: some View {
        if canMove {
            Button(action: pick) { row(showsChevron: true) }
                .buttonStyle(RowPressStyle())
                .accessibilityHint("Picks another time")
                .accessibilityIdentifier("plan.row.\(item.id)")
                .pickAnotherTime(for: item, isPresented: $picking)
        } else {
            row(showsChevron: false)
        }
    }

    /// Done and missed workouts stay put; upcoming ones can move.
    private var canMove: Bool {
        model.completion(for: item) == nil && !isMissed && item.slot.start > model.now
    }

    private func pick() {
        picking = true
    }

    private func row(showsChevron: Bool) -> some View {
        HStack(alignment: .top, spacing: Theme.md) {
            what
            Spacer(minLength: Theme.sm)
            VStack(alignment: .trailing, spacing: Theme.xxs) {
                Text(item.slot.start.clock)
                    .font(.body.monospacedDigit())
                    .foregroundStyle(isMissed ? Theme.textMuted : Theme.text)
                status
            }
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.textMuted)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, Theme.md)
        .frame(minHeight: TapTargetButtonStyle.minSide)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    /// The day (with "Moved" when the agent moved it), what and how long, and why.
    private var what: some View {
        VStack(alignment: .leading, spacing: Theme.xxs) {
            HStack(spacing: Theme.sm) {
                Text(item.slot.start.formatted(.dateTime.weekday(.wide)))
                    .font(.body.weight(.medium))
                    .foregroundStyle(isMissed ? Theme.textMuted : Theme.text)
                    .strikethrough(isMissed, color: Theme.textMuted)
                if model.movedAction(for: item) != nil { Badge(text: "Moved") }
            }
            Text(detail)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
            if let reason = model.reason(for: item), !isMissed, model.completion(for: item) == nil {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, Theme.xxs)
            }
        }
    }

    /// "Strength, 30 minutes."
    private var detail: String {
        var parts = [Activity.title(item.slot), "\(item.slot.minutes) minutes"]
        if let place = item.slot.place { parts.append(place) }
        return parts.joined(separator: ", ") + "."
    }

    private var isMissed: Bool { model.isMissed(item) }

    @ViewBuilder
    private var status: some View {
        if model.completion(for: item) != nil {
            Label("Done", systemImage: "checkmark.circle.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.success)
        } else if isMissed {
            Text("Next time")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
        }
    }
}
