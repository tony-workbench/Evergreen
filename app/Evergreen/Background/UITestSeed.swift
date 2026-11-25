#if DEBUG
import Foundation
import SwiftData

/// Debug builds only, for automated screen checks and recordings: the launch
/// argument `-uiTest <name>` starts the app on a throwaway in-memory store
/// with made-up history instead of this device's Apple Health and calendar.
/// Nothing is read from or written to the device, and nothing reaches the network.
///
///   -uiTest empty    no workouts at all
///   -uiTest thin     a run on each of the nine days before today: ten days of history, counting today
///   -uiTest runner   four weeks of morning runs, shoes at 212 km
///   -uiTest rain     the same, with rain due on tomorrow's run, a dry afternoon and three gyms nearby
///   -uiTest shoes    the same, with 492 km on the shoes
///   -uiTest home     training at home by the rules: nothing to train with, the usual rest weekdays, rain through
///                    the afternoon on the first training day from today, and the training day after it out
///
/// Release builds don't contain this file's code, and the argument does nothing there.
@MainActor
enum UITestSeed {
    enum Name: String, CaseIterable {
        case empty, thin, runner, rain, shoes, home
    }

    static let argument = "-uiTest"

    /// The seed named after `-uiTest` in the launch arguments, if any.
    static func name(in arguments: [String]) -> Name? {
        guard let index = arguments.firstIndex(of: argument), arguments.indices.contains(index + 1) else { return nil }
        return Name(rawValue: arguments[index + 1])
    }

    /// The seeded container and model for this launch; nil for a normal launch.
    static func launch(arguments: [String] = ProcessInfo.processInfo.arguments) -> (container: ModelContainer, model: AppModel)? {
        name(in: arguments).map { make($0) }
    }

    /// One seeded launch: which seed, its day, and the calendar it is read in.
    struct Seeding {
        let name: Name
        let today: Date
        let calendar: Calendar
        /// The seeds with runs: shoes on the log and tomorrow's usual run on the plan.
        var runs: Bool { name == .runner || name == .rain || name == .shoes }
    }

    static func make(_ name: Name, now: Date = Date(), calendar: Calendar = .current) -> (container: ModelContainer, model: AppModel) {
        let seed = Seeding(name: name, today: calendar.startOfDay(for: now), calendar: calendar)
        let container = inMemoryContainer(today: seed.today)
        let history = HealthHistory(workouts: workouts(name, today: seed.today, calendar: calendar), days: [], readAt: now)
        let model = AppModel(context: container.mainContext,
                             setup: AppModel.Setup(memory: throwawayMemory(), onDevice: false, health: history))
        let home = name == .home ? homeDays(today: seed.today, calendar: calendar) : nil
        if let home { seedRules(model, out: home.out, calendar: calendar) }
        model.triggers.setUp(triggerParts(seed, rain: home?.rain, model: model))
        if seed.runs { addTomorrowsRun(to: model, seed) }
        Task {
            if home != nil { await model.saveRules(model.userRules, quiet: true) }
            await model.tick()
            await model.triggers.checkAll(now: Date(), mayAsk: true)
        }
        return (container, model)
    }

