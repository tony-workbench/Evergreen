import SwiftUI

/// The pine buddy beside the tour's caption. It reacts once to each scene
/// with one of its own motions (a wave, a single hop, or the full cheer) and
/// otherwise stands still. Under Reduce Motion it just stands.
struct TourBuddy: View {
    enum Move {
        case wave, hop, celebrate

        var seconds: Double {
            switch self {
            case .wave: WavingBuddy.greeting
            case .hop: CelebratingBuddy.hopTime
            case .celebrate: 2.2
            }
        }
    }

    var move: Move
    /// Goes up each time the scene wants the reaction.
    var fired: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start: Date?

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: start == nil)) { timeline in
            if let start, !reduceMotion {
                let time = timeline.date.timeIntervalSince(start)
                switch move {
                case .wave:
                    let (raise, swing) = WavingBuddy.arm(at: time)
                    PineBuddy(pose: .waving, raise: raise, wave: swing)
                case .hop, .celebrate:
                    let (hop, squash) = CelebratingBuddy.motion(at: time)
                    PineBuddy(pose: .celebrating, hop: hop, squash: squash)
                }
            } else {
                PineBuddy(pose: .standing)
            }
        }
        .accessibilityHidden(true)
        .onChange(of: fired) {
            start = Date()
            Task {
                try? await Task.sleep(for: .seconds(move.seconds))
                start = nil
            }
        }
    }
}
