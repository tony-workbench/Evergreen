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
    private static let log = Logger(subsystem: "com.evergreentraining.app", category: "calendar")

    func coordinate(for text: String) async throws -> Coordinate? {
        do {
            guard let point = try await CLGeocoder().geocodeAddressString(text).first?.location?.coordinate else { return nil }
            return Coordinate(latitude: point.latitude, longitude: point.longitude)
        } catch let error as CLError where error.code == .network {
            throw error
        } catch {
            // Usually no place by that name; logged without the place itself.
            Self.log.debug("A place wasn't found: \(String(describing: (error as? CLError)?.code.rawValue), privacy: .public)")
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
    static func classify(_ request: Request, geocoder: any PlaceGeocoding) async -> [String: DayKind] {
        let calendar = request.calendar
        var kinds: [String: DayKind] = [:]
        var away = AwayCheck(home: request.rules.home, calendar: calendar, places: PlaceLookup(geocoder: geocoder))
        for offset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: request.today)) else { continue }
            let day = LocalTime(date, in: calendar.timeZone).day
            if let said = request.saidKind(date: date, day: day, isToday: offset == 0) {
                kinds[day] = said
            } else {
                kinds[day] = await away.isAway(on: date, events: request.busy) ? .out : .home
            }
        }
        return kinds
    }

    /// What the days are worked out from: the rules, the calendar's events, the person's word and where the phone is.
    struct Request: Sendable {
        var rules: UserRules
        /// Timed events and all-day or free ones with a place.
        var busy: [Busy]
        /// Days the person said they go out, and days they said they are home.
        var goingOut: Set<String> = []
        var stayingHome: Set<String> = []
        /// The phone was far from home when the app opened today.
        var farToday = false
        /// The first day to work out.
        var today: Date
        var calendar: Calendar

        /// Rules 1 and 2: what the rules or the person settle for a day, before the calendar is looked at.
        func saidKind(date: Date, day: String, isToday: Bool) -> DayKind? {
            if rules.isRestDay(date, calendar: calendar) { return .rest }
            if goingOut.contains(day) || (isToday && farToday) { return .out }
            return stayingHome.contains(day) ? .home : nil
        }
    }

    /// The engine's `dayKinds` input. Rest days are left out: the engine works those out from the rules itself.
    static func engineValue(_ kinds: [String: DayKind]) -> JSONValue {
        .object(kinds.filter { $0.value != .rest }.mapValues { .string($0.rawValue) })
    }

    /// A location shorter than this names no place.
    private static let shortestPlace = 3

    /// Text that names no place: a video call's link, or nothing much.
    static func isNoPlace(_ text: String) -> Bool {
        let lower = text.lowercased()
        let calls = ["http://", "https://", "zoom.us", "meet.google", "teams.microsoft", "webex", "facetime"]
        return lower.count < shortestPlace || calls.contains { lower.contains($0) }
    }
}

/// Rule 3 of `DayKinds.classify`: a day with an event placed somewhere that isn't home is a day out. Each typed place is
/// asked of the geocoder once per classification (`PlaceLookup`).
struct AwayCheck {
    let home: HomePlace?
    let calendar: Calendar
    var places: PlaceLookup

    /// An event on the day of `date` placed somewhere that isn't home.
    mutating func isAway(on date: Date, events: [Busy]) async -> Bool {
        guard let end = calendar.date(byAdding: .day, value: 1, to: date) else { return false }
        for event in events where event.start < end && event.end > date {
            if let place = event.place, await isAway(at: place) { return true }
        }
        return false
    }

    /// A place that isn't home. Without a home no place is home, so the place needn't be looked up: it never leaves the
    /// phone. A place that can't be found counts as not home; a meeting link is no place.
    private mutating func isAway(at place: EventPlace) async -> Bool {
        guard let home else { return !Self.namesNoPlace(place) }
        guard let found = await places.coordinate(of: place) else { return false }
        guard let point = found else { return true }
        return !home.isHome(point)
    }

    /// A typed place that names no place: a video call's link, or nothing much.
    private static func namesNoPlace(_ place: EventPlace) -> Bool {
        guard case .text(let text) = place else { return false }
        return DayKinds.isNoPlace(text)
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
            let point = await lookUp(text)
            found.updateValue(point, forKey: text)
            return .some(point)
        }
    }
}

extension PlaceLookup {
    private static let log = Logger(subsystem: "com.evergreentraining.app", category: "calendar")

    /// The geocoder's answer; nil for a place it couldn't find, or couldn't be asked (offline), which is said in the log.
    fileprivate func lookUp(_ text: String) async -> Coordinate? {
        do {
            return try await geocoder.coordinate(for: text)
        } catch {
            Self.log.error("A place couldn't be looked up, so its day counts as out: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}

/// Every typed place the geocoder found, kept on this phone so a day can still be judged with the phone offline. A
/// place found once is not asked again: an address doesn't move, and it leaves the phone only the first time.
/// One for the app (`AppModel.placeMemory`): read from the phone once, and saved each time a place is found, so two
/// classifications at once can't lose each other's places.
@MainActor
final class PlaceMemory {
    nonisolated static let key = "found_places"
    /// The places of a few months of events; the oldest go first.
    nonisolated static let keep = 200
    private nonisolated static let log = Logger(subsystem: "com.evergreentraining.app", category: "calendar")

    struct Found: Codable, Equatable, Sendable {
        var text: String
        var point: Coordinate
    }

    /// Where the places are kept; nil keeps them in memory only.
    let defaults: UserDefaults?
    private(set) var found: [Found]

    init(defaults: UserDefaults? = nil) {
        self.defaults = defaults
        found = defaults.map { Self.load(from: $0) } ?? []
    }

    func point(for text: String) -> Coordinate? { found.last { $0.text == text }?.point }

    func remember(_ text: String, at point: Coordinate) {
        found.removeAll { $0.text == text }
        found = Array((found + [Found(text: text, point: point)]).suffix(Self.keep))
        if let defaults { Self.save(found, to: defaults) }
    }

    nonisolated static func load(from defaults: UserDefaults) -> [Found] {
        guard let data = defaults.data(forKey: key) else { return [] }
        do { return try JSONDecoder().decode([Found].self, from: data) } catch {
            log.error("Found places couldn't be read: \(error.localizedDescription, privacy: .public)")
            return []
        }
    }

    nonisolated static func save(_ found: [Found], to defaults: UserDefaults) {
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
