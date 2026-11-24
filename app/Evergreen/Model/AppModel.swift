import Foundation
import Observation
import os
import SwiftData

/// The one model the views read (`@Environment(AppModel.self)`). It keeps the
/// clock and the day, Apple Health, the tick that runs the rules, and
/// notifications, and it owns the parts that do the rest: the plan store,
/// memory, the week's suggestions, Ask Evergreen and the triggers. What those
/// parts hold is reached through it (the `AppModel+…` files forward to them).
@Observable
@MainActor
final class AppModel {
    /// The saved plan: the run, the actions and what they add up to (PlanStore.swift).
    let store: PlanStore
    /// What is remembered, and stopping and forgetting it (MemoryModel.swift).
    @ObservationIgnored private(set) lazy var memoryModel = MemoryModel(app: self, memory: memory)
    /// "Ask Evergreen" and the AI key behind it (AskEvergreen.swift).
    @ObservationIgnored private(set) lazy var asking = AskEvergreen(app: self, key: aiKeyStore)
    /// The week's suggestions, the person's answers and placing what they accept (WeekSuggestions.swift).
    @ObservationIgnored private(set) lazy var week = WeekSuggestions(app: self)
    let persona: PersonaKey
    /// What Evergreen last read from Apple Health, for the person's own week (`.me`).
    private(set) var health = HealthHistory.cached()
    @ObservationIgnored private let healthReader: any HealthReading
    /// The last good answer, decoded once from `run.lastResponse`.
    private(set) var response: TickResponse?

    /// Follows the phone: a new time zone or region is picked up without a relaunch.
    let calendar: Calendar
    /// A clock to read instead of the device's (tests give a fixed one).
    @ObservationIgnored let clock: (@Sendable () -> Date)?
    /// Whether the phone is unlocked, instead of asking the device (tests).
    @ObservationIgnored var unlocked: (@MainActor () -> Bool)?
    @ObservationIgnored let notifier = Notifier()
    /// Writes a finished home workout to Apple Health; tests give one that counts.
    @ObservationIgnored var writeStrength: @Sendable (Date, Date) async -> Bool = { await WorkoutWriter.saveStrength(start: $0, end: $1) }
    /// Turns an event's typed place into a coordinate, for telling days out; tests give a fake.
    @ObservationIgnored var geocoder: any PlaceGeocoding = SystemGeocoder()
    /// Makes the phone's location to the given accuracy in metres, for "far from home" and setting home; tests give a fake.
    @ObservationIgnored var deviceLocation: @MainActor (Double) -> any LocationProviding = { DeviceLocation(accuracy: $0) }
    /// The memory engine over this phone's memory folder; nil if the folder can't be made.
    @ObservationIgnored let memory: MemoryEngine?
    /// False for the tour's model, which never touches the device or the network.
    @ObservationIgnored let onDevice: Bool
    /// The real triggers: rain on an outdoor workout, distance on the running shoes (AppModel+Triggers.swift).
    let triggers = TriggerCenter()
    /// Where the person's AI key is kept.
    @ObservationIgnored let aiKeyStore: AIKey
    /// Where the Automatic switches and the last update time are kept (tests give their own).
    @ObservationIgnored var settings: UserDefaults = .standard
    /// How often a step fell back to its rules because the AI couldn't do it, by step.
    @ObservationIgnored var fallbacks: [String: Int] = [:]
    /// Set when the saved plan couldn't be read and the app began again; said once on Today, then cleared.
    var startedFreshNotice = false
    /// Goes up once a minute, so what depends on the time of day is read again.
    var minute = 0
    /// The busy times on the person's other calendars, as last read (on a tick or a calendar change).
    @ObservationIgnored var busyCache: [Busy] = []
    /// All-day and free events with a place, read with `busyCache`; they only tell days out from days at home.
    @ObservationIgnored var placedCache: [Busy] = []
    /// The places found for events, kept for the settings in use (`placeMemory`, AppModel+Rules.swift).
    @ObservationIgnored var placeMemoryKept: PlaceMemory?
    /// The last few things that happened, newest first, for Settings.
    var activity: [String] = []
    /// Notes already shown in the hero on an earlier launch, and the ones shown on this one.
    @ObservationIgnored var notesShownNow: Set<String> = []
    /// What to look at to replace worn running shoes, once found; and whether the card was put off for now.
    var shoeAdvice: ShoeAdvice?
    var shoeCardPutOff = false
    /// Goes up each time something is worth a cheer (a workout done, a session added); the buddy watches it.
    var celebration = 0
    /// Screen time earned by working out (ScreenTime/EarnedTimeModel.swift).
    let earnedTime = EarnedTimeModel()
    /// The rules the person set (Model/UserRules.swift); off until they answer "How you train" or import a profile.
    var userRules = UserRules()
    /// Each of the next eight days as home, out or rest, worked out on the phone (AppModel+Rules.swift).
    var dayKinds: [String: DayKind] = [:]
    /// The week the rules make: each day's kind, focus, time and fallbacks (Model/HomeWeek.swift).
    var homeWeek: HomeWeek?
    /// What each day at home of that week holds, by day; filled after the week is worked out.
    var homeWeekContent: [String: WorkoutContent] = [:]
    /// Said at the top of the week table when the week can't reach its aim ("This week has 4 sets of…").
    var homeWeekNote: String?
    /// The days whose movements the AI chose (and code passed), with its one sentence on why, shown as picked by AI.
    var homeWeekReasons: [String: String] = [:]
    /// Where the week table's load stands (`loadHomeWeek()`): loading, ready, offline (the AI couldn't be reached,
    /// so the week stands on the rules' content) or failed (no week could be worked out).
    var homeWeekLoad: HomeWeekLoad = .loading
    /// Whether the AI couldn't be reached the last time the week's content was filled in.
    var homeWeekOffline = false
    /// What the person did on the workout page (Model/WorkoutLog.swift).
    var workoutLog = WorkoutLog()
    /// Set by "Start" on a reminder, or a tap on one (AppModel+Reminders.swift): the root view goes there and sets it back to nil.
    var workoutRoute: WorkoutRoute?
    /// Today's session asked for by a reminder, as the screens read it before `workoutRoute`: setting it false clears that route.
    var workoutRequested: Bool {
        get { workoutRoute == .session }
        set {
            if newValue { workoutRoute = .session } else if workoutRoute == .session { workoutRoute = nil }
        }
    }
    /// Every movement's words, read from the engine once (AppModel+Workout.swift).
    var movements: [Movement] = []
    /// The movements the rules and the log leave closed (no things for it, left out, "can't do", not earned yet), from the
    /// engine's own check; nil until it was asked. "Swap" offers none of them (AppModel+Workout.swift).
    var closedMovements: Set<String>?
    /// Whether notifications are allowed.
    private(set) var notificationAccess: NotificationAccess = .notAsked

