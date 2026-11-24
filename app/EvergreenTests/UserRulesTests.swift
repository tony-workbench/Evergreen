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

    @Test func aProfileWithAValueThatCantBeUsedChangesNothing() {
        #expect(throws: UserRules.ImportError.unreadable) { try UserRules().importing(Data("not json".utf8)) }
        #expect(throws: UserRules.ImportError.outOfRange) { try UserRules().importing(Data(#"{"restWeekdays":[7]}"#.utf8)) }
        #expect(throws: UserRules.ImportError.outOfRange) { try UserRules().importing(Data(#"{"equipment":["barbell"]}"#.utf8)) }
        #expect(throws: UserRules.ImportError.outOfRange) { try UserRules().importing(Data(#"{"window":{"from":"21:00","to":"12:00"}}"#.utf8)) }
    }

    @Test func aChangedRuleChangesTheWeeksKey() {
        var rules = UserRules()
        rules.isOn = true
        let before = WeekCache.key(day: "2026-11-30", rows: [], busy: [], rules: rules.cacheText)
        rules.restWeekdays = [5, 6]
        let after = WeekCache.key(day: "2026-11-30", rows: [], busy: [], rules: rules.cacheText)
        #expect(before != after)
        #expect(WeekCache.key(day: "2026-11-30", rows: [], busy: []) == WeekCache.key(day: "2026-11-30", rows: [], busy: [], rules: ""))
    }

    @Test func weekdaysAreCountedFromMonday() {
        let monday = Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: 30, hour: 9))!
        let sunday = Fixture.calendar.date(from: DateComponents(year: 2026, month: 12, day: 6, hour: 9))!
        #expect(UserRules.weekdayIndex(monday, calendar: Fixture.calendar) == 0)
        #expect(UserRules.weekdayIndex(sunday, calendar: Fixture.calendar) == 6)
    }
}
