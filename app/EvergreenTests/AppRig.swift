import Foundation
import SwiftData
@testable import Evergreen

/// A clock a test sets and moves; the app model reads it instead of the device's.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date

    init(_ now: Date) { value = now }

    var now: Date {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}

/// The Evergreen calendar as a list of events, kept in line with the plan by
/// the same comparison the device's calendar uses, and counting what each
/// sync created, changed and removed. Also the meetings on the person's other calendars.
@MainActor
final class RecordingCalendar: PlanCalendar {
    var access: CalendarAccess
    var onChange: (@MainActor () -> Void)?
    /// Meetings on the person's other calendars.
    var meetings: [Busy] = []

    /// What is on the Evergreen calendar now.
    private(set) var events: [CalendarEntry] = []
    private(set) var created: [CalendarEntry] = []
    private(set) var updated: [CalendarEntry] = []
    private(set) var deleted: [CalendarEntry] = []
    private(set) var cleared = 0

    init(access: CalendarAccess = .on) { self.access = access }

    func requestAccess() async -> Bool {
        access = .on
        return true
    }

    func sync(_ entries: [CalendarEntry], from storyDay: Date) {
        guard access == .on else { return }
        let changes = CalendarChanges(desired: entries, existing: events.indices.map { (id: $0, entry: events[$0]) })
        var next = events
        for update in changes.update { next[update.event] = update.entry }
        updated += changes.update.map(\.entry)
        deleted += changes.delete.map { events[$0] }
        next = next.enumerated().filter { !changes.delete.contains($0.offset) }.map(\.element)
        next += changes.create
        created += changes.create
        events = next
    }

    func removeAllEvents(around storyDay: Date) {
        cleared += 1
        events = []
    }

    func busyTimes(from storyDay: Date) async -> [Busy] {
        access == .on ? meetings.sorted { $0.start < $1.start } : []
    }

    /// All-day or free events with a place, as the calendar would give them.
    var placed: [Busy] = []
    func placedEvents(from storyDay: Date) async -> [Busy] {
        access == .on ? placed : []
    }

    /// The event for a plan item, by the item's id at the end of its key.
    func event(for planItemId: String) -> CalendarEntry? {
        events.first { $0.key.lastPathComponent == planItemId }
    }
}

/// Apple Health as a script: what the next read returns, and how often it was read.
final class ScriptedHealth: HealthReading, @unchecked Sendable {
    private let lock = NSLock()
    private var answer: HealthHistory?
    private var count = 0

    /// Nil is a read that failed.
    init(_ answer: HealthHistory? = nil) { self.answer = answer }

    var isAvailable: Bool { true }
    var reads: Int { lock.withLock { count } }
    func willReturn(_ history: HealthHistory?) { lock.withLock { answer = history } }

    func read(now: Date, calendar: Calendar) async -> HealthHistory? {
        lock.withLock {
            count += 1
            return answer
        }
    }
}

/// A forecast that counts how often it is asked: dry, except 6 AM to noon on one day.
final class CountingForecast: ForecastProviding, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    let wetDay: Date?
    let calendar: Calendar

    init(wetDay: Date?, calendar: Calendar) {
        self.wetDay = wetDay
        self.calendar = calendar
    }

    var requests: Int { lock.withLock { count } }

    func forecast(at place: Coordinate, now: Date) async throws -> Forecast {
        lock.withLock { count += 1 }
        let from = calendar.startOfDay(for: now)
        let hours = (0..<72).map { index -> Forecast.Hour in
            let start = from.addingTimeInterval(Double(index) * 3600)
            let hour = calendar.component(.hour, from: start)
            let wet = wetDay.map { calendar.isDate(start, inSameDayAs: $0) && (6..<12).contains(hour) } ?? false
            return Forecast.Hour(start: start, probability: wet ? 85 : 5, millimeters: wet ? 2.4 : 0)
        }
        return Forecast(hours: hours, fetchedAt: now, place: place.rounded)
    }
}

/// The times of day the clock-dependent tests run at, on Thursday 19 November 2026
/// in Los Angeles: mid-morning, late evening, and just after midnight.
enum Clocks {
    static let morning = Fixture.at(9)
    static let lateEvening = Fixture.at(23, 30)
    static let justAfterMidnight = Fixture.at(0, 5)
    static let all = [morning, lateEvening, justAfterMidnight]
}

/// The app model as the app makes it for the device, with everything outside
/// it replaced: a clock the test sets, a fixed time zone, a recording
/// calendar, scripted Apple Health, its own memory folder and settings, and
/// (when asked) trigger parts that count what they were asked for.
/// Nothing reaches the device's calendar, Health, Keychain or the network.
@MainActor
struct AppRig {
    let container: ModelContainer
    let model: AppModel
    let clock: TestClock
    let calendar: RecordingCalendar
    let health: ScriptedHealth
    let settings: UserDefaults
    let notices = Notices()

    /// A month of made-up history (the `jordan` fixture) ending the day before `now`.
    static func month(endingBefore now: Date) -> HealthHistory {
        PersonaFixture.load("jordan", storyDay: Fixture.calendar.startOfDay(for: now), calendar: Fixture.calendar).health
    }

