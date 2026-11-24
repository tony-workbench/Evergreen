import UserNotifications
import os

/// Local notifications: a reminder before each workout, and what the triggers say.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let reminderLead: TimeInterval = 30 * 60
    private static let log = Logger(subsystem: "com.evergreentraining.app", category: "notifications")

    private let center = UNUserNotificationCenter.current()
    private(set) var access: NotificationAccess = .notAsked

    /// Called when someone taps a notification, so the app can look again.
    var onOpen: (@MainActor () -> Void)?
    /// The person tapped "Undo" on a notification about a move; the value is the move's id.
    var onUndo: (@MainActor (String) -> Void)?
    /// A button on a day-at-home reminder; the value is the workout's day (YYYY-MM-DD).
    var onWorkoutAction: (@MainActor (WorkoutAction, String) -> Void)?

    nonisolated static let movedCategory = "moved"
    nonisolated static let undoAction = "undo"

    /// The buttons on a day-at-home reminder. "Start" opens the app on the workout page; the others work without opening it.
    enum WorkoutAction: String, Sendable {
        case start
        case later
        case skipOut = "skip_out"
        case skipUnwell = "skip_unwell"
        case skipNotToday = "skip_not_today"
        case goingOut = "going_out"

        /// Why a day was skipped, as kept in the workout log; nil for the actions that aren't a skip.
        var skipReason: String? {
            switch self {
            case .skipOut: "out"
            case .skipUnwell: "unwell"
            case .skipNotToday: "not_today"
            default: nil
            }
        }
    }

    /// The categories: Start · Later today, Start · Skip today (with its reason), Start now, and I'm going out tomorrow.
    nonisolated static let workoutCategory = "workout"
    nonisolated static let workoutLastCategory = "workout_last"
    nonisolated static let workoutMovedCategory = "workout_moved"
    nonisolated static let tomorrowCategory = "home_tomorrow"

    override init() {
        super.init()
        center.delegate = self
        let undo = UNNotificationAction(identifier: Self.undoAction, title: "Undo", options: [])
        let start = UNNotificationAction(identifier: WorkoutAction.start.rawValue, title: "Start", options: [.foreground])
        let startNow = UNNotificationAction(identifier: WorkoutAction.start.rawValue, title: "Start now", options: [.foreground])
        let later = UNNotificationAction(identifier: WorkoutAction.later.rawValue, title: "Later today", options: [])
        let skips = [(WorkoutAction.skipOut, "Skip today: I’m out"), (.skipUnwell, "Skip today: not feeling well"), (.skipNotToday, "Skip today: not today")]
            .map { UNNotificationAction(identifier: $0.0.rawValue, title: $0.1, options: []) }
        let goingOut = UNNotificationAction(identifier: WorkoutAction.goingOut.rawValue, title: "I’m going out tomorrow", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.movedCategory, actions: [undo], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.workoutCategory, actions: [start, later], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.workoutLastCategory, actions: [start] + skips, intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.workoutMovedCategory, actions: [startNow], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.tomorrowCategory, actions: [goingOut], intentIdentifiers: []),
        ])
    }

    // MARK: Access

    func refreshAccess() async {
        let status = await center.notificationSettings().authorizationStatus
        access = switch status {
        case .authorized, .provisional, .ephemeral: .on
        case .notDetermined: .notAsked
        default: .off
        }
    }

    func requestAccess() async {
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            Self.log.error("Notification request failed: \(error.localizedDescription)")
        }
        await refreshAccess()
    }

    // MARK: Calendar trigger: reminders

    /// One reminder 30 minutes before each upcoming workout in the next week,
    /// replaced on every change so moves and undos carry over.
    /// They fire on the phone's real clock.
    func scheduleReminders(for items: [PlanItem]) async {
        guard access == .on else { return }
        let pending = await center.pendingNotificationRequests().map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.hasPrefix("reminder-") && !$0.hasPrefix(WorkoutReminders.prefix) })
        let horizon = Date.now.addingTimeInterval(7 * 24 * 3600)
        for item in items {
            let at = item.slot.start.addingTimeInterval(-Self.reminderLead)
            guard at > .now, at < horizon else { continue }
            let copy = NotificationCopy.reminder(item)
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            await add("reminder-\(item.id)-\(Int(item.slot.start.timeIntervalSince1970))", copy,
                      trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
        }
    }

    /// The reminders for the days at home (`WorkoutReminders`), replaced as a whole on every change.
    func scheduleHomeReminders(_ reminders: [WorkoutReminder], calendar: Calendar = .current) async {
        let pending = await center.pendingNotificationRequests().map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.hasPrefix(WorkoutReminders.prefix) })
        guard access == .on else { return }
        for reminder in reminders {
            let category = switch reminder.kind {
            case .evening: Self.tomorrowCategory
            case .moved: Self.workoutMovedCategory
            case .last: Self.workoutLastCategory
            case .soon, .now, .later: Self.workoutCategory
            }
            let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: reminder.fires)
            await add(reminder.id, (reminder.title, reminder.body), trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false),
                      category: category, info: ["day": reminder.day, "kind": reminder.kind.rawValue])
        }
    }

    /// "Later today": the reminders of `day` that would fire before `time` go, so the next one is at the later time.
    func dropHomeReminders(day: String, before time: Date) async {
        let pending = await center.pendingNotificationRequests()
        let ids = pending.filter { request in
            guard request.identifier.hasPrefix(WorkoutReminders.prefix + day),
                  let fires = (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() else { return false }
            return fires < time
        }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    /// Every Sunday at 20:00, "Your week ahead is ready", while the person plans by their rules. The week is worked out
    /// again when the app opens (and in the background when the system allows), so the words promise nothing more.
    func scheduleWeekAhead(_ on: Bool) async {
        center.removePendingNotificationRequests(withIdentifiers: [Self.weekAheadId])
        guard on, access == .on else { return }
        let copy = NotificationCopy.weekAhead
        await add(Self.weekAheadId, copy, trigger: UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: 20, minute: 0, weekday: 1), repeats: true))
    }

    static let weekAheadId = "week-ahead"

    /// Takes off what is left of a day's workout reminders, once the day's session is done.
    func cancelReminders(on day: Date, calendar: Calendar = .current) async {
        let pending = await center.pendingNotificationRequests()
        let ids = pending.filter { request in
            guard request.identifier.hasPrefix("reminder-"), let trigger = request.trigger as? UNCalendarNotificationTrigger,
                  let fires = trigger.nextTriggerDate() else { return false }
            return calendar.isDate(fires, inSameDayAs: day)
        }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    // MARK: Now

    /// A notification right away, such as "I moved your run". It shows as a
    /// banner even with the app open.
    func send(_ copy: (title: String, body: String), id: String) async {
        guard access == .on else { return }
        await add("now-\(id)", copy, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false),
                  undoes: id.hasPrefix(Self.movePrefix) ? id : nil)
    }

    // MARK: Shared

    /// The ids of the moves the agent makes off a meeting; only those can be undone from the notification.
    static let movePrefix = "defend-"

    private func add(_ id: String, _ copy: (title: String, body: String), trigger: UNNotificationTrigger,
                     undoes move: String? = nil, category: String? = nil, info: [String: String] = [:]) async {
        let content = UNMutableNotificationContent()
        content.title = copy.title
        content.body = copy.body
        content.sound = .default
        content.userInfo = ["open": "today"]
        for (key, value) in info { content.userInfo[key] = value }
        if let category { content.categoryIdentifier = category }
        if let move {
            content.categoryIdentifier = Self.movedCategory
            content.userInfo["move"] = move
        }
        do {
            try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        } catch {
            Self.log.error("Couldn't schedule \(id): \(error.localizedDescription)")
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Show banners even with the app open, so a move is seen when it happens.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let undone = response.actionIdentifier == Self.undoAction
            ? response.notification.request.content.userInfo["move"] as? String : nil
        let workout = WorkoutAction(rawValue: response.actionIdentifier)
        let day = response.notification.request.content.userInfo["day"] as? String
        await MainActor.run {
            if let undone { self.onUndo?(undone) }
            else if let workout, let day { self.onWorkoutAction?(workout, day) }
            else { self.onOpen?() }
        }
    }
}
