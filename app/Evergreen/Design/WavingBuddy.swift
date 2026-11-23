import SwiftUI

/// The pine buddy saying hi: the arm comes up, waves a few times and goes back
/// down. Looping, it waves again after a rest (Welcome). Once, it waves and
/// then walks in place (the bottom of Today). Under Reduce Motion it holds the
/// wave still, or just stands.
struct WavingBuddy: View {
    var filled: Int? = nil
    /// Wave again after each rest; otherwise wave once, then walk.
    var loops = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()

    /// Arm up, swinging, arm down.
    nonisolated static let raiseTime = 0.3
    nonisolated static let swingTime = 1.3
    nonisolated static let greeting = raiseTime + swingTime + raiseTime
    /// The rest between waves when looping.
    static let rest = 1.6
    /// Hand swings per second.
    static let swingRate = 2.0

    var body: some View {
        if reduceMotion {
            if loops {
                PineBuddy(pose: .waving, filled: filled)
            } else {
                WalkingBuddy(filled: filled)
            }
        } else {
            TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
                let elapsed = timeline.date.timeIntervalSince(start)
                if !loops, elapsed >= Self.greeting {
                    let t = timeline.date.timeIntervalSinceReferenceDate
                    PineBuddy(pose: .walking, filled: filled, stride: sin(t * 2 * .pi * 1.1))
                } else {
                    let (raise, wave) = Self.arm(at: loops ? elapsed.truncatingRemainder(dividingBy: Self.greeting + Self.rest) : elapsed)
                    PineBuddy(pose: .waving, filled: filled, raise: raise, wave: wave)
                }
            }
        }
    }

    /// How far the arm is up (0…1) and where the hand is in its swing (-1…1).
    static func arm(at time: TimeInterval) -> (raise: Double, wave: Double) {
        func easeOut(_ x: Double) -> Double { 1 - (1 - x) * (1 - x) }
        switch time {
        case ..<raiseTime:
            return (easeOut(time / raiseTime), 0)
        case ..<(raiseTime + swingTime):
            let swing = time - raiseTime
            // Fades the last swing back to center so the arm comes down cleanly.
            let fade = min(1, (swingTime - swing) / 0.25)
            return (1, sin(swing * 2 * .pi * swingRate) * fade)
        case ..<greeting:
            return (1 - easeOut((time - raiseTime - swingTime) / raiseTime), 0)
        default:
            return (0, 0)
        }
    }
}
