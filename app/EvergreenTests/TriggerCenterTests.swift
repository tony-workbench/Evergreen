import Foundation
import Testing
@testable import Evergreen

/// The checks run again and again (foreground, calendar changes, background
/// refreshes) and each thing is said once. Injected clock, store, forecast,
/// place, gyms and workouts; no network, no device.
@MainActor
struct TriggerCenterTests {
    let now = TriggerRig.evening
    let rainKey = "rain|plan-me-2026-11-22-running|2026-11-22"

    // MARK: Rain

    @Test func rainOnASessionIsNotifiedOnceHoweverOftenItIsChecked() async throws {
        let rig = try TriggerRig()
        for minutes in [0, 5, 90, 200] {
            await rig.center.checkAll(now: now.addingTimeInterval(Double(minutes) * 60), mayAsk: minutes == 0)
        }
        #expect(rig.notices.ids == [rainKey])
        #expect(rig.notices.sent.first?.title == "Rain on tomorrow’s long run")
        #expect(rig.notices.sent.first?.body == "85% chance of rain around \(TriggerRig.date(22, 8).clock). It looks dry from \(TriggerRig.date(22, 12).clock). Want to move it?")
        // The ask itself stays for the screen, with its places.
        let ask = try #require(rig.center.rainAsks.first)
        #expect(rig.center.rainAsks.count == 1 && ask.key == rainKey)
        #expect(ask.places.map(\.name) == ["Nearest", "Second Nearest", "Third Nearest"])
        #expect(ask.intent?.kind == "move" && ask.intent?.targetWorkoutId == ask.session.id)
        // Four checks over 200 minutes: the forecast was fetched once an hour at most, and only from Open-Meteo.
        let urls = await rig.fetches.urls
        #expect(urls.count == 3)
        #expect(urls.allSatisfy { $0.host() == "api.open-meteo.com" })
    }

    @Test func aRelaunchDoesNotNotifyAgain() async throws {
        let store = MemoryTriggerStore()
        let first = try TriggerRig(store: store)
        await first.center.checkAll(now: now, mayAsk: true)
        let second = try TriggerRig(store: store)
        await second.center.checkAll(now: now.addingTimeInterval(600), mayAsk: false)
        #expect(first.notices.ids == [rainKey] && second.notices.sent.isEmpty)
        #expect(second.center.rainAsks.count == 1)
        // Kept in the forecast cache too: the relaunch didn't fetch.
        #expect(await second.fetches.urls.isEmpty)
    }

    @Test func anotherSessionOrAnotherDayIsItsOwnNotification() async throws {
        let store = MemoryTriggerStore()
        let ride = TriggerRig.session("plan-me-2026-11-22-cycling", type: "Cycling", hour: 10)
        let rig = try TriggerRig(plan: [TriggerRig.session(), ride], store: store)
        await rig.center.checkAll(now: now, mayAsk: true)
        await rig.center.checkAll(now: now, mayAsk: true)
        #expect(rig.notices.ids == [rainKey, "rain|plan-me-2026-11-22-cycling|2026-11-22"])
    }

    @Test func aDryForecastSaysNothing() async throws {
        let rig = try TriggerRig(file: "open-meteo-recorded-dry.json")
        await rig.center.checkAll(now: now, mayAsk: true)
        #expect(rig.notices.sent.isEmpty && rig.center.rainAsks.isEmpty)
        #expect(rig.places.searches == 0)
    }

    @Test func aWetDayWithNoWindowPointsIndoors() async throws {
        let rig = try TriggerRig(file: "open-meteo-wet-all-day.json")
        await rig.center.checkAll(now: now, mayAsk: true)
        #expect(rig.notices.sent.first?.body.hasPrefix("80% chance of rain around \(TriggerRig.date(22, 8).clock). Nearest is ") == true)
        #expect(rig.center.rainAsks.first?.intent == nil)
    }

