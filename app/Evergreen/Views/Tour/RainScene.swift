import SwiftUI

/// Tour scene 3, "Rain? It finds a way.": Today with the real rain card,
/// "Rain at 8:30 tomorrow. Move to 2 PM, or go indoors?"; a tap on Move; and
/// the run back on the plan at the dry time, marked "Moved".
struct RainScene: View {
    let react: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var demo = TourDemo()
    @State private var ask: RainAsk?
    /// The card as it is laid out, from the first frame.
    @State private var card: RainAsk?
    @State private var moved: PlanItem?
    @State private var taps = 0

    var body: some View {
        TourPhone(layoutWidth: 385) {
            VStack(alignment: .leading, spacing: Theme.sm) {
                Text(demo.dateLine)
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .padding(.bottom, Theme.xs)
                // Both states share one place and one height: the card is in the layout all along and only its opacity changes.
                ZStack(alignment: .topLeading) {
                    if let card {
                        RainCard(ask: card, now: demo.model.now, onMove: {}, onKeep: {})
                            // Over "Move": the card's padding, then half a button.
                            .overlay(alignment: .bottomLeading) {
                                TourPulse(fired: taps).offset(x: Theme.lg + 36, y: -(Theme.lg + 12))
                            }
                            .opacity(ask == nil ? 0 : 1)
                    }
                    // The row and the week are laid out from the first frame too (unseen, with the run where it was),
                    // so the scene has one height and the date line never moves.
                    if let item = moved ?? card?.session {
                        VStack(alignment: .leading, spacing: Theme.md) {
                            PlanRow(item: item)
                            Rectangle().fill(Theme.rule).frame(height: 1)
                            // The week with the run at its dry time.
                            WeekPicture(limit: 99)
                        }
                        .opacity(moved == nil ? 0 : 1)
                    }
                }
            }
            .environment(demo.model)
        }
        .accessibilityElement()
        .accessibilityLabel("Rain is due on tomorrow's run. Evergreen asks: move it to 2 PM, or go indoors? Move is tapped, and the run is at 2 PM.")
        .task {
            let script = TourScript(reduceMotion: reduceMotion)
            let rain = demo.rainAsk()
            card = rain
            await script.wait(0.3)
            script.change { ask = rain }
            guard let rain, let dry = rain.dryWindow else { return }
            await script.wait(1.6)
            taps += 1
            await script.wait(0.45)
            // The card goes first; the moved run comes only once it is gone, so the two never share a frame.
            script.change(0.2) { ask = nil }
            await script.wait(0.3)
            let item = demo.move(rain.session, to: dry.start)
            script.change { moved = item }
            react()
        }
    }
}
