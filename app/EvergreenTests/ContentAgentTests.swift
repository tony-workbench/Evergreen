import Foundation
import Testing
@testable import Evergreen

/// The AI chooses each home day's movements and code checks them (plan 4.2): only movements open to the person,
/// problems sent back at most twice, and the rules' own content for any day that never passes.
struct ContentAgentTests {
    let engine = BundleContent(bundle: AppModel.planBundle)
    let days = [ContentAgent.Day(day: "2026-12-01", id: "home-2026-12-01", focus: "full"),
                ContentAgent.Day(day: "2026-12-03", id: "home-2026-12-03", focus: "full")]

    var rules: UserRules {
        var rules = UserRules()
        rules.isOn = true
        rules.equipment = []
        return rules
    }

    func rulesWeek() async throws -> [WorkoutContent] {
        try #require(await engine.week(days.map { (id: $0.id, focus: $0.focus) }, minutes: 30, basis: .init(rules: rules, log: WorkoutLog()))).contents
    }

    /// An answer giving each day the rules' own movements, in reverse order, with `reason`.
    func answer(_ week: [WorkoutContent], reason: String = "Legs first while you're fresh, then arms.", replacing: String? = nil) -> String {
        let days = week.map { content -> JSONValue in
            var items = content.items.reversed().map { ["movementId": .string($0.movementId), "sets": .number(Double($0.sets))] as JSONValue }
            if let replacing { items[0] = ["movementId": .string(replacing), "sets": 2] }
            return ["day": .string(String(content.sessionId!.dropFirst("home-".count))), "items": .array(items), "reason": .string(reason)]
        }
        return JSONValue.object(["days": .array(days)]).text
    }

    func agent(_ model: ScriptedModel) -> ContentAgent { ContentAgent(model: model, modelId: AIModels.standard, engine: engine) }

    func request(_ week: [WorkoutContent]) -> ContentAgent.Request {
        ContentAgent.Request(days: days, minutes: 30, rules: rules, log: WorkoutLog(), lighter: false, rulesWeek: week)
    }

    @Test func movementsTheAIChoseAreUsedOnceCodePassesThem() async throws {
        let week = try await rulesWeek()
        let model = ScriptedModel([ScriptedModel.text(answer(week))])
        let picked = try #require(await agent(model).pick(request(week)).picks)
        #expect(picked.keys.sorted() == days.map(\.day))
        let first = try #require(picked["2026-12-01"])
        #expect(first.content.items.map(\.movementId) == week[0].items.reversed().map(\.movementId))
        #expect(first.reason == "Legs first while you're fresh, then arms.")
        // What the AI is told: the movements open today and the limits, nothing about the person.
        let sent = await model.requests[0].messages[0]["content"]?.string ?? ""
        #expect(sent.contains("Movements to choose from"))
        #expect(sent.contains("bodyweight_squat"))
        #expect(!sent.contains("backpack_row"), "no backpack: never offered")
    }

    @Test func aMovementThePersonDoesntHaveGoesBackAndIsFixed() async throws {
        let week = try await rulesWeek()
        let model = ScriptedModel([ScriptedModel.text(answer(week, replacing: "backpack_row")), ScriptedModel.text(answer(week))])
        let picked = try #require(await agent(model).pick(request(week)).picks)
        #expect(picked.count == 2)
        let requests = await model.requests
        #expect(requests.count == 2)
        let repair = requests[1].messages.last?["content"]?.string ?? ""
        #expect(repair.contains("The check found problems"))
    }

    @Test func afterThreeWrongAnswersTheRulesContentStands() async throws {
        let week = try await rulesWeek()
        let wrong = ScriptedModel.text(answer(week, replacing: "not_a_movement"))
        let model = ScriptedModel([wrong, wrong, wrong])
        let picked = try #require(await agent(model).pick(request(week)).picks)
        #expect(picked.isEmpty)
        #expect(await model.requests.count == ContentAgent.maxRevisions + 1)
    }

    @Test func aReasonThatCantBeShownIsNotShown() async throws {
        let week = try await rulesWeek()
        let bad = ScriptedModel.text(answer(week, reason: "Uses bodyweight_squat first."))
        let picked = try #require(await agent(ScriptedModel([bad, bad, bad])).pick(request(week)).picks)
        #expect(picked.isEmpty)
    }

    @Test func noAnswerIsNotKeptAsAnAnswer() async throws {
        let week = try await rulesWeek()
        let answer = await agent(ScriptedModel([.failure(.unreachable)])).pick(request(week))
        #expect(answer == .unanswered(.unreachable))
        #expect(answer.picks == nil && answer.isOffline, "offline: the week table says so, apart from a failure")
        let refused = await agent(ScriptedModel([.failure(.keyRefused)])).pick(request(week))
        #expect(refused == .unanswered(.keyRefused) && !refused.isOffline)
    }

    @Test func aChosenSessionIsDosedAgainFromTheLogAsItIsNow() async throws {
        let week = try await rulesWeek()
        let chosen = week[0]
        let session = BundleContent.Session(id: chosen.sessionId, focus: "full", minutes: 30)
        let again = try #require(await engine.propose(.init(proposal: ContentAgent.proposal(of: chosen), session: session),
                                                      basis: .init(rules: rules, log: WorkoutLog())))
        #expect(again.pass)
        #expect(again.content?.items.map(\.movementId) == chosen.items.map(\.movementId))
    }
}
