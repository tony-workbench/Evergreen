import Foundation

/// The one time picked ahead for each day at home, by day ("2026-11-20" → "18:10"): in the week table, with "Only at …" on
/// the evening reminder, "Later today" or "Move to …". Kept in settings by its clock, so it stands when the week is worked
/// out again with other times. Days before today drop off.
enum ChosenSlot {
    static let key = "home_picked_time"

    /// The time picked for each day from `today` on.
    static func all(in defaults: UserDefaults, from today: String) -> [String: String] {
        (defaults.dictionary(forKey: key) as? [String: String] ?? [:]).filter { $0.key >= today }
    }

    /// Keeps `clock` for `day`, or with nil every time again.
    static func set(_ clock: String?, day: String, from today: String, in defaults: UserDefaults) {
        var picked = all(in: defaults, from: today)
        picked[day] = clock
        defaults.set(picked, forKey: key)
    }
}
