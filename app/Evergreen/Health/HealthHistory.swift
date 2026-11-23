import Foundation

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

    static func cached() -> HealthHistory {
        guard let data = try? Data(contentsOf: cacheURL),
              let history = try? JSONDecoder.contract.decode(HealthHistory.self, from: data)
        else { return HealthHistory() }
        return history
    }

    func saveToCache() {
        guard let data = try? JSONEncoder.contract.encode(self) else { return }
        try? FileManager.default.createDirectory(at: URL.applicationSupportDirectory, withIntermediateDirectories: true)
        try? data.write(to: Self.cacheURL, options: [.atomic, .completeFileProtection])
    }
}
