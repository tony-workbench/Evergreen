import Foundation

/// A suggestion as sentences, never as a dotted string of labels.
enum SuggestionWords {
    /// "Run, Monday at 7." The one large statement on Today.
    static func statement(_ session: WeekPlan.Session, calendar: Calendar = .current) -> String {
        guard let slot = session.after else { return session.title }
        return "\(Activity.title(slot)), \(slot.start.formatted(.dateTime.weekday(.wide))) \(at(slot.start, calendar))."
    }

    /// "40 minutes, as usual." or "27 minutes. Kept short so this week stays close to your normal."
    /// A reason that only repeats the statement ("Your usual Monday 7 AM run.") is said as "as usual".
    static func detail(_ session: WeekPlan.Session) -> String {
        guard let slot = session.after else { return PlainWords.reason(session.reason) }
        let reason = PlainWords.reason(session.reason)
        let sentences = reason.split(separator: ". ", omittingEmptySubsequences: true).map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: ". ")) }
        let usual = sentences.first?.lowercased().hasPrefix("your usual") == true
        let rest = (usual ? Array(sentences.dropFirst()) : sentences).filter { !$0.isEmpty }.map { $0 + "." }
        return (["\(slot.minutes) minutes\(usual ? ", as usual" : "")."] + rest).joined(separator: " ")
    }

    /// "at 7", "at 7:30", "at noon", "at 6 PM": mornings need no AM.
    static func at(_ date: Date, _ calendar: Calendar = .current) -> String {
        let hour = calendar.component(.hour, from: date), minute = calendar.component(.minute, from: date)
        if hour == 12, minute == 0 { return "at noon" }
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        let clock = minute == 0 ? "\(twelve)" : String(format: "%d:%02d", twelve, minute)
        return hour >= 12 ? "at \(clock) PM" : "at \(clock)"
    }

    /// The headline kept for VoiceOver and the Why sheet: the statement and its detail.
    static func headline(_ session: WeekPlan.Session) -> String {
        "\(statement(session)) \(detail(session))"
    }
}
