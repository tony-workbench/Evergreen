import Foundation
import Observation

/// The week's suggestions: planning them, what each rests on, the person's
/// answers, and placing an accepted session on the calendar. Nothing is on
/// the plan until the person adds it.
@Observable
@MainActor
final class WeekSuggestions {
    /// The app model this is part of: the clock, the plan store, memory and the engines are read from it.
    @ObservationIgnored unowned let app: AppModel
    /// The planner's last answer, kept so Today can show a suggestion for today.
    var weekPlan: WeekPlan?
    /// True while the week is being planned, for the hero's waiting state.
    var planning = false
    /// Why the week couldn't be planned by the AI, in words for the person; nil when it could.
    var planProblem: String?
    /// The planning in flight, so two callers share one.
    @ObservationIgnored var planTask: Task<WeekPlan?, Never>?
    @ObservationIgnored var planGeneration = 0
    /// The agent's sessions behind the week on screen, for placing an accepted session.
    @ObservationIgnored var plannedSessions: [PlanSession] = []
    /// The last planned week and what it was planned from.
    @ObservationIgnored var weekCache: WeekCache?
    /// How many times the planning agent was asked for a week (tests count these).
    @ObservationIgnored var weeksPlanned = 0
    /// The busy times on the person's calendars when the week was last planned; the free-time bases come from these.
    var busyForBases: [Busy] = []
    /// Exactly what the planning agent was last sent about the person.
    var sentToAI = ""
    /// The memory key last answered "Not true for me", for its Undo.
    var rejectedBasis: String?
    /// The last "Not now" that stopped a usual time: its line ("Got it. I won't plan around Wednesday 7 AM runs.") and
    /// the answer Undo takes back. It does not depend on the week planned afterwards, and stays on Today until the person
    /// adds or declines something else, asks, undoes or restores it, or leaves the app.
    var lastDecline: StopNote?
    /// A calendar preview waiting for the person to confirm.
    var placement: Placement?

    init(app: AppModel) {
        self.app = app
    }

    // MARK: What Today shows first

    /// The suggestion in Today's hero: the open one with the strongest personal basis.
    var topSuggestion: WeekPlan.Session? { rankedSuggestions.first }

    private var rankedSuggestions: [WeekPlan.Session] {
        let later = openSuggestions.filter { ($0.after?.start ?? .distantPast) > app.now }
        // The one that rests on the most of what is remembered comes first, then the soonest:
        // a general suggestion is never on top while a personal one is open.
        func strength(_ session: WeekPlan.Session) -> Int { Set(session.basedOn ?? []).intersection(usableKeys).count }
        let usableKeys = Set(app.memoryRows.filter(\.isUsable).map(\.key))
        return later.sorted {
            let a = strength($0), b = strength($1)
            return a != b ? a > b : ($0.after?.start ?? .distantFuture) < ($1.after?.start ?? .distantFuture)
        }
    }

    /// What a suggestion rests on: its remembered lines and the free time on the calendar.
    func bases(for session: WeekPlan.Session) -> [Basis] {
        Basis.list(for: session, rows: app.memoryRows, busy: app.calendarAccess == .on ? busyForBases : nil, calendar: app.calendar)
    }

    /// "Not true for me" on a memory basis: it is stopped, and the week is planned again without it.
    func rejectBasis(_ key: String) async {
        await app.stop(key: key)
        rejectedBasis = key
        await replan()
    }

    /// Undo of the last "Not true for me".
    func undoRejectBasis() async {
        guard let key = rejectedBasis else { return }
        rejectedBasis = nil
        await app.restore(key: key)
        await replan()
    }

    private func replan() async {
        guard weekPlan != nil else { return }
        _ = try? await loadWeekPlan()
    }

    // MARK: Placing an accepted session