    /// Counts ticks so only the newest one's answer is applied. Ticks overlap
    /// (a calendar change right after an answer), and one that waited longer
    /// for memory or the calendar must not replace a newer one.
    @ObservationIgnored private var latestTick = 0
    /// Waits for a burst of calendar changes to settle before ticking.
    @ObservationIgnored private var calendarChangeTask: Task<Void, Never>?
    /// The rule changes the workout page's buttons started, saved one after another (`pageSaved()`, AppModel+WorkoutPage.swift).
    @ObservationIgnored var pageSave: Task<Void, Never>?

    /// What a model is made with besides its store: everything outside it, each with the device's own as the default.
    /// Tests and the tour give their own.
    struct Setup {
        /// The memory engine over this phone's memory folder; nil runs without memory.
        var memory: MemoryEngine? = MemoryEngine.standard()
        /// False makes a model for the tour, which plays scripted steps: the real rules and screens, but nothing touches
        /// the calendar, notifications, Apple Health or the network.
        var onDevice = true
        var aiKey = AIKey()
        /// A history to start from instead of this phone's Apple Health.
        var health: HealthHistory?
        var calendar: Calendar = .autoupdatingCurrent
        var clock: (@Sendable () -> Date)?
        var calendarSync: (any PlanCalendar)?
        var healthReader: any HealthReading = HealthReader()
    }

    init(context: ModelContext, setup: Setup = Setup()) {
        calendar = setup.calendar
        clock = setup.clock
        healthReader = setup.healthReader
        aiKeyStore = setup.aiKey
        onDevice = setup.onDevice
        memory = setup.memory
        let today = calendar.startOfDay(for: setup.clock?() ?? Date())
        store = PlanStore(context: context, today: today, calendarSync: setup.calendarSync ?? CalendarSync())
        persona = store.run.personaKey
        // Health is the only history. A model off the device (the tour, a seeded launch) never reads this phone's.
        if let seeded = setup.health { health = seeded } else if !setup.onDevice { health = HealthHistory() }
        if setup.onDevice, Storage.startedFresh, !freshStartWasSaid { startedFreshNotice = true }
        useKeyFromEnvironment()
        openDay(today)
        guard onDevice else { return }
        readWhatThePhoneKeeps()
        listenToTheDevice()
    }