    @Test func notNowPutsARainAskAway() async throws {
        let rig = try TriggerRig()
        await rig.center.checkRain(now: now, mayAsk: true)
        let ask = try #require(rig.center.rainAsks.first)
        rig.center.dismiss(ask)
        #expect(rig.center.rainAsks.isEmpty)
        await rig.center.checkRain(now: now.addingTimeInterval(300), mayAsk: true)
        #expect(rig.center.rainAsks.isEmpty && rig.notices.ids == [rainKey])
    }

    // MARK: Location

    @Test func locationIsAskedOnceAndOnlyWithAnOutdoorSessionAhead() async throws {
        // Nothing outdoors in the next two days: no prompt.
        let indoors = try TriggerRig(plan: [TriggerRig.session("yoga", type: "Yoga")], location: .notAsked)
        await indoors.center.checkAll(now: now, mayAsk: true)
        #expect(indoors.location.requests == 0)

        // An outdoor session, but the app isn't on screen: no prompt from the background.
        let rig = try TriggerRig(location: .notAsked)
        await rig.center.checkAll(now: now, mayAsk: false)
        #expect(rig.location.requests == 0 && rig.notices.sent.isEmpty)
        // On screen: asked, allowed, and the check goes on.
        await rig.center.checkAll(now: now, mayAsk: true)
        #expect(rig.location.requests == 1 && rig.notices.ids == [rainKey])
    }

    @Test func aDenialTurnsRainOffAndIsNeverAskedAgain() async throws {
        let store = MemoryTriggerStore()
        let rig = try TriggerRig(location: .notAsked, answer: .denied, store: store)
        await rig.center.checkAll(now: now, mayAsk: true)
        await rig.center.checkAll(now: now, mayAsk: true)
        #expect(rig.location.requests == 1)
        #expect(rig.notices.sent.isEmpty && rig.center.rainAsks.isEmpty)
        #expect(await rig.fetches.urls.isEmpty)
        // Even if the system forgot the answer (a restored phone), the app doesn't ask twice.
        let again = try TriggerRig(location: .notAsked, store: store)
        await again.center.checkAll(now: now, mayAsk: true)
        #expect(again.location.requests == 0)
    }

    @Test func withoutAFixTheLastRoundedPlaceIsUsed() async throws {
        let store = MemoryTriggerStore()
        let first = try TriggerRig(store: store)
        await first.center.checkRain(now: now, mayAsk: true)
        #expect(store.value(Coordinate.self, for: TriggerCenter.lastPlaceKey) == Coordinate(latitude: 37.77, longitude: -122.42))
        // In the background there is no fix.
        let second = try TriggerRig(plan: [TriggerRig.session("plan-me-2026-11-22-walking", type: "Walking", hour: 9)], store: store)
        second.location.place = nil
        await second.center.checkRain(now: now.addingTimeInterval(120), mayAsk: false)
        #expect(second.notices.ids == ["rain|plan-me-2026-11-22-walking|2026-11-22"])
    }

    // MARK: Shoes

    @Test func eachShoeThresholdIsNotifiedOnce() async throws {
        let store = MemoryTriggerStore()
        // 19 runs of 25 km since 1 November: 475 km.
        var runs = (1...19).map { TriggerRig.run(km: 25, day: $0) }
        let before = try TriggerRig(store: store, workouts: runs)
        await before.center.setShoes(startedOn: TriggerRig.date(1, 9), name: nil, now: now)
        await before.center.checkAll(now: now, mayAsk: true)
        #expect(!before.notices.ids.contains { $0.hasPrefix("shoes") })

        // One more run: 500 km. Checked three times, said once.
        runs.append(TriggerRig.run(km: 25, day: 20))
        let headsUp = try TriggerRig(store: store, workouts: runs)
        for _ in 0..<3 { await headsUp.center.checkShoes(now: now) }
        #expect(headsUp.notices.ids == ["shoes|2026-11-01|heads_up"])
        #expect(headsUp.notices.sent.first?.title == "A heads-up about your running shoes")
        #expect(headsUp.center.shoes?.km == 500)

        // 650 km: the second and last one.
        runs += (0..<6).map { _ in TriggerRig.run(km: 25, day: 21) }.enumerated().map { index, run in
            var run = run
            run.start = TriggerRig.date(21, 6 + index * 2)
            run.end = run.start.addingTimeInterval(3000)
            return run
        }
        let replace = try TriggerRig(store: store, workouts: runs)
        for _ in 0..<3 { await replace.center.checkShoes(now: now) }
        #expect(replace.notices.ids == ["shoes|2026-11-01|replace"])
        #expect(replace.notices.sent.first?.title == "Time for new running shoes")

        // A new pair is a new count, with its own notifications later.
        await replace.center.gotNewShoes(now: now)
        await replace.center.checkShoes(now: now)
        #expect(replace.notices.ids.count == 1)
    }

