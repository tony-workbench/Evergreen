import Foundation

/// The engine's content functions: which movements a home session holds and
/// every movement's words. Code builds the content; nothing here asks a model.
struct BundleContent: Sendable {
    static let globals = ["workoutContent", "weekContent", "checkContent", "movementLibrary", "contentBrief", "proposedContent"]

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

    /// What a model may choose from for one session: the limits as plain sentences and the movements open to the person
    /// today (id, name, pattern, level, whether new, the library's dose). No personal data and no calendar text.
    func brief(focus: String, minutes: Int, rules: UserRules, log: WorkoutLog, lighter: Bool = false) async -> (lines: [String], choices: JSONValue)? {
        var input = Self.shared(rules: rules, log: log, lighter: lighter)
        input["focus"] = .string(focus)
        input["minutes"] = .number(Double(minutes))
        let answer = await bundle.call("contentBrief", .object(input))
        guard answer.isOK, let lines = answer["lines"]?.array?.compactMap(\.string), let choices = answer["choices"] else { return nil }
        return (lines, choices)
    }

    /// A model's proposal for one session, dosed by code (rest, load, the slow step, isNew) and run through every content
    /// check. `week` is the week's other contents, so the week's own limits are checked with this one in place; `rulesWeek`
    /// is the rules' own week for the same days, whose sets of each pattern a short week is held to (at most four).
    /// Nil only when the engine can't be run; a proposal it refuses comes back with `pass` false and its problems.
    func propose(_ proposal: JSONValue, id: String, focus: String, minutes: Int, rules: UserRules, log: WorkoutLog,
                 lighter: Bool = false, week: [WorkoutContent]? = nil, rulesWeek: [WorkoutContent]? = nil) async -> (content: WorkoutContent?, pass: Bool, problems: [String])? {
        var input = Self.shared(rules: rules, log: log, lighter: lighter)
        input["proposal"] = proposal
        input["sessionId"] = .string(id)
        input["focus"] = .string(focus)
        input["minutes"] = .number(Double(minutes))
        if let week { input["week"] = .from(week) }
        if let rulesWeek { input["rulesWeek"] = .from(rulesWeek) }
        let answer = await bundle.call("proposedContent", .object(input))
        guard answer.isOK else { return nil }
        let problems = (answer["violations"]?.array ?? []).compactMap { $0["text"]?.string }
        return (answer["content"]?.decoded(WorkoutContent.self), answer["pass"] == .bool(true), problems)
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
