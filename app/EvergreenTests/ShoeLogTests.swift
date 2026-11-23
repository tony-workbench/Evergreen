import Foundation
import Testing
@testable import Evergreen

/// The running shoes: distance since they were started, the two thresholds,
/// and the row the agents read.
@MainActor
struct ShoeLogTests {
    let started = Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: 1))!
    let now = TriggerRig.evening

    @Test func distanceIsTheRunsSinceTheShoesWereStarted() {
        let workouts = [
            TriggerRig.run(km: 10, day: 30, month: 10),          // before the shoes
            TriggerRig.run(km: 8.5, day: 1),                     // the first day counts
            TriggerRig.run(km: 12, day: 8),
            TriggerRig.run(km: 6, day: 9, type: "Walking"),      // not a run
            TriggerRig.run(km: 5, day: 25),                      // after now
            Workout(id: "no-distance", activityType: "Running", start: TriggerRig.date(10, 7), end: TriggerRig.date(10, 8),
                    effort: nil, avgHeartRate: nil, source: .health),
        ]
        #expect(ShoeLog.km(workouts, since: started, until: now) == 20.5)
        #expect(ShoeLog.km([], since: started, until: now) == 0)
    }

    @Test func aRunRecordedTwiceCountsOnce() {
        // The watch and the phone both saved the same run.
        let twice = [TriggerRig.run(km: 10, day: 8, id: "watch"), TriggerRig.run(km: 9.8, day: 8, id: "phone")]
        let km = ShoeLog.km(twice, since: started, until: now)
        #expect(km == 10 || km == 9.8)
    }

    @Test func theThresholdsAre480And640() {
        #expect(ShoeEvent(km: 479.9) == nil)
        #expect(ShoeEvent(km: 480) == .headsUp)
        #expect(ShoeEvent(km: 639.9) == .headsUp)
        #expect(ShoeEvent(km: 640) == .replace)
        let log = ShoeLog(name: nil, startedOn: started)
        #expect(ShoeStatus(log: log, km: 120).line == nil)
        #expect(ShoeStatus(log: log, km: 492.4).line == "Your running shoes have 492 km on them. Worth checking how the soles look.")
        #expect(ShoeStatus(log: ShoeLog(name: "Ghost 16", startedOn: started), km: 655).line
            == "Your running shoes (Ghost 16) have 655 km on them. Time for a new pair.")
    }

    @Test func theGearRowHasTheContractsShape() throws {
        let row = try #require(ShoeStatus(log: ShoeLog(name: "Ghost 16", startedOn: started), km: 492.44).memoryRow(now: now, calendar: Fixture.calendar))
        #expect(row.group == "gear" && row.kind == "gear" && row.isUsable)
        #expect(row.data == .object(["item": .string("Ghost 16"), "km": .number(492.4), "boughtOn": .string("2026-11-01")]))
        #expect(row.since == "2026-11-01")
        #expect(row.updated == "2026-11-21T20:00:00-08:00")
        #expect(!row.memoryId.isEmpty && !row.key.isEmpty && !row.slot.isEmpty)
        // It survives the wire.
        let back = try JSONDecoder().decode(MemoryRow.self, from: JSONEncoder().encode(row))
        #expect(back == row)
    }

    @Test func answeringTheQuestionStartsTheCountAndNewOnesResetIt() async throws {
        let rig = try TriggerRig(workouts: (1...20).map { TriggerRig.run(km: 25, day: $0) })
        #expect(rig.center.shoeLog == nil && rig.center.shoes == nil)
        await rig.center.checkShoes(now: now)
        #expect(rig.center.shoes == nil && rig.notices.sent.isEmpty)

        await rig.center.setShoes(startedOn: TriggerRig.date(1, 15), name: "Ghost 16", now: now)
        #expect(rig.center.shoeLog == ShoeLog(name: "Ghost 16", startedOn: started))
        #expect(rig.center.shoes?.km == 500 && rig.center.shoes?.event == .headsUp)
        #expect(rig.center.shoes?.memoryRow(now: now, calendar: Fixture.calendar)?.kind == "gear")

        // "I got new ones": today, nothing run in them yet (the last run was this morning's... on the 20th).
        await rig.center.gotNewShoes(now: now)
        #expect(rig.center.shoeLog == ShoeLog(name: nil, startedOn: TriggerRig.date(21, 0)))
        #expect(rig.center.shoes?.km == 0 && rig.center.shoes?.event == nil)
        // Kept across a relaunch.
        let relaunched = TriggerCenter()
        relaunched.setUp(TriggerCenter.Parts(
            store: rig.store, forecast: ForecastClient(), location: rig.location, places: rig.places,
            distance: WorkoutsRunningDistance(workouts: []), notify: { _, _ in }, busy: { [] }, plan: { [] }, calendar: Fixture.calendar
        ))
        #expect(relaunched.shoeLog == rig.center.shoeLog)
    }

    @Test func theQuestionCanBePutOff() throws {
        let rig = try TriggerRig()
        #expect(!rig.center.shoeQuestionSkipped)
        rig.center.skipShoeQuestion()
        #expect(rig.center.shoeQuestionSkipped)
        #expect(rig.store.value(Bool.self, for: TriggerCenter.shoeQuestionSkippedKey) == true)
    }
}
