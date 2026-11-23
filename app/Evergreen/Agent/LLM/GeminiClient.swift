import Foundation

/// Talks to Google's Gemini API (`generateContent`) over plain HTTPS with the
/// person's own key. The key goes in the `x-goog-api-key` header of requests
/// to generativelanguage.googleapis.com and nowhere else: never in the
/// address, never logged, never part of an error.
///
/// The app's requests are written in one neutral shape (`ModelRequest`);
/// this turns them into the API's own and back. Every field sent is one the
/// API documents or the working client this was modelled on sends:
/// `contents`, `systemInstruction`, `tools` (function declarations or Google
/// Search), and `generationConfig` with `temperature`, `responseMimeType`,
/// `responseSchema`, `maxOutputTokens` and, for steps that need no thinking, `thinkingConfig.thinkingBudget`.
struct GeminiClient: LanguageModel {
    let key: String
    var session: URLSession = GeminiClient.privateSession
    /// Counts calls and tokens, for the Status section of Settings.
    var usage: AIUsage? = nil

    static let host = "generativelanguage.googleapis.com"
    /// A session that keeps nothing: no cache on disk, no cookies, no stored credentials.
    static let privateSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }()
    /// No request waits longer than this; the working card also has Cancel.
    static let timeout: TimeInterval = 30
    /// How long to wait before the one retry of a step that runs behind the screen (the plan, the memory update).
    var retryDelay: Duration = .seconds(2)
    /// The same for a quick step the person is waiting on (sorting a sentence, reading its intent).
    var quickRetryDelay: Duration = .milliseconds(500)
    /// A step with a time limit up to this is a quick one.
    static let quickLimit: TimeInterval = 10
    /// The longest a quick step keeps the person waiting, both tries and the pause together.
    static let quickBudget: TimeInterval = 12
    /// A second try of a quick step gets at least this long.
    static let shortestRetry: TimeInterval = 3

    static func endpoint(_ model: String) -> URL {
        URL(string: "https://\(host)/v1beta/models/\(model):generateContent")!
    }

    /// One request, and one more try when no answer came for a passing reason: a timeout, no network, too many
    /// requests (429) or a server error. A refused key or a refused request is never tried again. A quick step's
    /// second try gets what is left of twelve seconds; a step behind the screen waits two seconds and tries with its own limit.
    func reply(to request: ModelRequest) async throws(ModelFailure) -> ModelReply {
        let started = ContinuousClock().now
        var passing = false
        do {
            return try await send(request, passing: &passing)
        } catch {
            guard passing, !Task.isCancelled else { throw error }
            var again = request
            if let limit = request.timeout, limit <= Self.quickLimit {
                try? await Task.sleep(for: quickRetryDelay)
                let spent = (ContinuousClock().now - started).components
                let left = Self.quickBudget - Double(spent.seconds) - Double(spent.attoseconds) / 1e18
                again.timeout = min(limit, max(Self.shortestRetry, left))
            } else {
                try? await Task.sleep(for: retryDelay)
            }
            guard !Task.isCancelled else { throw error }
            var stillPassing = false
            do {
                return try await send(again, passing: &stillPassing)
            } catch let second {
                // The same trouble twice is reported as it first was; a different, lasting one (a refused key) as itself.
                throw stillPassing ? error : second
            }
        }
    }

    // MARK: Request

    /// The request as it goes over the wire.
    static func body(_ request: ModelRequest) -> JSONValue {
        var config: [String: JSONValue] = ["temperature": 0]
        if let schema = request.answerSchema {
            config["responseMimeType"] = "application/json"
            config["responseSchema"] = responseSchema(schema)
        }
        // Sorting a sentence needs no thinking; everything else is left to the model's default.
        if request.effort == "low" { config["thinkingConfig"] = ["thinkingBudget": 0] }
        if let most = request.maxOutput { config["maxOutputTokens"] = .number(Double(most)) }
        var body: [String: JSONValue] = [
            "contents": .array(contents(request.messages)),
            "generationConfig": .object(config),
        ]
        if !request.system.isEmpty { body["systemInstruction"] = ["parts": [["text": .string(request.system)]]] }
        var tools = request.serverTools
        if !request.tools.isEmpty {
            tools.append(["functionDeclarations": .array(request.tools.map { tool in
                var declaration: [String: JSONValue] = ["name": .string(tool.name), "description": .string(tool.description)]
                // A tool that takes nothing is declared without parameters.
                if tool.schema["properties"]?.object?.isEmpty == false { declaration["parameters"] = parameters(tool.schema) }
                return .object(declaration)
            })])
        }
        if !tools.isEmpty { body["tools"] = .array(tools) }
        return .object(body)
    }

    /// The conversation as `contents`: the model's own parts go back exactly
    /// as they came (a part may carry a thought signature that must not
    /// change), and each tool result becomes a `functionResponse` named after its call.
    static func contents(_ messages: [JSONValue]) -> [JSONValue] {
        var names: [String: String] = [:], sentIds: Set<String> = []
        return messages.map { message in
            let role: JSONValue = message["role"]?.string == "assistant" ? "model" : "user"
            if let text = message["content"]?.string { return ["role": role, "parts": [["text": .string(text)]]] }
            let parts = (message["content"]?.array ?? []).compactMap { block -> JSONValue? in
                switch block["type"]?.string {
                case "tool_use":
                    if let id = block["id"]?.string, let name = block["name"]?.string { names[id] = name }
                    if let id = block["id"]?.string, block["part"]?["functionCall"]?["id"] != nil { sentIds.insert(id) }
                    return block["part"] ?? ["functionCall": ["name": block["name"] ?? "", "args": block["input"] ?? [:]]]
                case "tool_result":
                    let id = block["tool_use_id"]?.string ?? ""
                    let said: JSONValue = block["is_error"] == .bool(true) ? ["error": block["content"] ?? ""] : ["result": block["content"] ?? ""]
                    var response: [String: JSONValue] = ["name": .string(names[id] ?? ""), "response": said]
                    // The call's own id goes back with its result, when the API gave one.
                    if sentIds.contains(id) { response["id"] = .string(id) }
                    return ["functionResponse": .object(response)]
                default:
                    return block["part"] ?? block["text"].map { ["text": $0] }
                }
            }
            return ["role": role, "parts": .array(parts)]
        }
    }

    /// A JSON Schema as the API's `responseSchema`: upper-case types, and
    /// only `properties`, `required`, `items`, `enum` and `description`. What
    /// is left out is still checked on the phone against the full schema.
    static func responseSchema(_ schema: JSONValue) -> JSONValue {
        reduced(schema, upperCase: true)
    }

    /// The same subset with JSON's own lower-case types, for a function's `parameters`.
    static func parameters(_ schema: JSONValue) -> JSONValue {
        reduced(schema, upperCase: false)
    }

    private static func reduced(_ schema: JSONValue, upperCase: Bool) -> JSONValue {
        guard case .object(let fields) = schema else { return schema }
        var kept: [String: JSONValue] = [:]
        // A type that may also be null is sent as the type itself.
        let type = fields["type"]?.string ?? fields["type"]?.array?.compactMap(\.string).first { $0 != "null" }
        if let type { kept["type"] = .string(upperCase ? type.uppercased() : type) }
        if let description = fields["description"] { kept["description"] = description }
        if let values = fields["enum"] { kept["enum"] = values }
        if let required = fields["required"]?.array, !required.isEmpty { kept["required"] = .array(required) }
        if let items = fields["items"] { kept["items"] = reduced(items, upperCase: upperCase) }
        if let properties = fields["properties"]?.object {
            // A free-form object (no named properties) can't be described to the API, so that field is left out of what is asked for.
            let named = properties.filter { !isFreeForm($0.value) }
            kept["properties"] = .object(named.mapValues { reduced($0, upperCase: upperCase) })
            if let required = kept["required"]?.array {
                let still = required.filter { named[$0.string ?? ""] != nil }
                kept["required"] = still.isEmpty ? nil : .array(still)
            }
        }
        return .object(kept)
    }

    private static func isFreeForm(_ schema: JSONValue) -> Bool {
        let type = schema["type"]?.string ?? schema["type"]?.array?.compactMap(\.string).first { $0 != "null" }
        return type == "object" && (schema["properties"]?.object ?? [:]).isEmpty
    }

    // MARK: Sending

    private func send(_ request: ModelRequest, passing: inout Bool) async throws(ModelFailure) -> ModelReply {
        guard !key.isEmpty else { throw .noKey }
        var http = URLRequest(url: Self.endpoint(request.model), timeoutInterval: request.timeout ?? Self.timeout)
        http.httpMethod = "POST"
        http.setValue("application/json", forHTTPHeaderField: "Content-Type")
        http.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        http.httpBody = try? JSONEncoder().encode(Self.body(request))
        let answer = try await Self.answer(to: http, session: session, passing: &passing)
        let reply = try Self.reply(from: answer)
        await usage?.count(input: Int(answer["usageMetadata"]?["promptTokenCount"]?.number ?? 0),
                           output: Int(answer["usageMetadata"]?["candidatesTokenCount"]?.number ?? 0),
                           thinking: Int(answer["usageMetadata"]?["thoughtsTokenCount"]?.number ?? 0))
        return reply
    }

    /// Sends a request and reads the answer or the failure. Shared with the model list call.
    static func answer(to http: URLRequest, session: URLSession) async throws(ModelFailure) -> JSONValue {
        var passing = false
        return try await answer(to: http, session: session, passing: &passing)
    }

    /// The same; `passing` is set when the failure is one that may be gone a moment later.
    static func answer(to http: URLRequest, session: URLSession, passing: inout Bool) async throws(ModelFailure) -> JSONValue {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: http)
        } catch {
            // A timeout or no network: no answer came. A cancelled request is the person's own doing.
            passing = (error as? URLError)?.code != .cancelled
            throw .unreachable
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        passing = [408, 429, 499].contains(status) || status >= 500
        let answer = try? JSONDecoder().decode(JSONValue.self, from: data)
        let message = answer?["error"]?["message"]?.string ?? ""
        switch status {
        case 200..<300:
            guard let answer else { throw .unreadable }
            return answer
        case 401, 403:
            throw .keyRefused
        case 400 where message.localizedCaseInsensitiveContains("API key"):
            // A key the API doesn't know comes back as an invalid request.
            throw .keyRefused
        case 402, 429:
            throw .limited
        case 408, 499, 500...:
            throw .unavailable
        default:
            throw .invalid(message.isEmpty ? "The request was refused (\(status))." : message)
        }
    }

    /// The answer in the app's own shape. Each block keeps the API's part as
    /// it came, so it can be sent back unchanged.
    static func reply(from answer: JSONValue) throws(ModelFailure) -> ModelReply {
        if answer["promptFeedback"]?["blockReason"] != nil { return ModelReply(stopReason: "refusal", content: []) }
        guard let candidate = answer["candidates"]?.array?.first else { throw .unreadable }
        var calls = 0
        let content = (candidate["content"]?["parts"]?.array ?? []).compactMap { part -> JSONValue? in
            if let call = part["functionCall"] {
                calls += 1
                return ["type": "tool_use", "id": call["id"] ?? .string("call_\(calls)"), "name": call["name"] ?? "",
                        "input": call["args"] ?? [:], "part": part]
            }
            // Thinking is not part of the answer, but goes back with the turn.
            if part["thought"] == .bool(true) { return ["type": "thinking", "part": part] }
            return part["text"].map { ["type": "text", "text": $0, "part": part] } ?? ["type": "other", "part": part]
        }
        let sources = (candidate["groundingMetadata"]?["groundingChunks"]?.array ?? []).compactMap { $0["web"] }
        let stop: String = switch candidate["finishReason"]?.string {
        case _ where calls > 0: "tool_use"
        case "STOP", nil: "end_turn"
        case "MAX_TOKENS": "max_tokens"
        case "MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "TOO_MANY_TOOL_CALLS": "malformed"
        default: "refusal"
        }
        return ModelReply(stopReason: stop, content: content, sources: sources)
    }

    // MARK: The account's models

    /// The models this key can use for `generateContent`, by id ("gemini-3.8-flash"). Also the check that a key works.
    static func models(key: String, session: URLSession = GeminiClient.privateSession) async throws(ModelFailure) -> [String] {
        guard !key.isEmpty else { throw .noKey }
        var http = URLRequest(url: URL(string: "https://\(host)/v1beta/models")!, timeoutInterval: 30)
        http.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        let answer = try await answer(to: http, session: session)
        return (answer["models"]?.array ?? []).filter { model in
            model["supportedGenerationMethods"]?.array?.contains("generateContent") ?? true
        }.compactMap { $0["name"]?.string?.replacing("models/", with: "") }.sorted()
    }
}
