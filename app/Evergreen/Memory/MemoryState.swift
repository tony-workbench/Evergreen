import Foundation

/// What the person can forget and what is forgotten now (the bundle's
/// `memoryState`): dates and type names only, never a fact's text.
struct MemoryState: Equatable, Sendable {
    /// Days with a daily line, oldest first, as `YYYY-MM-DD`.
    var days: [String] = []
    /// Every kind of fact that can be stopped.
    var types: [String] = []
    var stoppedTypes: [String] = []
    var forgottenDays: [String] = []
    /// The computed files that were forgotten whole ("profile", "rolling").
    var forgottenKinds: [String] = []

    /// Whether "forget everything computed" is in effect.
    var everythingForgotten: Bool { !forgottenKinds.isEmpty }
}
