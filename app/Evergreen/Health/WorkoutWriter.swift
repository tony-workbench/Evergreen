import HealthKit
import os

/// Writes a finished home session to Apple Health as a strength workout, so
/// it counts like any other workout (and for earned screen time). Only the
/// type, start and end go in; no movement names or notes.
enum WorkoutWriter {
    static let type = HKObjectType.workoutType()

    /// Whether Evergreen may write workouts.
    static var mayWrite: Bool {
        HKHealthStore.isHealthDataAvailable() && Permissions.healthStore.authorizationStatus(for: type) == .sharingAuthorized
    }

    /// Saves one strength workout from `start` to `end`. False when Health is off or the save fails; the session is still recorded here.
    static func saveStrength(start: Date, end: Date) async -> Bool {
        guard HKHealthStore.isHealthDataAvailable(), end > start else { return false }
        let store = Permissions.healthStore
        if store.authorizationStatus(for: type) == .notDetermined { await askToWrite(store) }
        guard store.authorizationStatus(for: type) == .sharingAuthorized else { return false }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
        do {
            try await builder.beginCollection(at: start)
            try await builder.endCollection(at: end)
            return try await builder.finishWorkout() != nil
        } catch {
            Logger.health.error("The home workout couldn't be saved to Apple Health: \(String(describing: error), privacy: .public)")
            return false
        }
    }

    /// The write permission, asked once. A refusal isn't reported by HealthKit; a failed request is logged.
    private static func askToWrite(_ store: HKHealthStore) async {
        do {
            try await store.requestAuthorization(toShare: [type], read: HealthReader.readTypes)
        } catch {
            Logger.health.error("The Apple Health write request failed: \(String(describing: error), privacy: .public)")
        }
    }
}
