import Foundation
import Testing
@testable import Evergreen

/// The memory bundle running in JavaScriptCore: a sync rolls memory. No network.
struct MemoryEngineTests {
    /// A fresh memory folder, or the one given (a relaunch).
    static func engine(
        root: URL = FileManager.default.temporaryDirectory.appending(path: "memory-\(UUID().uuidString)")
    ) throws -> MemoryEngine {
        try #require(MemoryEngine(root: root, secret: "test-secret-0123456789abcdef"))
    }

    static func jordan(now: Date = Fixture.at(13, 30)) -> MemoryInput {
        let person = PersonaFixture.load("jordan", storyDay: Fixture.storyDay, calendar: Fixture.calendar)
        return MemoryInput(personaKey: "jordan", historyStart: person.historyStart, now: now,
                           workouts: person.workouts, days: person.days, calendar: Fixture.calendar)
    }

    @Test func sleepAndRestingHeartRateGoInAsDailySummaries() throws {
        let input = Self.jordan()
        let snapshot = input.snapshot(exportDate: input.midnight)
        let days = try #require(snapshot["dailySummaries"]?.array)
        let last = try #require(days.last)

        #expect(days.count == 30)
        #expect(last["date"]?.string == "2026-11-18")
        #expect(last["restingHeartRate"]?.number == 49)
        #expect(last["sleepMinutes"]?["totalAsleep"]?.number == 481)
    }

    // MARK: Planner text

    @Test func whatIsSentIsTheBriefAndTheFactsBehindIt() async throws {
        let engine = try Self.engine()
        _ = await engine.sync(Self.jordan())
        let memory = try #require(await engine.plannerMemory("jordan"))

        // The brief: plain bullets, at most 120 words, no headings or file names.
        #expect(memory.words <= 120)
        #expect(memory.plannerText.split(separator: "\n").allSatisfy { $0.hasPrefix("- ") })
        #expect(!memory.plannerText.contains(".md") && !memory.plannerText.contains("##"))
        #expect(memory.plannerText.contains("Usual times: Running"))
        // The facts behind it, each with its kind, for the harness's rules.
        #expect(memory.facts.contains { $0.kind == "regularity" && $0.text.hasPrefix("Fixed slot among recognised activities: running on") })
        #expect(memory.facts.contains { $0.kind == "body" && $0.text.hasPrefix("Average sleep over the last 7 days") })
        #expect(memory.facts.contains { $0.kind == "load" })

        let brief = try #require(await engine.brief("jordan"))
        #expect(brief.lines(.body).compactMap(\.key) == ["load", "sleep", "resting_hr"])
        #expect(brief.lines(.routine).contains { $0.key?.hasPrefix("slot:running:") == true })
        #expect(brief.stopped.isEmpty)
        #expect(brief.noticed.count == 3)
    }

    // MARK: Stopping one fact

