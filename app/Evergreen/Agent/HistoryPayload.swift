import Foundation

/// The person's Apple Health history as the plan rules read it: workouts and
/// daily sleep and resting heart rate. It never leaves the phone; the rules
/// turn it into a few numbers (usual week, load, readiness) for the planning agent.
struct HistoryPayload: Encodable, Equatable, Sendable {
    struct Session: Encodable, Equatable, Sendable {
        var activityType: String
        var start: String
        var end: String
        var avgHeartRate: Int?
        var effort: Double?
        var distanceKm: Double?
    }

    struct Day: Encodable, Equatable, Sendable {
        var date: String
        var sleepMin: Double?
        var restingHeartRate: Double?
    }

    var workouts: [Session]
    var daily: [Day]

    init(workouts: [Workout], days: [HealthHistory.Day], cal: Calendar) {
        self.workouts = workouts.map {
            Session(activityType: $0.activityType, start: LocalTime($0.start, in: cal.timeZone).text, end: LocalTime($0.end, in: cal.timeZone).text,
                    avgHeartRate: $0.avgHeartRate, effort: $0.effort, distanceKm: $0.distanceKm.map { ($0 * 1000).rounded() / 1000 })
        }
        daily = days.map { Day(date: LocalTime($0.date, in: cal.timeZone).day, sleepMin: $0.sleepMin, restingHeartRate: $0.restingHeartRate) }
    }
}
