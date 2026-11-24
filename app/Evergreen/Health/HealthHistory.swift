import Foundation
import os

/// What Evergreen read from Apple Health: recent workouts and, per day, minutes
/// asleep and resting heart rate. Kept in Application Support so the app opens
/// with your last-read history before HealthKit answers.
struct HealthHistory: Codable, Equatable, Sendable {
    struct Day: Codable, Equatable, Sendable {
        /// The local day (start of day) the night ended or the reading was taken.
        var date: Date
        var sleepMin: Double?
        var restingHeartRate: Double?
    }

    var workouts: [Workout] = []
    var days: [Day] = []
    var readAt: Date?

    /// The first day there's anything to plan from; nil when there's nothing.
    var historyStart: Date? { workouts.map(\.start).min() }

    // MARK: Cache

    static var cacheURL: URL {
        URL.applicationSupportDirectory.appending(path: "health-history.json")
    }

    /// The history kept from the last read. None kept yet (the first launch) is the usual empty start, not a fault.
    static func cached() -> HealthHistory {
        guard FileManager.default.fileExists(atPath: cacheURL.path(percentEncoded: false)) else { return HealthHistory() }
        return Logger.health.attempt("The kept Health history couldn't be read; it is read again from Apple Health") {
            try JSONDecoder.contract.decode(HealthHistory.self, from: Data(contentsOf: cacheURL))
        } ?? HealthHistory()
    }

    func saveToCache() {
        _ = Logger.health.attempt("The Health history couldn't be kept") {
            let data = try JSONEncoder.contract.encode(self)
            try FileManager.default.createDirectory(at: URL.applicationSupportDirectory, withIntermediateDirectories: true)
            try data.write(to: Self.cacheURL, options: [.atomic, .completeFileProtection])
        }
    }
}
