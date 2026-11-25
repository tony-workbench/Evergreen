import EventKit
import UIKit

/// The real triggers, wired to the device: what starts a check, and what the
/// screens read from it. The checks themselves are in `Background/TriggerCenter.swift`.
extension AppModel {
    /// Called once from `init` for the model on the device. Hands the checks
    /// their parts and runs them when the app comes forward, when the calendar
    /// changes while it is open, and (from `Refresh`) in the background.
    func startTriggers(busy: @escaping @MainActor () async -> [Busy],
                       notify: @escaping @MainActor (_ copy: (title: String, body: String), _ id: String) async -> Void) {
        // The unit tests host the app; they wire their own fakes and never prompt or reach the network.
        guard onDevice, !triggers.isSetUp, ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        triggers.setUp(TriggerCenter.Parts(
            store: FileTriggerStore(), forecast: ForecastClient(), location: DeviceLocation(), places: MapPlaceSearch(),
            distance: HealthRunningDistance(), notify: notify, busy: busy,
            plan: { [weak self] in self?.plan ?? [] }, calendar: calendar,
            homeDays: { [weak self] in self?.rainHomeDays ?? [] }
        ))
        let center = NotificationCenter.default
        // The model lives as long as the app, so these are never removed.
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            Refresh.schedule()
        }
        center.addObserver(forName: .EKEventStoreChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.calendarChangedForTriggers() }
        }
        // A week skipped while the phone was locked is worked out once it is unlocked, not at the next run.
        center.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.phoneUnlocked() }
        }
        Task { await checkTriggers(foreground: UIApplication.shared.applicationState == .active) }
    }

    /// False while the phone is locked after a background launch: the saved
    /// Health history can't be read then, so the plan in hand isn't the real
    /// one and nothing may be written or announced from it.
    var deviceUnlocked: Bool { unlocked?() ?? UIApplication.shared.isProtectedDataAvailable }

    /// The three checks: the calendar (a tick moves a workout something landed
    /// on, and says so once), then rain, then shoes. Nothing runs before
    /// onboarding is done, so no permission is asked for during it. In the
    /// foreground the tick has just run (`RootView`); in the background it runs here.
    func checkTriggers(foreground: Bool) async {
        guard onDevice, triggers.isSetUp, onboarded else { return }
        // Locked, nothing else runs; a week that is due is noted and worked out at the next chance.
        guard deviceUnlocked else { await checkHomeWeek(); return }
        if !foreground { await tick() }
        // With the app open: a phone far from home makes today a day out (needs a home set in My rules).
        if foreground { await checkFarFromHome() }
        // The week the rules make: looked at again the first time each day, and for the week ahead on Sunday evening.
        await checkHomeWeek()
        // A time of today's session that passed without a start hands it on to the next time.
        moveMissedHomeTimes()
        // Each check runs only while its switch in Settings is on.
        if Automatic.rain.isOn(settings) { await triggers.checkRain(now: now, mayAsk: foreground) }
        if Automatic.shoes.isOn(settings) { await triggers.checkShoes(now: now) }
    }

    private func phoneUnlocked() {
        Task { await deviceDidUnlock() }
    }

    /// A calendar change while the app is open moves the free time, so the dry
    /// window is worked out again. The slot-defense tick for the same change is
    /// `calendarChanged()`; this waits for the same burst to settle.
    private func calendarChangedForTriggers() {
        guard UIApplication.shared.applicationState == .active else { return }
        Task {
            try? await Task.sleep(for: .seconds(2))
            await triggers.checkRain(now: now, mayAsk: false)
        }
    }

    // MARK: What the screens read

    /// How many days of the person's own workouts there are to plan from.
    var historyDepth: HistoryDepth {
        HistoryDepth(workouts: workouts, now: now, calendar: calendar)
    }

    /// Whether to ask the one shoe question: the person runs, and hasn't answered or put it off.
    var shouldAskAboutShoes: Bool {
        triggers.isSetUp && triggers.shoeLog == nil && !triggers.shoeQuestionSkipped
            && workouts.contains { $0.activityType == "Running" }
    }

    func answerShoeQuestion(startedOn: Date, name: String?) {
        Task { await triggers.setShoes(startedOn: startedOn, name: name, now: now) }
    }

    func gotNewShoes() {
        Task { await triggers.gotNewShoes(now: now) }
    }
}

/// Rain on an outdoor workout.
extension AppModel {
    /// "Move" on a rain ask: the dry time goes through the calendar engine.
    /// A plain move of that one workout is done at once; anything more waits as a preview.
    func moveForRain(_ ask: RainAsk) async {
        guard let intent = ask.intent, let engine = calendarEngine,
              let result = await engine.plan(intent, memory: calendarMemory, now: now)
        else { return }
        let plain = result.question == nil && result.proposed.count == 1 && result.proposed[0].status == "moved"
        if plain, write(result.proposed) {
            triggers.dismiss(ask)
            Task { await tick() }
        } else if !result.proposed.isEmpty || result.question != nil {
            placement = Placement(sessionKey: nil, result: result)
            triggers.dismiss(ask)
        }
    }
}

