import Foundation

/// What one home session holds, as the engine's `workoutContent` returns it
/// (contract/schemas/workout-content.schema.json): movements from the library,
/// each with its sets, its range of reps or seconds, its rest and, for a
/// backpack movement, the kilograms in the backpack.
struct WorkoutContent: Codable, Equatable, Sendable {
    /// How much slower each rep is lowered in the slow step (the engine's SLOW_EXTRA_SECONDS).
    static let slowExtraSeconds = 2
    var sessionId: String?
    var focus: String
    var minutes: Int
    var items: [Item]

    struct Item: Codable, Equatable, Sendable, Identifiable {
        var movementId: String
        var sets: Int
        /// The lowest and highest reps a set aims for; nil for a hold.
        var reps: [Int]?
        /// The shortest and longest hold, in seconds; nil for reps.
        var seconds: [Int]?
        /// Kilograms in the backpack.
        var load: Double?
        /// Seconds of rest between sets.
        var rest: Int
        /// Not done before: the page asks first whether the person can do one.
        var isNew: Bool
        /// The slow step: every rep lowered two seconds slower than the movement's usual tempo.
        var slow: Bool?

        var id: String { movementId }
        var range: [Int] { reps ?? seconds ?? [1, 1] }
        var low: Int { range.first ?? 1 }
        var high: Int { range.last ?? 1 }
        var isHold: Bool { seconds != nil }
        /// "8–12 reps", "20–40 seconds", with "each side" when the movement has two.
        func target(sides: Int) -> String {
            let unit = isHold ? "seconds" : "reps"
            return "\(low)–\(high) \(unit)" + (sides == Movement.bothSides ? " each side" : "")
        }
    }
}

/// One movement of the library (recommend-agent/data/movements.json), as the
/// engine's `movementLibrary` returns it. Every word the workout page shows
/// about a movement comes from here, so it reads the same on every day.
struct Movement: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var pattern: String
    var position: String
    var equipment: [String]
    var level: Int
    var balance: Bool
    var entry: Bool
    var setup: String
    var steps: [String]
    var feel: String
    var pass: String
    var mistakes: [String]
    var easier: String?
    var harder: String?
    var tempo: Tempo?
    var dose: Dose
    var sides: Int
    var rest: Int
    /// Starting kilograms in the backpack, for a backpack movement.
    var load: Double?

    struct Tempo: Codable, Equatable, Sendable { var down: Int; var hold: Int; var up: Int }
    struct Dose: Codable, Equatable, Sendable { var sets: Int; var reps: [Int]?; var seconds: [Int]? }

    /// `sides` of a movement done on each side in turn.
    static let bothSides = 2

    /// One numbered step of a movement, told apart by its words.
    struct Step: Equatable, Identifiable, Sendable {
        var number: Int
        var text: String
        var id: String
    }

    /// The steps numbered from 1, each with an identity that stays when another step is added or removed.
    var numberedSteps: [Step] {
        zip(steps, TextIdentity.ids(steps)).enumerated().map { place, step in
            Step(number: place + 1, text: step.0, id: step.1)
        }
    }

    var usesBackpack: Bool { equipment.contains("backpack") }
    /// "Down in 3 seconds, hold 1, up in 1." for a movement with a tempo.
    var tempoLine: String? {
        tempo.map { "Down in \($0.down) seconds, hold \($0.hold), up in \($0.up)." }
    }
}

/// The backpack's weight said as water, since a litre of water is a kilogram and bottles need no scale:
/// "4 litres of water in the backpack (two 2-litre bottles)".
enum BackpackWater {
    /// What a backpack holds safely, in kilograms (the engine's LOAD_MAX_KG).
    static let maxKg: Double = 12
    /// What a backpack movement starts with when the library gives no weight.
    static let startKg: Double = 2
    /// "Too easy" on a backpack movement, or at the end of a session: this many more kilograms.
    static let easierStepKg: Double = 2
    /// "Too hard" on a backpack movement: this many fewer kilograms, down to `leastKg`.
    static let harderStepKg: Double = 1
    static let leastKg: Double = 1

    static func words(_ kg: Double) -> String {
        let litres = kg.formatted(.number.precision(.fractionLength(0...1)))
        let unit = kg == 1 ? "litre" : "litres"
        return "\(litres) \(unit) of water in the backpack" + (bottles(kg).map { " (\($0))" } ?? "")
    }

    /// The big bottle, in litres: whole litres are said as these and at most one 1-litre bottle.
    static let bigBottleLitres = 2

    /// Whole litres as 2-litre and 1-litre bottles; nil for a part litre or a single 1-litre bottle.
    static func bottles(_ kg: Double) -> String? {
        guard kg >= Double(bigBottleLitres), kg <= maxKg, kg == kg.rounded() else { return nil }
        let twos = Int(kg) / bigBottleLitres, ones = Int(kg) % bigBottleLitres
        let count = { (n: Int) in ["one", "two", "three", "four", "five", "six"][n - 1] }
        var parts = ["\(count(twos)) 2-litre bottle" + (twos == 1 ? "" : "s")]
        if ones == 1 { parts.append("one 1-litre bottle") }
        return parts.joined(separator: " and ")
    }
}
