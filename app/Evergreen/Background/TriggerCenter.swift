import Foundation
import Observation
import os

/// The real triggers behind what Evergreen says on its own: rain due on an
/// outdoor workout, and distance adding up on the running shoes. Each check
/// can run any number of times (foreground, a calendar change, a background
/// refresh) and says each thing once.
@Observable
@MainActor
final class TriggerCenter {
    /// Everything a check reaches outside itself, so tests hand in fakes.
    struct Parts {
        var store: any TriggerStore
        var forecast: any ForecastProviding
        var location: any LocationProviding
        var places: any PlaceSearching
        var distance: any RunningDistanceReading
        /// Posts a local notification.
        var notify: @MainActor (_ copy: (title: String, body: String), _ id: String) async -> Void
        /// The person's busy times, from their calendar.
        var busy: @MainActor () async -> [Busy]
        /// The plan as it stands.
        var plan: @MainActor () -> [PlanItem]
        var calendar: Calendar = .current
        /// The days at home in the next two days, with their session, while the person plans by their rules.
        var homeDays: @MainActor () -> [RainHomeDay] = { [] }
    }

    static let locationAskedKey = "location-asked"
    static let lastPlaceKey = "last-place"
    static let dismissedRainKey = "rain-dismissed"
    /// How many dismissed rain asks and breaks are remembered, newest kept.
    static let dismissedRainKept = 50
    static let shoeQuestionSkippedKey = "shoe-question-skipped"
    private static let log = Logger(subsystem: "com.evergreentraining.app", category: "triggers")

    /// Rain asks for the next 48 hours that the person hasn't put away.
    private(set) var rainAsks: [RainAsk] = []
    /// Short breaks for a rainy afternoon at home, that the person hasn't added or put away.
    private(set) var rainSnacks: [RainSnacks] = []
    /// The current running shoes; nil until the person answers the one question.
    private(set) var shoeLog: ShoeLog?
    /// The shoes and the distance on them, once it has been read.
    private(set) var shoes: ShoeStatus?
    /// The person said "Not now" to the shoe question.
    private(set) var shoeQuestionSkipped = false
    /// Goes up whenever a first-time line is marked shown, so views read `firstTimeLine` again.
    private(set) var firstTimeChanges = 0

    @ObservationIgnored private var parts: Parts?
    @ObservationIgnored private var cache: ForecastCache?
    /// Places found for a spot, kept as long as the forecast is.
    @ObservationIgnored private var foundPlaces: (near: Coordinate, at: Date, places: [FoundPlace])?

    var isSetUp: Bool { parts != nil }

    /// Wires the checks to the device (or to fakes) and reads what was saved.
    func setUp(_ parts: Parts) {
        self.parts = parts
        cache = ForecastCache(source: parts.forecast, store: parts.store)
        shoeLog = parts.store.value(ShoeLog.self, for: ShoeLog.storeKey)
        shoeQuestionSkipped = parts.store.value(Bool.self, for: Self.shoeQuestionSkippedKey) ?? false
    }

    // MARK: Checks

    /// Rain, then shoes. `mayAsk` is true only with the app on screen: a permission prompt never comes from the background.
    func checkAll(now: Date, mayAsk: Bool) async {
        await checkRain(now: now, mayAsk: mayAsk)
        await checkShoes(now: now)
    }

    /// Outdoor workouts in the next 48 hours against the forecast for where the person is.
    func checkRain(now: Date, mayAsk: Bool) async {
        guard let parts, let cache else { return }
        let homeDays = parts.homeDays()
        guard !RainCheck.outdoorSessions(parts.plan(), now: now).isEmpty || !homeDays.isEmpty else {
            clearRain()
            return
        }
        guard await mayUseLocation(parts, mayAsk: mayAsk), let here = await place(parts),
              let forecast = await readForecast(cache, at: here, now: now) else { return }
        let found = await rainFound(parts, RainLook(forecast: forecast, homeDays: homeDays, now: now))
        var asks = found.asks
        rainSnacks = found.snacks.filter { day in !asks.contains { $0.snacks?.key == day.key } }
        if !asks.isEmpty {
            let nearby = IndoorPlace.nearest(await gyms(near: here, now: now), to: here)
            for index in asks.indices { asks[index].places = nearby }
        }
        rainAsks = asks
        await notifyRain(asks, now: now, parts: parts)
    }