    /// An in-memory store, which can't fail to open for a fixed schema, holding today's run, onboarded.
    private static func inMemoryContainer(today: Date) -> ModelContainer {
        let schema = Schema([Run.self, ActionRecord.self, LoggedWorkout.self])
        let container = try! ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: true))
        let run = Run(persona: .me, storyDay: today)
        run.onboarded = true
        container.mainContext.insert(run)
        return container
    }

    /// Memory rolls into a folder of its own, never the person's.
    private static func throwawayMemory() -> MemoryEngine? {
        MemoryEngine(root: FileManager.default.temporaryDirectory.appending(path: "ui-test-memory-\(UUID().uuidString)"),
                     secret: "ui-test-only-0123456789abcdef")
    }

    /// The triggers' parts, all fixed: the forecast (wet on `rain`, or tomorrow for the rain seed), the place, the gyms and
    /// the distance, with shoes on the log for the seeds with runs.
    private static func triggerParts(_ seed: Seeding, rain: Date?, model: AppModel) -> TriggerCenter.Parts {
        let calendar = seed.calendar
        let store = MemoryTriggerStore()
        if seed.runs {
            let startedOn = calendar.date(byAdding: .day, value: -SeedNumbers.shoesDaysOld, to: seed.today) ?? seed.today
            store.save(ShoeLog(name: nil, startedOn: startedOn), for: ShoeLog.storeKey)
        }
        let wetDay = seed.name == .rain ? calendar.date(byAdding: .day, value: 1, to: seed.today) : rain
        return TriggerCenter.Parts(
            store: store,
            forecast: FixedForecast(wetDay: wetDay, wetHours: seed.name == .home ? SeedNumbers.afternoonRain : SeedNumbers.morningRain,
                                    calendar: calendar),
            location: FixedLocation(), places: FixedPlaces(),
            distance: FixedDistance(km: seed.name == .shoes ? SeedNumbers.wornShoesKm : SeedNumbers.shoesKm),
            notify: { _, _ in }, busy: { [] }, plan: { [weak model] in model?.plan ?? [] }, calendar: calendar,
            homeDays: { [weak model] in model?.rainHomeDays ?? [] }
        )
    }

    /// As if the person had added tomorrow's usual run at 7:00: nothing is on a plan by itself.
    private static func addTomorrowsRun(to model: AppModel, _ seed: Seeding) {
        guard let tomorrow = seed.calendar.date(byAdding: .day, value: 1, to: seed.today),
              let start = seed.calendar.date(bySettingHour: SeedNumbers.runHour, minute: 0, second: 0, of: tomorrow) else { return }
        let zone = seed.calendar.timeZone
        let end = start.addingTimeInterval(TimeInterval(SeedNumbers.runMinutes) * ClockUnits.minute)
        _ = model.write([PreviewBlock(id: "ui-test-run", sessionId: "ui-test-run", activity: .run, title: "Run",
                                      start: LocalTime(start, in: zone), end: LocalTime(end, in: zone),
                                      minutes: SeedNumbers.runMinutes, status: "new", reason: "Your usual morning run.")])
    }

    /// The first training day from today has rain in the afternoon (the short breaks show when that is today or
    /// tomorrow); the training day after it goes out.
    static func homeDays(today: Date, calendar: Calendar) -> (out: Date, rain: Date)? {
        let rest = UserRules().restWeekdays
        let training = (0..<SeedNumbers.lookAheadDays).compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
            .filter { !rest.contains(UserRules.weekdayIndex($0, calendar: calendar)) }
        guard training.count >= SeedNumbers.seededHomeDays else { return nil }
        return (training[1], training[0])
    }

    /// Rules on, with nothing to train with, kept in a settings store of their own so the device's rules are untouched.
    static func seedRules(_ model: AppModel, out: Date, calendar: Calendar) {
        let suite = "ui-test-home"
        let settings = UserDefaults(suiteName: suite) ?? .standard
        settings.removePersistentDomain(forName: suite)
        model.settings = settings
        var rules = UserRules()
        rules.isOn = true
        rules.equipment = []
        model.userRules = rules
        model.workoutLog = WorkoutLog()
        model.homeWeek = nil
        settings.set([LocalTime(out, in: calendar.timeZone).day], forKey: AppModel.goingOutKey)
    }

    /// A 40-minute, 7 km run at 7:00 every morning before today: 28 days, or 9 for `thin` (which Today counts as ten days of history: the first run's day through today).
    static func workouts(_ name: Name, today: Date, calendar: Calendar) -> [Workout] {
        let days = name == .empty || name == .home ? 0 : name == .thin ? SeedNumbers.thinDays : SeedNumbers.fullDays
        guard days > 0 else { return [] }
        return (1...days).compactMap { back in
            guard let day = calendar.date(byAdding: .day, value: -back, to: today),
                  let start = calendar.date(bySettingHour: SeedNumbers.runHour, minute: 0, second: 0, of: day) else { return nil }
            let end = start.addingTimeInterval(TimeInterval(SeedNumbers.runMinutes) * ClockUnits.minute)
            return Workout(id: "ui-test-run-\(back)", activityType: "Running", start: start, end: end, effort: nil,
                           avgHeartRate: SeedNumbers.runHeartRate, source: .health, distanceKm: SeedNumbers.runKm, indoor: false)
        }
    }
}

/// Dry everywhere, except some hours of one day (6 AM to noon unless said otherwise).
struct FixedForecast: ForecastProviding {
    var wetDay: Date?
    var wetHours: Range<Int> = SeedNumbers.morningRain
    var calendar: Calendar

    func forecast(at place: Coordinate, now: Date) async throws -> Forecast {
        let from = calendar.startOfDay(for: now)
        let hours = (0..<SeedNumbers.forecastHours).map { index -> Forecast.Hour in
            let start = from.addingTimeInterval(Double(index) * ClockUnits.hour)
            let hour = calendar.component(.hour, from: start)
            let wet = wetDay.map { calendar.isDate(start, inSameDayAs: $0) && wetHours.contains(hour) } ?? false
            return Forecast.Hour(start: start, probability: wet ? SeedNumbers.wetChance : SeedNumbers.dryChance,
                                 millimeters: wet ? SeedNumbers.wetMillimetres : 0)
        }
        return Forecast(hours: hours, fetchedAt: now, place: place.rounded)
    }
}

/// The made-up history's numbers.
enum SeedNumbers {
    /// The shoes on the log were started this many days ago, and have run this far (or, for the shoes seed, this far).
    static let shoesDaysOld = 120
    static let shoesKm = 212.0
    static let wornShoesKm = 492.0
    /// The usual run: at 7:00, 40 minutes, 7 km, at 148 bpm.
    static let runHour = 7
    static let runMinutes = 40
    static let runKm = 7.0
    static let runHeartRate = 148
    /// Days of runs before today: the full seeds and `thin`.
    static let fullDays = 28
    static let thinDays = 9
    /// The forecast covers three days; wet hours are likely to rain, the others aren't.
    static let forecastHours = 72
    static let morningRain = 6..<12
    static let afternoonRain = 12..<20
    static let wetChance = 85
    static let dryChance = 5
    static let wetMillimetres = 2.4
    /// The home days are looked for in the next two weeks; two are seeded, one with rain and one out.
    static let lookAheadDays = 14
    static let seededHomeDays = 2
}

@MainActor
final class FixedLocation: LocationProviding {
    let permission = LocationPermission.allowed
    func request() async -> Bool { true }
    func current() async -> Coordinate? { Coordinate(latitude: 40, longitude: -100) }
}

@MainActor
final class FixedPlaces: PlaceSearching {
    func gyms(near place: Coordinate) async -> [FoundPlace] {
        [("Corner Gym", 0.004), ("Riverside Fitness", 0.012), ("Climbing Hall", 0.03), ("Far Away Gym", 0.2)].map { name, offset in
            FoundPlace(name: name, coordinate: Coordinate(latitude: place.latitude + offset, longitude: place.longitude))
        }
    }
}

struct FixedDistance: RunningDistanceReading {
    var km: Double
    func runningKm(since start: Date, until now: Date) async -> Double? { km }
}
#endif
