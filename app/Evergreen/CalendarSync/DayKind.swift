import CoreLocation
import Foundation

/// What a day is for training, worked out on the phone and never by the model:
/// a day at home trains, a day out and a rest weekday don't. Only the word for
/// each day ("home", "out", "rest") goes to the plan engine; where events are
/// and where home is stay here.
enum DayKind: String, Codable, Sendable, CaseIterable {
    case home, out, rest
}

/// Turns an event's typed place into a coordinate. The system's geocoder, only
/// for events the calendar kept no coordinate for; tests hand in a fake.
protocol PlaceGeocoding: Sendable {
    func coordinate(for text: String) async -> Coordinate?
}

struct SystemGeocoder: PlaceGeocoding {
    func coordinate(for text: String) async -> Coordinate? {
        guard let point = try? await CLGeocoder().geocodeAddressString(text).first?.location?.coordinate else { return nil }
        return Coordinate(latitude: point.latitude, longitude: point.longitude)
    }
}

enum DayKinds {
    /// The days to classify: today and the six after it.
    static let days = 7

    /// Each day's kind, by these rules in this order:
    /// 1. a weekday the rules never train on is `rest`;
    /// 2. a day the person said they go out, or today when the phone is far from home, is `out`; a day they said they
    ///    are home is `home`, whatever the calendar says (the way to correct a wrong guess);
    /// 3. a day with an event placed somewhere that isn't home is `out` (a place that can't be found counts as not home;
    ///    a meeting link is no place);
    /// 4. every other day is `home`.
    /// Without a home set, only rules 1, 2 and the far-away check apply, since no event can be told to be at home.
    static func classify(rules: UserRules, busy: [Busy], goingOut: Set<String>, stayingHome: Set<String> = [], farToday: Bool, from today: Date,
                         calendar: Calendar, geocoder: any PlaceGeocoding) async -> [String: DayKind] {
        var kinds: [String: DayKind] = [:]
        var found: [String: Coordinate?] = [:]
        for offset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: today)) else { continue }
            let day = LocalTime(date, in: calendar.timeZone).day
            if rules.isRestDay(date, calendar: calendar) { kinds[day] = .rest; continue }
            if goingOut.contains(day) || (offset == 0 && farToday) { kinds[day] = .out; continue }
            if stayingHome.contains(day) { kinds[day] = .home; continue }
            var away = false
            if let home = rules.home {
                for event in busy where calendar.isDate(event.start, inSameDayAs: date) {
                    guard let place = event.place, let point = await coordinate(of: place, geocoder: geocoder, found: &found) else { continue }
                    if point.map(home.isHome) != true { away = true; break }
                }
            }
            kinds[day] = away ? .out : .home
        }
        return kinds
    }

    /// The engine's `dayKinds` input. Rest days are left out: the engine works those out from the rules itself.
    static func engineValue(_ kinds: [String: DayKind]) -> JSONValue {
        .object(kinds.filter { $0.value != .rest }.mapValues { .string($0.rawValue) })
    }

    /// Text that names no place: a video call's link, or nothing much.
    static func isNoPlace(_ text: String) -> Bool {
        let lower = text.lowercased()
        let calls = ["http://", "https://", "zoom.us", "meet.google", "teams.microsoft", "webex", "facetime"]
        return lower.count < 3 || calls.contains { lower.contains($0) }
    }

    // A place: its coordinate (`.some(point)`), a place that can't be found (`.some(nil)`), or no place at all (nil).
    private static func coordinate(of place: EventPlace, geocoder: any PlaceGeocoding,
                                   found: inout [String: Coordinate?]) async -> Coordinate?? {
        switch place {
        case .coordinate(let point): return .some(point)
        case .text(let text):
            if isNoPlace(text) { return nil }
            if let known = found[text] { return .some(known) }
            let point = await geocoder.coordinate(for: text)
            found[text] = point
            return .some(point)
        }
    }
}
