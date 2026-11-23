import Foundation

/// Why the week couldn't be planned.
enum PlanFailure: Error, Equatable {
    /// No AI key is connected.
    case notConnected
    /// The engines that check the plan didn't load.
    case unavailable
}