    // MARK: A moved workout

    @Test func aMoveIsAnnouncedOncePerMove() async throws {
        let store = MemoryTriggerStore()
        let rig = try TriggerRig(store: store)
        let copy = (title: "A meeting landed on your run", body: "I moved it to 6:45 PM.")
        await rig.center.announceMove(id: "defend-plan-me-2026-11-22-running-1795500000", copy: copy, now: now)
        await rig.center.announceMove(id: "defend-plan-me-2026-11-22-running-1795500000", copy: copy, now: now.addingTimeInterval(60))
        // The next day's launch clears the run and the agent makes the same move again: still said once.
        let nextDay = try TriggerRig(store: store)
        await nextDay.center.announceMove(id: "defend-plan-me-2026-11-22-running-1795500000", copy: copy, now: now.addingTimeInterval(86_400))
        #expect(rig.notices.ids == ["defend-plan-me-2026-11-22-running-1795500000"] && nextDay.notices.sent.isEmpty)
        // Another meeting on the same workout is another move.
        await rig.center.announceMove(id: "defend-plan-me-2026-11-22-running-1795503600", copy: copy, now: now)
        #expect(rig.notices.ids.count == 2)
    }

    @Test func theLedgerForgetsOnlyWhatIsLongPast() {
        let store = MemoryTriggerStore()
        let ledger = NotifiedLedger(store: store)
        #expect(ledger.firstTime("a", now: now))
        #expect(!ledger.firstTime("a", now: now.addingTimeInterval(44 * 86_400)))
        #expect(ledger.firstTime("b", now: now.addingTimeInterval(46 * 86_400)))
        #expect(!ledger.contains("a") && ledger.contains("b"))
    }

    // MARK: First-time lines

    @Test func eachFirstTimeLineIsShownOnce() throws {
        let rig = try TriggerRig()
        #expect(FirstTimeKind.allCases.map(\.rawValue) == ["moved_workout", "rain", "shoes"])
        for kind in FirstTimeKind.allCases {
            let line = try #require(rig.center.firstTimeLine(kind))
            #expect(line == kind.line && !line.contains("\n") && line.split(separator: " ").count <= 16)
        }
        rig.center.markFirstTimeShown(.rain)
        rig.center.markFirstTimeShown(.rain)
        #expect(rig.center.firstTimeLine(.rain) == nil)
        #expect(rig.center.firstTimeLine(.shoes) != nil && rig.center.firstTimeLine(.movedWorkout) != nil)
        // Kept across a relaunch.
        #expect(FirstTime(store: rig.store).line(for: .rain) == nil)
    }

    // MARK: Files

    @Test func theFileStoreKeepsValuesAcrossLaunches() {
        let folder = FileManager.default.temporaryDirectory.appending(path: "triggers-\(UUID().uuidString)")
        let store = FileTriggerStore(folder: folder)
        #expect(store.value(ShoeLog.self, for: ShoeLog.storeKey) == nil)
        let log = ShoeLog(name: "Ghost 16", startedOn: TriggerRig.date(1, 0))
        store.save(log, for: ShoeLog.storeKey)
        #expect(FileTriggerStore(folder: folder).value(ShoeLog.self, for: ShoeLog.storeKey) == log)
        store.save(ShoeLog?.none, for: ShoeLog.storeKey)
        #expect(FileTriggerStore(folder: folder).value(ShoeLog.self, for: ShoeLog.storeKey) == nil)
    }
}
