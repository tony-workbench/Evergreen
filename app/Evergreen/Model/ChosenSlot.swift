import Foundation

/// The one time picked ahead for each day at home, by day ("2026-11-20" → "18:10"): in the week table, with "Only at …" on
/// the evening reminder, "Later today" or "Move to …". Kept in settings by its clock, so it stands when the week is worked
/// out again with other times. Days before today drop off.
enum ChosenSlot {
    static let key = "home_picked_time"
    /// Where an earlier build kept the same picks, in the same form. Read once, moved to `key`, then removed.
    static let oldKey = "home_picked_later"

    /// The time picked for each day from `today` on.
    static func all(in defaults: UserDefaults, from today: String) -> [String: String] {
        migrate(defaults)
        return (defaults.dictionary(forKey: key) as? [String: String] ?? [:]).filter { $0.key >= today }
    }

    /// One pick: the time (nil for every time again), the day it is for, and today, before which days drop off.
    struct Pick {
        var clock: String?
        var day: String
        var today: String
    }

    /// Keeps the pick's time for its day, or with nil every time again.
    static func set(_ pick: Pick, in defaults: UserDefaults) {
        var picked = all(in: defaults, from: pick.today)
        picked[pick.day] = pick.clock
        defaults.set(picked, forKey: key)
    }

    /// Moves picks kept under the old key to the new one. A day picked under both keeps the new key's time.
    static func migrate(_ defaults: UserDefaults) {
        guard defaults.object(forKey: oldKey) != nil else { return }
        guard let old = defaults.dictionary(forKey: oldKey) as? [String: String] else {
            defaults.removeObject(forKey: oldKey)   // nothing readable there: nothing to keep
            return
        }
        let current = defaults.dictionary(forKey: key) as? [String: String] ?? [:]
        defaults.set(old.merging(current) { _, new in new }, forKey: key)
        defaults.removeObject(forKey: oldKey)
    }
}
