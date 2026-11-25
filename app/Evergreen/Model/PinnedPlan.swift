import Foundation

/// The fixed week the tour plays on its throwaway model: three workouts,
/// starting with tonight's 6 PM run. Never a person's plan.
enum PinnedPlan {
    struct Entry {
        /// Why this workout is on the week, as its row says it.
        let reason: String
        let dayOffset: Int
        let hour: Int
        let minute: Int
        let minutes: Int
        let activityType: String
    }

    static func entries(for key: PersonaKey) -> [Entry] {
        switch key {
        case .tour:
            [
                Entry(reason: "Easy pace to keep your week steady.", dayOffset: 0, hour: 18, minute: 0, minutes: 45, activityType: "Running"),
                Entry(reason: "Builds endurance in your open morning.", dayOffset: 1, hour: 8, minute: 30, minutes: 90, activityType: "Running"),
                Entry(reason: "Strength for your legs as miles climb.", dayOffset: 2, hour: 7, minute: 0, minutes: 40,
                      activityType: "FunctionalStrengthTraining"),
            ]
        case .me:
            [] // Nothing is on a person's plan until they add it.
        }
    }

    static func id(_ key: PersonaKey, _ entry: Entry) -> String {
        "plan-\(key.rawValue)-d\(entry.dayOffset)-\(entry.hour)\(entry.minute)"
    }

    /// Why a pinned workout is on the week, by its plan item id.
    static func reason(for itemId: String, key: PersonaKey) -> String? {
        entries(for: key).first { id(key, $0) == itemId }?.reason
    }

    static func items(for key: PersonaKey, storyDay: Date, calendar: Calendar = .current) -> [PlanItem] {
        entries(for: key).map { entry in
            let day = calendar.date(byAdding: .day, value: entry.dayOffset, to: storyDay)!
            let start = calendar.date(bySettingHour: entry.hour, minute: entry.minute, second: 0, of: day)!
            let end = start.addingTimeInterval(Double(entry.minutes) * 60)
            return PlanItem(id: id(key, entry), slot: Slot(start: start, end: end, activityType: entry.activityType))
        }
    }
}
