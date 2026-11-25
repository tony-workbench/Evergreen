import SwiftUI

/// Words for an action on the plan: what was done, the time before and
/// after, and why.
enum ActionCopy {
    static func headline(_ action: AgentAction) -> String {
        switch action.kind {
        case .move: "Saved your workout"
        case .shrink: "Made it fit"
        case .note: action.title ?? "Noted"
        case .addWorkout: action.title ?? "Added a workout"
        }
    }

    /// "12:00 PM, 30 min → 6:30 PM, 15 min", old value struck through.
    static func beforeAfter(_ action: AgentAction) -> Text? {
        switch (action.before, action.after) {
        case let (before?, after?):
            Text("\(Text(before.summary).strikethrough().foregroundStyle(Theme.textMuted)) → \(Text(after.summary).fontWeight(.semibold))")
        case let (nil, after?):
            Text(after.summary).fontWeight(.semibold)
        default:
            nil
        }
    }

    static func when(_ date: Date, now: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) {
            return calendar.component(.hour, from: date) >= 17 ? "tonight" : "today"
        }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) {
            return "tomorrow"
        }
        return date.formatted(.dateTime.weekday(.wide))
    }

    /// VoiceOver reads each action as one sentence.
    static func spoken(_ action: AgentAction) -> String {
        var parts = [headline(action)]
        if let after = action.after {
            parts.append("\(after.start.clock), \(after.minutes) minutes")
        }
        return parts.joined(separator: ", ") + ". " + action.reason
    }
}

// MARK: Moves

extension ActionCopy {
    /// "Thu 12:15 PM → Fri 12:15 PM", old time struck through; a shrink adds
    /// the new length.
    static func moveChange(_ action: AgentAction) -> Text? {
        guard let before = action.before, let after = action.after else { return nil }
        let old = dayClock(before.start)
        var new = dayClock(after.start)
        if after.minutes != before.minutes { new += ", \(after.minutes) min" }
        return Text("\(Text(old).strikethrough().foregroundStyle(Theme.textMuted)) → \(Text(new).fontWeight(.semibold))")
    }

    /// "A new meeting overlaps your Thursday workout." when the agent defended
    /// the slot; the agent's own reason otherwise.
    static func moveReason(_ action: AgentAction) -> String {
        guard action.id.hasPrefix("defend-"), let before = action.before else { return action.reason }
        let day = before.start.formatted(.dateTime.weekday(.wide))
        let next = action.after.map { " \($0.start.clock) is your next open time." } ?? ""
        return "A meeting landed on your \(day) workout.\(next)"
    }

    /// "Still three this week. You’re on track.", with the new place when there is one.
    static func moveKeep(_ action: AgentAction, countWord: String) -> String {
        ["Still \(countWord) this week. You’re on track.", action.after?.place].compactMap { $0 }.joined(separator: " · ")
    }

    /// "Thu 12:15 PM"
    static func dayClock(_ date: Date) -> String {
        "\(date.formatted(.dateTime.weekday(.abbreviated))) \(date.clock)"
    }
}
