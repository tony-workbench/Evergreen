import Foundation
import os

/// What the person did on the workout page: the reps or seconds of every set,
/// the backpack's kilograms, how sore it was, and the days a home session was
/// done. Kept on this phone in UserDefaults; the engine is given the last few
/// times of each movement to pick what comes next.
struct WorkoutLog: Codable, Equatable, Sendable {
    static let key = "workout_log"
    /// Older entries go: the engine looks at the last two times of each movement.
    static let keep = 300
    /// Skipped days, done days and days done another way: the last sixty of each are kept.
    static let keptDays = 60

    struct Entry: Codable, Equatable, Sendable {
        var movementId: String
        /// YYYY-MM-DD
        var day: String
        /// Reps (or seconds) of each set done.
        var sets: [Int]
        var load: Double?
        /// Done at the slower tempo: the slow step of progression (each rep lowered two seconds slower).
        var slow: Bool?
        /// "Too hard" was pressed on it that time: the engine never counts such a time towards moving on (plan 4.2).
        /// Optional, true only when pressed, so an older log still reads.
        var tooHard: Bool?
    }

    var entries: [Entry] = []
    /// Kilograms for a backpack movement's next time only: "Too hard" took one off on the page, "Too easy" (while the weight
    /// is being found) adds two. Taken off again after a session without either, so the usual kilogram at a time carries
    /// on from what was done.
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
    /// Days marked done another way ("I did it another way", "Already done"), which can be taken back. Optional so an
    /// older log still reads.
    var otherWay: [String]?

    init() {}

