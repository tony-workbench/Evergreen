import Foundation

/// Every notification the app sends, counted together: at most six on a day, none before 06:00 or from 22:00
/// (the plan's section 6, from the plugin's mobile-design/mobile-backend.md). The reminders of a day at home, the 30-minute
/// reminder of any other workout, rain, a move off a meeting and "Your week ahead" all share the six. What is sent at once
/// (rain, a move) goes first, and the day-at-home reminders make room for it: the one at the time, the last time and the
/// evening word stay longest.
enum NotificationBudget {
    static let maxPerDay = 6
    /// The earliest a session can be planned ("Mornings too, from 06:00"), so no reminder is needed before it.
    static let quietUntilHour = 6
    static let quietFromHour = 22
    /// Notifications sent at once, counted by day: ["2026-11-19": 2]. A week is kept.
    static let sentKey = "notifications_sent_by_day"
    static let keptDays = 7

    static func isQuiet(_ date: Date, calendar: Calendar) -> Bool {
        let hour = calendar.component(.hour, from: date)
        return hour < quietUntilHour || hour >= quietFromHour
    }

    static func sent(on day: String, in defaults: UserDefaults) -> Int {
        (defaults.dictionary(forKey: sentKey) as? [String: Int])?[day] ?? 0
    }

    static func recordSent(on day: String, in defaults: UserDefaults) {
        var all = (defaults.dictionary(forKey: sentKey) as? [String: Int]) ?? [:]
        all[day, default: 0] += 1
        defaults.set(Dictionary(uniqueKeysWithValues: all.sorted { $0.key < $1.key }.suffix(keptDays).map { ($0.key, $0.value) }),
                     forKey: sentKey)
    }

    /// Keeps the reminders that fire on each day within that day's room, dropping the least needed first, the latest of
    /// them first: a later time, the move, ten minutes before, the question, then the one at the time.
    static func fit(_ reminders: [WorkoutReminder], room: (String) -> Int, calendar: Calendar) -> [WorkoutReminder] {
        let firingDay = { (reminder: WorkoutReminder) in LocalTime(reminder.fires, in: calendar.timeZone).day }
        var kept = reminders
        for day in Set(reminders.map(firingDay)) {
            var onDay = kept.filter { firingDay($0) == day }
            while onDay.count > max(room(day), 0), let drop = onDay.min(by: { less($0, $1) }) {
                onDay.removeAll { $0.id == drop.id }
                kept.removeAll { $0.id == drop.id }
            }
        }
        return kept
    }

    /// Lower ranks go first; of two with the same rank, the later one goes first.
    private static func less(_ a: WorkoutReminder, _ b: WorkoutReminder) -> Bool {
        rank(a.kind) != rank(b.kind) ? rank(a.kind) < rank(b.kind) : a.fires > b.fires
    }

    private static func rank(_ kind: WorkoutReminder.Kind) -> Int {
        switch kind {
        case .later: 0
        case .moved: 1
        case .soon: 2
        case .ask: 3
        case .now: 4
        case .evening, .outTomorrow: 5
        case .last: 6
        }
    }
}
