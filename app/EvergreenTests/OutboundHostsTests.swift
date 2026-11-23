import Foundation
import Testing
@testable import Evergreen

/// The app talks to one AI service. Every web address in the app's sources
/// and in the three bundled engines is checked against a short list: the
/// Gemini endpoint and the keyless forecast. Two more are only ever opened
/// in the browser by the person (where a key comes from), never called.
struct OutboundHostsTests {
    /// Hosts the app itself sends requests to.
    static let called: Set<String> = ["generativelanguage.googleapis.com", "api.open-meteo.com"]
    /// Hosts only opened in Safari from a button the person taps.
    static let opened: Set<String> = ["aistudio.google.com"]

    static func hosts(in text: String) -> Set<String> {
        Set(text.matches(of: /https?:\/\/([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/).map { String($0.1).lowercased() })
    }

    static func scan(_ extensions: [String]) throws -> (found: [String: Set<String>], scanned: Int, text: String) {
        let files = try #require(FileManager.default.enumerator(at: UserFacingWordsTests.app, includingPropertiesForKeys: nil))
        var found: [String: Set<String>] = [:]
        var scanned = 0, all = ""
        for case let file as URL in files where extensions.contains(file.pathExtension) {
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            scanned += 1
            all += text
            for host in hosts(in: text) { found[host, default: []].insert(file.lastPathComponent) }
        }
        return (found, scanned, all)
    }

    @Test func theAppCanOnlyReachGeminiAndTheForecast() throws {
        let app = try Self.scan(["swift", "plist"])
        #expect(app.scanned > 100)
        // Addresses that are only names in XML headers, not places anything is sent.
        let inert: Set<String> = ["www.apple.com", "developer.apple.com", "www.w3.org"]
        let others = app.found.keys.filter { !Self.called.contains($0) && !Self.opened.contains($0) && !inert.contains($0) }.sorted()
        #expect(others.isEmpty, "\(others.map { "\($0) in \(app.found[$0]!.sorted())" })")
        // The two it calls are each called from one place only.
        #expect(GeminiClient.host == "generativelanguage.googleapis.com")
        #expect(app.found["generativelanguage.googleapis.com"] == nil || app.found["generativelanguage.googleapis.com"] == ["GeminiClient.swift"])
        #expect(app.found["api.open-meteo.com"] == ["ForecastClient.swift"])
        #expect(app.found["aistudio.google.com"] == ["ConnectAIView.swift"])
    }

    @Test func theBundledEnginesCannotReachAnything() throws {
        let engines = try Self.scan(["js"])
        #expect(engines.scanned == 3)
        // They run in JavaScriptCore, which has no network; and they don't ask for one.
        for api in ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "importScripts", "EventSource"] {
            #expect(!engines.text.contains(api), "\(api) in a bundle")
        }
        // No web address is in them at all, even as data.
        let others = engines.found.keys.sorted()
        #expect(others.isEmpty, "\(others.count) hosts, such as \(others.prefix(3))")
    }

    @Test func noOtherServiceIsNamedAnywhereInTheApp() throws {
        let files = try #require(FileManager.default.enumerator(at: UserFacingWordsTests.app, includingPropertiesForKeys: nil))
        let names = ["anthropic", "claude", "openai", "superlinked", "senso", "nimble", "singlestore", "amplitude", "harness"]
        var found: [String] = []
        // ShownText lists words a model must not say to the person; that list is the one place such a word may be written.
        for case let file as URL in files where file.pathExtension == "swift" && file.lastPathComponent != "ShownText.swift" {
            let text = (try? String(contentsOf: file, encoding: .utf8))?.lowercased() ?? ""
            for name in names where text.range(of: "\\b\(name)\\b", options: .regularExpression) != nil {
                found.append("\(name) in \(file.lastPathComponent)")
            }
        }
        #expect(found.isEmpty, "\(found)")
    }
}
