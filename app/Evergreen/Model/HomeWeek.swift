import Foundation
import os

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
        defaults.data(forKey: key).flatMap { data in
            Logger.model.attempt("The kept home week couldn't be read; it is worked out again") { try JSONDecoder().decode(HomeWeek.self, from: data) }
        }
    }

    func save(to defaults: UserDefaults) {
        if let data = Logger.model.attempt("The home week couldn't be kept", { try JSONEncoder().encode(self) }) {
            defaults.set(data, forKey: Self.key)
        }
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

/// Where the week table's load stands. Offline is apart from failed: the week is there, worked out on the phone from
/// the rules, and only the AI's choice of movements is waiting for the network.
enum HomeWeekLoad: Equatable, Sendable {
    case loading
    case ready
    case offline
    case failed
}

/// The days a home session was planned, for the lighter fifth week: four full weeks in a row, and the next has a set
/// fewer of everything. The lighter week itself never counts towards the next four, done or not: counting starts again
/// after it (plan 4.2), so the weeks go four full, one lighter, four full, one lighter.
struct PlannedDays: Codable, Equatable, Sendable {
    static let key = "home_planned_days"
    static let fullWeeksBeforeLighter = 4
    static let keep = 60
    /// The lighter weeks kept: enough to cover every week `days` still reaches.
    static let keepLighter = 12
    static let daysInWeek = 7

    var days: [String] = []
    /// The Mondays of the weeks that were lighter, kept as they happen, so the count of four starts again after each one
    /// even once the oldest planned days have dropped off. Optional so older saved days still read.
    var lighterWeeks: [String]?

    static func load(from defaults: UserDefaults) -> PlannedDays {
        defaults.data(forKey: key).flatMap { data in
            Logger.model.attempt("The planned days couldn't be read; the count of weeks starts again") {
                try JSONDecoder().decode(PlannedDays.self, from: data)
            }
        } ?? PlannedDays()
    }

    func save(to defaults: UserDefaults) {
        if let data = Logger.model.attempt("The planned days couldn't be kept", { try JSONEncoder().encode(self) }) {
            defaults.set(data, forKey: Self.key)
        }
    }

    /// Adds the training days of a week just worked out. A day at home that stopped training is taken off, from today on.
    mutating func update(with week: HomeWeek, today: String) {
        let planned = Set(week.days.filter(\.trains).map(\.day))
        let window = Set(week.days.map(\.day))
        days = days.filter { !(window.contains($0) && $0 >= today && !planned.contains($0)) }
        days = Array(Set(days).union(planned)).sorted().suffix(Self.keep).map { $0 }
    }

    /// Whether the week of `monday` is the lighter one: the four weeks just before it were full (a session planned, and
    /// every planned one done), and none of them was itself a lighter week. Walks the weeks from the oldest planned day,
    /// so a lighter week resets the count whether or not it was kept in `lighterWeeks`.
    func isLighterWeek(monday: String, done: Set<String>, calendar: Calendar) -> Bool {
        if isKeptLighter(monday) { return true }
        guard let start = Self.date(monday, calendar: calendar), let oldest = days.min(),
              let first = Self.date(oldest, calendar: calendar).map({ Self.monday(of: $0, calendar: calendar) }) else { return false }
        var streak = 0
        var week = first
        while week < start {
            let iso = Self.iso(week, calendar: calendar)
            if isKeptLighter(iso) || streak == Self.fullWeeksBeforeLighter { streak = 0 }
            else { streak = isFull(week, done: done, calendar: calendar) ? streak + 1 : 0 }
            guard let next = calendar.date(byAdding: .day, value: Self.daysInWeek, to: week) else { return false }
            week = next
        }
        return streak == Self.fullWeeksBeforeLighter
    }

    /// Keeps the week of `monday` as lighter once it is, so it stays lighter all week and the next four start counting after it.
    mutating func settleLighterWeek(monday: String, done: Set<String>, calendar: Calendar) {
        guard !isKeptLighter(monday), isLighterWeek(monday: monday, done: done, calendar: calendar) else { return }
        lighterWeeks = Array(((lighterWeeks ?? []) + [monday]).sorted().suffix(Self.keepLighter))
    }

    private func isKeptLighter(_ monday: String) -> Bool { lighterWeeks?.contains(monday) == true }

    /// A week with a session planned and every planned one done.
    private func isFull(_ monday: Date, done: Set<String>, calendar: Calendar) -> Bool {
        let week = (0..<Self.daysInWeek).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }.map { Self.iso($0, calendar: calendar) }
        let planned = days.filter(week.contains)
        return !planned.isEmpty && planned.allSatisfy(done.contains)
    }

    /// The Monday that starts the Monday-to-Sunday week of `date`, at the start of the day.
    static func monday(of date: Date, calendar: Calendar) -> Date {
        // Monday 0 to Sunday 6: the days back to Monday.
        let back = UserRules.weekdayIndex(date, calendar: calendar)
        let day = calendar.startOfDay(for: date)
        return calendar.date(byAdding: .day, value: -back, to: day) ?? day
    }

    static func iso(_ date: Date, calendar: Calendar) -> String { LocalTime(date, in: calendar.timeZone).day }

    static func date(_ iso: String, calendar: Calendar) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == ClockUnits.dayKeyParts else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
