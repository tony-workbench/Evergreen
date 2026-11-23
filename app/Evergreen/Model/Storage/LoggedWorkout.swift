import Foundation
import SwiftData

/// A workout saved in the store itself, beside what Apple Health holds.
@Model
final class LoggedWorkout {
    var workoutId: String
    var activityType: String
    var start: Date
    var end: Date
    var effort: Double?
    var avgHeartRate: Int?
    var source: String
    var run: Run?

    init(_ workout: Workout) {
        workoutId = workout.id
        activityType = workout.activityType
        start = workout.start
        end = workout.end
        effort = workout.effort
        avgHeartRate = workout.avgHeartRate
        source = workout.source.rawValue
    }

    var workout: Workout {
        Workout(id: workoutId, activityType: activityType, start: start, end: end, effort: effort,
                avgHeartRate: avgHeartRate, source: Workout.Source(rawValue: source) ?? .demo)
    }
}
