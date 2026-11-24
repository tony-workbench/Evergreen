import Foundation

/// The things Evergreen does by itself, each of which the person can turn off in Settings. All are on until turned off,
/// except "Always ask me to pick one time", which is off until turned on.
enum Automatic: String, CaseIterable, Identifiable, Sendable {
    case memory = "auto_memory"
    case week = "auto_week"
    case rain = "auto_rain"
    case shoes = "auto_shoes"
    case meetings = "auto_meetings"
    case keepReminding = "auto_keep_reminding"
    case pickEachDay = "auto_pick_each_day"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .memory: "Daily memory update"
        case .week: "Weekly suggestions"
        case .rain: "Rain check"
        case .shoes: "Shoe mileage check"
        case .meetings: "Move workouts around new meetings"
        case .keepReminding: "Keep reminding me until I’ve trained"
        case .pickEachDay: "Always ask me to pick one time"
        }
    }

    /// One line on what it does and what it costs.
    var hint: String {
        switch self {
        case .memory: "One AI call a day."
        case .week: "One AI call when the day, what I remember or your calendar changes."
        case .rain: "For outdoor workouts in the next two days. No AI."
        case .shoes: "From your runs in Apple Health. No AI."
        case .meetings: "To the nearest free time, with Undo. No AI."
        case .keepReminding: "On a day at home: at the time and at each later time, up to six a day, none after 22:00. No AI."
        case .pickEachDay: "Each day at home keeps only the time you pick, the evening before or in the week, and nothing moves by itself. Until you pick, only the first time reminds. No AI."
        }
    }

    /// What it is before the person touches it.
    var startsOn: Bool { self != .pickEachDay }

    func isOn(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: rawValue) as? Bool ?? startsOn
    }

    /// Whether changing it changes the reminders of the days at home.
    var changesReminders: Bool { self == .keepReminding || self == .pickEachDay }
}