    /// "Add to plan" on a suggestion.
    func accept(_ session: WeekPlan.Session) async {
        guard suggestionState(session) == .open else { return }
        guard let planned = plannedSessions.first(where: { $0.id == session.id }), let loop = app.orchestrator(),
              let result = await loop.place(planned, rows: app.memoryRows, now: app.now)
        else {
            // No engine for this one (a break-in run, or it couldn't be placed): the time as suggested.
            addToPlan(session)
            return
        }
        guard result.isSimpleAdd else {
            placement = Placement(sessionKey: AppModel.answerKey(session), result: result)
            return
        }
        if await loop.confirm(result) != nil { accepted(AppModel.answerKey(session)) }
    }

    /// "Add all": every open suggestion that simply fits is added; one that
    /// needs an answer or would move something else stays a suggestion.
    func acceptAll() async {
        guard let loop = app.orchestrator() else { return }
        var added = 0
        for session in openSuggestions {
            // Each is placed against the plan as it stands after the ones before it.
            guard suggestionState(session) == .open, let planned = plannedSessions.first(where: { $0.id == session.id }),
                  let result = await app.orchestrator()?.place(planned, rows: app.memoryRows, now: app.now), result.isSimpleAdd,
                  await loop.confirm(result) != nil
            else { continue }
            app.store.answer(AppModel.answerKey(session), SuggestionAnswer(accepted: true))
            added += 1
        }
        guard added > 0 else { return }
        app.celebration += 1
        app.save()
        Task { [app] in await app.tick() }
    }

    /// Confirms the preview on screen: only now is anything written.
    func confirmPlacement() async {
        guard let placement, let loop = app.orchestrator() else { return }
        if await loop.confirm(placement.result) != nil {
            if let key = placement.sessionKey { accepted(key) } else { app.celebration += 1 }
            self.placement = nil
            app.ask = .idle
            Task { [app] in await app.tick() }
        }
    }

    /// Leaves the preview without writing anything.
    func cancelPlacement() {
        placement = nil
    }

    /// One of the answers to the engine's question.
    func answerPlacement(_ answerId: String) async {
        await replan(["type": "answer", "answerId": .string(answerId)])
    }

    /// A proposed block dragged to another start.
    func dragPlacement(_ blockId: String, to start: Date) async {
        await replan(["type": "drag", "id": .string(blockId), "start": .string(LocalTime(start, in: app.calendar.timeZone).text)])
    }

    /// A planned workout dragged to another start: asks the engine to move it, as a preview.
    func dragWorkout(_ item: PlanItem, to start: Date) async {
        guard let engine = app.calendarEngine else { return }
        let time = LocalTime(start, in: app.calendar.timeZone)
        let intent = CalendarIntent(kind: "move", targetWorkoutId: item.id, day: time.day, after: time.clock)
        if let result = await engine.plan(intent, memory: calendarMemory, now: app.now), !result.proposed.isEmpty || result.question != nil {
            placement = Placement(sessionKey: nil, result: result)
        }
    }

    /// The person's usual times and what they turned down, for the calendar engine.
    var calendarMemory: CalendarMemory { HandOff.rowsToCalendarMemory(app.memoryRows) }

    private func replan(_ change: JSONValue) async {
        guard let current = placement, let engine = app.calendarEngine,
              let result = await engine.replan(current.result, change: change, memory: calendarMemory, now: app.now)
        else { return }
        placement = Placement(sessionKey: current.sessionKey, result: result)
    }

    private func accepted(_ answerKey: String) {
        app.store.answer(answerKey, SuggestionAnswer(accepted: true))
        app.celebration += 1
        app.save()
        Task { [app] in await app.tick() }
    }

    // MARK: Planning the week

    /// Plans the week: the planning agent proposes it from the memory table,
    /// the rules check it, and only a week that passed is kept. When the AI
    /// can't be reached, or its week fails twice, the week from the rules is
    /// used instead. Nothing is added to the plan here.
    @discardableResult
    func loadWeekPlan(fresh: Bool = false, quiet: Bool = false) async throws(PlanFailure) -> WeekPlan {
        guard app.aiConnected else { throw .notConnected }
        // One planning at a time: a second caller waits for the one in flight, unless it asks for a fresh week.
        if !fresh, let running = planTask {
            if let plan = await running.value { return plan }
            throw .unavailable
        }
        planGeneration += 1
        let generation = planGeneration
        // The task keeps the app model for as long as the planning runs.
        let task = Task { [app] in await app.week.planWeek(fresh: fresh, generation: generation, quiet: quiet) }
        planTask = task
        let plan = await task.value
        if planGeneration == generation { planTask = nil }
        guard let plan else { throw .unavailable }
        return plan
    }

