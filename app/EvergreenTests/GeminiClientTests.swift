import Foundation
import SwiftData
import Testing
@testable import Evergreen

/// The request to the Gemini API: its shape, where it goes, where the key is
/// and isn't, and what each kind of answer becomes. A fake network with
/// Gemini-shaped answers; nothing is sent.
@Suite(.serialized)
struct GeminiClientTests {
    static let key = "AIza-test-not-a-real-key-9f3a"
    static let ok = #"{"candidates":[{"content":{"role":"model","parts":[{"text":"Hello."}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3,"totalTokenCount":15}}"#
    static let models = #"{"models":[{"name":"models/gemini-3.8-flash","supportedGenerationMethods":["generateContent"]},{"name":"models/gemini-3.8-pro","supportedGenerationMethods":["generateContent","countTokens"]},{"name":"models/embedding-2","supportedGenerationMethods":["embedContent"]}]}"#

    static func request(schema: JSONValue? = nil, effort: String = "medium") -> ModelRequest {
        ModelRequest(model: AIModels.standard, system: "Be brief.", messages: [["role": "user", "content": "Hi"]],
                     tools: schema == nil ? [.init(name: "memory_brief", description: "Reads memory.", schema: ClosureTool.noInput),
                                             .init(name: "stop_memory", description: "Stops a line.", schema: ClosureTool.strings(["key": "The key"]))] : [],
                     answerSchema: schema, effort: effort)
    }

    @Test func theRequestGoesOnlyToGoogleWithTheKeyInItsHeaderAndNeverInTheAddress() async throws {
        let usage = AIUsage(defaults: nil)
        let client = GeminiClient(key: Self.key, session: FakeAPI.session([.init(status: 200, body: Self.ok)]), usage: usage)
        let reply = try await client.reply(to: Self.request())
        #expect(reply.text == "Hello." && reply.stopReason == "end_turn")

        let sent = try #require(FakeAPI.requests.first)
        #expect(FakeAPI.requests.count == 1)
        let address = sent.request.url?.absoluteString ?? ""
        #expect(address == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent")
        #expect(sent.request.url?.query() == nil && address.contains(Self.key) == false)
        #expect(sent.request.httpMethod == "POST")
        #expect(sent.request.value(forHTTPHeaderField: "x-goog-api-key") == Self.key)
        // The key is in that one header: not in the body or any other header.
        #expect(!String(decoding: sent.body, as: UTF8.self).contains(Self.key))
        let others = (sent.request.allHTTPHeaderFields ?? [:]).filter { $0.key.lowercased() != "x-goog-api-key" }
        #expect(!others.values.contains { $0.contains(Self.key) })
        // The call and its tokens are counted.
        #expect(await usage.day() == AIUsage.Day(day: await usage.day().day, calls: 1, input: 12, output: 3))
    }

