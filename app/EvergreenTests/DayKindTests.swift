import Foundation
import Testing
@testable import Evergreen

/// Telling a day at home from a day out, on the phone: rest weekdays from the
/// rules, the person's own word, events away from home, and the phone far from
/// home when the app opens. Nothing here reaches the network: the geocoder is a fake.
struct DayKindTests {
    /// Monday 30 November 2026, 08:00 in the fixture's zone.
    let monday = Fixture.calendar.date(from: DateComponents(year: 2026, month: 11, day: 30, hour: 8))!
    let home = Coordinate(latitude: 40.0, longitude: -100.0)
    /// About 150 m north of home: still home.
    let nextDoor = Coordinate(latitude: 40.00135, longitude: -100.0)
    /// About 33 km north.
    let campus = Coordinate(latitude: 40.3, longitude: -100.0)

    struct FakeGeocoder: PlaceGeocoding {
        var places: [String: Coordinate] = [:]
        func coordinate(for text: String) async -> Coordinate? { places[text] }
    }

    var rules: UserRules {
        var rules = UserRules()
        rules.isOn = true
        rules.home = HomePlace(place: home)
        return rules
    }

    func day(_ offset: Int) -> String {
        LocalTime(Fixture.calendar.date(byAdding: .day, value: offset, to: monday)!, in: Fixture.calendar.timeZone).day
    }

    func event(_ offset: Int, at place: EventPlace?) -> Busy {
        let start = Fixture.calendar.date(byAdding: .hour, value: 24 * offset + 6, to: monday)!
        return Busy(start: start, end: start.addingTimeInterval(3600), place: place)
    }

    /// What a test says about the week: its events, the days marked out or home, whether the phone is far from home, and
    /// other rules than the usual ones.
    struct Said {
        var busy: [Busy] = []
        var goingOut: Set<String> = []
        var stayingHome: Set<String> = []
        var far = false
        var rules: UserRules? = nil
    }

    func kinds(_ said: Said = Said(), geocoder: FakeGeocoder = FakeGeocoder()) async -> [String: DayKind] {
        await DayKinds.classify(request(said), geocoder: geocoder)
    }

    func request(_ said: Said) -> DayKinds.Request {
        DayKinds.Request(rules: said.rules ?? rules, busy: said.busy, goingOut: said.goingOut, stayingHome: said.stayingHome,
                         farToday: said.far, today: monday, calendar: Fixture.calendar)
    }

    @Test func restWeekdaysAreRestAndEveryOtherDayIsHome() async {
        let week = await kinds()
        #expect((0..<7).map { week[day($0)] } == [.home, .home, .rest, .home, .home, .rest, .rest])
    }

    @Test func anEventAwayFromHomeMakesADayOut() async {
        let week = await kinds(.init(busy: [event(1, at: .coordinate(campus)), event(3, at: .coordinate(nextDoor))]))
        #expect(week[day(1)] == .out)
        #expect(week[day(3)] == .home)      // within 200 m of home
    }

    struct OfflineGeocoder: PlaceGeocoding {
        struct Offline: Error {}
        func coordinate(for text: String) async throws -> Coordinate? { throw Offline() }
    }

    @Test func offlineATypedPlaceNeverFoundIsNotHome() async {
        let week = await DayKinds.classify(request(.init(busy: [event(1, at: .text("Library")), event(3, at: .coordinate(home))])),
                                           geocoder: OfflineGeocoder())
        #expect(week[day(1)] == .out)       // can't be asked and never found: not home
        #expect(week[day(3)] == .home)      // a coordinate needs no geocoder
    }

    @Test func aTypedPlaceIsFoundOnThePhoneAndOneThatCantBeFoundIsNotHome() async {
        let geocoder = FakeGeocoder(places: ["Library": campus, "Home office": home])
        let week = await kinds(.init(busy: [event(0, at: .text("Home office")), event(1, at: .text("Library")), event(3, at: .text("Somewhere unknown"))]),
                               geocoder: geocoder)
        #expect(week[day(0)] == .home)
        #expect(week[day(1)] == .out)
        #expect(week[day(3)] == .out)
    }

    @Test func aMeetingLinkOrNoPlaceIsNoPlace() async {
        let week = await kinds(.init(busy: [event(0, at: .text("https://zoom.us/j/123")), event(1, at: nil)]))
        #expect(week[day(0)] == .home)
        #expect(week[day(1)] == .home)
    }

    @Test func thePersonsWordWinsOverTheCalendarButNotOverARestDay() async {
        let week = await kinds(.init(busy: [event(1, at: .coordinate(campus))], goingOut: [day(0), day(2)], stayingHome: [day(1)]))
        #expect(week[day(0)] == .out)
        #expect(week[day(1)] == .home)
        #expect(week[day(2)] == .rest)
    }

