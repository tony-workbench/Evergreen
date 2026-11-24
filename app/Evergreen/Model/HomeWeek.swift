import Foundation

/// The week the rules make, as the engine's `planContext` gives it in `homeWeek`:
/// each of the next seven days, its kind, what a day at home works, its first
/// time and the later times the same day to fall back to. Kept on the phone so
/// the week table, the reminders and a missed day read the same week.
struct HomeWeek: Codable, Equatable, Sendable {
    static let key = "home_week"

    struct Day: Codable, Equatable, Sendable, Identifiable {
        /// YYYY-MM-DD
        var day: String
        var weekday: String
        var kind: DayKind
        /// What the session works; nil on a day with no session.
        var focus: String?
        var first: LocalTime?
        var fallbacks: [LocalTime]

        var id: String { day }
        var trains: Bool { focus != nil && first != nil }
    }

    var days: [Day] = []
    /// A day at home is any day of kind `home`; a training day is one of those with time for a session.
    var homeDays = 0
    var trainingDays = 0
    /// "This week has only one day at home…", when there is one.
    var note: String?
    /// When it was worked out, so a stale week can be told apart.
    var madeOn: String?

    static func load(from defaults: UserDefaults) -> HomeWeek? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(HomeWeek.self, from: $0) }
    }

    func save(to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }

    /// Reads the engine's `homeWeek`; nil when it isn't there (rules off) or can't be read.
    static func from(engine value: JSONValue?, madeOn day: String) -> HomeWeek? {
        guard var week = value?.decoded(HomeWeek.self) else { return nil }
        week.madeOn = day
        return week
    }

    func day(_ iso: String) -> Day? { days.first { $0.day == iso } }

    /// The later times a day's session can still move to ("Later today"), in order.
    func fallbacks(on iso: String) -> [LocalTime] { day(iso)?.fallbacks ?? [] }
}

/// The days a home session was planned, for the lighter fifth week: four full weeks in a row, and the next has a set
/// fewer of everything.
struct PlannedDays: Codable, Equatable, Sendable {
    static let key = "home_planned_days"
    static let fullWeeksBeforeLighter = 4
    static let keep = 60

    var days: [String] = []

    static func load(from defaults: UserDefaults) -> PlannedDays {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(PlannedDays.self, from: $0) } ?? PlannedDays()
    }

    func save(to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }

    /// Adds the training days of a week just worked out. A day at home that stopped training is taken off, from today on.
    mutating func update(with week: HomeWeek, today: String) {
        let planned = Set(week.days.filter(\.trains).map(\.day))
        let window = Set(week.days.map(\.day))
        days = days.filter { !(window.contains($0) && $0 >= today && !planned.contains($0)) }
        days = Array(Set(days).union(planned)).sorted().suffix(Self.keep).map { $0 }
    }

    /// Whether each of the four weeks before the week of `monday` had a session planned, and every planned one done.
    func isLighterWeek(monday: String, done: Set<String>, calendar: Calendar) -> Bool {
        guard let start = Self.date(monday, calendar: calendar) else { return false }
        for back in 1...Self.fullWeeksBeforeLighter {
            let week = (0..<7).compactMap { calendar.date(byAdding: .day, value: $0 - 7 * back, to: start) }.map { Self.iso($0, calendar: calendar) }
            let planned = days.filter(week.contains)
            if planned.isEmpty || !planned.allSatisfy(done.contains) { return false }
        }
        return true
    }

    static func iso(_ date: Date, calendar: Calendar) -> String { LocalTime(date, in: calendar.timeZone).day }

    static func date(_ iso: String, calendar: Calendar) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
