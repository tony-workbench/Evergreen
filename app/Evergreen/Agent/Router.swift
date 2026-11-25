import Foundation

/// Which of the three agents a sentence is for.
enum AgentKind: String, CaseIterable, Sendable {
    case calendar, plan, memory
    /// A whole week: the plan agent proposes it, then the calendar agent places each accepted session.
    case week
    /// Not something Evergreen does.
    case none

    /// The small label on the agent's card.
    var label: String {
        switch self {
        case .calendar: "Calendar"
        case .plan, .week: "Plan"
        case .memory: "Memory"
        case .none: "Evergreen"
        }
    }
}

/// Decides which agent handles a sentence, with one small request to the
/// fast model that must answer with one of five words.
struct Router: Sendable {
    let model: any LanguageModel
    let modelId: String

    static let system = """
    You sort one sentence a person typed into a training app called Evergreen. Answer with the agent that should handle it:
    - "calendar": finding time, adding, scheduling, moving, shortening, lengthening, skipping or cancelling one workout, a race date, anything about when.
    - "week": planning or re-planning the whole week ("plan my week").
    - "plan": a question about what to do, which workouts, how hard, shoes, or why something was suggested.
    - "memory": what Evergreen remembers about the person, and asking it to stop using or forget something.
    - "none": anything else. Evergreen only does the things above.
    Examples:
    "find me 45 min to run tonight" -> calendar
    "skip the gym thursday" -> calendar
    "push tomorrows run back a bit" -> calendar
    "i have a half marathon on march 3" -> calendar
    "plan my week" -> week
    "why a long run on sunday?" -> plan
    "should I go hard tomorrow" -> plan
    "what do you remember about me" -> memory
    "stop planning sunday mornings" -> memory
    "forget last tuesday" -> memory
    "what's the weather on mars" -> none
    "book me a table for two" -> none
    """

    static let schema: JSONValue = [
        "type": "object",
        "properties": ["agent": ["type": "string", "enum": ["calendar", "plan", "week", "memory", "none"]]],
        "required": ["agent"],
        "additionalProperties": false,
    ]

    /// How long the model has to sort a sentence before code does it.
    static let quick: TimeInterval = 8

    /// The same sorting by a few words, for when there is no model to ask or it takes too long.
    static func byWords(_ sentence: String) -> AgentKind {
        let said = " " + sentence.lowercased().replacing("’", with: "'") + " "
        func has(_ words: String...) -> Bool { words.contains { said.contains($0) } }
        if has("remember", "forget", "stop using", "know about me", "learned about") { return .memory }
        if has("plan my week", "replan", "plan the week", "whole schedule", "fresh plan") { return .week }
        if CalendarAgent.cancelVerbs.contains(where: said.contains) || CalendarAgent.moveVerbs.contains(where: said.contains) { return .calendar }
        if has(" find ", " minutes", " min ", " add ", "schedule", " book ", "racing", "marathon", " race ") { return .calendar }
        if has("why", " week", "should i", "how hard", "what should", "shoes", "trainers", "overdoing") { return .plan }
        return .none
    }

    /// Sorting as the app does it, code first: a sentence that asks to forget or stop something is
    /// memory's; one that names a planned workout with a cancel or move verb is the calendar's; only
    /// then is the model asked, and when it can't be reached in time the words decide.
    func sort(_ sentence: String, memoryCommand: Bool, namesPlannedWorkout: Bool) async throws(ModelFailure) -> (kind: AgentKind, fellBack: Bool) {
        if memoryCommand { return (.memory, false) }
        let said = " " + sentence.lowercased().replacing("’", with: "'") + " "
        if namesPlannedWorkout, CalendarAgent.cancelVerbs.contains(where: said.contains) || CalendarAgent.moveVerbs.contains(where: said.contains) {
            return (.calendar, false)
        }
        return try await routeOrWords(sentence)
    }

    func route(_ sentence: String) async throws(ModelFailure) -> AgentKind {
        let reply = try await model.reply(to: ModelRequest(
            model: modelId, system: Self.system, messages: [["role": "user", "content": .string(sentence)]],
            answerSchema: Self.schema, timeout: Self.quick, effort: "low"
        ))
        // A declined or cut-off answer isn't a route.
        guard reply.stopReason == "end_turn", let answer = JSONValue.parse(reply.text),
              JSONSchemaCheck.problem(with: answer, schema: Self.schema) == nil,
              let kind = answer["agent"]?.string.flatMap(AgentKind.init(rawValue:))
        else { return .none }
        return kind
    }

    /// The route, and whether it had to come from the words alone because the
    /// model couldn't be reached. A refused key or a spent limit is the person's to know about, so those are still thrown.
    func routeOrWords(_ sentence: String) async throws(ModelFailure) -> (kind: AgentKind, fellBack: Bool) {
        do {
            return (try await route(sentence), false)
        } catch {
            switch error {
            case .noKey, .keyRefused, .limited: throw error
            case .unavailable, .unreachable, .unreadable, .invalid: return (Self.byWords(sentence), true)
            }
        }
    }
}