    @Test func farFromHomeTodayIsADayOutForTodayOnly() async {
        let week = await kinds(.init(far: true))
        #expect(week[day(0)] == .out)
        #expect(week[day(1)] == .home)
    }

    @Test func withoutAHomeEveryPlacedEventMakesADayOut() async {
        var noHome = rules
        noHome.home = nil
        let week = await kinds(.init(busy: [event(1, at: .coordinate(campus)), event(3, at: .text("https://zoom.us/j/1"))], rules: noHome))
        #expect(week[day(1)] == .out)       // no place can be home yet (plan 5.B.1)
        #expect(week[day(3)] == .home)      // a meeting link is no place
    }

    @Test func withoutAHomeATypedPlaceIsADayOutWithoutBeingLookedUp() async {
        var noHome = rules
        noHome.home = nil
        // Without a home the place isn't looked up at all: it never leaves the phone.
        let week = await DayKinds.classify(request(.init(busy: [event(3, at: .text("Library"))], rules: noHome)), geocoder: OfflineGeocoder())
        #expect(week[day(3)] == .out)
    }

    @Test func anAllDayEventAwayMakesEachDayItSpansADayOut() async {
        let start = Fixture.calendar.startOfDay(for: monday)
        let trip = Busy(start: start, end: Fixture.calendar.date(byAdding: .day, value: 2, to: start)!, place: .coordinate(campus))
        let week = await kinds(.init(busy: [trip]))
        #expect(week[day(0)] == .out)
        #expect(week[day(1)] == .out)
        #expect(week[day(3)] == .home)
    }

    struct CountingGeocoder: PlaceGeocoding {
        let places: [String: Coordinate]
        let asked = Asked()
        actor Asked { var texts: [String] = []; func add(_ text: String) { texts.append(text) } }
        func coordinate(for text: String) async throws -> Coordinate? { await asked.add(text); return places[text] }
    }

    @MainActor @Test func placesFoundOnlineAreKnownOfflineAndNotAskedAgain() async {
        let memory = PlaceMemory()
        let online = CountingGeocoder(places: ["Library": campus, "Home office": home])
        let busy = [event(0, at: .text("Home office")), event(1, at: .text("Library")), event(3, at: .text("Somewhere unknown"))]
        _ = await DayKinds.classify(request(.init(busy: busy)), geocoder: RememberingGeocoder(geocoder: online, memory: memory))
        #expect(memory.found.map(\.text).sorted() == ["Home office", "Library"])   // not found: not kept

        let offline = await DayKinds.classify(request(.init(busy: busy)), geocoder: RememberingGeocoder(geocoder: OfflineGeocoder(), memory: memory))
        #expect(offline[day(0)] == .home)   // known from last time
        #expect(offline[day(1)] == .out)
        #expect(offline[day(3)] == .out)    // never found: not home

        let again = CountingGeocoder(places: [:])
        _ = await DayKinds.classify(request(.init(busy: busy)), geocoder: RememberingGeocoder(geocoder: again, memory: memory))
        #expect(await again.asked.texts == ["Somewhere unknown"])   // a found place doesn't leave the phone again
    }

    @MainActor @Test func foundPlacesAreKeptOnThePhoneBetweenLaunches() {
        let defaults = UserDefaults(suiteName: "found-places-\(UUID())")!
        PlaceMemory(defaults: defaults).remember("Library", at: campus)
        // Saved as soon as it is found, and read back by the next launch's keeper.
        #expect(PlaceMemory.load(from: defaults) == [PlaceMemory.Found(text: "Library", point: campus)])
        #expect(PlaceMemory(defaults: defaults).point(for: "Library") == campus)
    }

    @Test func theEngineIsGivenOnlyHomeAndOutWords() async {
        let week = await kinds(.init(busy: [event(1, at: .coordinate(campus))]))
        guard case .object(let fields) = DayKinds.engineValue(week) else { Issue.record("not an object"); return }
        // Eight days from Monday (today and the seven after, so Sunday's plan reaches the next Sunday): the rest weekdays
        // drop out, leaving Monday, Tuesday, Thursday, Friday and the next Monday.
        #expect(fields.count == 5)
        #expect(fields[day(1)] == .string("out"))
        #expect(fields.values.allSatisfy { $0 == .string("home") || $0 == .string("out") })
    }

    @Test func homeIsA200MetreCircleAndFarIsTheSetLine() {
        let place = HomePlace(place: home)
        #expect(place.isHome(nextDoor))
        #expect(!place.isHome(Coordinate(latitude: 40.003, longitude: -100.0)))
        #expect(place.isFar(campus, kilometres: HomePlace.defaultFarKilometres))
        #expect(!place.isFar(campus, kilometres: 40))
    }
}
