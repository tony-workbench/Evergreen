import Foundation
import os

/// One request to a model: who it is, what was said so far, the tools it may
/// call and, for a structured answer, the JSON schema the answer must fit.
struct ModelRequest: Equatable, Sendable {
    /// A tool as the model sees it.
    struct Tool: Equatable, Sendable {
        var name: String
        var description: String
        var schema: JSONValue
    }

    var model: String
    var system: String
    /// The conversation in the API's own shape: `{"role": …, "content": …}`.
    var messages: [JSONValue]
    var tools: [Tool] = []
    /// Tools the API runs itself (Google Search), in the API's own shape.
    var serverTools: [JSONValue] = []
    /// When set, the answer is JSON that fits this schema.
    var answerSchema: JSONValue? = nil
    /// The most tokens the answer may take; nil for the model's own limit.
    var maxOutput: Int? = nil
    /// How long to wait for the answer, in seconds; nil for the client's usual limit. Quick steps give up sooner and let code carry on.
    var timeout: TimeInterval? = nil
    /// How hard to think: low (no thinking, for sorting a sentence) or the model's default.
    var effort = "medium"
}

/// What came back.
struct ModelReply: Equatable, Sendable {
    /// A tool the model wants run.
    struct ToolCall: Equatable, Sendable {
        var id: String
        var name: String
        var input: JSONValue
    }

    /// Why it stopped: end_turn, tool_use, max_tokens, malformed or refusal.
    var stopReason: String
    /// The answer as blocks (text, tool_use), each keeping the API's own part
    /// under `part`. They go back unchanged in the next request of a tool loop.
    var content: [JSONValue]
    /// The pages a web search behind the answer came from: `{uri, title}` each.
    var sources: [JSONValue] = []

    var text: String {
        content.filter { $0["type"]?.string == "text" }.compactMap { $0["text"]?.string }.joined()
    }

    var toolCalls: [ToolCall] {
        content.filter { $0["type"]?.string == "tool_use" }.compactMap { block in
            guard let id = block["id"]?.string, let name = block["name"]?.string else { return nil }
            return ToolCall(id: id, name: name, input: block["input"] ?? .object([:]))
        }
    }
}

/// Why a request to the model failed. None of these carries the key.
enum ModelFailure: Error, Equatable {
    /// No key is connected.
    case noKey
    /// The key was refused (401 or 403).
    case keyRefused
    /// Too many requests, or the key's spending limit.
    case limited
    /// The service is busy or down, also after one more try.
    case unavailable
    /// The request was refused as invalid; the API's own message.
    case invalid(String)
    /// No answer: offline or timed out.
    case unreachable
    /// An answer that couldn't be read.
    case unreadable
}

/// Something that answers a `ModelRequest`: the Gemini API, or a script in tests.
protocol LanguageModel: Sendable {
    func reply(to request: ModelRequest) async throws(ModelFailure) -> ModelReply
}

extension LanguageModel {
    /// `reply(to:)` for callers that fall back when no answer comes: nil, with the failure in the log.
    func replyIfPossible(to request: ModelRequest) async -> ModelReply? {
        do {
            return try await reply(to: request)
        } catch {
            Logger.agent.notice("No answer from the model: \(String(describing: error), privacy: .public)")
            return nil
        }
    }
}
