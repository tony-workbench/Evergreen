import CoreLocation
import Foundation
import os

/// What a day is for training, worked out on the phone and never by the model:
/// a day at home trains, a day out and a rest weekday don't. Only the word for
/// each day ("home", "out", "rest") goes to the plan engine; where events are
/// and where home is stay here.
enum DayKind: String, Codable, Sendable, CaseIterable {
    case home, out, rest
}

/// Turns an event's typed place into a coordinate. The system's geocoder, only
/// for events the calendar kept no coordinate for; tests hand in a fake.
/// nil is a place that can't be found; a thrown error is a geocoder that couldn't
/// be asked (offline). Either way the place is not home.
protocol PlaceGeocoding: Sendable {
    func coordinate(for text: String) async throws -> Coordinate?
}

struct SystemGeocoder: PlaceGeocoding {
    func coordinate(for text: String) async throws -> Coordinate? {
        do {
            guard let point = try await CLGeocoder().geocodeAddressString(text).first?.location?.coordinate else { return nil }
            return Coordinate(latitude: point.latitude, longitude: point.longitude)
        } catch let error as CLError where error.code == .network {
            throw error
        } catch {
            return nil
        }
    }
}

enum DayKinds {
    /// The days to classify: today and the seven after it, so a week planned on Sunday reaches the next Sunday.
    static let days = 8

    /// Each day's kind, by these rules in this order:
    /// 1. a weekday the rules never train on is `rest`;
    /// 2. a day the person said they go out, or today when the phone is far from home, is `out`; a day they said they
    ///    are home is `home`, whatever the calendar says (the way to correct a wrong guess);
    /// 3. a day with an event placed somewhere that isn't home is `out`: timed or all-day, marked busy or free, and every
    ///    day an event spans. A meeting link is no place. A place that can't be found counts as not home, and so does a
    ///    typed place offline that was never found while online (`PlaceMemory` keeps every place found, so most are still
    ///    known offline). Without a home set, no place is home, so any placed event makes a day out (plan 5.B.1);
    /// 4. every other day is `home`.
    static func classify(rules: UserRules, busy: [Busy], goingOut: Set<String>, stayingHome: Set<String> = [], farToday: Bool, from today: Date,
                         calendar: Calendar, geocoder: any PlaceGeocoding) async -> [String: DayKind] {
        var kinds: [String: DayKind] = [:]
        var places = PlaceLookup(geocoder: geocoder)
        for offset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: today)) else { continue }
            let day = LocalTime(date, in: calendar.timeZone).day
            if let said = saidKind(rules: rules, date: date, day: day, goingOut: goingOut, stayingHome: stayingHome,
                                   farToday: offset == 0 && farToday, calendar: calendar) {
                kinds[day] = said
                continue
            }
            let away = await isAway(on: date, events: busy, home: rules.home, places: &places, calendar: calendar)
            kinds[day] = away ? .out : .home
        }
        return kinds
    }

    /// Rules 1 and 2: what the rules or the person settle for a day, before the calendar is looked at.
    private static func saidKind(rules: UserRules, date: Date, day: String, goingOut: Set<String>, stayingHome: Set<String>,
                                 farToday: Bool, calendar: Calendar) -> DayKind? {
        if rules.isRestDay(date, calendar: calendar) { return .rest }
        if goingOut.contains(day) || farToday { return .out }
        return stayingHome.contains(day) ? .home : nil
    }

    /// Rule 3: an event on that day placed somewhere that isn't home.
    private static func isAway(on date: Date, events: [Busy], home: HomePlace?, places: inout PlaceLookup, calendar: Calendar) async -> Bool {
        guard let end = calendar.date(byAdding: .day, value: 1, to: date) else { return false }
        for event in events where event.start < end && event.end > date {
            guard let place = event.place else { continue }
            // Without a home no place is home, so the place needn't be looked up: it never leaves the phone.
            if home == nil {
                if case .text(let text) = place, DayKinds.isNoPlace(text) { continue }
                return true
            }
            guard let point = await places.coordinate(of: place) else { continue }
            guard let home, let point else { return true }
            if !home.isHome(point) { return true }
        }
        return false
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
}

/// Each typed place asked of the geocoder once per classification.
struct PlaceLookup {
    let geocoder: any PlaceGeocoding
    private var found: [String: Coordinate?] = [:]

    init(geocoder: any PlaceGeocoding) { self.geocoder = geocoder }

    /// A place: its coordinate (`.some(point)`), a place that can't be found or can't be asked offline (`.some(nil)`,
    /// not home), or no place at all (nil).
    mutating func coordinate(of place: EventPlace) async -> Coordinate?? {
        switch place {
        case .coordinate(let point): return .some(point)
        case .text(let text):
            if DayKinds.isNoPlace(text) { return nil }
            if let known = found[text] { return .some(known) }
            let point: Coordinate? = try? await geocoder.coordinate(for: text)
            found.updateValue(point, forKey: text)
            return .some(point)
        }
    }
}

/// Every typed place the geocoder found, kept on this phone so a day can still be judged with the phone offline. A
/// place found once is not asked again: an address doesn't move, and it leaves the phone only the first time.
actor PlaceMemory {
    static let key = "found_places"
    /// The places of a few months of events; the oldest go first.
    static let keep = 200
    private static let log = Logger(subsystem: "com.evergreentraining.app", category: "calendar")

    struct Found: Codable, Equatable, Sendable {
        var text: String
        var point: Coordinate
    }

    private(set) var found: [Found]

    init(_ found: [Found] = []) { self.found = found }

    func point(for text: String) -> Coordinate? { found.last { $0.text == text }?.point }

    func remember(_ text: String, at point: Coordinate) {
        found.removeAll { $0.text == text }
        found = Array((found + [Found(text: text, point: point)]).suffix(Self.keep))
    }

    static func load(from defaults: UserDefaults) -> [Found] {
        guard let data = defaults.data(forKey: key) else { return [] }
        do { return try JSONDecoder().decode([Found].self, from: data) } catch {
            log.error("Found places couldn't be read: \(error.localizedDescription, privacy: .public)")
            return []
        }
    }

    static func save(_ found: [Found], to defaults: UserDefaults) {
        do { defaults.set(try JSONEncoder().encode(found), forKey: key) } catch {
            log.error("Found places couldn't be saved: \(error.localizedDescription, privacy: .public)")
        }
    }
}

/// The geocoder with `PlaceMemory` in front: a place found before is answered from the phone, a new one is asked and
/// kept. Offline, a place never found throws, and the day counts it as not home.
struct RememberingGeocoder: PlaceGeocoding {
    let geocoder: any PlaceGeocoding
    let memory: PlaceMemory

    func coordinate(for text: String) async throws -> Coordinate? {
        if let known = await memory.point(for: text) { return known }
        guard let point = try await geocoder.coordinate(for: text) else { return nil }
        await memory.remember(text, at: point)
        return point
    }
}
