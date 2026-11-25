import Foundation

/// A usual time as the memory brief writes it. A brief line and a stopped
/// entry carry no data besides their words, so the activity, weekday and
/// hour are read from those: a line says "Running Sun 6 AM (3 of the last 4
/// weeks)." and a stopped entry "Running, Sunday 6 AM".
struct UsualTime: Equatable, Sendable {
    /// The activity in the brief's words, lowercased: "running", "strength training".
    var activity: String
    /// 1 (Monday) to 7 (Sunday).
    var weekday: Int
    var hour: Int

    /// From the text of a brief line; nil when it isn't a usual time.
    init?(line text: String) {
        guard let found = text.firstMatch(of: /^(.+) (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (AM|PM) \(/),
              let day = PlainWords.weekdays.firstIndex(where: { $0.hasPrefix(found.2) })
        else { return nil }
        self.init(activity: String(found.1), day: day, clock: String(found.3), half: String(found.4))
    }

    /// From the label of a stopped entry; nil when it isn't a usual time.
    init?(label: String) {
        guard let found = label.wholeMatch(of: /(.+), (\w+day) (\d{1,2}) (AM|PM)/),
              let day = PlainWords.weekdays.firstIndex(of: String(found.2))
        else { return nil }
        self.init(activity: String(found.1), day: day, clock: String(found.3), half: String(found.4))
    }

    private init?(activity: String, day: Int, clock: String, half: String) {
        guard let twelve = Int(clock), (1...12).contains(twelve) else { return nil }
        self.activity = activity.lowercased()
        weekday = day + 1
        hour = twelve % 12 + (half == "PM" ? 12 : 0)
    }

    var weekdayName: String { PlainWords.weekdays[weekday - 1] }

    /// "run" for running, "do strength training" for strength training.
    var verb: String {
        switch activity {
        case "running": "run"
        case "walking": "walk"
        case "cycling": "ride"
        case "swimming": "swim"
        case "hiking": "hike"
        case "rowing": "row"
        case "dance": "dance"
        default: "do \(activity)"
        }
    }

    /// A few words for it: "Sunday 6 AM runs", "Monday 6 PM strength sessions".
    var title: String {
        let sessions = switch activity {
        case "running": "runs"
        case "walking": "walks"
        case "cycling": "rides"
        case "swimming": "swims"
        case "hiking": "hikes"
        case "strength training": "strength sessions"
        default: activity + " sessions"
        }
        return "\(weekdayName) \(PlainWords.clock(hour)) \(sessions)"
    }
}
