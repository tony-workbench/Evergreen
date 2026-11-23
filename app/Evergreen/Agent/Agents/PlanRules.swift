import Foundation

/// The rules behind the plan, worked out by code so the model does no
/// arithmetic on raw data: the numbers it plans from, the hard checks every
/// proposal must pass, and a week from the rules alone as the quiet safety net.
protocol PlanRules: Sendable {
    /// The 7 days ahead with what the model needs: usual week, load and its cap, readiness, free time.
    func planContext(rows: [MemoryRow], now: Date) async -> JSONValue
    /// The week's limits as plain sentences, worked out by code, for the model to plan within.
    func planBrief(rows: [MemoryRow], now: Date) async -> [String]
    /// The hard rules as a validator. Empty when the week passes; each violation says how to fix it.
    func checkPlan(_ sessions: [PlanSession], summary: String, rows: [MemoryRow], now: Date) async -> [PlanViolation]
    /// A week from the rules alone.
    func recommendWeek(rows: [MemoryRow], now: Date) async -> [PlanSession]
}