/// A rainy afternoon at home: short breaks through the day, in place of a walk.
extension AppModel {
    /// Rain is looked at for today and this many days after it.
    static let rainDaysAhead = 1

    /// Today and tomorrow when they are days at home by the rules, with each day's home session if it has one.
    var rainHomeDays: [RainHomeDay] {
        guard userRules.isOn, let week = homeWeek else { return [] }
        return (0...Self.rainDaysAhead).compactMap { offset -> RainHomeDay? in
            let iso = dayISO(offset: offset)
            guard dayKinds[iso] == .home || week.day(iso)?.kind == .home, let date = PlannedDays.date(iso, calendar: calendar) else { return nil }
            let session = week.day(iso)?.first?.date.map { DateInterval(start: $0, duration: TimeInterval(userRules.sessionMax) * ClockUnits.minute) }
            return RainHomeDay(day: date, session: session)
        }
    }

    /// A day's short breaks for rain, for the week table: those on the plan, or else those offered and not yet answered.
    func rainBreaks(on day: String) -> (clocks: [String], added: Bool)? {
        let zone = calendar.timeZone
        let added = plan.filter { $0.id.hasPrefix("snack-\(day)-") }.map(\.slot.start).sorted()
        if !added.isEmpty { return (added.map(\.clock), true) }
        guard let offered = triggers.rainSnacks.first(where: { LocalTime($0.day, in: zone).day == day }) else { return nil }
        return (offered.blocks.map(\.start.clock), false)
    }

    /// "Short breaks through the day": each break goes on the plan and the calendar as its own short block.
    /// They aren't strength sessions: they don't count towards the week's sets or unlock screen time.
    func addRainSnacks(_ snacks: RainSnacks) {
        let zone = calendar.timeZone
        let day = LocalTime(snacks.day, in: zone).day
        let blocks = snacks.blocks.enumerated().map { index, block in
            PreviewBlock(id: "snack-\(day)-\(index + 1)", sessionId: nil, activity: .other, title: RainSnacks.title,
                         start: LocalTime(block.start, in: zone), end: LocalTime(block.end, in: zone),
                         minutes: snacks.minutes, status: "new", reason: "Rain all afternoon: a few minutes of moving instead of a walk.")
        }
        if write(blocks) {
            log("Added \(blocks.count) short breaks for the rain")
            celebration += 1
        }
        triggers.dismiss(snacks)
        Task { await tick() }
    }

    /// How many movements a short break takes turns with.
    static let movementsPerSnack = 2

    /// Two movements for a break, taking turns through the day; only ones the person has the equipment for and hasn't left out.
    func snackMovements(turn: Int) -> [Movement] {
        let owned = Set(userRules.equipment.map(\.rawValue) + ["floor", "wall"])
        let all = movements.filter { $0.pattern == "snack" && Set($0.equipment).isSubset(of: owned) && !userRules.avoid.contains($0.id) }
        guard !all.isEmpty else { return [] }
        let first = turn * Self.movementsPerSnack
        return (0..<min(Self.movementsPerSnack, all.count)).map { all[(first + $0) % all.count] }
    }

    /// The movements for one of today's breaks: its turn is its place among today's breaks (the first when it isn't one).
    func snackMovements(for item: PlanItem) -> [Movement] {
        snackMovements(turn: snacksToday.firstIndex { $0.id == item.id } ?? 0)
    }

    /// The short breaks on today's plan, for Today.
    var snacksToday: [PlanItem] {
        plan.filter { $0.id.hasPrefix("snack-\(todayISO)") && completion(for: $0) == nil }.sorted { $0.slot.start < $1.slot.start }
    }
}

/// Worn running shoes.
extension AppModel {
    /// Whether the shoe card has Today's hero: the pair is due, and the person hasn't put it off this launch.
    var shoesDue: ShoeStatus? {
        guard let status = triggers.shoes, status.event == .replace, !shoeCardPutOff else { return nil }
        return status
    }

    /// Looks for replacements once per pair, and keeps what the search found for that pair: with the AI's
    /// web search when a key is connected, else (or when the search gives nothing) the general advice with no links.
    func loadShoeAdvice() async {
        guard let status = shoesDue, shoeAdvice == nil else { return }
        if let kept = KeptShoeAdvice.load(for: status.log, from: settings) {
            shoeAdvice = kept
            return
        }
        var found: ShoeAdvice?
        if !askWithoutModel, let model = languageModel {
            let runner = ShoeSearch.Runner(status: status, habit: RunningHabit(workouts, now: now))
            found = await ShoeSearch.advice(for: runner, model: model, modelId: AIModels.model())
        }
        if let found { KeptShoeAdvice.save(found, for: status.log, to: settings) }
        shoeAdvice = found ?? .general(status)
    }
}
