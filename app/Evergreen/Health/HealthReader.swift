import HealthKit
import os

/// Reads the person's Apple Health history: workouts from the last 60 days
/// (type, times, average heart rate, distance, indoors) and, for the last 28
/// days, minutes asleep and resting heart rate. Read-only; nothing here writes.
struct HealthReader: Sendable {
    static let workoutDays = 60
    static let summaryDays = 28

    /// What onboarding asks to read.
    static let readTypes: Set<HKObjectType> = [
        HKObjectType.workoutType(),
        HKQuantityType(.heartRate),
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.distanceWalkingRunning),
        HKQuantityType(.distanceCycling),
        HKQuantityType(.workoutEffortScore),
        HKQuantityType(.estimatedWorkoutEffortScore),
        HKCategoryType(.sleepAnalysis),
    ]

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// Everything readable now. Types the person declined simply come back empty
    /// (HealthKit never says which reads were refused).
    /// Nil when the workouts couldn't be read at all (an error, or the phone is locked): the caller keeps what it had.
    func read(now: Date = Date(), calendar: Calendar = .current) async -> HealthHistory? {
        guard isAvailable else { return nil }
        let store = Permissions.healthStore
        let today = calendar.startOfDay(for: now)
        let workoutsFrom = calendar.date(byAdding: .day, value: -Self.workoutDays, to: today) ?? today
        let daysFrom = calendar.date(byAdding: .day, value: -Self.summaryDays, to: today) ?? today
        let summary = DateInterval(start: daysFrom, end: max(now, daysFrom))
        async let workouts = workouts(store, from: workoutsFrom, to: now)
        async let sleep = sleepMinutes(store, in: summary, calendar: calendar)
        async let resting = restingHeartRates(store, in: summary, calendar: calendar)
        let (read, s, r) = await (workouts, sleep, resting)
        guard let w = read else { return nil }
        let days = Set(s.keys).union(r.keys).sorted().map {
            HealthHistory.Day(date: $0, sleepMin: s[$0], restingHeartRate: r[$0])
        }
        return HealthHistory(workouts: w, days: days, readAt: now)
    }

    // MARK: Workouts

    private func workouts(_ store: HKHealthStore, from: Date, to: Date) async -> [Workout]? {
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to)
        let query = HKSampleQueryDescriptor(predicates: [.workout(predicate)], sortDescriptors: [SortDescriptor(\.startDate)])
        do {
            return try await query.result(for: store).map(Self.workout)
        } catch {
            // Locked after a background launch, or Health unavailable: the caller keeps what it had.
            Logger.health.error("Workouts couldn't be read: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    static func workout(_ w: HKWorkout) -> Workout {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let km = HKUnit.meterUnit(with: .kilo)
        let rate = w.statistics(for: HKQuantityType(.heartRate))?.averageQuantity()?.doubleValue(for: bpm)
        let distance = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming)]
            .lazy.compactMap { w.statistics(for: $0)?.sumQuantity()?.doubleValue(for: km) }.first
        return Workout(
            id: "hk-\(w.uuid.uuidString)", activityType: activityName(w.workoutActivityType),
            start: w.startDate, end: w.endDate, effort: nil, avgHeartRate: rate.map { Int($0.rounded()) },
            source: .health, distanceKm: distance, indoor: w.metadata?[HKMetadataKeyIndoorWorkout] as? Bool
        )
    }

    /// The names the app uses (`Activity`), "Other" for the rest.
    static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: "Running"
        case .walking, .hiking: "Walking"
        case .cycling: "Cycling"
        case .elliptical: "Elliptical"
        // Read by the memory's "you train at home" check, which a gym machine's workout turns off.
        case .stairClimbing, .stairs: "StairClimbing"
        case .functionalStrengthTraining: "FunctionalStrengthTraining"
        case .traditionalStrengthTraining: "TraditionalStrengthTraining"
        case .yoga: "Yoga"
        case .swimming: "Swimming"
        default: "Other"
        }
    }

    // MARK: Daily summaries

    /// Minutes asleep per night, counted on the day the night ended.
    private func sleepMinutes(_ store: HKHealthStore, in span: DateInterval, calendar: Calendar) async -> [Date: Double] {
        let asleep = HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue)
        let predicate = HKQuery.predicateForSamples(withStart: span.start, end: span.end)
        let query = HKSampleQueryDescriptor(predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: predicate)],
                                            sortDescriptors: [])
        let samples: [HKCategorySample]
        do { samples = try await query.result(for: store) } catch {
            Logger.health.error("Sleep couldn't be read: \(String(describing: error), privacy: .public)")
            return [:]
        }
        var minutes: [Date: Double] = [:]
        for sample in samples where asleep.contains(sample.value) {
            minutes[calendar.startOfDay(for: sample.endDate), default: 0] += sample.endDate.timeIntervalSince(sample.startDate) / ClockUnits.minute
        }
        return minutes.mapValues { $0.rounded() }
    }

    /// Resting heart rates are kept to a tenth of a beat.
    private static let tenths = 10.0

    /// The day's average resting heart rate.
    private func restingHeartRates(_ store: HKHealthStore, in span: DateInterval, calendar: Calendar) async -> [Date: Double] {
        let predicate = HKQuery.predicateForSamples(withStart: span.start, end: span.end)
        let query = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: HKQuantityType(.restingHeartRate), predicate: predicate),
            options: .discreteAverage, anchorDate: calendar.startOfDay(for: span.start), intervalComponents: DateComponents(day: 1)
        )
        let collection: HKStatisticsCollection
        do { collection = try await query.result(for: store) } catch {
            Logger.health.error("Resting heart rate couldn't be read: \(String(describing: error), privacy: .public)")
            return [:]
        }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        var rates: [Date: Double] = [:]
        collection.enumerateStatistics(from: span.start, to: span.end) { stats, _ in
            if let value = stats.averageQuantity()?.doubleValue(for: bpm) {
                rates[calendar.startOfDay(for: stats.startDate)] = (value * Self.tenths).rounded() / Self.tenths
            }
        }
        return rates
    }
}
