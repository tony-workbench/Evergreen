import Foundation

/// One thing the plan check found wrong with a proposed week.
struct PlanViolation: Codable, Equatable, Sendable {
    var code: String
    /// One plain sentence.
    var text: String
    var sessionId: String?
}
