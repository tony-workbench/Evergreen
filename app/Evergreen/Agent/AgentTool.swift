import Foundation

/// What a tool hands back to the model.
struct ToolOutcome: Equatable, Sendable {
    var text: String
    var isError = false
}

/// Something an agent can do: a name and description the model reads, the
/// JSON schema of its input, and the code that runs it. The loop checks the
/// input against the schema first, so `run` only ever sees input that fits.
protocol AgentTool: Sendable {
    var name: String { get }
    var description: String { get }
    var schema: JSONValue { get }
    func run(_ input: JSONValue) async -> ToolOutcome
}

/// A tool whose work is a closure, for tools that act on the app's own state.
struct ClosureTool: AgentTool {
    let name: String
    let description: String
    let schema: JSONValue
    let action: @MainActor @Sendable (JSONValue) async -> ToolOutcome

    func run(_ input: JSONValue) async -> ToolOutcome { await action(input) }

    /// The schema of a tool that takes nothing.
    static let noInput: JSONValue = ["type": "object", "properties": [:], "required": [], "additionalProperties": false]

    /// The schema of a tool that takes named strings, all required.
    static func strings(_ fields: KeyValuePairs<String, String>) -> JSONValue {
        [
            "type": "object",
            "properties": .object(Dictionary(fields.map { ($0.key, ["type": "string", "description": .string($0.value)] as JSONValue) }) { $1 }),
            "required": .array(fields.map { .string($0.key) }),
            "additionalProperties": false,
        ]
    }
}