    /// The "started fresh" line was already said (`dismissFreshStartNotice`): kept in `settings`, or in the standard
    /// defaults by a build from before `settings` held it.
    private var freshStartWasSaid: Bool {
        settings.bool(forKey: Self.freshStartSaidKey) || UserDefaults.standard.bool(forKey: Self.freshStartSaidKey)
    }

    /// A model for the tour or a seeded launch: `onDevice: false` keeps it off the device (see `Setup`).
    convenience init(context: ModelContext, memory: MemoryEngine?, onDevice: Bool) {
        self.init(context: context, setup: Setup(memory: memory, onDevice: onDevice))
    }

    /// For checking against the real API without anyone typing a key: a debug build launched with GEMINI_API_KEY in its
    /// environment uses it for this run, in memory only.
    private func useKeyFromEnvironment() {
        #if DEBUG
        if onDevice, let given = ProcessInfo.processInfo.environment["GEMINI_API_KEY"], !given.isEmpty {
            asking.sessionKey = given
            asking.aiKeyTail = asking.aiKeyTail ?? ""
        }
        #endif
    }

    /// Opens on `today`: a new day keeps everything the person added and starts again only what belonged to the day itself;
    /// the same day picks up its last answer. Then saves.
    private func openDay(_ today: Date) {
        if run.storyDay != today {
            startDay(today)
        } else {
            response = run.lastResponse.flatMap { data in
                Logger.model.attempt("The last answer couldn't be read") { try JSONDecoder.contract.decode(TickResponse.self, from: data) }
            }
        }
        save()
    }

    /// The rules, the workout log and the week, as kept on this phone.
    private func readWhatThePhoneKeeps() {
        userRules = UserRules.load(from: settings)
        workoutLog = WorkoutLog.load(from: settings)
        homeWeek = HomeWeek.load(from: settings)
    }

    /// The calendar, the notifications' buttons, Apple Health, earned time and the triggers.
    private func listenToTheDevice() {
        calendarSync.onChange = { [weak self] in self?.calendarChanged() }
        notifier.onOpen = { [weak self] in Task { await self?.tick() } }
        notifier.onUndo = { [weak self] id in self?.undoMove(id) }
        notifier.onWorkoutAction = { [weak self] action, day in await self?.handleWorkoutAction(action, day: day) }
        notifier.onPickTime = { [weak self] clock, day in await self?.pickTime(clock, day: day) }
        notifier.onDelivered = { [weak self] in self?.moveMissedHomeTimes() }
        Task { await refreshNotifications() }
        if persona.isReal { Task { await refreshHealth() } }
        watchWorkoutsForEarnedTime()
        startTriggers(busy: { [weak self] in
                          guard let self else { return [] }
                          return await self.calendarSync.busyTimes(from: self.calendar.startOfDay(for: self.now))
                      },
                      notify: { [weak self] copy, id in await self?.notifyNow(copy, id: id) })
    }

    // MARK: The saved plan, as views and the other parts read it

    var run: Run { store.run }
    var calendarSync: any PlanCalendar { store.calendarSync }
    var calendarAccess: CalendarAccess { store.calendarAccess }
    var appliedActions: [AgentAction] { store.appliedActions }
    var undoneIds: Set<String> { store.undoneIds }
    var loggedWorkouts: [Workout] { store.loggedWorkouts }
    var suggestionAnswers: [String: SuggestionAnswer] { store.suggestionAnswers }

    func isUndone(_ action: AgentAction) -> Bool { store.isUndone(action) }

    func record(_ action: AgentAction) { store.record(action) }

    // MARK: Derived

    var onboarded: Bool { run.onboarded }

    var clockMinutes: Int? { run.clockMinutes }
    var storyDay: Date { run.storyDay }

    var now: Date {
        if let clock { return clock() }
        // Only the tour's throwaway model has a fixed clock; the app runs on real time.
        guard !onDevice, let minutes = run.clockMinutes else { return Date() }
        return calendar.date(byAdding: .minute, value: minutes, to: storyDay) ?? Date()
    }

    /// Nothing is on a person's plan until they add it: the week arrives as
    /// suggestions. Only the tour's throwaway model starts from a fixed week.
    var basePlan: [PlanItem] {
        persona.isReal ? [] : PinnedPlan.items(for: persona, storyDay: storyDay, calendar: calendar)
    }

