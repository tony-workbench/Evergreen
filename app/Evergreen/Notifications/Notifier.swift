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
    /// "Only at …" or "Move to …" on a day-at-home reminder: the time picked ("18:10") and the workout's day.
    var onPickTime: (@MainActor (String, String) -> Void)?

    nonisolated static let movedCategory = "moved"
    nonisolated static let undoAction = "undo"

    /// The buttons on a day-at-home reminder. "Start" opens the app on the workout page; the others work without opening it.
    enum WorkoutAction: String, Sendable {
        case start
        case later
        case alreadyDone = "already_done"
        case skipOut = "skip_out"
        case skipUnwell = "skip_unwell"
        case skipNotToday = "skip_not_today"
        case goingOut = "going_out"
        case homeTomorrow = "home_tomorrow"

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

    /// The categories: Start · Later today · Already done, Start · Already done · Skip today (with its reason),
    /// Start now · Already done, I'm going out tomorrow (with "Only at …" when the reminder names times), and I'm home tomorrow.
    nonisolated static let workoutCategory = "workout"
    nonisolated static let workoutLastCategory = "workout_last"
    nonisolated static let workoutMovedCategory = "workout_moved"
    nonisolated static let tomorrowCategory = "home_tomorrow"
    nonisolated static let outTomorrowCategory = "out_tomorrow"

    /// The evening reminder with its "Only at …" buttons, and the question twenty minutes after a picked time with its
    /// "Move to …": their buttons name times, so they get a category for each set of times ("home_tomorrow|16:40,18:10").
    nonisolated static let askCategory = "workout_ask"
    nonisolated static let pickPrefix = "pick|"

    /// The buttons that are the same on every notification of their kind.
    private let fixedCategories: Set<UNNotificationCategory>

    /// Notification changes one after another, so a button pressed while the reminders are being planned again can't be
    /// undone by them: whatever is planned is worked out when its turn comes, from what is true then.
    private var queue: Task<Void, Never>?

    override init() {
        let undo = UNNotificationAction(identifier: Self.undoAction, title: "Undo", options: [])
        let start = UNNotificationAction(identifier: WorkoutAction.start.rawValue, title: "Start", options: [.foreground])
        let startNow = UNNotificationAction(identifier: WorkoutAction.start.rawValue, title: "Start now", options: [.foreground])
        let later = UNNotificationAction(identifier: WorkoutAction.later.rawValue, title: "Later today", options: [])
        let skips = [(WorkoutAction.skipOut, "Skip today: I’m out"), (.skipUnwell, "Skip today: not feeling well"), (.skipNotToday, "Skip today: not today")]
            // Skipping a day needs the phone unlocked, so a tap in a pocket can't do it; Today can take it back.
            .map { UNNotificationAction(identifier: $0.0.rawValue, title: $0.1, options: [.authenticationRequired]) }
        fixedCategories = [
            UNNotificationCategory(identifier: Self.movedCategory, actions: [undo], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.workoutCategory, actions: [start, later, Self.doneAction], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.workoutLastCategory, actions: [start, Self.doneAction] + skips, intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.workoutMovedCategory, actions: [startNow, Self.doneAction], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.tomorrowCategory, actions: [Self.goingOutAction], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.outTomorrowCategory,
                                   actions: [UNNotificationAction(identifier: WorkoutAction.homeTomorrow.rawValue, title: "I’m home tomorrow", options: [])],
                                   intentIdentifiers: []),
        ]
        super.init()
        center.delegate = self
        center.setNotificationCategories(fixedCategories)
    }

    /// Marks the day done and takes off the rest of its reminders, so it needs the phone unlocked; Today can take it back.
    private static var doneAction: UNNotificationAction {
        UNNotificationAction(identifier: WorkoutAction.alreadyDone.rawValue, title: "Already done", options: [.authenticationRequired])
    }

    private static var goingOutAction: UNNotificationAction {
        UNNotificationAction(identifier: WorkoutAction.goingOut.rawValue, title: "I’m going out tomorrow", options: [])
    }

    /// The category of a day-at-home reminder: its buttons.
    nonisolated static func category(of reminder: WorkoutReminder) -> String {
        switch reminder.kind {
        case .evening: reminder.choices.isEmpty ? tomorrowCategory : tomorrowCategory + "|" + reminder.choices.joined(separator: ",")
        case .ask: askCategory + "|" + reminder.choices.joined(separator: ",")
        case .moved: workoutMovedCategory
        case .last: workoutLastCategory
        case .outTomorrow: outTomorrowCategory
        case .soon, .now, .later: workoutCategory
        }
    }

    /// The button of a picked time, and the time a button picks ("pick|18:10" → "18:10").
    nonisolated static func pickAction(_ clock: String) -> String { pickPrefix + clock }
    nonisolated static func pickedClock(_ action: String) -> String? {
        action.hasPrefix(pickPrefix) ? String(action.dropFirst(pickPrefix.count)) : nil
    }

    /// The categories whose buttons name times, for the reminders about to be scheduled.
    private func timedCategories(_ reminders: [WorkoutReminder]) -> Set<UNNotificationCategory> {
        Set(reminders.filter { ($0.kind == .evening && !$0.choices.isEmpty) || $0.kind == .ask }.map { reminder in
            let picks = reminder.choices.map { clock in
                UNNotificationAction(identifier: Self.pickAction(clock),
                                     title: reminder.kind == .ask ? "Move to \(clock)" : "Only at \(clock)", options: [])
            }
            let rest = reminder.kind == .ask
                ? [Self.doneAction, UNNotificationAction(identifier: WorkoutAction.skipNotToday.rawValue, title: "Skip today",
                                                         options: [.authenticationRequired])]
                : [Self.goingOutAction]
            return UNNotificationCategory(identifier: Self.category(of: reminder), actions: picks + rest, intentIdentifiers: [])
        })
    }

    /// Runs notification changes in the order they were asked for.
    private func inTurn(_ work: @escaping @MainActor @Sendable () async -> Void) async {
        let before = queue
        let mine = Task { @MainActor in
            await before?.value
            await work()
        }
        queue = mine
        await mine.value
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

    /// The reminders for the days at home (`WorkoutReminders`), replaced as a whole on every change. `reminders` is asked
    /// when this change's turn comes, so a button pressed meanwhile is already part of it.
    func scheduleHomeReminders(calendar: Calendar = .current, _ reminders: @escaping @MainActor @Sendable () -> [WorkoutReminder]) async {
        await inTurn { [self] in
            let pending = await center.pendingNotificationRequests().map(\.identifier)
            center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.hasPrefix(WorkoutReminders.prefix) })
            guard access == .on else { return }
            let list = reminders()
            center.setNotificationCategories(fixedCategories.union(timedCategories(list)))
            for reminder in list {
                let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: reminder.fires)
                await add(reminder.id, (reminder.title, reminder.body), trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false),
                          category: Self.category(of: reminder), info: ["day": reminder.day, "kind": reminder.kind.rawValue])
            }
        }
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

    /// Takes off what is left of one day's home workout reminders, once its session is done or skipped. Only that day's:
    /// another day's reminders, the evening one about tomorrow and the other notifications stay.
    func cancelHomeReminders(day: String) async {
        await inTurn { [self] in
            let pending = await center.pendingNotificationRequests().map(\.identifier)
            center.removePendingNotificationRequests(withIdentifiers: WorkoutReminders.ids(pending, day: day))
        }
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
        let info = response.notification.request.content.userInfo
        let route = Self.route(action: response.actionIdentifier, day: info["day"] as? String, kind: info["kind"] as? String,
                               move: info["move"] as? String)
        await MainActor.run {
            switch route {
            case .undo(let move): self.onUndo?(move)
            case .pick(let clock, let day): self.onPickTime?(clock, day)
            case .workout(let action, let day): self.onWorkoutAction?(action, day)
            case .open: self.onOpen?()
            }
        }
    }

    /// Where a tap on a notification goes.
    enum Route: Equatable, Sendable {
        case undo(String)
        case pick(String, day: String)
        case workout(WorkoutAction, day: String)
        case open
    }

    /// A button does what it says. A tap on the body of a reminder of the day's session opens the workout page (Start);
    /// on the evening reminder, or any other notification, it opens Today.
    nonisolated static func route(action: String, day: String?, kind: String?, move: String?) -> Route {
        if action == undoAction, let move { return .undo(move) }
        if let clock = pickedClock(action), let day { return .pick(clock, day: day) }
        if let workout = WorkoutAction(rawValue: action), let day { return .workout(workout, day: day) }
        let sameDay = kind.flatMap(WorkoutReminder.Kind.init(rawValue:)).map { $0 != .evening && $0 != .outTomorrow } ?? false
        if action == UNNotificationDefaultActionIdentifier, sameDay, let day { return .workout(.start, day: day) }
        return .open
    }
}
