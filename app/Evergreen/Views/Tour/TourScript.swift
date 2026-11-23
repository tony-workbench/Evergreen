import SwiftUI

/// Plays a tour scene's steps in order: wait, then change something with a
/// short ease-out. Under Reduce Motion there's no waiting and no animation,
/// so the scene shows its final state straight away.
@MainActor
struct TourScript {
    let reduceMotion: Bool

    func wait(_ seconds: Double) async {
        if !reduceMotion { try? await Task.sleep(for: .seconds(seconds)) }
    }

    func change(_ seconds: Double = 0.25, _ body: () -> Void) {
        if reduceMotion { body() } else { withAnimation(.easeOut(duration: seconds), body) }
    }
}
