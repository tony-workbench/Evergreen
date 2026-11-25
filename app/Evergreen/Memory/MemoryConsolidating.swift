import Foundation

/// The memory engine as the loop needs it (the memory-agent bundle's
/// `memoryDailyRequest`, `memoryDailyApply`, `memoryTable`,
/// `memoryReviewQueue`, `memoryReject`, `memoryRestore` and `memoryConfirm`),
/// behind a protocol so the app's part can be written and tested without the
/// bundle. Facts are worked out by code; the model only proposes changes to
/// what is remembered, and the engine checks and applies them.
protocol MemoryConsolidating: Sendable {
    /// What the model is asked once a day.
    typealias DailyRequest = (day: String, system: String, user: String, schema: JSONValue, evidence: [JSONValue])

    /// Nil when that day's consolidation is already done, or there is nothing to consolidate.
    func dailyRequest(now: Date, outcomes: [Outcome]) async -> DailyRequest?
    /// Whether this engine is set to go without a model (debug screens and tests).
    var goesWithoutModel: Bool { get }
    /// The proposals the engine's own rules make from the same evidence: the fallback when the model can't be asked or keeps getting it wrong.
    func rulesAnswer(now: Date, outcomes: [Outcome]) async -> JSONValue?
    /// Hands an answer to the engine, which applies what passes its checks. Comes back with what it refused, each as "code: text"; nil when the engine itself failed.
    @discardableResult
    func apply(day: String, answer: JSONValue, now: Date) async -> [String]?
    /// Every row, in any state.
    func table() async -> [MemoryRow]
    /// The table as the engine writes it for the planning agent: at most 200 words. Empty before there is a row.
    func tableText() async -> String
    /// Rows waiting for "Is this right?".
    func reviewQueue() async -> [MemoryRow]
    func reject(key: String, now: Date) async
    func restore(key: String, now: Date) async
    func confirm(key: String, now: Date) async
}