    /// The planning itself. A result that a newer planning has overtaken is dropped.
    /// `quiet` keeps the week already on screen while the new one is worked out.
    func planWeek(fresh: Bool, generation: Int, quiet: Bool) async -> WeekPlan? {
        if !quiet { planning = true }
        defer { if planGeneration == generation { planning = false } }
        if !app.memoryRead { await app.syncMemory() }
        guard let loop = app.orchestrator() else {
            planProblem = "I couldn’t plan your week on this phone just now."
            return nil
        }
        let busy = await app.refreshBusy()
        // The week is shown from the table as it stands, and the day's memory (once a day) is settled after it,
        // so the person never waits for both. Only with nothing remembered yet does memory come first: there is nothing to plan from.
        let settles = Automatic.memory.isOn(app.settings)
        var rows = app.shown(await loop.memory.table())
        let settledFirst = settles && !rows.contains(where: \.isUsable)
        if settledFirst { rows = await settleMemory(loop) }
        // The same day, memory and calendar give the same week: the AI isn't asked again.
        let key = weekKey(rows: rows, busy: busy)
        let kept = weekCache ?? WeekCache.load(from: weekCacheStore)
        let week: PlanAgent.Week
        if !fresh, let kept, kept.key == key {
            week = kept.week
        } else {
            var planned = await loop.recommend(rows: rows, now: app.now)
            // With nothing to go on yet, two short walks to start from, said to be general.
            if planned.sessions.isEmpty, app.historyDepth.isThin { planned.sessions = await checkedStarters(rows: rows) }
            week = planned
            weeksPlanned += 1
            if week.source == .rules { app.fallbacks["plan", default: 0] += 1 }
            app.log(week.source == .agent ? "Week planned: \(week.sessions.count) sessions" : "Week planned by my own rules")
            // Only the AI's own week is kept: a week from the rules is planned again next time, when the AI may answer.
            if week.source == .agent { WeekCache(key: key, week: week).save(to: weekCacheStore) }
        }
        guard planGeneration == generation else { return nil }
        weekCache = week.source == .agent ? WeekCache(key: key, week: week) : nil
        planProblem = week.keyProblem
        busyForBases = busy
        sentToAI = await loop.brief(rows: rows, now: app.now)
        app.memoryRows = rows
        plannedSessions = week.sessions
        let plan = WeekPlan(week)
        weekPlan = plan
        // Each day at home's focus, kept so a missed one can move to the next day at home.
        await app.rememberHomeWeek()
        if settles, !settledFirst { settleMemoryAfterwards(loop, plannedFrom: key) }
        return plan
    }

    /// What a planned week depends on: the day, what is remembered, and the busy times near the hours a workout could go.
    func weekKey(rows: [MemoryRow], busy: [Busy]) -> String {
        WeekCache.key(day: LocalTime(app.now, in: app.calendar.timeZone).day, rows: rows,
                      busy: WeekCache.planning(busy, now: app.now, calendar: app.calendar), rules: app.rulesCacheText)
    }

    /// The day's memory update, with what it did written to the log. Returns the rows as they are afterwards.
    func settleMemory(_ loop: Orchestrator) async -> [MemoryRow] {
        let consolidated = await loop.consolidate(now: app.now, outcomes: app.yesterdayOutcomes)
        let rows = app.shown(consolidated.rows)
        if consolidated.run.source != .none {
            app.lastMemoryUpdate = app.now
            if consolidated.run.source == .rules { app.fallbacks["memory", default: 0] += 1 }
            app.log("Memory updated: \(rows.filter(\.isUsable).count) rows in use\(consolidated.run.source == .rules ? ", by my own rules" : "")")
        }
        return rows
    }

