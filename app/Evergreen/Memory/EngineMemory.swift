import Foundation

/// The memory agent in the memory bundle, for one person: the daily
/// request, applying the model's proposals, the table, the review queue,
/// and confirm, reject and restore.
struct EngineMemory: MemoryConsolidating {
    let engine: MemoryEngine
    let personaKey: String
    var timeZone: TimeZone
    /// What the person told the app that Health can't know (their shoes), for the daily request: `{gear: {item, km, boughtOn}}`.
    var extras: JSONValue? = nil
    /// Answer with the bundle's own rules instead of a model (debug screens and tests).
    var withoutModel = false

    private func time(_ date: Date) -> JSONValue { .string(LocalTime(date, in: timeZone).text) }

    private func request(now: Date, outcomes: [Outcome]) async -> JSONValue {
        var arguments: [String: JSONValue] = ["now": time(now), "outcomes": .from(outcomes)]
        if let extras { arguments["extras"] = extras }
        return await engine.agentCall("memoryDailyRequest", personaKey: personaKey, arguments)
    }

    func dailyRequest(now: Date, outcomes: [Outcome]) async -> DailyRequest? {
        let answer = await request(now: now, outcomes: outcomes)
        guard answer.isOK, answer["alreadyDone"] != .bool(true), answer["evidence"]?.array?.isEmpty == false,
              let day = answer["day"]?.string, let system = answer["system"]?.string, let user = answer["user"]?.string,
              let schema = answer["schema"]
        else { return nil }
        return (day, system, user, schema, answer["evidence"]?.array ?? [])
    }

    var goesWithoutModel: Bool { withoutModel }

    func rulesAnswer(now: Date, outcomes: [Outcome]) async -> JSONValue? {
        let request = await request(now: now, outcomes: outcomes)
        guard request.isOK, case .object(let fields) = request else { return nil }
        let answer = await engine.agentCall("memoryDemoModel", personaKey: personaKey, fields)
        return answer["proposals"] == nil ? nil : answer
    }

    @discardableResult
    func apply(day: String, answer: JSONValue, now: Date) async -> [String]? {
        let result = await engine.agentCall("memoryDailyApply", personaKey: personaKey, ["now": time(now), "day": .string(day), "proposals": answer])
        guard result.isOK else { return nil }
        return (result["rejected"]?.array ?? []).map { "\($0["code"]?.string ?? "rejected"): \($0["text"]?.string ?? "")" }
    }

    /// The rows in use, then the ones the person rejected.
    func table() async -> [MemoryRow] {
        let inUse = await engine.agentCall("memoryTable", personaKey: personaKey)["rows"]?.array?.compactMap { $0.decoded(MemoryRow.self) } ?? []
        let rejected = await engine.rejectedRows(personaKey).filter { row in !inUse.contains { $0.key == row.key } }
        return inUse + rejected
    }

    func tableText() async -> String {
        await engine.agentCall("memoryTable", personaKey: personaKey)["text"]?.string ?? ""
    }

    func reviewQueue() async -> [MemoryRow] {
        await engine.agentCall("memoryReviewQueue", personaKey: personaKey)["rows"]?.array?.compactMap { row in
            // A queued row has no state of its own yet: it is waiting for "Is this right?".
            guard case .object(var fields) = row else { return nil }
            fields["state"] = "review"
            fields["confidence"] = fields["confidence"] ?? 0.5
            fields["since"] = fields["since"] ?? fields["day"] ?? ""
            fields["updated"] = fields["updated"] ?? fields["day"] ?? ""
            return JSONValue.object(fields).decoded(MemoryRow.self)
        } ?? []
    }

    func reject(key: String, now: Date) async {
        // Kept as a rejected row, so it can be shown under "Stopped" and restored.
        var rejected = await engine.rejectedRows(personaKey)
        if var row = await table().first(where: { $0.key == key }), !rejected.contains(where: { $0.key == key }) {
            row.state = "rejected"
            rejected.append(row)
            await engine.setRejectedRows(rejected, personaKey: personaKey)
        }
        await change("memoryReject", key, now)
    }

    func confirm(key: String, now: Date) async { await change("memoryConfirm", key, now) }

    func restore(key: String, now: Date) async {
        await engine.setRejectedRows(await engine.rejectedRows(personaKey).filter { $0.key != key }, personaKey: personaKey)
        await change("memoryRestore", key, now)
        await engine.forgetRolled(personaKey)
    }

    private func change(_ name: String, _ key: String, _ now: Date) async {
        _ = await engine.agentCall(name, personaKey: personaKey, ["key": .string(key), "now": time(now)])
    }
}
