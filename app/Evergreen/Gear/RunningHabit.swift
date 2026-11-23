import Foundation

/// How much the person runs, for choosing shoes: the usual week and the longest recent run.
struct RunningHabit: Equatable, Sendable {
    /// Kilometres a week over the last four weeks.
    var weeklyKm: Int
    /// The longest single run in the last eight weeks, in kilometres.
    var longestKm: Int

    init(weeklyKm: Int, longestKm: Int) {
        self.weeklyKm = weeklyKm
        self.longestKm = longestKm
    }

    /// Nil without a recorded running distance in the last eight weeks.
    init?(_ workouts: [Workout], now: Date) {
        let day = 86_400.0
        let runs = StandInAgent.mergeDuplicates(workouts.filter {
            $0.activityType == "Running" && $0.start <= now && $0.start >= now.addingTimeInterval(-56 * day)
        })
        let longest = runs.compactMap(\.distanceKm).max() ?? 0
        guard longest > 0 else { return nil }
        let month = runs.filter { $0.start >= now.addingTimeInterval(-28 * day) }.reduce(0) { $0 + ($1.distanceKm ?? 0) }
        self.init(weeklyKm: Int((month / 4).rounded()), longestKm: Int(longest.rounded()))
    }
}
