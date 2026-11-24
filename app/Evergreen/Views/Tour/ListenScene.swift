import SwiftUI

/// Tour scene 4, "It listens when you say no.": the real suggestion row for a
/// 6:00 AM run from a usual time; a tap on Not now; the quiet line "Got it.
/// I won't plan around …" with Undo takes its place, and the session planned
/// again for 8:30 AM follows under it. Then the buddy cheers: the tour is done.
struct ListenScene: View {
    /// Asks the buddy beside the caption for its reaction to this scene.
    let react: () -> Void

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    @State private var demo = TourDemo()
    @State private var taps = 0
    /// The first suggestion, then nothing for a moment, then the next one.
    @State private var declined = false
    /// The line about what "Not now" stopped, once the first suggestion has gone.
    @State private var noted = false
    @State private var next = false

    var body: some View {
        TourPhone(layoutWidth: 320) {
            VStack(alignment: .leading, spacing: Theme.sm) {
                let again = demo.suggestion(hour: 8, usual: false)
                // Every part is in the layout from the first frame, so the scene keeps one height and nothing moves:
                // what "Not now" did, said first; under it the suggestion, then the next one in its place.
                let note = demo.model.stopNote(for: again)
                StopNoteRow(text: note?.text ?? "Got it. I won’t plan around Thursday 6 AM runs.", answerKey: note?.answerKey ?? "")
                    .opacity(noted ? 1 : 0)
                Rectangle().fill(Theme.rule).frame(height: 1)
                    .opacity(noted ? 1 : 0)
                ZStack(alignment: .topLeading) {
                    TopSuggestionCard(session: again)
                        .opacity(next ? 1 : 0)
                    TopSuggestionCard(session: demo.suggestion(hour: 6, usual: true))
                        // Over "Not now", the quiet answer beside the button.
                        .overlay(alignment: .bottomLeading) {
                            TourPulse(fired: taps).offset(x: 197, y: -(Theme.sm + 24))
                        }
                        .opacity(declined ? 0 : 1)
                }
            }
            .environment(demo.model)
        }
        .accessibilityElement()
        .accessibilityLabel("A run is suggested for 6 AM, from a usual time. Not now is tapped once. The suggestion goes, the next one is for 8:30 AM, and a line says: Got it, I won't plan around those 6 AM runs. The pine buddy cheers.")
        .task {
            let script = TourScript(reduceMotion: reduceMotion)
            await script.wait(1.6)
            taps += 1
            await script.wait(0.35)
            await demo.model.decline(demo.suggestion(hour: 6, usual: true))
            // The old suggestion goes, the line stands alone long enough to be read, then the next one comes.
            script.change(0.18) { declined = true }
            await script.wait(0.3)
            script.change { noted = true }
            await script.wait(1.4)
            script.change { next = true }
            await script.wait(0.3)
            react()
        }
    }
}
