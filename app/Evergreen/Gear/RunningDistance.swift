import HealthKit

/// How far the person has run since a day.
protocol RunningDistanceReading: Sendable {
    /// Kilometres; nil when it can't be read now.
    func runningKm(since start: Date, until now: Date) async -> Double?
}

/// Apple Health's running workouts since the shoes were started, however long
/// ago: the same read permission as the rest (workouts and walking + running
/// distance), nothing new to ask for.
struct HealthRunningDistance: RunningDistanceReading {
    func runningKm(since start: Date, until now: Date) async -> Double? {
        guard HKHealthStore.isHealthDataAvailable() else { return nil }
        let window = HKQuery.predicateForSamples(withStart: start, end: now)
        let running = HKQuery.predicateForWorkouts(with: .running)
        let query = HKSampleQueryDescriptor(
            predicates: [.workout(NSCompoundPredicate(andPredicateWithSubpredicates: [window, running]))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        guard let samples = try? await query.result(for: Permissions.healthStore) else { return nil }
        return ShoeLog.km(samples.map(HealthReader.workout), since: start, until: now)
    }
}
