import Foundation

/// Whether the screens move: not with the system's Reduce Motion on, nor on a debug UI-test launch with `-reduceMotion`
/// (Views/Debug/UITestArguments.swift). Every view that reads `accessibilityReduceMotion` asks this with it.
@MainActor
enum Motion {
    /// True when movement should be left out: Reduce Motion is on, or a UI test asked for it.
    static func reduced(_ system: Bool) -> Bool {
        system || forcedReduced
    }

    private static var forcedReduced: Bool {
        #if DEBUG
        return UITestArguments.reducesMotion()
        #else
        return false
        #endif
    }
}
