import Foundation
import Testing
@testable import Evergreen

/// The week the rules make, kept on the phone: read from the engine, its fallbacks,
/// the planned days behind the lighter fifth week, and a home session's movements in its calendar entry.
struct HomeWeekTests {
    private static let engine = #"""
    {"days":[
      {"day":"2026-11-30","weekday":"Monday","kind":"home","focus":"lower","first":"2026-11-30T16:40:00-08:00","fallbacks":["2026-11-30T18:10:00-08:00","2026-11-30T19:40:00-08:00"]},
      {"day":"2026-12-01","weekday":"Tuesday","kind":"out","focus":null,"first":null,"fallbacks":[]},
      {"day":"2026-12-02","weekday":"Wednesday","kind":"rest","focus":null,"first":null,"fallbacks":[]},
      {"day":"2026-12-03","weekday":"Thursday","kind":"home","focus":null,"first":null,"fallbacks":[]}
    ],"homeDays":2,"trainingDays":1,"note":"This week has only one day at home with time to train, so it works the whole body once."}
    """#

    private func week() throws -> HomeWeek {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(Self.engine.utf8))
        return try #require(HomeWeek.from(engine: value, madeOn: "2026-11-30"))
    }

    @Test func theEnginesWeekIsReadDayByDay() throws {
        let week = try week()
        #expect(week.days.map(\.kind) == [.home, .out, .rest, .home])
        #expect(week.days.map(\.trains) == [true, false, false, false])
        #expect(week.madeOn == "2026-11-30" && week.trainingDays == 1 && week.note != nil)
        #expect(week.fallbacks(on: "2026-11-30").map(\.clock) == ["18:10", "19:40"])
        #expect(week.fallbacks(on: "2026-12-01").isEmpty && week.day("2026-12-09") == nil)
    }

    @Test func aWeekThatIsntThereOrCantBeReadIsNil() {
        #expect(HomeWeek.from(engine: nil, madeOn: "2026-11-30") == nil)
        #expect(HomeWeek.from(engine: .string("week"), madeOn: "2026-11-30") == nil)
    }

    @Test func theWeekComesBackAsItWasSaved() throws {
        let defaults = try #require(UserDefaults(suiteName: "HomeWeekTests"))
        defaults.removePersistentDomain(forName: "HomeWeekTests")
        let week = try week()
        week.save(to: defaults)
        #expect(HomeWeek.load(from: defaults) == week)
    }

    @Test func plannedDaysKeepThePastAndDropADayThatStoppedTraining() throws {
        var planned = PlannedDays(days: ["2026-11-23", "2026-11-30", "2026-12-03"])
        planned.update(with: try week(), today: "2026-11-30")
        // Monday still trains, Thursday is home without time now, last Monday is the past.
        #expect(planned.days == ["2026-11-23", "2026-11-30"])
    }

    @Test func theFifthWeekIsLighterOnlyAfterFourFullWeeks() {
        let calendar = Fixture.calendar
        let mondays = ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]
        let planned = PlannedDays(days: mondays.flatMap { monday -> [String] in
            let start = PlannedDays.date(monday, calendar: calendar)!
            return [0, 3].map { PlannedDays.iso(calendar.date(byAdding: .day, value: $0, to: start)!, calendar: calendar) }
        })
        let all = Set(planned.days)
        #expect(planned.isLighterWeek(monday: "2026-11-30", done: all, calendar: calendar))
        #expect(!planned.isLighterWeek(monday: "2026-11-30", done: all.subtracting(["2026-11-19"]), calendar: calendar))
        // A week with nothing planned breaks the run of four.
        let gap = PlannedDays(days: planned.days.filter { !$0.hasPrefix("2026-11-1") || $0 < "2026-11-16" })
        #expect(!gap.isLighterWeek(monday: "2026-11-30", done: all, calendar: calendar))
    }

    @Test func aHomeSessionsCalendarEntryListsItsMovements() {
        let strength = PlanItem(id: "home", slot: Slot(start: Fixture.at(17, 0), end: Fixture.at(17, 25), activityType: "TraditionalStrengthTraining"))
        let walk = PlanItem(id: "walk", slot: Slot(start: Fixture.at(12, 0), end: Fixture.at(12, 30), activityType: "Walking"))
        let day = LocalTime(Fixture.storyDay, in: Fixture.calendar.timeZone).day
        let notes = [day: "Sit to stand, wall push-up, glute bridge"]
        let entries = CalendarEntry.entries(for: [strength, walk], storyDay: Fixture.storyDay, calendar: Fixture.calendar, notes: notes)
        // The strength session gets the movements; the walk the same day does not.
        #expect(entries.map(\.notes).sorted() == ["Planned by Evergreen.", "Planned by Evergreen.\nSit to stand, wall push-up, glute bridge"])
        #expect(CalendarEntry.entries(for: [strength], storyDay: Fixture.storyDay, calendar: Fixture.calendar).first?.notes == "Planned by Evergreen.")
    }

    #if DEBUG
    @Test @MainActor func theHomeSeedTrainsByTheRulesWithNothingToTrainWith() throws {
        let seeded = try #require(UITestSeed.launch(arguments: ["Evergreen", "-uiTest", "home"]))
        SuggestionTests.containers.append(seeded.container)
        let model = seeded.model
        #expect(model.userRules.isOn && model.userRules.equipment.isEmpty && model.userRules.restWeekdays == [2, 5, 6])
        #expect(model.settings != .standard && model.goingOutDays.count == 1)
        let days = try #require(UITestSeed.homeDays(today: Fixture.storyDay, calendar: Fixture.calendar))
        #expect(days.out < days.rain)
        for day in [days.out, days.rain] { #expect(![2, 5, 6].contains(UserRules.weekdayIndex(day, calendar: Fixture.calendar))) }
    }
    #endif
}
