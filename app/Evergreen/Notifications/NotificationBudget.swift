import Foundation

/// Every notification the app sends, counted together: at most six on a day, none before 09:00 or from 22:00
/// (the plan's section 6, from the plugin's mobile-design/mobile-backend.md). A person whose own hours start earlier
/// (mornings from 06:00, or a window from 07:30) gets the reminders of those sessions from then. The reminders of a day
/// at home, the 30-minute reminder of any other workout, rain, a move off a meeting and "Your week ahead" all share the
/// six. What is sent at once (rain, a move) goes first, and the day-at-home reminders make room for it: the one at the
/// time, the last time and the evening word stay longest.
enum NotificationBudget {
    static let maxPerDay = 6
    /// Nothing before this hour, unless the person's own hours start earlier (`UserRules.notificationsFrom`).
    static let quietUntilHour = 9
    /// The earliest any session can start ("Mornings too, from 06:00").
    static let earliestSessionHour = 6
    static let quietFromHour = 22
    /// Notifications sent at once, counted by day: ["2026-11-19": 2]. A week is kept.
    static let sentKey = "notifications_sent_by_day"
    static let keptDays = 7

    /// Night: before `from` (09:00 unless the person's hours start earlier) or from 22:00.
    static func isQuiet(_ date: Date, calendar: Calendar, from: Int = quietUntilHour) -> Bool {
        let hour = calendar.component(.hour, from: date)
        return hour < from || hour >= quietFromHour
    }

    static func sent(on day: String, in defaults: UserDefaults) -> Int {
        (defaults.dictionary(forKey: sentKey) as? [String: Int])?[day] ?? 0
    }

    /// Takes one of the day's six for a notification about to be sent, in one step: false when none is left. Checking
    /// and counting together means two sent at the same moment can't both see the sixth as free.
    static func claim(on day: String, in defaults: UserDefaults) -> Bool {
        guard sent(on: day, in: defaults) < maxPerDay else { return false }
        recordSent(on: day, in: defaults)
        return true
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

    /// The kinds from the lowest rank to the highest; kinds in one group share a rank.
    private static let rankOrder: [[WorkoutReminder.Kind]] = [[.later], [.moved], [.soon], [.ask], [.now], [.evening, .outTomorrow], [.last]]

    private static func rank(_ kind: WorkoutReminder.Kind) -> Int {
        rankOrder.firstIndex { $0.contains(kind) } ?? rankOrder.count
    }
}
