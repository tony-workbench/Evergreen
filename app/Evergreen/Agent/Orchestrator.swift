import Foundation

/// The loop that connects the agents, with the app as the hub. The agents
/// never call each other: each step here takes one agent's output as a typed
/// value and hands it to the next. A model proposes; code checks and
/// executes. A step that fails returns nothing and writes nothing, so the
/// last good screen stays.
///
/// The steps, in order: remember, recommend, place, confirm.
struct Orchestrator: Sendable {
    let memory: any MemoryConsolidating
    let rules: any PlanRules
    let calendar: any CalendarPlanning
    let writer: any CalendarWriting
    let model: any LanguageModel
    /// The model that thinks about memory and the plan.
    let modelId: String
    /// The person's time zone, from the app's calendar: an AI-written week is read in it.
    var timeZone = TimeZone.current

    // MARK: Remember

    /// The daily memory answer is a list of short proposals: this many tokens is room for all thirty.
    static let memoryMaxOutput = 4000
    static let memoryTimeout: TimeInterval = 60

    /// The memory agent gets the day's facts and outcomes and proposes
    /// changes; the engine applies what passes. At most one model call, and
    /// only when the day hasn't been consolidated. The table comes back
    /// either way, with how it went. The model's answer must be JSON of the
    /// asked shape; a number that isn't in the cited evidence goes back to
    /// it once with the exact problem; and when the model can't be asked or
    /// still doesn't answer in shape, the engine's own rules make the proposals instead.
    func consolidate(now: Date, outcomes: [Outcome]) async -> (rows: [MemoryRow], run: MemoryRun) {
        var run = MemoryRun()
        if let request = await memory.dailyRequest(now: now, outcomes: outcomes) {
            var answer: JSONValue?
            if !memory.goesWithoutModel {
                var messages: [JSONValue] = [["role": "user", "content": .string(request.user)]]
                for repair in 0...1 {
                    // No thinking and a capped answer, like the plan; this runs behind the screen, so it may take a minute, and the client tries once more when no answer comes.
                    let ask = ModelRequest(model: modelId, system: request.system, messages: messages, answerSchema: request.schema,
                                           maxOutput: Self.memoryMaxOutput, timeout: Self.memoryTimeout, effort: "low")
                    let reply: ModelReply
                    do {
                        reply = try await model.reply(to: ask)
                    } catch {
                        run.fallback = "the model couldn't be reached (\(error)) after one more try"
                        break
                    }
                    guard reply.stopReason == "end_turn" else {
                        run.fallback = "the model stopped with \(reply.stopReason)"
                        break
                    }
                    run.repairs = repair
                    // An answer of the wrong shape, or with a number its evidence doesn't hold, goes back once with what is wrong.
                    let proposed = JSONValue.parse(reply.text).flatMap { $0["proposals"]?.array == nil ? nil : $0 }
                    let wrong = proposed.map { MemoryRun.strayNumbers(in: $0, evidence: request.evidence) }
                        ?? ["That wasn't the JSON asked for: an object with a list called proposals."]
                    if let proposed, wrong.isEmpty || repair == 1 { answer = proposed }
                    if proposed == nil { run.fallback = "the answer wasn't the JSON asked for\(repair == 1 ? ", twice" : "")" }
                    guard !wrong.isEmpty, repair == 0 else { break }
                    messages.append(["role": "assistant", "content": .string(reply.text)])
                    messages.append(["role": "user", "content": .string("That can't be used:\n" + wrong.joined(separator: "\n") + "\nAnswer again with all the proposals, corrected.")])
                }
            }
            run.source = answer == nil ? .rules : .model
            if answer != nil { run.fallback = nil } else if memory.goesWithoutModel { run.fallback = "the model isn't used here" }
            if answer == nil { answer = await memory.rulesAnswer(now: now, outcomes: outcomes) }
            if let answer {
                run.proposals = answer["proposals"]?.array?.count ?? 0
                run.refused = await memory.apply(day: request.day, answer: answer, now: now) ?? []
            } else {
                run.source = .none
            }
        }
        return (await memory.table(), run)
    }

    // MARK: Recommend

    /// The planning agent gets the table and proposes a week. Only a week
    /// that passed `checkPlan` comes back; otherwise the week from the rules.
    func recommend(rows: [MemoryRow], now: Date) async -> PlanAgent.Week {
        await planner(rows: rows, now: now).week()
    }

    /// Exactly what the planning agent is sent about the person.
    func brief(rows: [MemoryRow], now: Date) async -> String {
        await planner(rows: rows, now: now).brief(lines: await rules.planBrief(rows: rows, now: now))
    }

    private func planner(rows: [MemoryRow], now: Date) async -> PlanAgent {
        var agent = PlanAgent(model: model, modelId: modelId, rules: rules, rows: rows, now: now)
        agent.timeZone = timeZone
        agent.tableText = await memory.tableText()
        return agent
    }

    // MARK: Place

    /// An accepted session becomes a calendar intent, and the calendar
    /// engine finds its exact time around real events, preferring the
    /// person's usual slots. This is a preview: nothing is written.
    func place(_ session: PlanSession, rows: [MemoryRow], now: Date) async -> CalendarResult? {
        guard var result = await calendar.plan(HandOff.sessionToIntent(session, rows: rows), memory: HandOff.rowsToCalendarMemory(rows), now: now) else { return nil }
        // Placed exactly where it was suggested, it keeps the suggestion's own reason: nobody asked for that time in words.
        for index in result.proposed.indices where result.proposed[index].start == session.start && !session.reason.isEmpty {
            result.proposed[index].reason = session.reason
        }
        return result
    }

    // MARK: Confirm

    /// Only the person's confirmation writes to the calendar. What was
    /// written comes back as plan records, which the app keeps so the write
    /// can be undone and tomorrow can tell whether the session happened
    /// (none for a cancellation). Nil when nothing was written.
    func confirm(_ result: CalendarResult) async -> [PlanRecord]? {
        guard !result.proposed.isEmpty, await writer.write(result.proposed) else { return nil }
        return result.proposed.filter { $0.status != "cancelled" }.map {
            PlanRecord(sessionId: $0.sessionId ?? $0.id, day: $0.start.day, activity: $0.activity, plannedStart: $0.start)
        }
    }
}
