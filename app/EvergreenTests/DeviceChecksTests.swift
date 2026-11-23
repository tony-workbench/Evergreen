import Foundation
import Testing
@testable import Evergreen

/// The rain check as the app runs it, with its switch in Settings: off means
/// nothing is asked of the forecast or the place search; on, with rain due on
/// tomorrow's run, means one ask.
@MainActor
struct RainSwitchTests {
    /// Tomorrow's 7 AM run on the plan, and rain due from 6 AM to noon tomorrow.
    static func rigWithRainDue() throws -> (rig: AppRig, parts: (forecast: CountingForecast, places: FakePlaces, location: FakeLocation)) {
        let rig = try AppRig()
        try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        let tomorrow = Fixture.calendar.date(byAdding: .day, value: 1, to: Clocks.morning)!
        return (rig, rig.wireTriggers(wetDay: tomorrow))
    }

    @Test func withTheRainCheckOffNoForecastAndNoPlaceSearchAreMade() async throws {
        let (rig, parts) = try Self.rigWithRainDue()
        rig.settings.set(false, forKey: Automatic.rain.rawValue)

        await rig.model.checkTriggers(foreground: true)
        await rig.model.checkTriggers(foreground: false)
        #expect(parts.forecast.requests == 0 && parts.places.searches == 0 && parts.location.requests == 0)
        #expect(rig.model.triggers.rainAsks.isEmpty && rig.notices.sent.isEmpty)
    }

    @Test func withTheRainCheckOnAndRainDueThereIsOneAsk() async throws {
        let (rig, parts) = try Self.rigWithRainDue()
        let model = rig.model

        await model.checkTriggers(foreground: true)
        let ask = try #require(model.triggers.rainAsks.first)
        #expect(model.triggers.rainAsks.count == 1 && ask.session.id == "the-run" && ask.worstProbability >= RainCheck.wetFrom)
        // It offers the first dry stretch that day (noon) and the nearest indoor places.
        #expect(ask.dryWindow?.start == Fixture.calendar.date(bySettingHour: 12, minute: 0, second: 0, of: ask.session.slot.start))
        #expect(ask.places.count == 3)
        #expect(rig.notices.sent.count == 1)
        #expect(parts.forecast.requests == 1 && parts.places.searches == 1)

        // Checked again (the app comes forward, the calendar changes, a background refresh): still one ask, said once,
        // and the forecast and the places are not fetched again within the hour.
        await model.checkTriggers(foreground: true)
        await model.checkTriggers(foreground: false)
        #expect(model.triggers.rainAsks.count == 1 && rig.notices.sent.count == 1)
        #expect(parts.forecast.requests == 1 && parts.places.searches == 1)

        // "Keep it": the ask goes and does not come back.
        model.triggers.dismiss(ask)
        await model.checkTriggers(foreground: true)
        #expect(model.triggers.rainAsks.isEmpty && rig.notices.sent.count == 1)
    }

    @Test func withNoRainDueThereIsNoAskAndNoPlaceSearch() async throws {
        let rig = try AppRig()
        try rig.plan(.run, id: "the-run", day: 1, hour: 7)
        let parts = rig.wireTriggers(wetDay: nil)
        await rig.model.checkTriggers(foreground: true)
        #expect(parts.forecast.requests == 1 && parts.places.searches == 0)
        #expect(rig.model.triggers.rainAsks.isEmpty && rig.notices.sent.isEmpty)
    }
}

/// Reading Apple Health: a read that fails keeps the history the app had, and
/// a locked phone doesn't read at all.
@MainActor
@Suite(.serialized)
struct HealthReadTests {
    /// A rig whose own first read (the app reads once when it starts) has finished, and the history it started with.
    static func settled() async throws -> (rig: AppRig, before: HealthHistory) {
        let rig = try AppRig()
        try await rig.wait("the first read") { rig.health.reads == 1 }
        return (rig, rig.model.health)
    }

    /// One more workout than the history has: this morning's swim.
    static func newer(_ history: HealthHistory) -> HealthHistory {
        var history = history
        let start = Fixture.at(7)
        history.workouts.append(Workout(id: "new-swim", activityType: "Swimming", start: start, end: start.addingTimeInterval(1800),
                                        effort: nil, avgHeartRate: nil, source: .health))
        return history
    }

    /// The app keeps the last read in a file; a test that reads puts back what was there.
    static func keepingTheSavedHistory(_ body: () async throws -> Void) async rethrows {
        let saved = try? Data(contentsOf: HealthHistory.cacheURL)
        defer {
            if let saved { try? saved.write(to: HealthHistory.cacheURL, options: .atomic) } else { try? FileManager.default.removeItem(at: HealthHistory.cacheURL) }
        }
        try await body()
    }

    @Test func aReadThatFailsKeepsTheHistoryThereWas() async throws {
        try await Self.keepingTheSavedHistory {
            let (rig, before) = try await Self.settled()
            let model = rig.model
            #expect(before.workouts.count > 20 && !before.days.isEmpty)

            // A read that works replaces it…
            let newer = Self.newer(before)
            rig.health.willReturn(newer)
            await model.refreshHealth()
            #expect(rig.health.reads == 2 && model.health == newer && model.workouts.contains { $0.id == "new-swim" })

            // …and one that fails leaves all of it, the new workout too.
            rig.health.willReturn(nil)
            await model.refreshHealth()
            #expect(rig.health.reads == 3)
            #expect(model.health == newer && model.workouts.count == before.workouts.count + 1)
            #expect(!model.historyDepth.isThin && model.recentWeeks.workoutDays > 0)
        }
    }

    @Test func aLockedPhoneSkipsTheReadAndWritesNothing() async throws {
        try await Self.keepingTheSavedHistory {
            let (rig, before) = try await Self.settled()
            let model = rig.model
            let run = try rig.plan(.run, id: "the-run", day: 1, hour: 7)
            rig.health.willReturn(Self.newer(before))

            model.unlocked = { false }
            await model.refreshHealth()
            #expect(rig.health.reads == 1 && model.health == before)
            // Nothing is written to the calendar from a locked phone either.
            model.move(run, to: run.slot.start.addingTimeInterval(3600))
            #expect(rig.calendar.event(for: "the-run")?.start == run.slot.start && rig.calendar.updated.isEmpty)

            // Unlocked again, the read happens and the calendar catches up.
            model.unlocked = { true }
            await model.refreshHealth()
            #expect(rig.health.reads == 2 && model.workouts.contains { $0.id == "new-swim" })
            model.save()
            #expect(rig.calendar.event(for: "the-run")?.start == run.slot.start.addingTimeInterval(3600))
        }
    }
}
