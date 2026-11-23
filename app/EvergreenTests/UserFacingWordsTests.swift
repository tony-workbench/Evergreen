import Foundation
import Testing

/// Nothing the person can read says "demo" or "scenario", names Amplitude, or
/// names one of the old sample people. Scans every
/// string literal in the app's Swift sources; identifiers and file names that are never shown are listed below.
struct UserFacingWordsTests {
    /// Keys, URL schemes, ids and log lines: read by code or developers, never shown.
    static let allowed: Set<String> = [
        "evergreen-demo", "trackerplusplus-demo",          // URL schemes of the test meeting older builds left on the calendar
        "memoryDemoModel",                                  // a function of the memory bundle
    ]

    static let app = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "Evergreen")

    /// The string literals on one line of Swift, comments left out.
    static func literals(in line: String) -> [String] {
        let code = line.trimmingCharacters(in: .whitespaces)
        guard !code.hasPrefix("//") else { return [] }
        return code.matches(of: /"((?:[^"\\]|\\.)*)"/).map { String($0.1) }
    }

    static func forbidden(_ text: String) -> Bool {
        let lower = text.lowercased()
        let words = Set(lower.split(whereSeparator: { !$0.isLetter }).map(String.init))
        let namesSomeone = !words.isDisjoint(with: ["sam", "alex", "jordan"])
        return (lower.contains("demo") || lower.contains("scenario") || lower.contains("amplitude") || namesSomeone)
            && !allowed.contains(text)
    }

    @Test func noStringInTheAppSaysDemoOrAmplitude() throws {
        let files = try #require(FileManager.default.enumerator(at: Self.app, includingPropertiesForKeys: nil))
        var checked = 0
        var found: [String] = []
        for case let file as URL in files where file.pathExtension == "swift" {
            checked += 1
            for (number, line) in try String(contentsOf: file, encoding: .utf8).split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
                for literal in Self.literals(in: String(line)) where Self.forbidden(literal) {
                    found.append("\(file.lastPathComponent):\(number + 1): \(literal)")
                }
            }
        }
        #expect(checked > 50)
        #expect(found.isEmpty, "\(found.joined(separator: "\n"))")
    }

    @Test func theScanSeesWhatItShould() {
        #expect(Self.literals(in: #"Text("Demo store. Nothing is charged.")"#) == ["Demo store. Nothing is charged."])
        #expect(Self.literals(in: #"    /// "Demo Gym" in a comment"#).isEmpty)
        #expect(Self.forbidden("Demo store") && Self.forbidden("Sent to Amplitude"))
        #expect(!Self.forbidden("evergreen-demo") && !Self.forbidden("Preview order"))
        #expect(Self.forbidden("Scenario controls") && Self.forbidden("Jordan's fit notes") && Self.forbidden("Sam’s walk"))
        #expect(!Self.forbidden("the same time") && !Self.forbidden("Your fit notes"))
    }
}