    /// A 40-minute run at 7:00 on each of the `days` mornings before `now`.
    static func runs(days: Int, before now: Date) -> HealthHistory {
        let today = Fixture.calendar.startOfDay(for: now)
        let workouts = days == 0 ? [] : (1...days).map { back -> Workout in
            let start = Fixture.calendar.date(bySettingHour: 7, minute: 0, second: 0, of: Fixture.calendar.date(byAdding: .day, value: -back, to: today)!)!
            return Workout(id: "rig-run-\(back)", activityType: "Running", start: start, end: start.addingTimeInterval(40 * 60),
                           effort: nil, avgHeartRate: 148, source: .health, distanceKm: 7, indoor: false)
        }
        return HealthHistory(workouts: workouts, days: [], readAt: now)
    }

    /// - Parameters:
    ///   - connected: whether an AI key is connected. When it is, the model is a script that can't be reached,
    ///     so memory and the week come from the engines' own rules unless the test gives another script.
    ///   - persona: `.me` is the person's own (empty) plan; `.tour` starts from the fixed three-workout week.
    init(now: Date = Clocks.morning, history: HealthHistory? = nil, persona: PersonaKey = .me, connected: Bool = true,
         calendarAccess: CalendarAccess = .on, healthRead: HealthHistory? = nil) throws {
        let schema = Schema([Run.self, ActionRecord.self, LoggedWorkout.self])
        container = try ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: true))
        // Kept for the whole run: a model's ticks go on after its test ends.
        SuggestionTests.containers.append(container)
        let run = Run(persona: persona, storyDay: Fixture.calendar.startOfDay(for: now))
        run.onboarded = true
        container.mainContext.insert(run)

        let clock = TestClock(now)
        self.clock = clock
        calendar = RecordingCalendar(access: calendarAccess)
        health = ScriptedHealth(healthRead)
        let suite = "rig-\(UUID().uuidString)"
        settings = UserDefaults(suiteName: suite)!
        settings.removePersistentDomain(forName: suite)

        model = AppModel(context: container.mainContext, memory: try MemoryEngineTests.engine(),
                         // An account nothing was ever saved under: no key is found on this machine.
                         aiKey: AIKey(account: "rig-no-key-\(UUID().uuidString)"),
                         health: history ?? AppRig.month(endingBefore: now),
                         calendar: Fixture.calendar, clock: { clock.now }, calendarSync: calendar, healthReader: health)
        model.settings = settings
        model.unlocked = { true }
        model.sessionKey = nil
        model.memoryWithoutModel = true
        if connected {
            model.scriptedModel = ScriptedModel([])
            model.aiKeyTail = "test"
        } else {
            model.aiKeyTail = nil
        }
    }

    /// Connects a key that is only ever sent to a scripted network: the model is the app's own client, answered from `answers` in order.
    /// When they run out the network can't be reached.
    @discardableResult
    func connect(key: String, answers: [ScriptedNetwork.Answer]) -> ScriptedNetwork.Script {
        let network = ScriptedNetwork.session(answers)
        model.scriptedModel = nil
        model.sessionKey = key
        model.aiKeyTail = AIKey.lastFour(key)
        model.aiSession = network.session
        return network.script
    }

    /// Wires the rain and shoe checks to parts that count their calls. Rain is due 6 AM to noon on `wetDay`.
    @discardableResult
    func wireTriggers(wetDay: Date? = nil) -> (forecast: CountingForecast, places: FakePlaces, location: FakeLocation) {
        let forecast = CountingForecast(wetDay: wetDay, calendar: Fixture.calendar)
        let places = FakePlaces(), location = FakeLocation(.allowed)
        let notices = notices, calendar = calendar
        model.triggers.setUp(TriggerCenter.Parts(
            store: MemoryTriggerStore(), forecast: forecast, location: location, places: places,
            distance: WorkoutsRunningDistance(workouts: []),
            notify: { copy, id in notices.add(copy, id) }, busy: { calendar.meetings },
            plan: { [weak model] in model?.plan ?? [] }, calendar: Fixture.calendar
        ))
        return (forecast, places, location)
    }

    /// Puts a workout on the plan as if the person had added it: `day` days from today at `hour`.
    @discardableResult
    func plan(_ activity: ActivityKind, id: String, day: Int, hour: Int, minute: Int = 0, minutes: Int = 40) throws -> PlanItem {
        let cal = Fixture.calendar
        let start = cal.date(bySettingHour: hour, minute: minute, second: 0, of: cal.date(byAdding: .day, value: day, to: cal.startOfDay(for: clock.now))!)!
        let zone = cal.timeZone
        _ = model.write([PreviewBlock(id: id, sessionId: id, activity: activity, title: activity.displayName, start: LocalTime(start, in: zone),
                                      end: LocalTime(start.addingTimeInterval(Double(minutes) * 60), in: zone), minutes: minutes, status: "new", reason: "You added this.")])
        guard let item = model.plan.first(where: { $0.id == id }) else { throw RigError.notPlanned(id) }
        return item
    }

    /// Waits for work the model started on its own (a tick after an answer, an announcement) until `done` holds.
    func wait(_ what: String = "", until done: @MainActor () -> Bool) async throws {
        for _ in 0..<400 {
            if done() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw RigError.timedOut(what)
    }

    enum RigError: Error { case notPlanned(String), timedOut(String) }
}
