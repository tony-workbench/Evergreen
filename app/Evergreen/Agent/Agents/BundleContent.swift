import Foundation

/// The engine's content functions: which movements a home session holds and
/// every movement's words. Code builds the content; nothing here asks a model.
struct BundleContent: Sendable {
    static let globals = ["workoutContent", "weekContent", "checkContent", "movementLibrary"]

    let bundle: JSBundle

    /// Every movement in the library; empty when the bundle can't be read.
    func library() async -> [Movement] {
        let answer = await bundle.call("movementLibrary", [:])
        return answer.isOK ? answer["movements"]?.decoded([Movement].self) ?? [] : []
    }

    /// One session's movements, sets and loads, from the person's rules and what they did before.
    func session(id: String?, focus: String, minutes: Int, rules: UserRules, log: WorkoutLog, turn: Int) async -> WorkoutContent? {
        var input: [String: JSONValue] = [
            "focus": .string(focus),
            "minutes": .number(Double(minutes)),
            "rules": rules.engineValue,
            "history": log.engineHistory,
            "loads": .object(log.loads.mapValues { .number($0) }),
            "turn": .number(Double(turn)),
        ]
        if let id { input["sessionId"] = .string(id) }
        if let pain = log.lastPain { input["lastPain"] = .number(Double(pain)) }
        if log.lastFeeling == .hard { input["deload"] = .bool(true) }
        let answer = await bundle.call("workoutContent", .object(input))
        return answer.isOK ? answer["content"]?.decoded(WorkoutContent.self) : nil
    }
}
