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

    /// The person's side of every content call: their rules, what they did before, and whether it is the lighter fifth
    /// week after four full ones (a set fewer of everything).
    struct Basis: Sendable {
        var rules: UserRules
        var log: WorkoutLog
        var lighter = false
    }

    /// One session: the id the engine knows it by (none for a one-off), what it works ("lower", "full"…) and its length.
    struct Session: Sendable {
        var id: String?
        var focus: String
        var minutes: Int
    }

    /// A model's proposal for one session to dose and check. `week` is the week's other contents, so the week's own limits
    /// are checked with this one in place; `rulesWeek` is the rules' own week for the same days, whose sets of each
    /// pattern a short week is held to (at most four).
    struct Proposal: Sendable {
        var proposal: JSONValue
        var session: Session
        var week: [WorkoutContent]?
        var rulesWeek: [WorkoutContent]?
    }

    /// One session's movements, sets and loads, from the person's rules and what they did before. `turn` takes the core
    /// movement in turns.
    func session(_ session: Session, basis: Basis, turn: Int) async -> WorkoutContent? {
        var input = Self.shared(basis)
        input.merge(Self.fields(of: session)) { _, new in new }
        input["turn"] = .number(Double(turn))
        let answer = await bundle.call("workoutContent", .object(input))
        return answer.isOK ? answer["content"]?.decoded(WorkoutContent.self) : nil
    }

    /// Every session of a week, with a set added where a part of the body has fewer than four, and the note when the
    /// week is short of its aim. Sessions are (id, focus) in order.
    func week(_ sessions: [(id: String, focus: String)], minutes: Int, basis: Basis) async -> (contents: [WorkoutContent], note: String?)? {
        var input = Self.shared(basis)
        input["sessions"] = .array(sessions.map { ["sessionId": .string($0.id), "focus": .string($0.focus), "minutes": .number(Double(minutes))] })
        let answer = await bundle.call("weekContent", .object(input))
        guard answer.isOK, let contents = answer["contents"]?.decoded([WorkoutContent].self) else { return nil }
        return (contents, answer["note"]?.string)
    }

    /// What a model may choose from for one session: the limits as plain sentences and the movements open to the person
    /// today (id, name, pattern, level, whether new, the library's dose). No personal data and no calendar text.
    func brief(_ session: Session, basis: Basis) async -> (lines: [String], choices: JSONValue)? {
        var input = Self.shared(basis)
        input["focus"] = .string(session.focus)
        input["minutes"] = .number(Double(session.minutes))
        let answer = await bundle.call("contentBrief", .object(input))
        guard answer.isOK, let lines = answer["lines"]?.array?.compactMap(\.string), let choices = answer["choices"] else { return nil }
        return (lines, choices)
    }

    /// A model's proposal for one session, dosed by code (rest, load, the slow step, isNew) and run through every content
    /// check. Nil only when the engine can't be run; a proposal it refuses comes back with `pass` false and its problems.
    func propose(_ proposal: Proposal, basis: Basis) async -> (content: WorkoutContent?, pass: Bool, problems: [String])? {
        var input = Self.shared(basis)
        input.merge(Self.fields(of: proposal.session)) { _, new in new }
        input["proposal"] = proposal.proposal
        if let week = proposal.week { input["week"] = .from(week) }
        if let rulesWeek = proposal.rulesWeek { input["rulesWeek"] = .from(rulesWeek) }
        let answer = await bundle.call("proposedContent", .object(input))
        guard answer.isOK else { return nil }
        let problems = (answer["violations"]?.array ?? []).compactMap { $0["text"]?.string }
        return (answer["content"]?.decoded(WorkoutContent.self), answer["pass"] == .bool(true), problems)
    }

    /// A session's own fields as the engine reads them.
    private static func fields(of session: Session) -> [String: JSONValue] {
        var fields: [String: JSONValue] = ["focus": .string(session.focus), "minutes": .number(Double(session.minutes))]
        if let id = session.id { fields["sessionId"] = .string(id) }
        return fields
    }

    /// Which of `ids` the rules and the log leave closed, by the engine's own content check: not in the library, its
    /// things not at hand, left out or "can't do", or not earned yet (a harder one before the easier one was passed, or
    /// the person's "I can"). Nil when the engine can't be run.
    func closed(_ ids: [String], rules: UserRules, log: WorkoutLog) async -> Set<String>? {
        var input = Self.shared(Basis(rules: rules, log: log))
        input["content"] = ["items": .array(ids.map { ["movementId": .string($0), "sets": .number(1)] })]
        let answer = await bundle.call("checkContent", .object(input))
        guard answer.isOK else { return nil }
        return Set((answer["violations"]?.array ?? []).compactMap { violation -> String? in
            guard let code = violation["code"]?.string, Self.closedCodes.contains(code) else { return nil }
            return violation["movementId"]?.string
        })
    }

    /// The content check's codes for a movement the person can't be given ("can't do" comes as `avoided_movement`).
    static let closedCodes: Set<String> = ["unknown_movement", "equipment_not_owned", "avoided_movement", "gated_movement"]

    private static func shared(_ basis: Basis) -> [String: JSONValue] {
        let log = basis.log
        var input: [String: JSONValue] = [
            "rules": basis.rules.engineValue,
            "history": log.engineHistory,
            "loads": .object(log.loads.mapValues { .number($0) }),
        ]
        if let pain = log.lastPain { input["lastPain"] = .number(Double(pain)) }
        if basis.lighter || log.lastFeeling == .hard { input["deload"] = .bool(true) }
        return input
    }
}
