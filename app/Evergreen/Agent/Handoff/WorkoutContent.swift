import Foundation

/// What one home session holds, as the engine's `workoutContent` returns it
/// (contract/schemas/workout-content.schema.json): movements from the library,
/// each with its sets, its range of reps or seconds, its rest and, for a
/// backpack movement, the kilograms in the backpack.
struct WorkoutContent: Codable, Equatable, Sendable {
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

        var id: String { movementId }
        var range: [Int] { reps ?? seconds ?? [1, 1] }
        var low: Int { range.first ?? 1 }
        var high: Int { range.last ?? 1 }
        var isHold: Bool { seconds != nil }
        /// "8–12 reps", "20–40 seconds", with "each side" when the movement has two.
        func target(sides: Int) -> String {
            let unit = isHold ? "seconds" : "reps"
            return "\(low)–\(high) \(unit)" + (sides == 2 ? " each side" : "")
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

    var usesBackpack: Bool { equipment.contains("backpack") }
    /// "Down in 3 seconds, hold 1, up in 1." for a movement with a tempo.
    var tempoLine: String? {
        tempo.map { "Down in \($0.down) seconds, hold \($0.hold), up in \($0.up)." }
    }
}
