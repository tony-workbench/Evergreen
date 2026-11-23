import Foundation
import JavaScriptCore

/// Runs one of the engine bundles (memory, plan rules, calendar) in
/// JavaScriptCore. Every engine works the same way: its functions are
/// globals that take one JSON string and return one JSON string, and never
/// throw; a failure is `{"ok": false, "error": {"code", "text"}}`.
actor JSBundle {
    private let resource: String
    private let bundle: Bundle
    private let prepare: @Sendable (JSContext) -> Void
    /// Loaded at the first call, on this actor, so nothing waits for it at launch.
    private lazy var context: JSContext? = load()

    /// `prepare` runs on the fresh context before the script, for a host object the bundle expects to find.
    init(resource: String, bundle: Bundle = .main, prepare: @escaping @Sendable (JSContext) -> Void = { _ in }) {
        self.resource = resource
        self.bundle = bundle
        self.prepare = prepare
    }

    /// Whether the bundle loaded and sets every one of these globals.
    func has(_ globals: [String]) -> Bool {
        guard let context else { return false }
        return globals.allSatisfy { context.objectForKeyedSubscript($0)?.isObject == true }
    }

    /// A fresh context with the bundle's script evaluated; nil when the script is missing or throws.
    private func load() -> JSContext? {
        guard let url = bundle.url(forResource: resource, withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8), let context = JSContext()
        else { return nil }
        prepare(context)
        context.evaluateScript(script)
        return context.exception == nil ? context : nil
    }

    /// Calls a global. A missing bundle, a missing global or an answer that can't be read comes back as an error value, like the engine's own failures.
    func call(_ name: String, _ arguments: JSONValue = [:]) -> JSONValue {
        guard let function = context?.objectForKeyedSubscript(name), function.isObject,
              let answer = function.call(withArguments: [arguments.text])?.toString().flatMap(JSONValue.parse)
        else { return ["ok": false, "error": ["code": "NoAnswer", "text": "That didn’t work just now."]] }
        return answer
    }
}

extension JSONValue {
    /// Whether an engine's answer is a success.
    var isOK: Bool { self["ok"] == .bool(true) }

    /// Any Codable value as JSON.
    static func from(_ value: some Encodable) -> JSONValue {
        (try? JSONEncoder().encode(value)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } ?? .null
    }

    /// This JSON as a Codable value; nil when it doesn't fit.
    func decoded<T: Decodable>(_ type: T.Type = T.self) -> T? {
        (try? JSONEncoder().encode(self)).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }
}
