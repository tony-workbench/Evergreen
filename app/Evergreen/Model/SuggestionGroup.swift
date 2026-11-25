import Foundation

/// Suggested sessions that are the same thing on different days (the same
/// activity, time, length and reason) as one item with its days, so a week
/// of 7 AM runs is one line and not five. Only sessions that really differ
/// get a line of their own.
struct SuggestionGroup: Identifiable, Equatable {
    /// In time order.
    var sessions: [WeekPlan.Session]

    var id: String { sessions.map(\.id).joined(separator: "+") }

    static let weekdayWords = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    /// A reason with its weekday taken out, so "Your usual Monday 7 AM run." and "Your usual Tuesday 7 AM run." are the same.
    static func withoutWeekday(_ reason: String) -> String {
        reason.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .filter { !weekdayWords.contains(String($0)) }.joined(separator: " ")
    }

    static func groups(_ sessions: [WeekPlan.Session], calendar: Calendar = .current) -> [SuggestionGroup] {
        var order: [String] = [], byKey: [String: [WeekPlan.Session]] = [:]
        for session in sessions.sorted(by: { ($0.after?.start ?? .distantFuture) < ($1.after?.start ?? .distantFuture) }) {
            guard let slot = session.after else { continue }
            let parts = calendar.dateComponents([.hour, .minute], from: slot.start)
            let key = "\(slot.activityType)|\(parts.hour ?? 0):\(parts.minute ?? 0)|\(slot.minutes)|\(withoutWeekday(session.reason))"
            if byKey[key] == nil { order.append(key) }
            byKey[key, default: []].append(session)
        }
        return order.compactMap { byKey[$0].map(SuggestionGroup.init(sessions:)) }
    }

    /// Monday 0 to Sunday 6, for the day markers.
    func weekdays(_ calendar: Calendar = .current) -> Set<Int> {
        Set(sessions.compactMap { $0.after.map { (calendar.component(.weekday, from: $0.start) + 5) % 7 } })
    }

    /// One line for the item: a single session as its statement and detail,
    /// several as what they share ("Your usual 7 AM run, 40 minutes.").
    func sentence(_ calendar: Calendar = .current) -> String {
        guard let first = sessions.first, let slot = first.after else { return "" }
        if sessions.count == 1 { return "\(SuggestionWords.statement(first, calendar: calendar)) \(SuggestionWords.detail(first))" }
        let noun = Activity.noun(slot)
        let time = SuggestionWords.at(slot.start, calendar).replacing("at ", with: "")
        let usual = PlainWords.reason(first.reason).lowercased().hasPrefix("your usual")
        let clock = calendar.component(.hour, from: slot.start) < 12 && time != "noon" ? "\(time) AM" : time
        return usual ? "Your usual \(clock) \(noun), \(slot.minutes) minutes." : "\(Activity.title(slot)) at \(clock), \(slot.minutes) minutes. \(PlainWords.reason(first.reason))"
    }
}
