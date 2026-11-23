import SwiftUI

/// Tour scene 2, "A meeting lands. Your run moves.": tonight's real plan row
/// at 6:00 PM; "Team sync" comes in above it; the row's time becomes 6:45 PM
/// with its "Moved" badge, and the real card, "Saved your workout", comes in
/// above with Undo.
struct MoveScene: View {
    /// Asks the buddy beside the caption for its reaction to this scene.
    let react: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var demo = TourDemo()
    @State private var meeting = false
    @State private var moved: AgentAction?
    @State private var cardShown = false

    var body: some View {
        // The tallest scene: laid out wide enough for the rows and the card under them.
        TourPhone(layoutWidth: 440) {
            VStack(alignment: .leading, spacing: Theme.sm) {
                Text(demo.dateLine)
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .padding(.bottom, Theme.xs)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Tonight")
                        .font(.footnote)
                        .foregroundStyle(Theme.textMuted)
                        .padding(.top, Theme.sm)
                    if meeting {
                        meetingRow
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                        Rectangle().fill(Theme.rule).frame(height: 1)
                    }
                    if let item = demo.tonight {
                        PlanRow(item: item)
                        Rectangle().fill(Theme.rule).frame(height: 1)
                    }
                }
                if let moved {
                    // Under the rows, where nothing has to make room for it: it only fades in.
                    AgentCard(action: moved)
                        .padding(.top, Theme.sm)
                        .opacity(cardShown ? 1 : 0)
                        .transition(.identity)
                }
            }
            .environment(demo.model)
        }
        .accessibilityElement()
        .accessibilityLabel("Tonight's run is at 6. A team sync lands at 6, so Evergreen moves the run to 6:45, marks it Moved and says so on a card with Undo.")
        .task {
            let script = TourScript(reduceMotion: reduceMotion)
            await script.wait(1.0)
            script.change { meeting = true }
            await script.wait(1.1)
            // The row changes in one step, with nothing sliding through anything else.
            moved = demo.moveTonight()
            await script.wait(0.3)
            script.change(0.2) { cardShown = true }
            await script.wait(0.3)
            react()
        }
    }

    /// What landed on the calendar, set like a plan row.
    private var meetingRow: some View {
        HStack(alignment: .top, spacing: Theme.md) {
            VStack(alignment: .leading, spacing: 2) {
                Label("Team sync", systemImage: "calendar")
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.textMuted)
                Text("Meeting · 60 min")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer(minLength: Theme.sm)
            Text("6:00 PM")
                .font(.body)
                .foregroundStyle(Theme.textMuted)
        }
        .padding(.vertical, Theme.md)
    }
}