    @Test func theBodyUsesOnlyTheFieldsTheAPIDocuments() throws {
        let body = GeminiClient.body(Self.request())
        #expect(Set(body.object?.keys.map(\.self) ?? []) == ["contents", "generationConfig", "systemInstruction", "tools"])
        #expect(body["contents"] == [["role": "user", "parts": [["text": "Hi"]]]])
        #expect(body["systemInstruction"] == ["parts": [["text": "Be brief."]]])
        #expect(body["generationConfig"] == ["temperature": 0])
        let declared = try #require(body["tools"]?.array?.first?["functionDeclarations"]?.array)
        // A tool that takes nothing has no parameters; the other has JSON's own lower-case types and no extra keywords.
        #expect(declared[0] == ["name": "memory_brief", "description": "Reads memory."])
        #expect(declared[1]["parameters"] == ["type": "object", "properties": ["key": ["type": "string", "description": "The key"]], "required": ["key"]])

        // A structured answer: JSON with the schema in the API's subset; sorting a sentence turns thinking off.
        let sorted = GeminiClient.body(Self.request(schema: Router.schema, effort: "low"))
        #expect(sorted["tools"] == nil)
        #expect(sorted["generationConfig"]?["responseMimeType"]?.string == "application/json")
        #expect(sorted["generationConfig"]?["thinkingConfig"] == ["thinkingBudget": 0])
        #expect(sorted["generationConfig"]?["responseSchema"] == ["type": "OBJECT", "required": ["agent"], "properties": [
            "agent": ["type": "STRING", "enum": ["calendar", "plan", "week", "memory", "none"]],
        ]])
    }

    @Test func aSchemaIsReducedToWhatTheAPIAccepts() {
        let schema: JSONValue = ["type": "object", "additionalProperties": false, "required": ["confidence"], "properties": [
            "confidence": ["type": "number", "minimum": 0, "maximum": 1, "description": "0 to 1"],
            "note": ["type": ["string", "null"], "minLength": 1, "pattern": "^a"],
            "items": ["type": "array", "minItems": 1, "items": ["type": "object", "additionalProperties": false, "properties": ["n": ["type": "integer"]]]],
        ]]
        #expect(GeminiClient.responseSchema(schema) == ["type": "OBJECT", "required": ["confidence"], "properties": [
            "confidence": ["type": "NUMBER", "description": "0 to 1"],
            "note": ["type": "STRING"],
            "items": ["type": "ARRAY", "items": ["type": "OBJECT", "properties": ["n": ["type": "INTEGER"]]]],
        ]])
    }

    @Test func aFunctionCallComesBackAsAToolCallAndItsPartGoesBackUnchanged() throws {
        let answer = try #require(JSONValue.parse(#"{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"stop_memory","args":{"key":"k1"},"id":"fc_7"},"thoughtSignature":"c2ln"}]},"finishReason":"STOP"}]}"#))
        let reply = try GeminiClient.reply(from: answer)
        #expect(reply.stopReason == "tool_use")
        #expect(reply.toolCalls == [.init(id: "fc_7", name: "stop_memory", input: ["key": "k1"])])

        // The next request: the question, the model's turn exactly as it came, and the result named after its call.
        let contents = GeminiClient.contents([
            ["role": "user", "content": "Stop Sunday runs"],
            ["role": "assistant", "content": .array(reply.content)],
            ["role": "user", "content": [["type": "tool_result", "tool_use_id": "fc_7", "content": "Stopped.", "is_error": false]]],
        ])
        #expect(contents[1] == ["role": "model", "parts": [["functionCall": ["name": "stop_memory", "args": ["key": "k1"], "id": "fc_7"], "thoughtSignature": "c2ln"]]])
        #expect(contents[2] == ["role": "user", "parts": [["functionResponse": ["name": "stop_memory", "id": "fc_7", "response": ["result": "Stopped."]]]]])

        // A call without an id gets one for the loop, and no id is sent back for it; an error is said as one.
        let plain = try GeminiClient.reply(from: try #require(JSONValue.parse(#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"memory_brief","args":{}}}]}}]}"#)))
        #expect(plain.toolCalls.first?.id == "call_1")
        let back = GeminiClient.contents([["role": "assistant", "content": .array(plain.content)],
                                          ["role": "user", "content": [["type": "tool_result", "tool_use_id": "call_1", "content": "No.", "is_error": true]]]])
        #expect(back[1]["parts"] == [["functionResponse": ["name": "memory_brief", "response": ["error": "No."]]]])
    }

    @Test func blockedCutOffAndMalformedAnswersAreNotReadAsAnswers() throws {
        func stop(_ json: String) throws -> String { try GeminiClient.reply(from: try #require(JSONValue.parse(json))).stopReason }
        #expect(try stop(#"{"candidates":[{"content":{"parts":[{"text":"Half"}]},"finishReason":"MAX_TOKENS"}]}"#) == "max_tokens")
        #expect(try stop(#"{"candidates":[{"finishReason":"SAFETY"}]}"#) == "refusal")
        #expect(try stop(#"{"candidates":[{"finishReason":"MALFORMED_FUNCTION_CALL"}]}"#) == "malformed")
        #expect(try stop(#"{"promptFeedback":{"blockReason":"SAFETY"}}"#) == "refusal")
        #expect(throws: ModelFailure.unreadable) { try GeminiClient.reply(from: ["candidates": []]) }
        // Thinking parts aren't part of the answer's text.
        let thought = try GeminiClient.reply(from: try #require(JSONValue.parse(#"{"candidates":[{"content":{"parts":[{"text":"hmm","thought":true},{"text":"Yes."}]},"finishReason":"STOP"}]}"#)))
        #expect(thought.text == "Yes.")
    }

    @Test(arguments: [(403, #"{"error":{"code":403,"message":"Permission denied.","status":"PERMISSION_DENIED"}}"#, ModelFailure.keyRefused),
                      (400, #"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#, .keyRefused),
                      (429, #"{"error":{"code":429,"message":"Quota exceeded.","status":"RESOURCE_EXHAUSTED"}}"#, .limited),
                      (402, #"{"error":{"code":402,"message":"Prepay credit depleted.","status":"RESOURCE_EXHAUSTED"}}"#, .limited),
                      (400, #"{"error":{"code":400,"message":"Bad input.","status":"INVALID_ARGUMENT"}}"#, .invalid("Bad input."))])
    func aRefusalBecomesAPlainFailureWithoutTheKey(status: Int, body: String, expected: ModelFailure) async {
        let client = GeminiClient(key: Self.key, session: FakeAPI.session([.init(status: status, body: body)]))
        await #expect(throws: expected) { try await client.reply(to: Self.request()) }
        #expect(!"\(expected)".contains(Self.key) && !AppModel.plain(expected).contains(Self.key) && !AppModel.keyProblem(expected).contains(Self.key))
    }

    /// A blip is tried once more; a refused key never is; two failures end with the first one's plain message.
    @Test func aPassingFailureIsTriedOnceMoreWithinTwelveSecondsAndARefusedKeyNeverIs() async throws {
        var quick = Self.request(schema: Router.schema, effort: "low")
        quick.timeout = Router.quick
        for blip in [429, 500, 503, 408] {
            var client = GeminiClient(key: Self.key, session: FakeAPI.session([.init(status: blip, body: "{}"), .init(status: 200, body: Self.ok)]))
            client.quickRetryDelay = .milliseconds(1)
            #expect(try await client.reply(to: quick).text == "Hello.", "\(blip)")
            #expect(FakeAPI.requests.count == 2, "\(blip)")
            // The second try gets what is left of the twelve seconds, never more than the step's own limit.
            let limits = FakeAPI.requests.map(\.request.timeoutInterval)
            #expect(limits[0] == Router.quick && limits[1] <= Router.quick && limits[1] >= GeminiClient.shortestRetry, "\(limits)")
        }
        // No network on the first try (the script's answer comes second).
        var client = GeminiClient(key: Self.key, session: FakeAPI.session([]))
        client.quickRetryDelay = .milliseconds(1)
        await #expect(throws: ModelFailure.unreachable) { try await client.reply(to: quick) }
        #expect(FakeAPI.requests.count == 2 && AppModel.plain(.unreachable) == "I couldn't reach your AI just now. Try again in a moment.")
        for refused in [401, 403] {
            client.session = FakeAPI.session([.init(status: refused, body: "{}"), .init(status: 200, body: Self.ok)])
            await #expect(throws: ModelFailure.keyRefused) { try await client.reply(to: quick) }
            #expect(FakeAPI.requests.count == 1, "\(refused)")
        }
        // A spent key (402) and a refused request (400) aren't passing either.
        for (status, failure) in [(402, ModelFailure.limited), (400, .invalid("The request was refused (400)."))] {
            client.session = FakeAPI.session([.init(status: status, body: "{}"), .init(status: 200, body: Self.ok)])
            await #expect(throws: failure) { try await client.reply(to: quick) }
            #expect(FakeAPI.requests.count == 1, "\(status)")
        }
        // Twice the same: the first failure's message. A blip and then a refused key: the key.
        client.session = FakeAPI.session([.init(status: 429, body: "{}"), .init(status: 503, body: "{}"), .init(status: 200, body: Self.ok)])
        await #expect(throws: ModelFailure.limited) { try await client.reply(to: quick) }
        #expect(FakeAPI.requests.count == 2)
        client.session = FakeAPI.session([.init(status: 503, body: "{}"), .init(status: 403, body: "{}")])
        await #expect(throws: ModelFailure.keyRefused) { try await client.reply(to: quick) }
        // A step behind the screen is tried again with its own limit.
        var slow = Self.request()
        slow.timeout = 60
        client.retryDelay = .milliseconds(1)
        client.session = FakeAPI.session([.init(status: 503, body: "{}"), .init(status: 200, body: Self.ok)])
        #expect(try await client.reply(to: slow).text == "Hello.")
        #expect(FakeAPI.requests.map(\.request.timeoutInterval) == [60, 60])
        #expect(GeminiClient.quickBudget == 12 && Router.quick + 0.5 + GeminiClient.shortestRetry < 12)
    }

    @Test func aBusyServiceIsTriedOnceMoreAndNoNetworkIsItsOwnFailure() async throws {
        var client = GeminiClient(key: Self.key, session: FakeAPI.session([.init(status: 503, body: "{}"), .init(status: 200, body: Self.ok)]))
        client.retryDelay = .milliseconds(1)
        #expect(try await client.reply(to: Self.request()).text == "Hello.")
        #expect(FakeAPI.requests.count == 2)
        client.session = FakeAPI.session([.init(status: 500, body: "{}"), .init(status: 503, body: "{}"), .init(status: 200, body: Self.ok)])
        await #expect(throws: ModelFailure.unavailable) { try await client.reply(to: Self.request()) }
        client.session = FakeAPI.session([])
        await #expect(throws: ModelFailure.unreachable) { try await client.reply(to: Self.request()) }
        client.session = FakeAPI.session([.init(status: 200, body: "not json")])
        await #expect(throws: ModelFailure.unreadable) { try await client.reply(to: Self.request()) }
    }

    @Test func withoutAKeychainTheKeyIsKeptSealedNeverAsPlainText() throws {
        let store = AIKey(account: "test-key-\(UUID().uuidString)")
        #expect(store.load() == nil && !store.save("   "))
        #expect(store.save("  \(Self.key)\n") && store.load() == Self.key)
        #expect(AIKey.lastFour(Self.key) == "…9f3a")
        // On a build with no Keychain the key is in a file: sealed, with its sealing key in an owner-only file beside it.
        if let sealed = try? String(contentsOf: store.sealedFile, encoding: .utf8) {
            #expect(sealed.hasPrefix("enc:v1:") && !sealed.contains(Self.key) && !sealed.contains("9f3a"))
            let attributes = try FileManager.default.attributesOfItem(atPath: store.boxKeyFile.path(percentEncoded: false))
            #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600 && (attributes[.size] as? NSNumber)?.intValue == 32)
            // A changed file, or another install's sealing key, opens nothing.
            #expect(store.open(String(sealed.dropLast(4)) + "AAAA") == nil)
            #expect(AIKey(account: "test-key-other-\(UUID().uuidString)").open(sealed) == nil)
        }
        // Sealing twice never gives the same bytes, and both open.
        let first = try #require(store.seal("secret")), second = try #require(store.seal("secret"))
        #expect(first != second && store.open(first) == "secret" && store.open(second) == "secret" && store.open("secret") == nil)
        store.remove()
        #expect(store.load() == nil)
        #expect(!FileManager.default.fileExists(atPath: store.sealedFile.path(percentEncoded: false)))
        #expect(!FileManager.default.fileExists(atPath: store.boxKeyFile.path(percentEncoded: false)))
    }

    @Test func oneModelForEveryStepAndOnlyAModelIdCanBeChosen() throws {
        let defaults = try #require(UserDefaults(suiteName: "models-\(UUID().uuidString)"))
        #expect(AIModels.model(defaults: defaults) == "gemini-3.8-flash")
        defaults.set(" gemini-3.8-pro ", forKey: AIModels.settingKey)
        #expect(AIModels.model(defaults: defaults) == "gemini-3.8-pro")
        defaults.set("x:generateContent?key=1", forKey: AIModels.settingKey)
        #expect(AIModels.model(defaults: defaults) == "gemini-3.8-flash")
    }

    @MainActor @Test func checkConnectionSavesOnlyAKeyGoogleAcceptsAndSaysWhatWentWrong() async throws {
        let store = AIKey(account: "test-key-\(UUID().uuidString)")
        let model = AppModel(context: try SuggestionTests.container().mainContext, memory: nil, aiKey: store)
        #expect(!model.aiConnected && model.languageModel == nil)
        #expect(await model.connectAI(key: " ") == "Paste your key first.")

        let refused = #"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#
        for (answers, said) in [([FakeAPI.Answer(status: 400, body: refused)], "didn’t accept that key"), ([.init(status: 429, body: "{}")], "hit its limit"),
                                ([], "couldn’t reach Google")] {
            model.aiSession = FakeAPI.session(answers)
            let problem = try #require(await model.connectAI(key: Self.key))
            #expect(problem.contains(said) && !problem.contains(Self.key) && !problem.contains("9f3a"))
            #expect(!model.aiConnected && store.load() == nil && model.aiModels.isEmpty)
        }

        model.aiSession = FakeAPI.session([.init(status: 200, body: Self.models)])
        #expect(await model.connectAI(key: "  \(Self.key)\n") == nil)
        #expect(model.aiConnected && model.aiKeyTail == "…9f3a" && store.load() == Self.key)
        // Only the models that can answer are offered, and the result line counts them.
        #expect(model.aiModels == ["gemini-3.8-flash", "gemini-3.8-pro"])
        #expect(AIServiceBlock.connected(saved: true, models: model.aiModels.count) == "Connected and saved · 2 models available")
        // The check was one request to Google's list of models, with the key in its header and not in the address.
        let sent = try #require(FakeAPI.requests.first)
        #expect(FakeAPI.requests.count == 1 && sent.request.url?.absoluteString == "https://generativelanguage.googleapis.com/v1beta/models")
        #expect(sent.request.value(forHTTPHeaderField: "x-goog-api-key") == Self.key)
        #expect(model.languageModel is GeminiClient && model.activity.first?.contains("AI connected: 2 models") == true)

        // Checking again with an empty field checks the saved key and keeps it.
        model.aiSession = FakeAPI.session([.init(status: 200, body: Self.models)])
        #expect(await model.connectAI(key: "") == nil && store.load() == Self.key)
        model.disconnectAI()
        #expect(!model.aiConnected && store.load() == nil && model.languageModel == nil && model.aiModels.isEmpty)
    }

    @Test func theKeyFromTheEnvironmentIsReadOnlyInDebugBuilds() throws {
        let source = try String(contentsOf: UserFacingWordsTests.app.appending(path: "Model/AppModel.swift"), encoding: .utf8)
        let parts = source.components(separatedBy: #"environment["GEMINI_API_KEY"]"#)
        #expect(parts.count == 2)
        // The one read sits between `#if DEBUG` and its `#endif`, so a release build never compiles it.
        #expect(parts[0].components(separatedBy: "#if DEBUG").count - parts[0].components(separatedBy: "#endif").count == 1)
        let all = try #require(FileManager.default.enumerator(at: UserFacingWordsTests.app, includingPropertiesForKeys: nil))
        for case let file as URL in all where file.pathExtension == "swift" && file.lastPathComponent != "AppModel.swift" {
            #expect(!(try String(contentsOf: file, encoding: .utf8)).contains("GEMINI_API_KEY"), "\(file.lastPathComponent)")
        }
    }
}

/// What Evergreen does by itself stops when its switch is off.
@MainActor
struct AutomaticTests {
    @Test func everySwitchIsOnUntilTurnedOff() throws {
        let defaults = try #require(UserDefaults(suiteName: "auto-\(UUID().uuidString)"))
        #expect(Automatic.allCases.allSatisfy { $0.isOn(defaults) == $0.startsOn })
        #expect(!Automatic.pickEachDay.isOn(defaults), "picking the time each day waits until it's turned on")
        defaults.set(false, forKey: Automatic.rain.rawValue)
        #expect(!Automatic.rain.isOn(defaults) && Automatic.shoes.isOn(defaults))
    }

    @Test func weeklySuggestionsAndTheDailyMemoryUpdateStopWhenSwitchedOff() async throws {
        let model = try await EngineTests.model()
        let defaults = try #require(UserDefaults(suiteName: "auto-\(UUID().uuidString)"))
        model.settings = defaults
        defaults.set(false, forKey: Automatic.week.rawValue)
        await model.loadSuggestionsIfNeeded()
        #expect(model.weekPlan == nil && model.weeksPlanned == 0)

        // Asked for by hand, the week is still planned; with the memory update off, the day isn't consolidated.
        defaults.set(false, forKey: Automatic.memory.rawValue)
        try await model.loadWeekPlan()
        #expect(model.weeksPlanned == 1 && model.lastMemoryUpdate == nil)
        let loop = try #require(model.orchestrator())
        #expect(await loop.memory.dailyRequest(now: model.now, outcomes: []) != nil)

        defaults.set(true, forKey: Automatic.memory.rawValue)
        try await model.loadWeekPlan(fresh: true)
        #expect(model.lastMemoryUpdate != nil && model.activity.contains { $0.contains("Memory updated") })
        #expect(await loop.memory.dailyRequest(now: model.now, outcomes: []) == nil)
    }

    @Test func callsAndTokensAreCountedPerDay() async {
        let usage = AIUsage(defaults: nil)
        let day = Date(timeIntervalSince1970: 1_800_000_000)
        await usage.count(input: 100, output: 20, now: day)
        await usage.count(input: 50, output: 5, now: day.addingTimeInterval(60))
        let counted = await usage.day(now: day.addingTimeInterval(120))
        #expect(counted.calls == 2 && counted.input == 150 && counted.output == 25)
        // The next day starts again.
        #expect(await usage.day(now: day.addingTimeInterval(86_400 * 2)).calls == 0)
    }
}
