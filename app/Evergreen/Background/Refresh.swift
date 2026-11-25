import BackgroundTasks
import Foundation

/// The background refresh: a few times a day iOS wakes the app, and it runs
/// the same three checks as in the foreground (a calendar change on a
/// workout, rain, shoes) and posts their notifications. Each check says a
/// thing once, however often it runs.
enum Refresh {
    /// Listed in Info.plist under `BGTaskSchedulerPermittedIdentifiers`.
    static let taskId = "com.evergreentraining.app.refresh"
    /// Not sooner than this after the last one; iOS decides the real time.
    static let earliest: TimeInterval = 2 * 3600

    /// Asks iOS for the next refresh. Called when the app leaves the screen and at the start of each refresh.
    static func schedule(now: Date = Date()) {
        let request = BGAppRefreshTaskRequest(identifier: taskId)
        request.earliestBeginDate = nextBegin(after: now, calendar: .current)
        // Refused on a simulator and when Background App Refresh is off; the foreground checks still run.
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Two hours on, or Sunday 20:00 if that comes first, so the next week can be built without the app being opened.
    /// iOS still picks the moment; the "Your week ahead" notification opens the app, which builds the week if no refresh has.
    static func nextBegin(after now: Date, calendar: Calendar) -> Date {
        let usual = now.addingTimeInterval(earliest)
        let sundayEvening = DateComponents(hour: AppModel.weekAheadHour, minute: 0, weekday: AppModel.weekAheadWeekday)
        guard let sunday = calendar.nextDate(after: now, matching: sundayEvening, matchingPolicy: .nextTime) else { return usual }
        return min(usual, sunday)
    }

    /// What one refresh does. The task is registered in `EvergreenApp` with `.backgroundTask(.appRefresh(Refresh.taskId))`.
    @MainActor
    static func run(_ model: AppModel) async {
        schedule()
        await model.checkTriggers(foreground: false)
    }
}
