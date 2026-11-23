import Foundation

/// A workout Health recorded, as far as outcomes need it.
struct HealthWorkout: Codable, Equatable, Sendable {
    /// The Apple Health type, "Running".
    var activityType: String
    var start: String
    var durationMin: Double
}
