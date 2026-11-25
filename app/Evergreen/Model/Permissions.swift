import HealthKit
import os

/// The Health permission prompt for onboarding, shown after a one-sentence
/// explainer that matches its usage string. A denial never blocks
/// the app: it starts with two short walks and learns from there. Calendar access lives in CalendarSync.
enum Permissions {
    static let healthStore = HKHealthStore()

    static func requestHealth() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        do {
            try await healthStore.requestAuthorization(toShare: [WorkoutWriter.type], read: HealthReader.readTypes)
        } catch {
            // Not a denial (that isn't reported): the request itself failed. The app goes on without Apple Health.
            Logger.health.error("The Apple Health request failed: \(String(describing: error), privacy: .public)")
        }
    }
}
