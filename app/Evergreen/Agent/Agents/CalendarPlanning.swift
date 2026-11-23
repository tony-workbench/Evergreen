import Foundation

/// The calendar engine, as the loop uses it. It only ever previews: the app
/// writes to the calendar, after the person confirms.
protocol CalendarPlanning: Sendable {
    /// Where an intent fits around the real events, given the person's usual times. Nil when it failed.
    func plan(_ intent: CalendarIntent, memory: CalendarMemory, now: Date) async -> CalendarResult?
    /// The same for a sentence, read by the engine's own rules instead of a model.
    func plan(request: String, memory: CalendarMemory, now: Date) async -> CalendarResult?
    /// The last preview again after the person changed something: `{type: "drag", id, start}`, `{type: "answer", answerId}` or `{type: "text", intent}`.
    func replan(_ last: CalendarResult, change: JSONValue, memory: CalendarMemory, now: Date) async -> CalendarResult?
    /// The JSON Schema of an intent, for the model that turns a sentence into one.
    func intentSchema() async -> JSONValue
}
