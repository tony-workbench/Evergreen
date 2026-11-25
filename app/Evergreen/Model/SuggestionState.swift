import Foundation

/// Where one suggestion stands, for its row.
enum SuggestionState: Equatable {
    /// Waiting for the person: Add to plan or Not now.
    case open
    case added
    /// The person said not now; the row is hidden.
    case declined
    /// The plan already has this kind of workout that day.
    case alreadyPlanned
}
