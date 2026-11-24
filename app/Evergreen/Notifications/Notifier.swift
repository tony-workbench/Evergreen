import UserNotifications
import os

/// Local notifications: a reminder before each workout, and what the triggers say.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let reminderLead: TimeInterval = 30 * 60
    /// The 30-minute reminders reach a week ahead; the rest are planned as the week comes.
    static let reminderHorizon: TimeInterval = 7 * 24 * 60 * 60
    private static let log = Logger(subsystem: "com.evergreentraining.app", category: "notifications")

    private let center = UNUserNotificationCenter.current()
    private(set) var access: NotificationAccess = .notAsked

    /// Called when someone taps a notification, so the app can look again.
    var onOpen: (@MainActor () -> Void)?
    /// The person tapped "Undo" on a notification about a move; the value is the move's id.
    var onUndo: (@MainActor (String) -> Void)?
    /// A button on a day-at-home reminder; the value is the workout's day (YYYY-MM-DD). Awaited, so a button pressed on the
    /// lock screen finishes before the system suspends the app again.
    var onWorkoutAction: (@MainActor (WorkoutAction, String) async -> Void)?
    /// "Only at …" or "Move to …" on a day-at-home reminder: the time picked ("18:10") and the workout's day. Awaited too.
    var onPickTime: (@MainActor (String, String) async -> Void)?
    /// A notification was shown with the app open, or tapped: the app looks at what time it is now (a time of a day at
    /// home that passed without a start moves the session on). Called before the tap's own action.
    var onDelivered: (@MainActor () -> Void)?

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

    /// The categories: Start · Later today · Already done, Start · Already done · Skip today (I'm out or not feeling well),
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
        fixedCategories = Self.fixedCategorySet()
        super.init()
        center.delegate = self
        center.setNotificationCategories(fixedCategories)
    }

    /// The categories whose buttons are always the same.
    private static func fixedCategorySet() -> Set<UNNotificationCategory> {
        let undo = UNNotificationAction(identifier: undoAction, title: "Undo", options: [])
        let start = UNNotificationAction(identifier: WorkoutAction.start.rawValue, title: "Start", options: [.foreground])
        let startNow = UNNotificationAction(identifier: WorkoutAction.start.rawValue, title: "Start now", options: [.foreground])
        let later = UNNotificationAction(identifier: WorkoutAction.later.rawValue, title: "Later today", options: [])
        let homeTomorrow = UNNotificationAction(identifier: WorkoutAction.homeTomorrow.rawValue, title: "I’m home tomorrow", options: [])
        return [
            UNNotificationCategory(identifier: movedCategory, actions: [undo], intentIdentifiers: []),
            UNNotificationCategory(identifier: workoutCategory, actions: [start, later, doneAction], intentIdentifiers: []),
            UNNotificationCategory(identifier: workoutLastCategory, actions: [start, doneAction] + lastSkips, intentIdentifiers: []),
            UNNotificationCategory(identifier: workoutMovedCategory, actions: [startNow, doneAction], intentIdentifiers: []),
            UNNotificationCategory(identifier: tomorrowCategory, actions: [goingOutAction], intentIdentifiers: []),
            UNNotificationCategory(identifier: outTomorrowCategory, actions: [homeTomorrow], intentIdentifiers: []),
        ]
    }

    /// The last time of the day has room for four buttons (iOS shows no more): Start, Already done and the two skips that
    /// tell the app something. "Not today" is what leaving the last reminder alone already says, so it is on Today only.
    /// Skipping a day needs the phone unlocked, so a tap in a pocket can't do it; Today can take it back.
    private static var lastSkips: [UNNotificationAction] {
        [(WorkoutAction.skipOut, "Skip today: I’m out"), (.skipUnwell, "Skip today: not feeling well")]
            .map { UNNotificationAction(identifier: $0.0.rawValue, title: $0.1, options: [.authenticationRequired]) }
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

    /// One reminder 30 minutes before each workout given (the model has already kept them to the week ahead, out of the
    /// night and within each day's six: `AppModel.keptOtherReminders`), replaced on every change so moves and undos carry over.
    func scheduleReminders(for items: [PlanItem], now: Date, calendar: Calendar) async {
        guard access == .on else { return }
        let pending = await center.pendingNotificationRequests().map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.hasPrefix("reminder-") && !$0.hasPrefix(WorkoutReminders.prefix) })
        let horizon = now.addingTimeInterval(Self.reminderHorizon)
        for item in items {
            let at = item.slot.start.addingTimeInterval(-Self.reminderLead)
            guard at > now, at < horizon else { continue }
            let copy = NotificationCopy.reminder(item)
            let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            await add(Note(id: "reminder-\(item.id)-\(Int(item.slot.start.timeIntervalSince1970))", copy: copy,
                           trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
        }
    }

    /// The reminders for the days at home (`WorkoutReminders`), replaced as a whole on every change, or only one day's
    /// with `day` (a button pressed on the lock screen, when the rest of the week can't be read). `reminders` is asked
    /// when this change's turn comes, so a button pressed meanwhile is already part of it.
    func scheduleHomeReminders(calendar: Calendar = .current, day: String? = nil,
                               _ reminders: @escaping @MainActor @Sendable () -> [WorkoutReminder]) async {
        await inTurn { [self] in
            let pending = await center.pendingNotificationRequests().map(\.identifier)
            let replaced = day.map { WorkoutReminders.ids(pending, day: $0) } ?? pending.filter { $0.hasPrefix(WorkoutReminders.prefix) }
            center.removePendingNotificationRequests(withIdentifiers: replaced)
            guard access == .on else { return }
            let list = reminders().filter { reminder in day.map { reminder.day == $0 } ?? true }
            center.setNotificationCategories(fixedCategories.union(timedCategories(list)))
            for reminder in list {
                let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: reminder.fires)
                await add(Note(id: reminder.id, copy: (reminder.title, reminder.body),
                               trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false),
                               category: Self.category(of: reminder), info: ["day": reminder.day, "kind": reminder.kind.rawValue]))
            }
        }
    }

    /// Every Sunday at 20:00 (`AppModel.weekAheadWeekday`, `weekAheadHour`), "Your week ahead is ready", while the person
    /// plans by their rules. The week is worked out again when the app opens (and in the background when the system
    /// allows), so the words promise nothing more.
    func scheduleWeekAhead(_ on: Bool) async {
        center.removePendingNotificationRequests(withIdentifiers: [Self.weekAheadId])
        guard on, access == .on else { return }
        let copy = NotificationCopy.weekAhead
        let when = DateComponents(hour: AppModel.weekAheadHour, minute: 0, weekday: AppModel.weekAheadWeekday)
        await add(Note(id: Self.weekAheadId, copy: copy, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: true)))
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
        await add(Note(id: "now-\(id)", copy: copy, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false),
                       undoes: id.hasPrefix(Self.movePrefix) ? id : nil))
    }

    // MARK: Shared

    /// The ids of the moves the agent makes off a meeting; only those can be undone from the notification.
    static let movePrefix = "defend-"

    /// One notification to schedule: its id, what it says, when, its buttons (`category`), what a tap needs to know
    /// (`info`), and for a move off a meeting the move "Undo" takes back.
    private struct Note {
        var id: String
        var copy: (title: String, body: String)
        var trigger: UNNotificationTrigger
        var category: String?
        var info: [String: String] = [:]
        var undoes: String?
    }

    private func add(_ note: Note) async {
        let content = UNMutableNotificationContent()
        content.title = note.copy.title
        content.body = note.copy.body
        content.sound = .default
        content.userInfo = ["open": "today"]
        for (key, value) in note.info { content.userInfo[key] = value }
        if let category = note.category { content.categoryIdentifier = category }
        if let move = note.undoes {
            content.categoryIdentifier = Self.movedCategory
            content.userInfo["move"] = move
        }
        do {
            try await center.add(UNNotificationRequest(identifier: note.id, content: content, trigger: note.trigger))
        } catch {
            Self.log.error("Couldn't schedule \(note.id): \(error.localizedDescription)")
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Show banners even with the app open, so a move is seen when it happens.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await MainActor.run { self.onDelivered?() }
        return [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        let tap = Tap(action: response.actionIdentifier, day: info["day"] as? String, kind: info["kind"] as? String,
                      move: info["move"] as? String)
        await handle(tap)
    }

    /// What a tap on a notification carries: the button (or the body's default action) and what the notification said
    /// about itself (`info` in `add`).
    struct Tap: Equatable, Sendable {
        var action: String
        var day: String?
        var kind: String?
        var move: String?
    }

    /// A tap, done: the app looks at the time first (`onDelivered`), then the tap goes where `route` says. Waits for a
    /// reminder's button to be done.
    func handle(_ tap: Tap) async {
        onDelivered?()
        switch Self.route(tap) {
        case .undo(let move): onUndo?(move)
        case .pick(let clock, let day): await onPickTime?(clock, day)
        case .workout(let action, let day): await onWorkoutAction?(action, day)
        case .open: onOpen?()
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
    nonisolated static func route(_ tap: Tap) -> Route {
        if tap.action == undoAction, let move = tap.move { return .undo(move) }
        guard let day = tap.day else { return .open }
        if let clock = pickedClock(tap.action) { return .pick(clock, day: day) }
        if let workout = WorkoutAction(rawValue: tap.action) { return .workout(workout, day: day) }
        let sameDay = tap.kind.flatMap(WorkoutReminder.Kind.init(rawValue:)).map { $0 != .evening && $0 != .outTomorrow } ?? false
        return tap.action == UNNotificationDefaultActionIdentifier && sameDay ? .workout(.start, day: day) : .open
    }
}
