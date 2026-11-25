import Foundation

/// Keeps the last forecast for an hour, so the checks (foreground, calendar
/// change, background) ask the network at most once an hour for one place.
@MainActor
final class ForecastCache {
    static let lifetime: TimeInterval = 3600
    static let storeKey = "forecast"

    private let source: any ForecastProviding
    private let store: any TriggerStore

    init(source: any ForecastProviding, store: any TriggerStore) {
        self.source = source
        self.store = store
    }

    func forecast(at place: Coordinate, now: Date) async throws -> Forecast {
        if let kept = store.value(Forecast.self, for: Self.storeKey), kept.place == place.rounded {
            let age = now.timeIntervalSince(kept.fetchedAt)
            if age >= 0, age < Self.lifetime { return kept }
        }
        let fresh = try await source.forecast(at: place, now: now)
        store.save(fresh, for: Self.storeKey)
        return fresh
    }
}
