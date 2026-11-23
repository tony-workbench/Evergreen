import Foundation

/// The one filter every model-written sentence passes before a person sees
/// it: plan reasons, the week's summary, and the answers to questions. Text
/// that carries the system's own vocabulary (field names, memory keys,
/// brackets, underscores) isn't shown; the caller asks the model again once,
/// and then says it in code-written words.
enum ShownText {
    static let banned = ["basedon", "checkplan", "plancontext", "load cap", "loadcap", "readiness", "acwr", "planner", "harness", "memory key",
                         "usual_slot", "weeksseen", "weekstotal", "ratiotousual", "json", "schema", "tool", "function call", "memoryid", "sessionid",
                         "targetworkoutid", "partofday", "racedate", "distancekm"]

    /// What is wrong with the text, in words the model can act on; nil when it can be shown.
    static func problem(with text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "it is empty" }
        let lower = trimmed.lowercased()
        if let word = banned.first(where: lower.contains) { return "it uses the technical word \"\(word)\"" }
        if trimmed.contains("_") { return "it contains an underscore" }
        if trimmed.contains(where: { "[]{}<>`|".contains($0) }) { return "it contains brackets or code marks" }
        if lower.contains(/\b(mem|slot|gear|goal|s|ses|brief):[a-z0-9]/) { return "it contains a memory key or an id" }
        if trimmed.contains(/\b[a-z]+[A-Z][a-zA-Z]*\b/) { return "it contains a field name" }
        return nil
    }

    /// The text when it can be shown, else the fallback.
    static func shown(_ text: String, else fallback: String) -> String {
        problem(with: text) == nil ? text.trimmingCharacters(in: .whitespacesAndNewlines) : fallback
    }
}
