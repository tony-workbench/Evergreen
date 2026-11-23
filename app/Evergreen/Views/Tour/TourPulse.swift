import SwiftUI

/// Where a tap happens in a tour scene: one soft accent ring that grows and
/// fades each time `fired` goes up. Nothing shows under Reduce Motion.
struct TourPulse: View {
    var fired: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .strokeBorder(Theme.accent, lineWidth: 3)
            .frame(width: 24, height: 24)
            .phaseAnimator([0, 1, 2], trigger: fired) { ring, phase in
                ring.scaleEffect(phase == 0 ? 0.6 : phase == 1 ? 1 : 2.2)
                    .opacity(phase == 1 && !reduceMotion ? 0.9 : 0)
            } animation: { phase in
                phase == 1 ? .easeOut(duration: 0.12) : .easeOut(duration: 0.3)
            }
            .accessibilityHidden(true)
    }
}
