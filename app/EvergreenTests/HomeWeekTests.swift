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

    /// Monday and Thursday planned and done in each of the weeks starting on `mondays`.
    private func doneWeeks(_ mondays: [String]) -> PlannedDays {
        let calendar = Fixture.calendar
        return PlannedDays(days: mondays.flatMap { monday -> [String] in
            let start = PlannedDays.date(monday, calendar: calendar)!
            return [0, 3].map { PlannedDays.iso(calendar.date(byAdding: .day, value: $0, to: start)!, calendar: calendar) }
        })
    }

    /// The Mondays of eleven weeks in a row, from 21 September 2026: week 1 is [0], week 5 is [4], week 10 is [9].
    private var elevenMondays: [String] {
        let start = PlannedDays.date("2026-09-21", calendar: Fixture.calendar)!
        return (0..<11).map { PlannedDays.iso(Fixture.calendar.date(byAdding: .day, value: 7 * $0, to: start)!, calendar: Fixture.calendar) }
    }

    @Test func theLighterWeekComesAfterEveryFourFullOnesAndNeverCounts() {
        let mondays = elevenMondays
        // Every week planned and done, the lighter ones too.
        let planned = doneWeeks(Array(mondays.prefix(10)))
        let done = Set(planned.days)
        let lighter = mondays.indices.filter { planned.isLighterWeek(monday: mondays[$0], done: done, calendar: Fixture.calendar) }
        #expect(lighter.map { $0 + 1 } == [5, 10], "weeks 5 and 10 are lighter; week 6 counts again from one")
        #expect(!planned.isLighterWeek(monday: mondays[5], done: done, calendar: Fixture.calendar), "week 6 is full again")
    }

    @Test func aKeptLighterWeekStillResetsTheCountOnceItsDaysHaveDroppedOff() throws {
        let mondays = elevenMondays
        // Only weeks 2 to 9 are still kept: without knowing week 5 was lighter, week 6 would look like the fifth full one.
        var planned = doneWeeks(Array(mondays[1...8]))
        let done = Set(planned.days)
        #expect(planned.isLighterWeek(monday: mondays[5], done: done, calendar: Fixture.calendar))
        planned.lighterWeeks = [mondays[4]]
        #expect(!planned.isLighterWeek(monday: mondays[5], done: done, calendar: Fixture.calendar))
        #expect(planned.isLighterWeek(monday: mondays[9], done: done, calendar: Fixture.calendar))
        // Settling week 10 keeps it, so it stays lighter all week, done or not.
        planned.settleLighterWeek(monday: mondays[9], done: done, calendar: Fixture.calendar)
        #expect(planned.lighterWeeks == [mondays[4], mondays[9]])
        #expect(planned.isLighterWeek(monday: mondays[9], done: [], calendar: Fixture.calendar))
        // An older saved copy without lighter weeks still reads.
        let old = #"{"days":["2026-11-02"]}"#
        #expect(try JSONDecoder().decode(PlannedDays.self, from: Data(old.utf8)).lighterWeeks == nil)
    }

    @Test func aHomeSessionsCalendarEntryListsItsMovements() {
        let strength = PlanItem(id: "home", slot: Slot(start: Fixture.at(17, 0), end: Fixture.at(17, 25), activityType: "TraditionalStrengthTraining"))
        let walk = PlanItem(id: "walk", slot: Slot(start: Fixture.at(12, 0), end: Fixture.at(12, 30), activityType: "Walking"))
        let day = LocalTime(Fixture.storyDay, in: Fixture.calendar.timeZone).day
        let notes = [day: "Sit to stand, wall push-up, glute bridge"]
        let entries = CalendarEntry.entries(.init(plan: [strength, walk], storyDay: Fixture.storyDay, calendar: Fixture.calendar,
                                                         marks: CalendarEntry.Marks(notes: notes)))
        // The strength session gets the movements; the walk the same day does not.
        #expect(entries.map(\.notes).sorted() == ["Planned by Evergreen.", "Planned by Evergreen.\nSit to stand, wall push-up, glute bridge"])
        #expect(CalendarEntry.entries(.init(plan: [strength], storyDay: Fixture.storyDay, calendar: Fixture.calendar)).first?.notes == "Planned by Evergreen.")
    }

    #if DEBUG
    @Test @MainActor func theHomeSeedTrainsByTheRulesWithNothingToTrainWith() throws {
        let seeded = try #require(UITestSeed.launch(arguments: ["Evergreen", "-uiTest", "home"]))
        SuggestionTests.containers.append(seeded.container)
        let model = seeded.model
        #expect(model.userRules.isOn && model.userRules.equipment.isEmpty && model.userRules.restWeekdays == [2, 5, 6])
        #expect(model.settings != .standard && model.goingOutDays.count == 1)
        let days = try #require(UITestSeed.homeDays(today: Fixture.storyDay, calendar: Fixture.calendar))
        #expect(days.rain < days.out)
        for day in [days.out, days.rain] { #expect(![2, 5, 6].contains(UserRules.weekdayIndex(day, calendar: Fixture.calendar))) }
    }
    #endif

    @Test func theBackgroundRefreshCanBeginAtSundayEvening() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let at = { (day: Int, hour: Int, minute: Int) in
            try #require(calendar.date(from: DateComponents(year: 2026, month: 12, day: day, hour: hour, minute: minute)))
        }
        // Sunday 6 December at 19:00: the next refresh may begin at 20:00, not two hours on.
        #expect(Refresh.nextBegin(after: try at(6, 19, 0), calendar: calendar) == (try at(6, 20, 0)))
        // A Tuesday: two hours on, as usual.
        #expect(Refresh.nextBegin(after: try at(1, 10, 0), calendar: calendar) == (try at(1, 12, 0)))
        // Sunday at 20:30, past the hour: two hours on, since the next Sunday is a week away.
        #expect(Refresh.nextBegin(after: try at(6, 20, 30), calendar: calendar) == (try at(6, 22, 30)))
    }
}
