import Foundation

/// Reads the person's history: Apple Health (`HealthReader`), or a stand-in in tests.
protocol HealthReading: Sendable {
    var isAvailable: Bool { get }
    /// Nil when the workouts couldn't be read at all: the caller keeps what it had.
    func read(now: Date, calendar: Calendar) async -> HealthHistory?
}

extension HealthReader: HealthReading {}
