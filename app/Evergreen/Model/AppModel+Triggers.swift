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
            plan: { [weak self] in self?.plan ?? [] }, calendar: calendar
        ))
        let center = NotificationCenter.default
        // The model lives as long as the app, so these are never removed.
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            Refresh.schedule()
        }
        center.addObserver(forName: .EKEventStoreChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.calendarChangedForTriggers() }
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
        guard onDevice, triggers.isSetUp, onboarded, deviceUnlocked else { return }
        if !foreground { await tick() }
        // With the app open: a phone far from home makes today a day out (needs a home set in My rules).
        if foreground { await checkFarFromHome() }
        // Each check runs only while its switch in Settings is on.
        if Automatic.rain.isOn(settings) { await triggers.checkRain(now: now, mayAsk: foreground) }
        if Automatic.shoes.isOn(settings) { await triggers.checkShoes(now: now) }
    }

    /// A calendar change while the app is open moves the free time, so the dry
    /// window is worked out again. The slot-defense tick for the same change is
    /// `calendarChanged()`; this waits for the same burst to settle.
    private func calendarChangedForTriggers() {
        guard UIApplication.shared.applicationState == .active else { return }
        Task {
            try? await Task.sleep(for: .seconds(2))
            await triggers.checkRain(now: Date(), mayAsk: false)
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
            found = await ShoeSearch.advice(for: status, habit: RunningHabit(workouts, now: now), model: model, modelId: AIModels.model())
        }
        if let found { KeptShoeAdvice.save(found, for: status.log, to: settings) }
        shoeAdvice = found ?? .general(status)
    }
}