    /// Nothing about rain to say.
    private func clearRain() {
        rainAsks = []
        rainSnacks = []
    }

    /// Whether the place may be read. Asked once, the first time an outdoor workout is this close; once denied, off,
    /// silently, and never asked for again.
    private func mayUseLocation(_ parts: Parts, mayAsk: Bool) async -> Bool {
        switch parts.location.permission {
        case .allowed:
            return true
        case .denied:
            clearRain()
            return false
        case .notAsked:
            guard mayAsk, parts.store.value(Bool.self, for: Self.locationAskedKey) != true else { return false }
            parts.store.save(true, for: Self.locationAskedKey)
            guard await parts.location.request() else {
                clearRain()
                return false
            }
            return true
        }
    }

    /// Where the person is, rounded. In the background there may be no fresh fix; the last rounded place will do.
    private func place(_ parts: Parts) async -> Coordinate? {
        let fix = await parts.location.current()?.rounded
        if let fix { parts.store.save(fix, for: Self.lastPlaceKey) }
        return fix ?? parts.store.value(Coordinate.self, for: Self.lastPlaceKey)
    }

    /// The forecast for `here`, kept for an hour; nil, with why in the log, when it can't be had (offline, say).
    private func readForecast(_ cache: ForecastCache, at here: Coordinate, now: Date) async -> Forecast? {
        do {
            return try await cache.forecast(at: here, now: now)
        } catch {
            Self.log.failed("No forecast for the rain check", error)
            return nil
        }
    }

    /// What a rain check looks at: the forecast, the days at home in it, and when.
    private struct RainLook {
        let forecast: Forecast
        let homeDays: [RainHomeDay]
        let now: Date
    }

    /// The rain asks and rainy afternoons' breaks the person hasn't put away. An outdoor workout on a rainy day at home
    /// offers the breaks as a third answer.
    private func rainFound(_ parts: Parts, _ look: RainLook) async -> (asks: [RainAsk], snacks: [RainSnacks]) {
        let dismissed = Set(parts.store.value([String].self, for: Self.dismissedRainKey) ?? [])
        let busy = await parts.busy()
        var asks = RainCheck.asks(plan: parts.plan(), forecast: look.forecast, busy: busy, now: look.now, calendar: parts.calendar)
            .filter { !dismissed.contains($0.key) }
        let room = RainCheck.SnackRoomBasis(plan: parts.plan(), busy: busy, now: look.now, calendar: parts.calendar)
        let snacks = RainCheck.snacks(days: look.homeDays, forecast: look.forecast, around: room)
            .filter { !dismissed.contains($0.key) }
        for index in asks.indices {
            asks[index].snacks = snacks.first { parts.calendar.isDate($0.day, inSameDayAs: asks[index].session.slot.start) }
        }
        return (asks, snacks)
    }

    /// Each rain ask, and each rainy afternoon's breaks still offered, notified once.
    private func notifyRain(_ asks: [RainAsk], now: Date, parts: Parts) async {
        let ledger = NotifiedLedger(store: parts.store)
        for ask in asks where ledger.firstTime(ask.key, now: now) {
            await parts.notify(NotificationCopy.rain(ask, now: now, calendar: parts.calendar), ask.key)
        }
        for day in rainSnacks where ledger.firstTime(day.key, now: now) {
            await parts.notify(NotificationCopy.rainSnacks(count: day.blocks.count, minutes: day.minutes), day.key)
        }
    }

