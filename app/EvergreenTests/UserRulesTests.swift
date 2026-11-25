import Foundation
import Testing
@testable import Evergreen

/// The person's rules: kept as they set them, sent to the engine without home,
/// imported from a profile file, and part of the week's cache key.
struct UserRulesTests {
    @Test func theDefaultsAreTheGenericWeekAndOff() {
        let rules = UserRules()
        #expect(!rules.isOn)
        #expect(rules.restWeekdays == [2, 5, 6])
        #expect(rules.sessionMin == 20 && rules.sessionMax == 25)
        #expect(rules.windowFrom == "12:00" && rules.windowTo == "20:30")
        #expect(!rules.mornings)
        #expect(rules.isValid)
        #expect(rules.cacheText.isEmpty)
    }

    @Test func savedRulesComeBackTheSame() throws {
        let defaults = try #require(UserDefaults(suiteName: "UserRulesTests"))
        defaults.removePersistentDomain(forName: "UserRulesTests")
        var rules = UserRules()
        rules.isOn = true
        rules.avoid = ["jump_squat"]
        rules.home = HomePlace(place: Coordinate(latitude: 1, longitude: 2))
        rules.save(to: defaults)
        #expect(UserRules.load(from: defaults) == rules)
    }

    @Test func theEngineGetsTheRulesButNeverHome() {
        var rules = UserRules()
        rules.isOn = true
        rules.home = HomePlace(place: Coordinate(latitude: 1, longitude: 2))
        guard case .object(let fields) = rules.engineValue else { Issue.record("not an object"); return }
        #expect(Set(fields.keys) == ["restWeekdays", "sessionMinutes", "window", "mornings", "equipment", "avoid", "movements"])
        #expect(fields["window"]?["from"] == .string("12:00"))
    }

    @Test func aProfileFillsTheAnswersAndTurnsTheRulesOn() throws {
        let profile = #"{"restWeekdays":[6,2],"sessionMinutes":{"min":20,"max":25},"window":{"from":"12:00","to":"20:30"},"#
            + #""equipment":["backpack","floor"],"avoid":["burpee"],"movements":{"split_squat":"can"},"farKilometres":25,"note":"ignored"}"#
        let rules = try UserRules().importing(Data(profile.utf8))
        #expect(rules.isOn)
        #expect(rules.restWeekdays == [2, 6])
        #expect(rules.equipment == [.backpack])
        #expect(rules.avoid == ["burpee"])
        #expect(rules.movements["split_squat"] == .can)
        #expect(rules.farKilometres == 25)
    }

    @Test func aProfileWithAValueThatCantBeUsedChangesNothing() throws {
        #expect(throws: UserRules.ImportError.unreadable) { try UserRules().importing(Data("not json".utf8)) }
        #expect(throws: UserRules.ImportError.outOfRange) { try UserRules().importing(Data(#"{"restWeekdays":[7]}"#.utf8)) }
        #expect(throws: UserRules.ImportError.outOfRange) { try UserRules().importing(Data(#"{"equipment":["barbell"]}"#.utf8)) }
        // A movement id that isn't in the library is refused, not kept.
        #expect(throws: UserRules.ImportError.outOfRange) { try UserRules().importing(Data(#"{"avoid":["made_up"]}"#.utf8), library: ["glute_bridge"]) }
        #expect(try UserRules().importing(Data(#"{"avoid":["glute_bridge"]}"#.utf8), library: ["glute_bridge"]).avoid == ["glute_bridge"])
        #expect(throws: UserRules.ImportError.outOfRange) { try UserRules().importing(Data(#"{"window":{"from":"21:00","to":"12:00"}}"#.utf8)) }
    }

    @Test func aChangedRuleChangesTheWeeksKey() {
        var rules = UserRules()
        rules.isOn = true
        let before = WeekCache.key(.init(day: "2026-11-30", rows: [], busy: [], rules: rules.cacheText))
        rules.restWeekdays = [5, 6]
        let after = WeekCache.key(.init(day: "2026-11-30", rows: [], busy: [], rules: rules.cacheText))
        #expect(before != after)
        #expect(WeekCache.key(.init(day: "2026-11-30", rows: [], busy: [])) == WeekCache.key(.init(day: "2026-11-30", rows: [], busy: [], rules: "")))
    }

    @Test func crossedHoursAreSaidAsTheirOwnProblem() {
        var rules = UserRules()
        rules.windowFrom = "12:00"
        rules.windowTo = "09:00"
        #expect(rules.problems == [.window])
        #expect(!rules.isValid)
    }

    @Test func everyProblemMakesTheRulesInvalidAndNoneMeansValid() {
        #expect(UserRules().problems.isEmpty && UserRules().isValid)
        var rules = UserRules()
        rules.sessionMin = 30
        rules.sessionMax = 20
        rules.windowFrom = "25:00"
        rules.restWeekdays = [7]
        #expect(rules.problems == [.restDays, .lengths, .clock], "in the order the screen shows the answers")
        #expect(!rules.isValid)
    }

    @Test func notTriedYetIsKeptAsNothingSaid() {
        var rules = UserRules()
        rules.setState(.cannot, of: "push_up")
        #expect(rules.state(of: "push_up") == .cannot)
        rules.setState(.untried, of: "push_up")
        #expect(rules.movements["push_up"] == nil && rules.state(of: "push_up") == .untried)
    }

    @Test func weekdaysAreCountedFromMonday() {
        let monday = Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: 30, hour: 9))!
        let sunday = Fixture.calendar.date(from: DateComponents(year: 2026, month: 12, day: 6, hour: 9))!
        #expect(UserRules.weekdayIndex(monday, calendar: Fixture.calendar) == 0)
        #expect(UserRules.weekdayIndex(sunday, calendar: Fixture.calendar) == 6)
    }

    @Test func savedRulesMissingAFieldKeepTheRestAndStayOn() throws {
        let saved = #"{"isOn":true,"restWeekdays":[0,6],"sessionMin":15,"sessionMax":20,"avoid":["jump_squat"],"equipment":["backpack","rocket"]}"#
        let rules = try JSONDecoder().decode(UserRules.self, from: Data(saved.utf8))
        #expect(rules.isOn)
        #expect(rules.restWeekdays == [0, 6])
        #expect(rules.sessionMin == 15 && rules.sessionMax == 20)
        #expect(rules.avoid == ["jump_squat"])
        #expect(rules.equipment == [.backpack])
        #expect(rules.windowFrom == "12:00" && rules.windowTo == "20:30")
        #expect(rules.farKilometres == HomePlace.defaultFarKilometres)
    }
}
