import Foundation

/// What the person said to one suggestion: add it, or not now. A "not now" to
/// a suggestion that rested on memory also says which memory keys it stopped,
/// so Undo can restore them. Kept with the run so it survives a relaunch.
struct SuggestionAnswer: Codable, Hashable, Sendable {
    var accepted: Bool
    /// The memory keys this "not now" stopped; empty when the suggestion came from the rules alone.
    var stopped: [String] = []
}