    /// Where the person's history begins: Apple Health's first workout.
    var historyStart: Date {
        return health.historyStart.map { calendar.startOfDay(for: $0) } ?? storyDay
    }

    /// The sessions the person added, with the moves of them on top.
    var plan: [PlanItem] { store.plan(on: basePlan, calendar: calendar) }

    var todayPlan: [PlanItem] { plan.filter { calendar.isDate($0.slot.start, inSameDayAs: storyDay) } }

    var workouts: [Workout] {
        health.workouts + loggedWorkouts
    }

    /// Newest first.
    var feed: [AgentAction] { appliedActions.reversed() }

    /// Whether a week can be planned: an AI key is connected.
    var plannerAvailable: Bool { aiConnected }

    func completion(for item: PlanItem) -> Completion? {
        response?.completions.first { $0.planItemId == item.id }
    }

    func isMissed(_ item: PlanItem) -> Bool {
        completion(for: item) == nil && item.slot.end.addingTimeInterval(StandInAgent.grace) <= now
    }

    // MARK: Agent

    /// Ticks now, then every minute while the app is on screen, so a window that
    /// passes with the app open is still noticed.
    func keepTicking() async {
        await tick()
        // After that the full tick runs on a change (the calendar, coming forward, an answer).
        // Each minute only moves the clock the screen reads, so a passed workout shows as missed.
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(ClockUnits.secondsPerMinute))
            minute += 1
            moveMissedHomeTimes()
            // A workout whose time has just passed needs the full tick once.
            if plan.contains(where: { abs($0.slot.end.addingTimeInterval(StandInAgent.grace).timeIntervalSince(now)) < ClockUnits.minute }) { await tick() }
        }
    }

    func tick() async {
        latestTick += 1
        let thisTick = latestTick
        // The first tick after launch rolls memory first, so a shoe pick already has it.
        if !memoryRead { await syncMemory() }
        let snapshot = TickSnapshot(
            now: now,
            timeZone: calendar.timeZone.identifier,
            plan: plan,
            workouts: workouts,
            actions: appliedActions.filter { !isUndone($0) },
            undoneActionIds: appliedActions.map(\.id).filter(undoneIds.contains),
            busy: Automatic.meetings.isOn(settings) ? await refreshBusy() : []
        )
        guard thisTick == latestTick else { return }
        apply(StandInAgent().tick(snapshot))
        await syncMemory()
    }

    private func apply(_ response: TickResponse) {
        let known = store.recordedIds
        for action in response.actions where !known.contains(action.id) {
            record(action)
            announceMove(action)
        }
        if let before = self.response, response.completions.count > before.completions.count { celebration += 1 }
        self.response = response
        run.lastResponse = Logger.model.attempt("The answer couldn't be kept") { try JSONEncoder.contract.encode(response) }
        save()
    }

    // MARK: Person's choices

    func undo(_ action: AgentAction) {
        guard store.undo(action) else { return }
        save()
        Task { await tick() }
    }

    /// "Undo" on the notification about a move: the workout goes back to where it was.
    func undoMove(_ actionId: String) {
        guard let action = appliedActions.first(where: { $0.id == actionId }) else { return }
        undo(action)
    }

    /// Takes a workout off the plan for good: the action that added it and every move of it since.
    func remove(_ item: PlanItem) {
        store.takeOff(item)
        save()
        Task { await tick() }
    }

    /// What a move the person made says in the feed.
    nonisolated static let pickedReason = "You picked this time."

    /// "Pick another time": logged as the person's own move so it shows in the feed. Its length stays the same.
    func move(_ item: PlanItem, to start: Date, reason: String = AppModel.pickedReason) {
        move(item, to: (start, start.addingTimeInterval(item.slot.end.timeIntervalSince(item.slot.start))), reason: reason)
    }

    /// A move that sets the end too, so its length can change (a resize).
    func move(_ item: PlanItem, to times: (start: Date, end: Date), reason: String = AppModel.pickedReason) {
        let after = Slot(start: times.start, end: times.end, activityType: item.slot.activityType)
        record(AgentAction(
            id: "user-move-\(UUID().uuidString)", kind: .move, planItemId: item.id,
            before: item.slot, after: after, reason: reason, createdAt: now
        ))
        save()
        Task { await tick() }
    }

    /// Onboarding's calendar step, and "Turn on Calendar" before anyone has
    /// been asked. Puts the plan on the calendar if access is granted.
    func requestCalendarAccess() async {
        await store.requestCalendarAccess()
        syncCalendar()
    }

    /// Something changed on the phone's calendars, maybe a meeting on a
    /// workout (slot defense). The app's own writes land here too; a tick that
    /// changes nothing writes nothing, so this settles.
    private func calendarChanged() {
        calendarChangeTask?.cancel()
        calendarChangeTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await tick()
            // The week the rules make follows the calendar during the day too, for the days it changes.
            await checkHomeWeek()
        }
    }

    // MARK: Notifications and Live Activity

    /// The next workout that isn't done or missed yet.
    var nextWorkout: PlanItem? {
        plan.first { completion(for: $0) == nil && !isMissed($0) && $0.slot.end > now }
    }

    /// Onboarding's notifications step.
    func requestNotificationAccess() async {
        await notifier.requestAccess()
        await refreshNotifications()
    }

    func refreshNotifications() async {
        await notifier.refreshAccess()
        notificationAccess = notifier.access
        await scheduleNotifications()
    }

    /// Plans every reminder again. Locked (a button pressed on the lock screen after a background launch), the plan and
    /// Health in hand may not be the real ones, so only the day-at-home reminders of `day`, the day the button was about,
    /// are planned again; the rest waits for the phone to be unlocked.
    func scheduleNotifications(day: String? = nil) async {
        guard onDevice else { return }
        guard deviceUnlocked else {
            if let day { await scheduleHomeNotifications(day: day) }
            return
        }
        // A day out has no reminders: the person said they're out, or the phone was far from home when the app opened.
        // A session on a day at home has reminders of its own (AppModel+Reminders.swift), not the one 30 minutes before.
        await notifier.scheduleReminders(for: keptOtherReminders, now: now, calendar: calendar)
        await scheduleHomeNotifications()
        await notifier.scheduleWeekAhead(userRules.isOn)
    }

    /// Starts clean: a reinstall keeps calendar events, so clear the plan's old
    /// events before the first plan syncs.
    func completeOnboarding() {
        if onDevice { calendarSync.removeAllEvents(around: storyDay) }
        run.onboarded = true
        save()
        Task {
            await refreshHealth()
            await tick()
            await checkTriggers(foreground: true)
        }
    }

    // MARK: Apple Health

    /// Reads Apple Health again (on launch and when the app comes forward, for
    /// the person's own week) and re-plans when anything changed.
    func refreshHealth() async {
        guard onDevice, healthReader.isAvailable else { return }
        // A locked phone can't read Health: nothing is replaced by an empty read then, or after any failed one.
        guard deviceUnlocked, let read = await healthReader.read(now: now, calendar: calendar) else { return }
        let changed = read.workouts != health.workouts || read.days != health.days
        health = read
        read.saveToCache()
        refreshEarnedTime()
        if changed, persona.isReal { await tick() }
    }

    /// When the agent moves a workout off something on the calendar, says so as a
    /// notification, once: "A meeting landed on your run … I moved it to 6:45 PM."
    private func announceMove(_ action: AgentAction) {
        guard onDevice, action.id.hasPrefix("defend-"), let before = action.before, let after = action.after else { return }
        let copy = NotificationCopy.moved(before: before, after: after)
        Task { await triggers.announceMove(id: action.id, copy: copy, now: now) }
    }

    // MARK: Storage

    /// Moves on to a new day: the plan is kept, and the week and what is done are worked out again.
    private func startDay(_ day: Date) {
        store.startDay(day)
        weekPlan = nil
        response = nil
    }

    /// Called when the app comes forward and when the clock changes much
    /// (midnight, a new time zone): if the day has moved on, the app does too.
    /// True when it did.
    @discardableResult
    func refreshDay() -> Bool {
        let today = calendar.startOfDay(for: clock?() ?? Date())
        guard onDevice, run.storyDay != today else { return false }
        startDay(today)
        save()
        return true
    }

    /// Saves the run, refreshes what views read, then brings the
    /// Evergreen calendar in line with the plan. Every change to the run
    /// goes through here.
    func save() {
        store.save()
        syncCalendar()
        Task { await scheduleNotifications() }
    }

    /// Puts the plan on the calendar, from the device and only while it is unlocked.
    private func syncCalendar() {
        guard onDevice, deviceUnlocked else { return }
        let marks = CalendarEntry.Marks(notes: calendarNotes, done: userRules.isOn ? Set(workoutLog.doneDays) : [])
        store.syncCalendar(plan, calendar: calendar, marks: marks)
    }
}
