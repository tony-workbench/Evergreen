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
    /// `lighter` is the fifth week after four full ones: a set fewer of everything.
    func session(id: String?, focus: String, minutes: Int, rules: UserRules, log: WorkoutLog, turn: Int, lighter: Bool = false) async -> WorkoutContent? {
        var input = Self.shared(rules: rules, log: log, lighter: lighter)
        input["focus"] = .string(focus)
        input["minutes"] = .number(Double(minutes))
        input["turn"] = .number(Double(turn))
        if let id { input["sessionId"] = .string(id) }
        let answer = await bundle.call("workoutContent", .object(input))
        return answer.isOK ? answer["content"]?.decoded(WorkoutContent.self) : nil
    }

    /// Every session of a week, with a set added where a part of the body has fewer than four, and the note when the
    /// week is short of its aim. Sessions are (id, focus) in order.
    func week(_ sessions: [(id: String, focus: String)], minutes: Int, rules: UserRules, log: WorkoutLog, lighter: Bool = false) async -> (contents: [WorkoutContent], note: String?)? {
        var input = Self.shared(rules: rules, log: log, lighter: lighter)
        input["sessions"] = .array(sessions.map { ["sessionId": .string($0.id), "focus": .string($0.focus), "minutes": .number(Double(minutes))] })
        let answer = await bundle.call("weekContent", .object(input))
        guard answer.isOK, let contents = answer["contents"]?.decoded([WorkoutContent].self) else { return nil }
        return (contents, answer["note"]?.string)
    }

    private static func shared(rules: UserRules, log: WorkoutLog, lighter: Bool) -> [String: JSONValue] {
        var input: [String: JSONValue] = [
            "rules": rules.engineValue,
            "history": log.engineHistory,
            "loads": .object(log.loads.mapValues { .number($0) }),
        ]
        if let pain = log.lastPain { input["lastPain"] = .number(Double(pain)) }
        if lighter || log.lastFeeling == .hard { input["deload"] = .bool(true) }
        return input
    }
}