    @Test func aStoppedFactIsNotSentAndComesBackWhenRestored() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "memory-\(UUID().uuidString)")
        let engine = try Self.engine(root: root)
        let input = Self.jordan()
        _ = await engine.sync(input)
        let before = try #require(await engine.plannerMemory("jordan"))
        let line = try #require(await engine.brief("jordan")?.lines.first { $0.usualTime?.activity == "running" })
        let key = try #require(line.key), slot = try #require(line.usualTime)
        let day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][slot.weekday - 1]
        let fact = "running on \(day) between \(String(format: "%02d", slot.hour)):00"
        #expect(before.facts.contains { $0.text.contains(fact) })

        #expect(await engine.stop(key: key, personaKey: "jordan"))
        #expect(await engine.stop(key: "sleep", personaKey: "jordan"))
        let after = try #require(await engine.plannerMemory("jordan"))
        #expect(!after.facts.contains { $0.text.contains(fact) })
        #expect(!after.facts.contains { $0.text.hasPrefix("Average sleep") })
        #expect(!after.plannerText.contains("Average sleep"))
        #expect(await engine.brief("jordan")?.stopped.map(\.key) == [key, "sleep"])
        #expect(await engine.brief("jordan")?.lines.contains { $0.key == key } == false)

        // A roll doesn't bring it back, and neither does a relaunch.
        await engine.sync(Self.jordan(now: Fixture.at(15)))
        let relaunched = try Self.engine(root: root)
        #expect(await relaunched.plannerMemory("jordan")?.facts.contains { $0.text.contains(fact) } == false)
        #expect(await relaunched.brief("jordan")?.stopped.map(\.key) == [key, "sleep"])

        // Restored, it comes back with the next roll.
        #expect(await relaunched.restore(key: key, personaKey: "jordan"))
        _ = await relaunched.sync(input)
        #expect(await relaunched.plannerMemory("jordan")?.facts.contains { $0.text.contains(fact) } == true)
        #expect(await relaunched.brief("jordan")?.stopped.map(\.key) == ["sleep"])
    }

    @Test func forgettingADayAKindOfFactOrEverythingAndRestoring() async throws {
        let engine = try Self.engine()
        let input = Self.jordan()
        _ = await engine.sync(input)
        func text() async -> String { await engine.plannerMemory("jordan")?.plannerText ?? "" }
        func state() async throws -> MemoryState { try #require(await engine.state("jordan")) }

        let start = try await state()
        #expect(start.days.last == "2026-11-18")
        #expect(start.types.contains("body"))
        #expect(start.stoppedTypes.isEmpty && start.forgottenDays.isEmpty && !start.everythingForgotten)

        // One day.
        #expect(await engine.forget(.day("2026-11-18"), personaKey: "jordan"))
        _ = await engine.sync(input)
        #expect(try await state().forgottenDays == ["2026-11-18"])
        #expect(try await !state().days.contains("2026-11-18"))
        #expect(await engine.plannerMemory("jordan")?.facts.contains { $0.text.hasPrefix("[daily] 2026-11-18") } == false)

        // One kind of fact, and back.
        #expect(await text().contains("Average sleep"))
        #expect(await engine.forget(.type("body"), personaKey: "jordan"))
        _ = await engine.sync(input)
        #expect(await !text().contains("Average sleep"))
        #expect(try await state().stoppedTypes == ["body"])
        #expect(await engine.restore(.type("body"), personaKey: "jordan"))
        _ = await engine.sync(input)
        #expect(await text().contains("Average sleep"))

        // Everything computed, and back.
        #expect(await engine.forget(.everything, personaKey: "jordan"))
        _ = await engine.sync(input)
        #expect(try await state().everythingForgotten)
        #expect(await engine.plannerMemory("jordan")?.facts.isEmpty == true)
        #expect(await engine.restore(.everything, personaKey: "jordan"))
        _ = await engine.sync(input)
        #expect(await engine.plannerMemory("jordan")?.facts.isEmpty == false)
        #expect(try await !state().everythingForgotten)
    }

    // MARK: The rolled-yesterday guard

    @Test func aRelaunchDoesNotRollYesterdayAgain() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "memory-\(UUID().uuidString)")
        var input = Self.jordan(now: Fixture.storyDay)   // exactly midnight: only yesterday's roll runs

        let first = try Self.engine(root: root)
        _ = await first.sync(input)
        let rolled = try #require(await first.plannerMemory("jordan"))

        // A workout that turns up for yesterday would change the roll, if it ran again.
        input.workouts.append(Fixture.workout("late-walk", at: Fixture.at(20, dayOffset: -1), minutes: 30))

        let relaunched = try Self.engine(root: root)
        _ = await relaunched.sync(input)
        #expect(await relaunched.plannerMemory("jordan") == rolled)

        // Without the saved record (what every launch used to start with) the same sync rolls yesterday again.
        try FileManager.default.removeItem(at: root.appending(path: "rolled.json"))
        let forgetful = try Self.engine(root: root)
        _ = await forgetful.sync(input)
        #expect(await forgetful.plannerMemory("jordan") != rolled)
    }
}
