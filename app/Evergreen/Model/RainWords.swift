import Foundation

/// A rain ask in the agent's words.
enum RainWords {
    /// "Rain at 8:30 tomorrow. Move to 2 PM, or go indoors?"
    static func headline(_ ask: RainAsk, now: Date, calendar: Calendar = .current) -> String {
        let start = ask.session.slot.start
        let day = calendar.isDate(start, inSameDayAs: now) ? "today"
            : calendar.isDate(start, inSameDayAs: now.addingTimeInterval(24 * 3600)) ? "tomorrow"
            : "on \(start.formatted(.dateTime.weekday(.wide)))"
        let rain = "Rain at \(Basis.hour(start, calendar).replacing(" AM", with: "").replacing(" PM", with: "")) \(day)."
        let move = ask.dryWindow.map { "Move to \(Basis.hour($0.start, calendar))" }
        switch (move, ask.places.isEmpty) {
        case (let move?, false): return "\(rain) \(move), or go indoors?"
        case (let move?, true): return "\(rain) \(move)?"
        case (nil, false): return "\(rain) Go indoors, or keep it?"
        case (nil, true): return "\(rain) No dry gap that day. Keep it?"
        }
    }

    /// "70% chance of rain during your run."
    static func detail(_ ask: RainAsk) -> String {
        "\(ask.worstProbability)% chance of rain during your \(Activity.noun(ask.session.slot))."
    }
}
