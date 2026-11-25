import Foundation
@testable import Evergreen

/// A model that answers from a script and keeps every request it was sent.
actor ScriptedModel: LanguageModel {
    private var script: [Result<ModelReply, ModelFailure>]
    private let fallback: (@Sendable (ModelRequest) -> ModelReply)?
    private(set) var requests: [ModelRequest] = []

    init(_ script: [Result<ModelReply, ModelFailure>]) {
        self.script = script
        fallback = nil
    }

    /// Answers every request with a function of it.
    init(_ answer: @escaping @Sendable (ModelRequest) -> ModelReply) {
        script = []
        fallback = answer
    }

    func reply(to request: ModelRequest) async throws(ModelFailure) -> ModelReply {
        requests.append(request)
        if let fallback { return fallback(request) }
        guard !script.isEmpty else { throw .unavailable }
        return try script.removeFirst().get()
    }

    static func text(_ text: String, stop: String = "end_turn") -> Result<ModelReply, ModelFailure> {
        .success(ModelReply(stopReason: stop, content: [["type": "text", "text": .string(text)]]))
    }

    static func call(_ name: String, _ input: JSONValue = [:], id: String = "call_1") -> Result<ModelReply, ModelFailure> {
        .success(ModelReply(stopReason: "tool_use", content: [
            ["type": "thinking", "thinking": "", "signature": "sig"],
            ["type": "tool_use", "id": .string(id), "name": .string(name), "input": input],
        ]))
    }
}
