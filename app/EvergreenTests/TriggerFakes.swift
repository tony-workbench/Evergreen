import Foundation
@testable import Evergreen

/// Counts what a test asked the network for. Nothing here reaches it.
actor FetchLog {
    private(set) var urls: [URL] = []
    func add(_ url: URL) { urls.append(url) }
}

@MainActor
final class FakeLocation: LocationProviding {
    var permission: LocationPermission
    /// What the person answers when asked.
    var answer: LocationPermission
    var place: Coordinate?
    private(set) var requests = 0

    init(_ permission: LocationPermission, answer: LocationPermission = .allowed,
         place: Coordinate? = Coordinate(latitude: 37.7712, longitude: -122.4194)) {
        self.permission = permission
        self.answer = answer
        self.place = place
    }

    func request() async -> Bool {
        requests += 1
        permission = answer
        return permission == .allowed
    }

    func current() async -> Coordinate? { permission == .allowed ? place : nil }
}

@MainActor
final class FakePlaces: PlaceSearching {
    var found: [FoundPlace]
    private(set) var searches = 0

    init(_ found: [FoundPlace] = FakePlaces.five) { self.found = found }

    func gyms(near place: Coordinate) async -> [FoundPlace] {
        searches += 1
        return found
    }

    /// Around 37.77, -122.42: 0.01° of latitude is about 1.1 km.
    static let five = [
        FoundPlace(name: "Third Nearest", coordinate: Coordinate(latitude: 37.80, longitude: -122.42)),
        FoundPlace(name: "Nearest", coordinate: Coordinate(latitude: 37.775, longitude: -122.42)),
        FoundPlace(name: "Too Far", coordinate: Coordinate(latitude: 37.85, longitude: -122.42)),
        FoundPlace(name: "Second Nearest", coordinate: Coordinate(latitude: 37.78, longitude: -122.42)),
        FoundPlace(name: "Fourth Nearest", coordinate: Coordinate(latitude: 37.805, longitude: -122.42)),
    ]
}

/// What would have been posted as notifications.
@MainActor
final class Notices {
    private(set) var sent: [(id: String, title: String, body: String)] = []
    func add(_ copy: (title: String, body: String), _ id: String) { sent.append((id, copy.title, copy.body)) }
    var ids: [String] { sent.map(\.id) }
}

/// The checks with every outside part faked: a recorded forecast, a fixed
/// place, fixed gyms, fixed workouts, and a clock the test moves.
@MainActor
struct TriggerRig {
    static let here = Coordinate(latitude: 37.7712, longitude: -122.4194)
    /// Saturday 21 November 2026, 8 PM in San Francisco: the evening the forecast was recorded.
    static let evening = date(21, 20)

    static func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    static func session(_ id: String = "plan-me-2026-11-22-running", type: String = "Running", day: Int = 22, hour: Int = 8,
                        minutes: Int = 60, place: String? = nil) -> PlanItem {
        let start = date(day, hour)
        return PlanItem(id: id, slot: Slot(start: start, end: start.addingTimeInterval(Double(minutes) * 60), activityType: type, place: place))
    }

    static func forecast(_ file: String, fetchedAt: Date = evening) throws -> Forecast {
        try Forecast(openMeteo: PersonaFixture.data(file), fetchedAt: fetchedAt, place: here.rounded)
    }

    static func run(km: Double, day: Int, month: Int = 11, id: String = UUID().uuidString, type: String = "Running") -> Workout {
        let start = Fixture.calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: 7))!
        return Workout(id: id, activityType: type, start: start, end: start.addingTimeInterval(3000), effort: nil,
                       avgHeartRate: nil, source: .health, distanceKm: km)
    }

    let center = TriggerCenter()
    let store: any TriggerStore
    let location: FakeLocation
    let places = FakePlaces()
    let notices = Notices()
    let fetches = FetchLog()
    var plan: [PlanItem]
    var busy: [Busy] = []
    var workouts: [Workout] = []

    init(file: String = "open-meteo-wet-morning.json", plan: [PlanItem] = [TriggerRig.session()],
         location: LocationPermission = .allowed, answer: LocationPermission = .allowed,
         store: any TriggerStore = MemoryTriggerStore(), busy: [Busy] = [], workouts: [Workout] = []) throws {
        self.store = store
        self.location = FakeLocation(location, answer: answer)
        self.plan = plan
        self.busy = busy
        self.workouts = workouts
        let data = try PersonaFixture.data(file)
        let notices = notices, fetches = fetches
        center.setUp(TriggerCenter.Parts(
            store: store,
            forecast: ForecastClient(fetch: { url in
                await fetches.add(url)
                return data
            }),
            location: self.location, places: places,
            distance: WorkoutsRunningDistance(workouts: workouts),
            notify: { copy, id in notices.add(copy, id) },
            busy: { busy }, plan: { plan }, calendar: Fixture.calendar
        ))
    }
}