    /// Settles the day's memory with the week already on screen, and plans again only when what is remembered changed.
    private func settleMemoryAfterwards(_ loop: Orchestrator, plannedFrom key: String) {
        guard app.memoryTask == nil else { return }
        app.memoryTask = Task { [weak app] in
            guard let app else { return }
            let rows = await app.week.settleMemory(loop)
            guard !Task.isCancelled else { return }
            app.memoryTask = nil
            guard app.week.weekKey(rows: rows, busy: app.busyNow) != key else { return }
            app.memoryRows = rows
            _ = try? await app.loadWeekPlan(quiet: true)
        }
    }

    /// Short walks to start from, for someone with no history yet: the most that passes the plan check, from two
    /// 30-minute walks down to one of 10 minutes. Nothing that fails the check is shown, so there may be none.
    func checkedStarters(rows: [MemoryRow]) async -> [PlanSession] {
        guard let rules = app.planRules else { return [] }
        for (count, minutes) in [(2, 30), (2, 20), (1, 20), (1, 15), (1, 10)] {
            let sessions = Array(starterSessions(minutes: minutes).prefix(count))
            if await rules.checkPlan(sessions, summary: "", rows: rows, now: app.now).isEmpty { return sessions }
        }
        return []
    }

    /// Walks tomorrow evening and three days later.
    func starterSessions(minutes: Int) -> [PlanSession] {
        [1, 4].compactMap { offset in
            guard let day = app.calendar.date(byAdding: .day, value: offset, to: app.calendar.startOfDay(for: app.now)),
                  let start = app.calendar.date(bySettingHour: 18, minute: 0, second: 0, of: day) else { return nil }
            let time = LocalTime(start, in: app.calendar.timeZone)
            return PlanSession(id: PlanSession.id(day: time.day, activity: .walk, start: time), day: time.day, start: time, minutes: minutes, activity: .walk,
                               intensity: "easy", reason: "A short walk to start while I learn your routine.", basedOn: [])
        }
    }

    /// Where the planned week is kept between launches: nowhere for a throwaway or scripted model.
    private var weekCacheStore: UserDefaults? { app.onDevice && app.scriptedModel == nil ? app.settings : nil }

    /// Plans the week once, and again after the run is cleared.
    func loadSuggestionsIfNeeded() async {
        guard app.plannerAvailable, weekPlan == nil, Automatic.week.isOn(app.settings) else { return }
        _ = try? await loadWeekPlan()
    }

    // MARK: The person's answers

    /// Suggested sessions the person hasn't answered yet. A session planned again
    /// after a "not now" is still offered in the list, but the person has
    /// answered for that day, so it isn't counted.
    var openSuggestions: [WeekPlan.Session] {
        (weekPlan?.sessions ?? []).filter {
            $0.kind == "addWorkout" && $0.after != nil && suggestionState($0) == .open && stopNote(for: $0) == nil
        }
    }

    func suggestionState(_ session: WeekPlan.Session) -> SuggestionState {
        if let answer = app.suggestionAnswers[AppModel.answerKey(session)] {
            return answer.accepted ? .added : .declined
        }
        guard let slot = session.after else { return .open }
        let planned = app.plan.contains {
            $0.id != session.id && $0.slot.activityType == slot.activityType
                && app.calendar.isDate($0.slot.start, inSameDayAs: slot.start)
        }
        return planned ? .alreadyPlanned : .open
    }

    /// "Add to plan": the session joins the plan and the calendar. Nothing goes into memory.
    func addToPlan(_ session: WeekPlan.Session) {
        guard suggestionState(session) == .open, let action = AppModel.action(adding: session, at: app.now) else { return }
        lastDecline = nil
        app.store.add(action)
        app.store.answer(AppModel.answerKey(session), SuggestionAnswer(accepted: true))
        app.celebration += 1
        app.save()
        Task { [app] in await app.tick() }
    }

