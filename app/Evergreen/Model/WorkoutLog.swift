import Foundation

/// What the person did on the workout page: the reps or seconds of every set,
/// the backpack's kilograms, how sore it was, and the days a home session was
/// done. Kept on this phone in UserDefaults; the engine is given the last few
/// times of each movement to pick what comes next.
struct WorkoutLog: Codable, Equatable, Sendable {
    static let key = "workout_log"
    /// Older entries go: the engine looks at the last two times of each movement.
    static let keep = 300

    struct Entry: Codable, Equatable, Sendable {
        var movementId: String
        /// YYYY-MM-DD
        var day: String
        /// Reps (or seconds) of each set done.
        var sets: [Int]
        var load: Double?
    }

    var entries: [Entry] = []
    /// Kilograms for a backpack movement's next time only: "Too hard" took one off on the page, "Too easy" at the end adds two.
    /// Taken off again after a session without either, so the usual kilogram at a time carries on from what was done.
    var loads: [String: Double] = [:]
    /// The soreness answer after the last session, 0 to 5 ("4" takes a set off next time).
    var lastPain: Int?
    /// Days a home session was finished here or done another way.
    var doneDays: [String] = []
    /// "Too hard" after the last session makes the next one a set lighter.
    var lastFeeling: WorkoutFeeling?
    /// How many home sessions were built, so the core movement takes turns.
    var turn = 0
    /// Days skipped from a reminder, with the reason: "out", "unwell" or "not_today". Optional so an older log still reads.
    var skipped: [String: String]?

    static func load(from defaults: UserDefaults) -> WorkoutLog {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(WorkoutLog.self, from: $0) } ?? WorkoutLog()
    }

    func save(to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }

    /// The engine's `history`.
    var engineHistory: JSONValue {
        .array(entries.map { entry in
            var value: [String: JSONValue] = ["movementId": .string(entry.movementId), "day": .string(entry.day),
                                              "sets": .array(entry.sets.map { .number(Double($0)) })]
            if let load = entry.load { value["load"] = .number(load) }
            return .object(value)
        })
    }

    func didHomeSession(on day: String) -> Bool { doneDays.contains(day) }

    func didSkip(_ day: String) -> Bool { skipped?[day] != nil }

    /// "Skip today" with its reason. Only the last sixty days are kept.
    mutating func skip(_ day: String, reason: String) {
        var all = skipped ?? [:]
        all[day] = reason
        skipped = Dictionary(uniqueKeysWithValues: all.sorted { $0.key < $1.key }.suffix(60).map { ($0.key, $0.value) })
    }

    /// Records a finished session: each movement's sets, the soreness answer and the day.
    mutating func record(day: String, results: [WorkoutResult], pain: Int?) {
        for result in results where !result.sets.isEmpty {
            entries.append(Entry(movementId: result.movementId, day: day, sets: result.sets, load: result.load))
        }
        if entries.count > Self.keep { entries.removeFirst(entries.count - Self.keep) }
        if let pain { lastPain = pain }
        markDone(day)
    }

    /// The backpack's weight for next time, from the session just done: "Too hard" on a movement keeps the lighter weight
    /// the page already set, "Too easy" at the end adds two kilograms (up to what a backpack holds), anything else
    /// leaves it to the usual step up.
    mutating func settleLoads(_ results: [WorkoutResult], feeling: WorkoutFeeling?) {
        for result in results {
            guard let load = result.load else { continue }
            if result.tooHard { loads[result.movementId] = load }
            else if feeling == .easy { loads[result.movementId] = min(BackpackWater.maxKg, load + BackpackWater.easierStepKg) }
            else { loads.removeValue(forKey: result.movementId) }
        }
    }

    mutating func markDone(_ day: String) {
        if !doneDays.contains(day) { doneDays.append(day) }
        doneDays = Array(doneDays.suffix(60))
    }
}

/// One movement on the workout page: what was planned and what was done.
struct WorkoutResult: Codable, Equatable, Sendable {
    var movementId: String
    var sets: [Int] = []
    var load: Double?
    /// "Too hard" this time: a backpack movement drops a kilogram, a bodyweight one goes to the easier one next time.
    var tooHard = false
    /// The person swapped it for the easier movement on the page.
    var swappedFrom: String?
}

/// A session left half done: picked up where it stopped when the page opens again the same day.
struct WorkoutProgress: Codable, Equatable, Sendable {
    static let key = "workout_progress"
    var day: String
    var content: WorkoutContent
    /// The movement on screen.
    var index = 0
    var results: [WorkoutResult]
    var startedAt: Date

    static func load(from defaults: UserDefaults, day: String) -> WorkoutProgress? {
        guard let saved = defaults.data(forKey: key).flatMap({ try? JSONDecoder().decode(WorkoutProgress.self, from: $0) }),
              saved.day == day else { return nil }
        return saved
    }

    func save(to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }

    static func clear(from defaults: UserDefaults) { defaults.removeObject(forKey: key) }
}
