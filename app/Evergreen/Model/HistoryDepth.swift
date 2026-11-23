import Foundation

/// How much of the person's own history there is to plan from, in days: from
/// their first workout in Apple Health to today. Zero with no workouts.
struct HistoryDepth: Equatable, Sendable {
    /// Under this many days the routine isn't learned yet.
    static let enoughDays = 14

    var days: Int

    var isEmpty: Bool { days == 0 }
    var isThin: Bool { days < Self.enoughDays }

    init(days: Int) {
        self.days = max(0, days)
    }

    init(workouts: [Workout], now: Date, calendar: Calendar = .current) {
        guard let first = workouts.map(\.start).filter({ $0 <= now }).min() else {
            self.init(days: 0)
            return
        }
        let span = calendar.dateComponents([.day], from: calendar.startOfDay(for: first), to: calendar.startOfDay(for: now)).day ?? 0
        // A first workout today is one day of history.
        self.init(days: span + 1)
    }
}
