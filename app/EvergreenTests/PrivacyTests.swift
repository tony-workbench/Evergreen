import Foundation
import Testing
@testable import Evergreen

/// What the person is promised: "Forget everything" really empties what the
/// app knows and sends, and the key is never in anything the app shows or
/// keeps. The model here is the app's own client on a scripted network, so
/// the requests are the ones the app would really send, and the planned week
/// is kept in the model's own settings store, as the app keeps it.
@MainActor
struct PrivacyTests {
    /// Long and unlike anything else, so any part of it turning up is a leak.
    static let key = "AIzaSyT3stK3y-n0t-r3al-Zq8Xw2Lm5Vb7Nc"
    static let quietWeek = ScriptedNetwork.Answer.text(#"{"sessions":[],"summary":"A quiet week."}"#)

    // MARK: Forget everything

    @Test func forgetEverythingEmptiesWhatIsRememberedShownSentAndKept() async throws {
        let rig = try AppRig()
        let model = rig.model
        // The AI can't be used for the first week (a refused request), so it comes from the rules, with what it rests on.
        let network = rig.connect(key: Self.key, answers: [.error(400, "Request contains an invalid argument.")])
        try await model.loadWeekPlan()

        // Before: memory has lines, a suggestion names one of them, and the request carried the rows.
        let keys = model.memoryRows.filter(\.isUsable).map(\.key), statements = model.memoryRows.map(\.statement)
        #expect(keys.count >= 5 && !model.remembered.isEmpty)
        #expect(model.openSuggestions.contains { model.bases(for: $0).contains { $0.key != nil } })
        let first = try #require(network.requests.last?.body)
        #expect(keys.allSatisfy(first.contains))
        // Then the AI answers, and its week is kept for the next launch.
        network.then([Self.quietWeek])
        try await model.loadWeekPlan(fresh: true)
        #expect(model.weekCache != nil && WeekCache.load(from: rig.settings) != nil)
        #expect(network.requests.count == 2)

        await model.forget(.everything)

        // What I remember: nothing, in either group, and it says it is not remembering.
        #expect(model.remembered.isEmpty && model.memoryRows.filter(\.isUsable).isEmpty)
        #expect(model.memoryBrief.lines.isEmpty && model.memoryState.everythingForgotten && model.reviewRows.isEmpty)
        // The week on screen and the kept week are gone.
        #expect(model.weekPlan == nil && model.openSuggestions.isEmpty && model.sentToAI.isEmpty)
        #expect(model.weekCache == nil && WeekCache.load(from: rig.settings) == nil)

        // The next plan request (which can't be answered: the week comes from the rules) carries no row and no statement.
        try await model.loadWeekPlan()
        // Two before, then the plan request and its one more try.
        #expect(network.requests.count == 4)
        let next = try #require(network.requests.last?.body)
        #expect(!keys.contains(where: next.contains) && !statements.contains(where: next.contains), "\(next.prefix(600))")
        #expect(next.contains("(nothing yet)"))
        #expect(!keys.contains(where: model.sentToAI.contains) && !statements.contains(where: model.sentToAI.contains))
        // The suggestions that come back name no memory: no chip, no basis, no key.
        #expect(!model.openSuggestions.isEmpty)
        #expect(model.openSuggestions.allSatisfy { ($0.basedOn ?? []).isEmpty && model.bases(for: $0).allSatisfy { $0.key == nil } })
        #expect(model.remembered.isEmpty && model.memoryRows.filter(\.isUsable).isEmpty)
    }

    // MARK: The key

    /// Everything the app has put in front of the person or kept, as text.
    static func said(_ model: AppModel, _ returned: [String?]) -> [String] {
        var ask: [String] = []
        switch model.ask {
        case .answer(_, let text), .problem(let text): ask = [text]
        default: break
        }
        let kept = [model.settings.data(forKey: WeekCache.storeKey), model.run.lastResponse].compactMap { $0.map { String(decoding: $0, as: UTF8.self) } }
        let settings = model.settings.dictionaryRepresentation().map { "\($0.key)=\($0.value)" }
        return model.activity + ask + kept + settings + model.aiModels
            + [model.planProblem, model.sentToAI, model.aiKeyTail, model.weekPlan?.summary].compactMap(\.self) + returned.compactMap(\.self)
            + model.fallbacks.keys + model.appliedActions.map(\.reason)
    }

    @Test func theKeyIsNeverInWhatIsShownLoggedOrKeptAfterARefusalALimitAndASuccess() async throws {
        let rig = try AppRig()
        let model = rig.model
        // A server that repeats the key back in its error, the worst case for a leak.
        let refused = ScriptedNetwork.Answer.error(400, "Invalid value at 'key' (\(Self.key)): the account for \(Self.key) was not found")
        let limited = ScriptedNetwork.Answer.error(429, "Quota exceeded for key \(Self.key).")
        let network = rig.connect(key: Self.key, answers: [])
        var returned: [String?] = []

        // 400: checking the connection, planning the week, and asking.
        network.then([refused])
        returned.append(await model.connectAI(key: ""))
        #expect(returned.last != nil)
        network.then([refused])
        try await model.loadWeekPlan(fresh: true)
        network.then([refused])
        await model.askEvergreen("What is the weather on Mars?")
        var said = Self.said(model, returned)

        // 429: the same three.
        network.then([limited])
        returned.append(await model.connectAI(key: ""))
        #expect(returned.last != nil)
        network.then([limited])
        try await model.loadWeekPlan(fresh: true)
        #expect(model.planProblem != nil && model.weekPlan?.fromRules == true)
        said += Self.said(model, returned)
        network.then([limited])
        await model.askEvergreen("Why this week?")
        guard case .problem = model.ask else { Issue.record("a spent key should be said: \(model.ask)"); return }
        said += Self.said(model, returned)

        // Success: connected, the AI's week is kept, a sentence is answered.
        network.then([.init(status: 200, body: GeminiClientTests.models)])
        returned.append(await model.connectAI(key: ""))
        #expect(returned.last == .some(nil) && !model.aiModels.isEmpty)
        network.then([Self.quietWeek])
        try await model.loadWeekPlan(fresh: true)
        #expect(model.planProblem == nil && model.weekPlan?.fromRules == false && WeekCache.load(from: rig.settings) != nil)
        network.then([.text(#"{"agent":"none"}"#)])
        await model.askEvergreen("Book me a table for two")
        guard case .answer = model.ask else { Issue.record("expected an answer: \(model.ask)"); return }
        said += Self.said(model, returned)

        // Every request went out with the key in its header, so the key was really in play…
        // Nine steps; the ones that hit the limit were each tried once more.
        #expect(network.requests.count >= 9)
        #expect(network.requests.allSatisfy { $0.headers["x-goog-api-key"] == Self.key && !$0.url.contains(Self.key) && !$0.body.contains(Self.key) })
        // …and no line the person can read, and nothing the app kept, has the key or a recognisable piece of it.
        #expect(said.count > 20 && model.activity.count >= 3)
        let pieces = [Self.key, String(Self.key.prefix(12)), String(Self.key.dropFirst(8).prefix(12)), String(Self.key.suffix(8))]
        let leaks = said.filter { line in pieces.contains(where: line.contains) }
        #expect(leaks.isEmpty, "\(leaks)")
        // All that is ever shown of it is its last four characters.
        #expect(model.aiKeyTail == "…" + Self.key.suffix(4))
    }
}