    /// The distance on the shoes, and a notification the first time it passes 480 km and 640 km.
    func checkShoes(now: Date) async {
        guard let parts else { return }
        guard let log = shoeLog else {
            shoes = nil
            return
        }
        guard let km = await parts.distance.runningKm(since: log.startedOn, until: now), log == shoeLog else { return }
        let status = ShoeStatus(log: log, km: km)
        shoes = status
        guard let event = status.event, let copy = NotificationCopy.shoes(status) else { return }
        let key = "shoes|\(RainCheck.day(log.startedOn, parts.calendar))|\(event.rawValue)"
        if NotifiedLedger(store: parts.store).firstTime(key, now: now) {
            await parts.notify(copy, key)
        }
    }

    /// The agent moved a workout off something on the calendar: said once per move.
    func announceMove(id: String, copy: (title: String, body: String), now: Date) async {
        guard let parts, NotifiedLedger(store: parts.store).firstTime("moved|\(id)", now: now) else { return }
        await parts.notify(copy, id)
    }

    private func gyms(near here: Coordinate, now: Date) async -> [FoundPlace] {
        guard let parts else { return [] }
        if let kept = foundPlaces, kept.near == here, now.timeIntervalSince(kept.at) < ForecastCache.lifetime, now >= kept.at {
            return kept.places
        }
        let places = await parts.places.gyms(near: here)
        foundPlaces = (here, now, places)
        return places
    }

    // MARK: The person's answers

    /// "Not now" on a rain ask: it isn't shown again for that workout and day.
    func dismiss(_ ask: RainAsk) {
        guard let parts else { return }
        var dismissed = parts.store.value([String].self, for: Self.dismissedRainKey) ?? []
        if !dismissed.contains(ask.key) { dismissed.append(ask.key) }
        parts.store.save(Array(dismissed.suffix(Self.dismissedRainKept)), for: Self.dismissedRainKey)
        rainAsks.removeAll { $0.key == ask.key }
        if let snacks = ask.snacks { dismiss(snacks) }
    }

    /// "Not now" on a rainy afternoon's breaks, or once they are on the plan: not offered again for that day.
    func dismiss(_ snacks: RainSnacks) {
        guard let parts else { return }
        var dismissed = parts.store.value([String].self, for: Self.dismissedRainKey) ?? []
        if !dismissed.contains(snacks.key) { dismissed.append(snacks.key) }
        parts.store.save(Array(dismissed.suffix(Self.dismissedRainKept)), for: Self.dismissedRainKey)
        rainSnacks.removeAll { $0.key == snacks.key }
        for index in rainAsks.indices where rainAsks[index].snacks?.key == snacks.key { rainAsks[index].snacks = nil }
    }

    /// The answer to "When did you start using your current running shoes?"
    func setShoes(startedOn: Date, name: String?, now: Date) async {
        guard let parts else { return }
        let log = ShoeLog(name: name, startedOn: parts.calendar.startOfDay(for: min(startedOn, now)))
        shoeLog = log
        shoes = nil
        parts.store.save(log, for: ShoeLog.storeKey)
        await checkShoes(now: now)
    }

    /// "I got new ones": the count starts again today.
    func gotNewShoes(now: Date) async {
        await setShoes(startedOn: now, name: nil, now: now)
    }

    /// "Not now" on the shoe question: it isn't asked again.
    func skipShoeQuestion() {
        shoeQuestionSkipped = true
        parts?.store.save(true, for: Self.shoeQuestionSkippedKey)
    }

    // MARK: First-time lines

    /// The muted line for the first real occurrence of this kind; nil once it has been shown.
    func firstTimeLine(_ kind: FirstTimeKind) -> String? {
        _ = firstTimeChanges
        guard let parts else { return nil }
        return FirstTime(store: parts.store).line(for: kind)
    }

    func markFirstTimeShown(_ kind: FirstTimeKind) {
        guard let parts else { return }
        FirstTime(store: parts.store).markShown(kind)
        firstTimeChanges += 1
    }
}
