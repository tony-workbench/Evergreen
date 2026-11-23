import Foundation

/// A calendar preview waiting for the person: what the calendar engine
/// proposes for an accepted session or a typed request. Nothing is written
/// until they confirm.
struct Placement: Equatable, Sendable {
    /// The suggestion it is for; nil when it came from "Ask Evergreen".
    var sessionKey: String?
    var result: CalendarResult
    /// One more line under the preview, such as that only the first of two requests was done.
    var note: String? = nil
}
