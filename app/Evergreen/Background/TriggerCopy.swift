import Foundation

/// The words of the notifications the real triggers send. Same voice as the
/// rest: what happened and why, no guilt, nothing to buy.
extension NotificationCopy {
    /// Rain is likely during an outdoor workout.
    static func rain(_ ask: RainAsk, now: Date, calendar: Calendar = .current) -> (title: String, body: String) {
        let noun = Activity.noun(ask.session.slot)
        let start = ask.session.slot.start
        let day = calendar.isDate(start, inSameDayAs: now) ? "today’s"
            : calendar.isDate(start, inSameDayAs: now.addingTimeInterval(24 * 3600)) ? "tomorrow’s"
            : "\(start.formatted(.dateTime.weekday(.wide)))’s"
        var body = "\(ask.worstProbability)% chance of rain around \(start.clock)."
        if let window = ask.dryWindow {
            body += " It looks dry from \(window.start.clock). Want to move it?"
        } else if let place = ask.places.first {
            body += " \(place.name) is \(place.distanceText) away if you’d rather go indoors."
        } else {
            body += " No dry gap that day, so it’s your call."
        }
        return ("Rain on \(day) \(noun)", body)
    }

    /// The running shoes reached a threshold.
    static func shoes(_ status: ShoeStatus) -> (title: String, body: String)? {
        guard let event = status.event, let line = status.line else { return nil }
        return (event == .replace ? "Time for new running shoes" : "A heads-up about your running shoes", line)
    }
}
