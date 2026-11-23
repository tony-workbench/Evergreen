import Foundation
import Testing
@testable import Evergreen

/// One name for a planned workout, wherever it is shown: the calendar
/// entry, the week picture, the rows and the notifications.
struct ActivityNameTests {
    static func slot(_ kind: ActivityKind, minutes: Int, type: String? = nil) -> Slot {
        let start = Date(timeIntervalSince1970: 1_795_000_000)
        return Slot(start: start, end: start.addingTimeInterval(Double(minutes) * 60), activityType: type ?? kind.healthType)
    }

    @Test func everyActivityInTheListHasItsOwnNameOnTheCalendar() {
        let named: [(ActivityKind, Int, String)] = [
            (.run, 40, "Run"), (.longRun, 75, "Long run"), (.walk, 30, "Walk"), (.strength, 45, "Strength"), (.yoga, 40, "Yoga"),
            (.ride, 60, "Ride"), (.swim, 30, "Swim"), (.stretch, 20, "Stretch"), (.elliptical, 30, "Elliptical"), (.other, 30, "Workout"),
        ]
        #expect(Set(named.map(\.0)).union([.rest]) == Set(ActivityKind.allCases))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        for (kind, minutes, title) in named {
            let slot = Self.slot(kind, minutes: minutes)
            let item = PlanItem(id: "p-\(kind.rawValue)", slot: slot)
            #expect(Activity.title(slot) == title, "\(kind)")
            // The calendar entry and the reminder say the same word.
            #expect(CalendarEntry.entries(for: [item], storyDay: slot.start, calendar: calendar).map(\.title) == [title], "\(kind)")
            #expect(NotificationCopy.reminder(item).title.hasPrefix(title + " at "), "\(kind)")
        }
        // An activity outside the list goes by its own name; a rest day is never written.
        #expect(Activity.title(Self.slot(.other, minutes: 30, type: "Rowing")) == "Rowing" && Activity.noun(Self.slot(.other, minutes: 30, type: "MixedCardio")) == "mixed cardio")
        #expect(CalendarEntry.entries(for: [PlanItem(id: "r", slot: Self.slot(.rest, minutes: 30))], storyDay: Date(), calendar: calendar).isEmpty)
        #expect(Activity.noun(Self.slot(.stretch, minutes: 20)) == "stretch" && Activity.noun(Self.slot(.longRun, minutes: 75)) == "long run")
    }
}
