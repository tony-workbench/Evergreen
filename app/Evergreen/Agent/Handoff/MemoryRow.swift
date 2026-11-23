import Foundation

/// One row of the memory table. `key` is opaque: nothing reads meaning out
/// of it. What a reader needs is in `data`, by `kind`.
struct MemoryRow: Codable, Equatable, Sendable {
    var memoryId: String
    var key: String
    /// Names the memory this row is a version of.
    var slot: String
    /// routine, body, feedback, gear or goal.
    var group: String
    /// usual_slot, weekly_volume, load, sleep, resting_hr, mix, response, gear or goal.
    var kind: String
    /// The row as one plain sentence.
    var statement: String
    var data: JSONValue
    /// saved, confirmed, review or rejected.
    var state: String
    var confidence: Double
    /// The day it has held since.
    var since: String
    /// When it last changed: a day, or a time.
    var updated: String

    /// Only saved and confirmed rows are planned from.
    var isUsable: Bool { state == "saved" || state == "confirmed" }
    var isRejected: Bool { state == "rejected" }
}
