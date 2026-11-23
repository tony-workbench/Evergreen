import Foundation

/// How much the AI was used today: calls, and tokens in and out. Kept in
/// memory and in the app's defaults, and started again each local day.
actor AIUsage {
    struct Day: Codable, Equatable, Sendable {
        var day = ""
        var calls = 0
        var input = 0
        var output = 0
        /// Tokens the model spent thinking, billed like output.
        var thinking = 0
    }

    static let storeKey = "ai_usage"
    private let defaults: UserDefaults?
    private var today: Day

    init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        today = defaults?.data(forKey: Self.storeKey).flatMap { try? JSONDecoder().decode(Day.self, from: $0) } ?? Day()
    }

    func count(input: Int, output: Int, thinking: Int = 0, now: Date = Date()) {
        roll(now)
        today.calls += 1
        today.input += input
        today.output += output
        today.thinking += thinking
        defaults?.set(try? JSONEncoder().encode(today), forKey: Self.storeKey)
    }

    func day(now: Date = Date()) -> Day {
        roll(now)
        return today
    }

    private func roll(_ now: Date) {
        let day = now.formatted(.iso8601.year().month().day().dateSeparator(.dash))
        if today.day != day { today = Day(day: day) }
    }
}
