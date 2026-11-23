import Foundation
import Testing
@testable import Evergreen

/// The three bundled engines write sentences the app shows as they are:
/// reasons, summaries, messages, and the `text` of an error. None of them may
/// say "demo", "scenario" or "persona", name one of the old sample people, or
/// name another provider. Scans every sentence written in the three files,
/// and checks what the engines actually answer with.
struct EngineWordsTests {
    static let files = ["Resources/Engines/calendar-phone.js", "Resources/Engines/recommend-phone.js", "Resources/Memory/memory-phone.js"]
    static let people: Set<String> = ["sam", "alex", "jordan"]
    static let providers: Set<String> = ["anthropic", "claude", "openai", "chatgpt", "superlinked", "senso", "nimble", "singlestore", "amplitude", "harness"]

    /// The forbidden word in a sentence, if there is one.
    static func forbidden(_ text: String) -> String? {
        let lower = text.lowercased()
        if let part = ["demo", "scenario", "persona"].first(where: lower.contains) { return part }
        let words = Set(lower.split(whereSeparator: { !$0.isLetter }).map(String.init))
        return words.intersection(people.union(providers)).sorted().first
    }

    /// The strings in JavaScript source that read as words for a person: quoted or in backticks, with a space in them
    /// and a letter. Keys, codes and field names (one word) are not sentences and never reach the screen.
    static func sentences(in source: String) -> [String] {
        let quoted = source.matches(of: /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/)
        return quoted.map { String($0.1 ?? $0.2 ?? $0.3 ?? "") }.filter { $0.contains(" ") && $0.contains(where: \.isLetter) }
    }

    /// Data of the shoe catalog that recommend-phone.js still carries. Only `recommendShoes` returns it, and the app never calls that.
    static func isCatalogData(_ sentence: String) -> Bool {
        ["Demo forecast", "Demo Gym day-pass policy", "Demo catalog"].contains(sentence) || sentence.hasPrefix("The Vaporfly 3, currently discounted")
    }

    @Test func noSentenceInTheBundledEnginesSaysAForbiddenWord() throws {
        var found: [String] = [], catalog: [String] = [], scanned = 0
        for file in Self.files {
            let source = try String(contentsOf: UserFacingWordsTests.app.appending(path: file), encoding: .utf8)
            let sentences = Self.sentences(in: source)
            // The scan reads each file's sentences: hundreds of them.
            #expect(sentences.count > 100, "\(file): \(sentences.count)")
            scanned += sentences.count
            for sentence in sentences {
                guard let word = Self.forbidden(sentence) else { continue }
                if Self.isCatalogData(sentence) { catalog.append(sentence) } else { found.append("\(file): “\(word)” in “\(sentence.prefix(120))”") }
            }
        }
        #expect(scanned > 1000)
        #expect(found.isEmpty, "\(found.joined(separator: "\n"))")
        #expect(catalog.isEmpty, "\(catalog)")
        // The app calls none of the functions that return that data.
        #expect(!BundlePlanRules.globals.contains("recommendShoes"))
    }

    @Test func theScanSeesWhatItShould() throws {
        let source = #"add('load_over_cap', null, 'This week adds up to more than your body is used to.', `shorten the week by ${n} min in total`); const k = "usual_slot"; say("Sam's demo week");"#
        #expect(Self.sentences(in: source) == ["This week adds up to more than your body is used to.", "shorten the week by ${n} min in total", "Sam's demo week"])
        #expect(Self.forbidden("Sam's week") == "sam" && Self.forbidden("A Demo forecast") == "demo" && Self.forbidden("Scenario two") == "scenario")
        #expect(Self.forbidden("Ask Claude") == "claude" && Self.forbidden("unknown_persona said") == "persona" && Self.forbidden("Sent to OpenAI.") == "openai")
        #expect(Self.forbidden("The same time as usual.") == nil && Self.forbidden("Your usual Friday 6 AM run.") == nil)
        // The real files hold the sentences the app is known to show.
        let rules = try String(contentsOf: UserFacingWordsTests.app.appending(path: Self.files[1]), encoding: .utf8)
        #expect(Self.sentences(in: rules).contains("This week adds up to more than your body is used to."))
    }

    /// Every string in an engine's answer, at any depth.
    static func strings(in value: JSONValue) -> [String] {
        switch value {
        case .string(let text): [text]
        case .array(let items): items.flatMap(strings)
        case .object(let fields): fields.values.flatMap(strings)
        default: []
        }
    }

    @Test @MainActor func whatTheEnginesAnswerWithHasNoForbiddenWord() async throws {
        let rig = try AppRig()
        let model = rig.model
        try await model.loadWeekPlan()
        let rules = try #require(model.planRules)
        var shown: [String] = []

        // The week: reasons and the summary; the limits; every violation of a week with a lot wrong with it.
        shown += model.plannedSessions.map(\.reason) + [model.weekPlan?.summary ?? ""]
        shown += await rules.planBrief(rows: model.memoryRows, now: model.now)
        var bad = model.plannedSessions.map { session in var session = session; session.minutes = 170; session.intensity = "hard"; session.basedOn = ["not-a-key"]; return session }
        bad += bad
        let violations = await rules.checkPlan(bad, summary: "", rows: model.memoryRows, now: model.now)
        #expect(Set(violations.map(\.code)).count >= 4)
        shown += violations.map(\.text)
        // Errors: each bundle asked for something it can't do.
        for (bundle, call) in [(AppModel.planBundle, "recommendWeek"), (AppModel.planBundle, "checkPlan"), (AppModel.calendarBundle, "calendarPlan"), (AppModel.calendarBundle, "calendarReplan")] {
            let answer = await bundle.call(call, ["now": "not a time", "persona": "sam"])
            #expect(answer["ok"] == .bool(false), "\(call)")
            shown += Self.strings(in: answer["error"] ?? [:])
        }
        // The calendar: typed sentences of each kind, and what it says back.
        try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        for sentence in ["Find me 30 minutes to walk tomorrow evening", "Move tomorrow’s run to the afternoon", "Shorten tomorrow’s run to 20 minutes",
                         "Cancel tomorrow’s run", "I’m racing a 10k on December 6", "Add a swim at 3am", "Move the long run"] {
            guard let result = await model.calendarEngine?.plan(request: sentence, memory: model.calendarMemory, now: model.now) else { continue }
            shown += [result.message] + result.proposed.flatMap { [$0.title, $0.reason] } + [result.question?.text ?? ""] + (result.question?.answers.map(\.label) ?? [])
        }
        // Memory: the table's statements and the lines of the brief.
        shown += model.memoryRows.map(\.statement) + model.memoryBrief.lines.map(\.sentence) + model.remembered.map(\.text)

        let said = shown.filter { !$0.isEmpty }
        #expect(said.count > 40)
        let wrong = said.compactMap { text in Self.forbidden(text).map { "“\($0)” in “\(text)”" } }
        #expect(wrong.isEmpty, "\(wrong.joined(separator: "\n"))")
    }
}