    /// Field by field, so a log saved by an older or newer version keeps everything it can read: a missing or unreadable
    /// field takes its default instead of losing the whole log.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = c.field([Entry].self, .entries, log: .workout) ?? []
        loads = c.field([String: Double].self, .loads, log: .workout) ?? [:]
        lastPain = c.field(Int.self, .lastPain, log: .workout)
        doneDays = c.field([String].self, .doneDays, log: .workout) ?? []
        lastFeeling = c.field(WorkoutFeeling.self, .lastFeeling, log: .workout)
        turn = c.field(Int.self, .turn, log: .workout) ?? 0
        skipped = c.field([String: String].self, .skipped, log: .workout)
        otherWay = c.field([String].self, .otherWay, log: .workout)
    }

    static func load(from defaults: UserDefaults) -> WorkoutLog {
        guard let data = defaults.data(forKey: key) else { return WorkoutLog() }
        do { return try JSONDecoder().decode(WorkoutLog.self, from: data) } catch {
            Logger.workout.error("The workout log couldn't be read: \(error.localizedDescription, privacy: .public)")
            return WorkoutLog()
        }
    }

    func save(to defaults: UserDefaults) {
        do { defaults.set(try JSONEncoder().encode(self), forKey: Self.key) } catch {
            Logger.workout.error("The workout log couldn't be saved: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The engine's `history`.
    var engineHistory: JSONValue {
        .array(entries.map { entry in
            var value: [String: JSONValue] = ["movementId": .string(entry.movementId), "day": .string(entry.day),
                                              "sets": .array(entry.sets.map { .number(Double($0)) })]
            if let load = entry.load { value["load"] = .number(load) }
            if entry.slow == true { value["slow"] = .bool(true) }
            if entry.tooHard == true { value["tooHard"] = .bool(true) }
            return .object(value)
        })
    }

    func didHomeSession(on day: String) -> Bool { doneDays.contains(day) }

    /// The backpack's weight kept for a movement from an earlier session: the one set for next time, else the last one
    /// logged. Nil the first time with the backpack, while its weight is still being found (plan 5.C).
    func savedLoad(_ movementId: String) -> Double? {
        loads[movementId] ?? entries.last { $0.movementId == movementId && $0.load != nil }?.load
    }

    /// Done another way, not finished on the workout page.
    func didOtherWay(_ day: String) -> Bool { otherWay?.contains(day) == true }

    /// Finished on the workout page.
    func finishedOnPage(_ day: String) -> Bool { didHomeSession(on: day) && !didOtherWay(day) }

    func didSkip(_ day: String) -> Bool { skipped?[day] != nil }

    /// "Skip today" with its reason. Only the last sixty days are kept.
    mutating func skip(_ day: String, reason: String) {
        var all = skipped ?? [:]
        all[day] = reason
        skipped = Dictionary(uniqueKeysWithValues: all.sorted { $0.key < $1.key }.suffix(Self.keptDays).map { ($0.key, $0.value) })
    }

    /// Records a finished session: each movement's sets, the soreness answer and the day.
    mutating func record(day: String, results: [WorkoutResult], pain: Int?) {
        for result in results where !result.sets.isEmpty {
            entries.append(Entry(movementId: result.movementId, day: day, sets: result.sets, load: result.load,
                                 slow: result.slow == true ? true : nil, tooHard: result.tooHard ? true : nil))
        }
        if entries.count > Self.keep { entries.removeFirst(entries.count - Self.keep) }
        if let pain { lastPain = pain }
        markDone(day)
        // The session finished on the page stands in for "Already done" pressed meanwhile: done once, not twice.
        otherWay?.removeAll { $0 == day }
    }

    /// The backpack's weight for next time, from the session just done: "Too hard" on a movement keeps the weight the
    /// page left it at, and while the weight is still being found (`WorkoutResult.calibrating`) "Too easy" at the end adds
    /// two kilograms (up to what a backpack holds). Anything else leaves it to the usual step up: a kilogram after a
    /// session with every set at the top.
    mutating func settleLoads(_ results: [WorkoutResult], feeling: WorkoutFeeling?) {
        for result in results {
            guard let load = result.load else { continue }
            // A load changed on the page ("Too hard" or "Too easy" on that movement) is the one kept; the end-of-session
            // "Too easy" only raises the ones not changed there, and only while their weight is being found.
            if result.tooHard || result.tooEasy == true {
                loads[result.movementId] = load
            } else if feeling == .easy, result.calibrating == true {
                loads[result.movementId] = min(BackpackWater.maxKg, load + BackpackWater.easierStepKg)
            } else {
                loads.removeValue(forKey: result.movementId)
            }
        }
    }

    mutating func markDone(_ day: String) {
        if !doneDays.contains(day) { doneDays.append(day) }
        doneDays = Array(doneDays.suffix(Self.keptDays))
    }

    /// "I did it another way" or "Already done".
    mutating func markDoneAnotherWay(_ day: String) {
        guard !didHomeSession(on: day) else { return }
        markDone(day)
        otherWay = Array(((otherWay ?? []) + [day]).suffix(Self.keptDays))
    }

    /// Takes back "I did it another way" or "Already done"; a session finished on the page stays done.
    mutating func undoOtherWay(_ day: String) {
        guard didOtherWay(day) else { return }
        doneDays.removeAll { $0 == day }
        otherWay?.removeAll { $0 == day }
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
    /// "Too easy" on a backpack movement this time: its load went up on the page and stays there.
    var tooEasy: Bool?
    /// Done at the slower tempo the session asked for (the slow step), kept in the log so the engine knows it was done.
    var slow: Bool?
    /// A backpack movement with no weight kept from an earlier session (plan 5.C): this session finds its weight, so
    /// "Too hard" takes a kilogram off and "Too easy" adds two. Decided from the log when the session starts; nil for a
    /// movement without a backpack, and for a session saved by an older build (then read from the log).
    var calibrating: Bool?
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
    /// When the AI chose today's movements: its one sentence on why, shown on the page as picked by AI.
    var reason: String?

    /// A set has been done: the session is under way, not only open.
    var isUnderWay: Bool { results.contains { !$0.sets.isEmpty } }

    /// The kilograms in the backpack for the movement on screen: what the page set, else what the session planned.
    var backpackLoad: Double? {
        guard results.indices.contains(index), content.items.indices.contains(index) else { return nil }
        return results[index].load ?? content.items[index].load
    }

    /// "Too hard" on a backpack movement while its weight is being found: a kilogram less now and next time, down to the
    /// least. The new weight, or nil for a movement without a backpack.
    mutating func backpackTooHard() -> Double? {
        guard let load = backpackLoad else { return nil }
        let lighter = max(BackpackWater.leastKg, load - BackpackWater.harderStepKg)
        results[index].load = lighter
        results[index].tooHard = true
        results[index].tooEasy = nil
        return lighter
    }

    /// "Too easy" on a backpack movement while its weight is being found: two kilograms more now and next time, up to what
    /// a backpack holds. Nil when it already holds that much, and nothing changes.
    mutating func backpackTooEasy() -> Double? {
        guard let load = backpackLoad else { return nil }
        let heavier = min(BackpackWater.maxKg, load + BackpackWater.easierStepKg)
        guard heavier > load else { return nil }
        results[index].load = heavier
        results[index].tooEasy = true
        results[index].tooHard = false
        return heavier
    }

    /// Today's half-done session. One that can't be read is said in the log and started again: the sets done in it are
    /// lost, the day's log is not.
    static func load(from defaults: UserDefaults, day: String) -> WorkoutProgress? {
        guard let data = defaults.data(forKey: key) else { return nil }
        do {
            let saved = try JSONDecoder().decode(WorkoutProgress.self, from: data)
            return saved.day == day ? saved : nil
        } catch {
            Logger.workout.error("The half-done workout couldn't be read: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    func save(to defaults: UserDefaults) {
        do { defaults.set(try JSONEncoder().encode(self), forKey: Self.key) } catch {
            Logger.workout.error("The half-done workout couldn't be saved: \(error.localizedDescription, privacy: .public)")
        }
    }

    static func clear(from defaults: UserDefaults) { defaults.removeObject(forKey: key) }
}

extension Logger {
    /// The workout page and its log.
    static let workout = Logger(subsystem: "com.evergreentraining.app", category: "workout")
}
