import Foundation
@testable import Evergreen

/// The running distance worked out from workouts handed in, instead of read from Apple Health.
struct WorkoutsRunningDistance: RunningDistanceReading {
    var workouts: [Workout]

    func runningKm(since start: Date, until now: Date) async -> Double? {
        ShoeLog.km(workouts, since: start, until: now)
    }
}
