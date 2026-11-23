import Foundation

/// The generic tool-use loop: ask the model, run the tools it calls (after
/// checking each input against the tool's schema), hand the results back, and
/// go again until it answers in words. It stops after `maxSteps` requests and
/// when its task is cancelled.
struct AgentLoop: Sendable {
    let model: any LanguageModel
    let modelId: String
    let system: String
    let tools: [any AgentTool]
    var maxSteps = 6

    enum Ending: Equatable, Sendable {
        /// The model answered in words.
        case answered(String)
        /// It kept calling tools past the step limit.
        case tooManySteps
        /// It declined, or ran out of room before answering.
        case stopped(String)
        case cancelled
    }

    struct Result: Equatable, Sendable {
        var ending: Ending
        /// The tools that ran, in order, with what each returned.
        var calls: [(name: String, outcome: ToolOutcome)] = []
        var steps = 0

        static func == (a: Result, b: Result) -> Bool {
            a.ending == b.ending && a.steps == b.steps && a.calls.map(\.name) == b.calls.map(\.name)
                && a.calls.map(\.outcome) == b.calls.map(\.outcome)
        }
    }

    func run(_ userText: String) async throws(ModelFailure) -> Result {
        var messages: [JSONValue] = [["role": "user", "content": .string(userText)]]
        var result = Result(ending: .tooManySteps)
        let definitions = tools.map { ModelRequest.Tool(name: $0.name, description: $0.description, schema: $0.schema) }

        while result.steps < maxSteps {
            if Task.isCancelled { result.ending = .cancelled; return result }
            result.steps += 1
            let reply = try await model.reply(to: ModelRequest(model: modelId, system: system, messages: messages, tools: definitions))
            // Check why it stopped before reading what it said.
            switch reply.stopReason {
            case "tool_use":
                break
            case "end_turn", "stop_sequence":
                result.ending = .answered(reply.text)
                return result
            default:
                result.ending = .stopped(reply.stopReason)
                return result
            }
            // The assistant's blocks go back exactly as they came; every result in one user message.
            messages.append(["role": "assistant", "content": .array(reply.content)])
            var results: [JSONValue] = []
            for call in reply.toolCalls {
                let outcome = await run(call)
                result.calls.append((call.name, outcome))
                results.append([
                    "type": "tool_result", "tool_use_id": .string(call.id),
                    "content": .string(outcome.text), "is_error": .bool(outcome.isError),
                ])
            }
            messages.append(["role": "user", "content": .array(results)])
        }
        return result
    }

    /// Runs one tool call, unless the tool is unknown or the input doesn't fit its schema.
    private func run(_ call: ModelReply.ToolCall) async -> ToolOutcome {
        guard let tool = tools.first(where: { $0.name == call.name }) else {
            return ToolOutcome(text: "There is no tool called \(call.name).", isError: true)
        }
        if let problem = JSONSchemaCheck.problem(with: call.input, schema: tool.schema) {
            return ToolOutcome(text: "The input doesn't fit: \(problem).", isError: true)
        }
        return await tool.run(call.input)
    }
}