    /// "Not now", one tap. A suggestion that rested on memory stops those
    /// facts and the week is asked for again without them; one that didn't is
    /// only hidden.
    func decline(_ session: WeekPlan.Session) async {
        guard suggestionState(session) == .open else { return }
        // Code decides what a "not now" stops: only the usual time this session is, never whatever else it cites.
        let keys = rejectableKeys(for: session)
        // Said from the row as it is now, before it is stopped and the week is planned again without this session.
        let note = keys.first.map { StopNote(text: "Got it. I won’t plan around \(app.title(for: $0)).", answerKey: AppModel.answerKey(session)) }
        app.store.answer(AppModel.answerKey(session), SuggestionAnswer(accepted: false, stopped: keys))
        app.save()
        lastDecline = note
        guard !keys.isEmpty else { return }
        for key in keys { await app.stop(key: key) }
        await reloadSuggestions()
    }

    /// "Not now" to several at once: all are answered, their usual times stopped, and the week planned again once.
    func decline(all sessions: [WeekPlan.Session]) async {
        var stopped: [String] = []
        for session in sessions where suggestionState(session) == .open {
            let keys = rejectableKeys(for: session).filter { !stopped.contains($0) }
            app.store.answer(AppModel.answerKey(session), SuggestionAnswer(accepted: false, stopped: keys))
            stopped += keys
        }
        app.save()
        for key in stopped { await app.stop(key: key) }
        if !stopped.isEmpty, weekPlan != nil { _ = try? await loadWeekPlan() }
    }

    /// The memory keys a "not now" to this session stops: the usual times it is, by the hand-off's rule.
    func rejectableKeys(for session: WeekPlan.Session) -> [String] {
        guard let slot = session.after else { return [] }
        let start = LocalTime(slot.start, in: app.calendar.timeZone)
        let planned = plannedSessions.first { $0.id == session.id } ?? PlanSession(
            id: session.id, day: start.day, start: start, minutes: slot.minutes, activity: ActivityKind(healthType: slot.activityType),
            intensity: "easy", reason: session.reason, basedOn: session.basedOn ?? [])
        return HandOff.keysToReject(planned, rows: app.memoryRows)
    }

    /// The "not now" that stopped memory facts behind this row's suggestion, if there is one:
    /// "Got it. I won't plan around Sunday 6 AM runs."
    func stopNote(for session: WeekPlan.Session) -> (text: String, answerKey: String)? {
        let made = app.suggestionAnswers.first { $0.key.hasPrefix("\(session.id)|") && !$0.value.accepted && !$0.value.stopped.isEmpty }
        guard let made, let key = made.value.stopped.first else { return nil }
        return ("Got it. I won’t plan around \(app.title(for: key)).", made.key)
    }

    /// Undo of a "not now" that stopped memory: the facts are used again and the suggestion comes back.
    func undoDecline(_ answerKey: String) async {
        guard let answer = app.suggestionAnswers[answerKey], !answer.accepted else { return }
        // Restoring each usual time takes the answer back and plans the week again.
        for key in answer.stopped { await app.restore(key: key) }
        if app.suggestionAnswers[answerKey] != nil {
            app.store.answer(answerKey, nil)
            app.save()
            await reloadSuggestions()
        }
    }

    /// A usual time is in use again (Undo on Today, or Restore in What I remember): the "not now" that stopped it
    /// no longer stands, so its suggestion can come back, and the week is planned again.
    func restored(key: String) async {
        let taken = app.suggestionAnswers.filter { !$0.value.accepted && $0.value.stopped.contains(key) }.map(\.key)
        for answerKey in taken { app.store.answer(answerKey, nil) }
        if let note = lastDecline, taken.contains(note.answerKey) { lastDecline = nil }
        if !taken.isEmpty { app.save() }
        await reloadSuggestions()
    }

    /// Asks for the week again when one is on screen, so it reflects what memory now sends.
    private func reloadSuggestions() async {
        guard weekPlan != nil else { return }
        _ = try? await loadWeekPlan()
    }
}
