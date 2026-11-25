import Foundation
import SwiftData
import Testing
@testable import Evergreen

/// "Ask Evergreen" end to end with a scripted model: the sentence is sorted,
/// the memory agent acts through its tools on the real memory engine, and
/// one card comes back. No network.
@MainActor
struct MemoryAgentTests {
    static func model(_ script: [Result<ModelReply, ModelFailure>]) async throws -> (AppModel, ScriptedModel) {
        let model = SuggestionTests.model(try SuggestionTests.container())
        let scripted = ScriptedModel(script)
        model.scriptedModel = scripted
        await model.syncMemory()
        return (model, scripted)
    }

    static let toMemory = ScriptedModel.text(#"{"agent":"memory"}"#)

    @Test func askingWhatIsRememberedReadsTheBriefAndAnswersOnOneCard() async throws {
        let (model, scripted) = try await Self.model([Self.toMemory, ScriptedModel.call("memory_brief"), ScriptedModel.text("You usually train four times a week.")])
        await model.askEvergreen("  What do you remember about me?  ")
        #expect(model.ask == .answer(agent: .memory, text: "You usually train four times a week."))

        let requests = await scripted.requests
        #expect(requests.map(\.model) == ["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash"])
        #expect(requests[1].tools.map(\.name) == ["memory_brief", "stop_memory", "restore_memory", "forget_day", "forget_everything"])
        // The tool handed back the real brief, keys included.
        let result = try #require(requests[2].messages.last?["content"]?.array?.first?["content"]?.string)
        // Numbered sentences, with no key in them.
        #expect(result.contains("1. \(try #require(model.remembered.first?.text))") && result.contains("Days that can be forgotten:") && !result.contains("["))
        model.dismissAsk()
        #expect(model.ask == .idle)
    }

    @Test func theAgentsToolsOnlyAskAndThePersonsConfirmDoesIt() async throws {
        let model = try await EngineTests.model()
        try await model.loadWeekPlan()
        let key = try #require(model.memoryRows.first { $0.kind == "usual_slot" && $0.isUsable }?.key)
        let day = try #require(model.memoryState.days.last)
        let tools = MemoryAgent.tools(model)
        func run(_ name: String, _ input: JSONValue = [:]) async throws -> ToolOutcome {
            await (try #require(tools.first { $0.name == name })).run(input)
        }

        // A model calling the tool changes nothing: it puts a question on the screen.
        let line = try #require(model.remembered.firstIndex { $0.key == key }).advanced(by: 1)
        #expect(try await !run("stop_memory", ["line": .string("\(line)")]).isError)
        #expect(model.pendingMemory == .stop(keys: [key], title: model.title(for: key)) && !model.stoppedKeys.contains(key))
        model.pendingMemory = nil   // "Keep"
        #expect(!model.stoppedKeys.contains(key))

        #expect(try await !run("forget_everything").isError)
        #expect(model.pendingMemory == .forgetEverything && !model.memoryRows.isEmpty)
        #expect(try await !run("forget_day", ["date": .string(day)]).isError)
        #expect(model.pendingMemory == .forgetDay(day) && model.memoryState.days.contains(day))

        // Only Confirm does it.
        try await _ = run("stop_memory", ["line": .string("\(line).")])
        await model.confirmPendingMemory()
        #expect(model.pendingMemory == nil && model.stoppedKeys.contains(key))
        #expect(try await !run("restore_memory", ["line": "S1"]).isError)
        #expect(!model.stoppedKeys.contains(key))

        // Keys and days that aren't there ask nothing.
        #expect(try await run("stop_memory", ["line": "99"]).isError)
        #expect(try await run("stop_memory", ["line": "mem:made-up"]).isError)
        #expect(try await run("forget_day", ["date": "1999-01-01"]).isError)
        #expect(model.pendingMemory == nil)
    }

    @Test func forgettingAndStoppingAreRecognisedBeforeAnyModelAndWaitForConfirm() async throws {
        let model = try await EngineTests.model()
        try await model.loadWeekPlan()
        let scripted = ScriptedModel([])
        model.scriptedModel = scripted

        await model.askEvergreen("delete everything you know about me")
        #expect(model.pendingMemory == .forgetEverything && model.ask == .idle && !model.memoryRows.isEmpty)
        // No model was asked, so it can't be sent somewhere else or carried out on its say-so.
        #expect(await scripted.requests.isEmpty)
        await model.confirmPendingMemory()
        #expect(model.memoryRows.filter(\.isUsable).isEmpty && model.activity.contains { $0.contains("Forgot everything") })
    }

    @Test func theMatcherReadsForgetAndStopSentencesAndLeavesTheRestAlone() {
        let today = "2026-11-23"   // a Monday
        let days = ["2026-11-17", "2026-11-22"]
        let rows = [PlanFakes.sundayRun, PlanFakes.wednesdayYoga, PlanFakes.load]
        func match(_ sentence: String) -> PendingMemory? { MemoryCommand.match(sentence, today: today, days: days, rows: rows) }
        for sentence in ["forget everything", "delete everything you know about me", "erase all you know about me please", "wipe your memory of me"] {
            #expect(match(sentence) == .forgetEverything, "\(sentence)")
        }
        #expect(match("forget last tuesday") == .forgetDay("2026-11-17") && match("Forget yesterday") == .forgetDay("2026-11-22"))
        // A day there is nothing for, and sentences that aren't about memory, are left to the agents.
        #expect(match("forget last friday") == nil && match("cancel tomorrow's run") == nil && match("remove the gym on thursday") == nil)
        #expect(match("what do you remember about me") == nil && match("delete my run on sunday") == nil)
        #expect(match("stop planning sunday mornings") == .stop(keys: ["k1"], title: "Sunday mornings"))
        #expect(match("stop planning Wednesdays") == .stop(keys: ["k2"], title: "Wednesdays"))
        #expect(match("stop planning sunday evenings") == nil && match("stop planning fridays") == nil)
    }

    /// A sentence that names a day forgets that day and never more; everything needs saying with no day;
    /// a stop names a habit; what can't be placed asks, and never guesses the larger deletion.
    @Test func theMatcherNeverGuessesTheLargerDeletion() {
        let today = "2026-11-23"   // a Monday
        let days = ["2026-11-17", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-10-31"]
        let rows = [PlanFakes.sundayRun, PlanFakes.wednesdayYoga, PlanFakes.load]
        let table: [(String, PendingMemory?)] = [
            ("please wipe the day 2026-11-21 from what you know", .forgetDay("2026-11-21")),
            ("forget 2026-11-17", .forgetDay("2026-11-17")),
            ("Forget everything from yesterday", .forgetDay("2026-11-22")),
            ("delete all you know about me from the 21st", .forgetDay("2026-11-21")),
            ("forget what you learned on Nov 21", .forgetDay("2026-11-21")),
            ("erase November 21st from your memory", .forgetDay("2026-11-21")),
            ("forget what you learned on 21 November", .forgetDay("2026-11-21")),
            ("forget the 31st of october", .forgetDay("2026-10-31")),
            ("forget last Friday", .forgetDay("2026-11-20")),
            ("wipe saturday from what you know about me", .forgetDay("2026-11-21")),
            ("forget today", .forgetDay("2026-11-23")),
            ("forget the day before yesterday", .forgetDay("2026-11-21")),
            ("clear what you remember about tuesday", .forgetDay("2026-11-17")),
            // A day with nothing kept: never everything.
            ("forget everything you know from 2026-11-05", .forgetWhich),
            ("forget last thursday", nil),
            // Everything, said with no day and nothing narrower.
            ("forget everything", .forgetEverything),
            ("delete everything you know about me", .forgetEverything),
            ("wipe all of it from your memory", .forgetEverything),
            ("erase all my data", .forgetEverything),
            ("clear your memory of me", .forgetEverything),
            // Can't be placed: ask.
            ("delete everything about last week", .forgetWhich),
            ("forget what you know about my sleep", .forgetWhich),
            ("wipe what you learned", .forgetWhich),
            ("delete some of what you remember", .forgetWhich),
            ("forget everything since the start of the month", .forgetWhich),
            // A habit.
            ("stop planning sunday mornings", .stop(keys: ["k1"], title: "Sunday mornings")),
            ("no more yoga on wednesday evenings", .stop(keys: ["k2"], title: "Wednesday evenings")),
            ("forget my sunday morning runs", .stop(keys: ["k1"], title: "Sunday mornings")),
            ("stop suggesting Wednesdays", .stop(keys: ["k2"], title: "Wednesdays")),
            ("stop planning fridays", nil),
            // Not about memory.
            ("forget it", nil),
            ("remove the gym on thursday", nil),
            ("delete my run on sunday", nil),
            ("clear my afternoon tomorrow", nil),
        ]
        #expect(table.count >= 25)
        for (sentence, expected) in table {
            #expect(MemoryCommand.match(sentence, today: today, days: days, rows: rows) == expected, "\(sentence)")
        }
        // The card says exactly what would be deleted.
        #expect(PendingMemory.forgetDay("2026-11-21").question == "Forget Saturday, November 21?")
        #expect(PendingMemory.forgetDay("2026-11-21").detail.contains("Saturday, November 21") && PendingMemory.forgetDay("2026-11-21").detail.contains("that day alone"))
        #expect(PendingMemory.forgetWhich.question == "Forget one day, or everything?")
    }

    @Test func otherSentencesGetAPlainCardAndFailuresNeverMentionTheKey() async throws {
        let (model, scripted) = try await Self.model([ScriptedModel.text(#"{"agent":"none"}"#), .failure(.keyRefused), .failure(.limited)])
        await model.askEvergreen("What's the weather on Mars?")
        guard case .answer(agent: AgentKind.none, _) = model.ask else {
            Issue.record("Expected a plain card, got \(model.ask)")
            return
        }
        await model.askEvergreen("")
        #expect(await scripted.requests.count == 1)
        await model.askEvergreen("What do you remember?")
        #expect(model.ask == .problem("Your AI key was refused. Check it in Settings."))
        await model.askEvergreen("What do you remember?")
        #expect(model.ask == .problem("Your AI key has hit its limit for now. Try again in a little while."))
    }
}
