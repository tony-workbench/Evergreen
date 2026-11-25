import SwiftUI

/// The pine buddy celebrating an order: three hops with arms pumping and a
/// squash on each landing, then a gentle happy bounce. The buddy's own motion
/// is the whole moment; no confetti (DESIGN.md). Still under Reduce Motion.
struct CelebratingBuddy: View {
    var filled: Int? = nil

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    @State private var start = Date()

    static let hops = 3
    nonisolated static let hopTime = 0.5
    /// How long a landing squash lasts, as a share of a hop.
    static let landing = 0.16

    var body: some View {
        if reduceMotion {
            PineBuddy(pose: .celebrating, filled: filled, hop: 0.4)
        } else {
            TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
                let (hop, squash) = Self.motion(at: timeline.date.timeIntervalSince(start))
                PineBuddy(pose: .celebrating, filled: filled, hop: hop, squash: squash)
            }
        }
    }

    /// Hop height (0…1) and landing squash (0…1) at a time since the order.
    static func motion(at time: TimeInterval) -> (hop: Double, squash: Double) {
        let burst = Double(hops) * hopTime
        if time < burst {
            let phase = time.truncatingRemainder(dividingBy: hopTime) / hopTime
            // Each hop starts from a squat: the landing of the one before, or a wind-up.
            let squash = phase < landing ? 1 - phase / landing : 0
            return (sin(.pi * phase), squash)
        }
        let after = time - burst
        if after < 0.2 {
            return (0, 1 - after / 0.2)
        }
        // Settled: a small, happy bounce.
        let bounce = max(0, sin((after - 0.2) * 2 * .pi * 0.9))
        return (bounce * 0.15, 0)
    }
}
