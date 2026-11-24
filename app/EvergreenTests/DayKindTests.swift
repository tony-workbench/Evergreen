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

    func kinds(busy: [Busy] = [], goingOut: Set<String> = [], stayingHome: Set<String> = [], far: Bool = false,
               geocoder: FakeGeocoder = FakeGeocoder(), rules: UserRules? = nil) async -> [String: DayKind] {
        await DayKinds.classify(rules: rules ?? self.rules, busy: busy, goingOut: goingOut, stayingHome: stayingHome, farToday: far,
                                from: monday, calendar: Fixture.calendar, geocoder: geocoder)
    }

    @Test func restWeekdaysAreRestAndEveryOtherDayIsHome() async {
        let week = await kinds()
        #expect((0..<7).map { week[day($0)] } == [.home, .home, .rest, .home, .home, .rest, .rest])
    }

    @Test func anEventAwayFromHomeMakesADayOut() async {
        let week = await kinds(busy: [event(1, at: .coordinate(campus)), event(3, at: .coordinate(nextDoor))])
        #expect(week[day(1)] == .out)
        #expect(week[day(3)] == .home)      // within 200 m of home
    }

    struct OfflineGeocoder: PlaceGeocoding {
        struct Offline: Error {}
        func coordinate(for text: String) async throws -> Coordinate? { throw Offline() }
    }

    @Test func aTypedPlaceWhileOfflineSaysNothingAboutTheDay() async {
        let week = await DayKinds.classify(rules: rules, busy: [event(1, at: .text("Library")), event(3, at: .coordinate(campus))],
                                           goingOut: [], farToday: false, from: monday, calendar: Fixture.calendar, geocoder: OfflineGeocoder())
        #expect(week[day(1)] == .home)
        #expect(week[day(3)] == .out)       // a coordinate needs no geocoder
    }

    @Test func aTypedPlaceIsFoundOnThePhoneAndOneThatCantBeFoundIsNotHome() async {
        let geocoder = FakeGeocoder(places: ["Library": campus, "Home office": home])
        let week = await kinds(busy: [event(0, at: .text("Home office")), event(1, at: .text("Library")), event(3, at: .text("Somewhere unknown"))],
                               geocoder: geocoder)
        #expect(week[day(0)] == .home)
        #expect(week[day(1)] == .out)
        #expect(week[day(3)] == .out)
    }

    @Test func aMeetingLinkOrNoPlaceIsNoPlace() async {
        let week = await kinds(busy: [event(0, at: .text("https://zoom.us/j/123")), event(1, at: nil)])
        #expect(week[day(0)] == .home)
        #expect(week[day(1)] == .home)
    }

    @Test func thePersonsWordWinsOverTheCalendarButNotOverARestDay() async {
        let week = await kinds(busy: [event(1, at: .coordinate(campus))], goingOut: [day(0), day(2)], stayingHome: [day(1)])
        #expect(week[day(0)] == .out)
        #expect(week[day(1)] == .home)
        #expect(week[day(2)] == .rest)
    }

    @Test func farFromHomeTodayIsADayOutForTodayOnly() async {
        let week = await kinds(far: true)
        #expect(week[day(0)] == .out)
        #expect(week[day(1)] == .home)
    }

    @Test func withoutAHomeAnEventCantMakeADayOut() async {
        var noHome = rules
        noHome.home = nil
        let week = await kinds(busy: [event(1, at: .coordinate(campus))], rules: noHome)
        #expect(week[day(1)] == .home)
    }

    @Test func theEngineIsGivenOnlyHomeAndOutWords() async {
        let week = await kinds(busy: [event(1, at: .coordinate(campus))])
        guard case .object(let fields) = DayKinds.engineValue(week) else { Issue.record("not an object"); return }
        #expect(fields.count == 4)
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
