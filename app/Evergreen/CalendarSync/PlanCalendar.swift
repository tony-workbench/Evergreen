import Foundation

/// The calendar the plan is kept on, as the app model uses it: the Evergreen
/// calendar on the device (`CalendarSync`), or a recording stand-in in tests.
@MainActor
protocol PlanCalendar: AnyObject {
    var access: CalendarAccess { get }
    var onChange: (@MainActor () -> Void)? { get set }
    @discardableResult
    func requestAccess() async -> Bool
    func sync(_ entries: [CalendarEntry], from storyDay: Date)
    func removeAllEvents(around storyDay: Date)
    func busyTimes(from storyDay: Date) async -> [Busy]
}

extension CalendarSync: PlanCalendar {}
