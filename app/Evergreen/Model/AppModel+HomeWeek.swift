import Foundation
import os

/// The week the rules make, kept up to date like a study plan: worked out
/// again the first time the app opens each day (the calendar, a day out, a
/// missed session), for the week ahead on Sunday evening, and, for the days it
/// changes, whenever the calendar changes or the app refreshes in the background. What each day
/// holds is filled in for the week table and the calendar's notes.
extension AppModel {
    static let checkedDayKey = "home_week_checked_day"
    static let weekAheadKey = "home_week_ahead_day"
    /// Set when the week was due but the phone was locked (a background run): it is worked out at the next chance, the
    /// next run or the phone being unlocked (`deviceDidUnlock`).
    static let rebuildPendingKey = "home_week_rebuild_pending"
    /// Sunday (1 in the Gregorian calendar) at 20:00 the week ahead is ready.
    nonisolated static let weekAheadWeekday = 1
    nonisolated static let weekAheadHour = 20

    /// Monday of this week, YYYY-MM-DD.
    var thisMonday: String {
        dayISO(offset: -UserRules.weekdayIndex(now, calendar: calendar))
    }

    /// The fifth week after four full ones has a set fewer of everything; the four after it count again from there.
    var isLighterWeek: Bool {
        PlannedDays.load(from: settings).isLighterWeek(monday: thisMonday, done: trainedDays, calendar: calendar)
    }

    /// Every day a home session was done: finished on the page, done another way, or a strength workout in Apple Health.
    var trainedDays: Set<String> {
        Set(workoutLog.doneDays + workouts.filter { ActivityKind(healthType: $0.activityType) == .strength }
            .map { LocalTime($0.start, in: calendar.timeZone).day })
    }

    /// Run with the other checks (coming forward, a background refresh) and after a calendar change settles: the whole
    /// week the first time each day and for the week ahead on Sunday evening; in between, the week the calendar makes
    /// now, kept only where a day changed (`updateHomeWeek`).
    /// Locked (a background run), the week can't be worked out with Apple Health: a week that was due is noted, and worked
    /// out at the next chance.
    func checkHomeWeek() async {
        guard onDevice, userRules.isOn else { return }
        guard deviceUnlocked else {
            if homeWeekDue { settings.set(true, forKey: Self.rebuildPendingKey) }
            return
        }
        guard homeWeekDue else { await updateHomeWeek(); return }
        let today = todayISO, sundayEvening = isSundayEvening
        await refreshHomeWeek()
        settings.set(today, forKey: Self.checkedDayKey)
        if sundayEvening { settings.set(today, forKey: Self.weekAheadKey) }
        settings.removeObject(forKey: Self.rebuildPendingKey)
    }

    /// The whole week is due: not worked out yet today, or not yet for the week ahead on Sunday evening.
    var homeWeekDue: Bool {
        let today = todayISO
        let weekAheadDue = isSundayEvening && settings.string(forKey: Self.weekAheadKey) != today
        return settings.string(forKey: Self.checkedDayKey) != today || weekAheadDue
    }

    /// Whether a rebuild was skipped while the phone was locked and still waits.
    var homeWeekRebuildPending: Bool { settings.bool(forKey: Self.rebuildPendingKey) }

    /// From Sunday 20:00 on: the week ahead is due.
    private var isSundayEvening: Bool {
        calendar.component(.weekday, from: now) == Self.weekAheadWeekday && calendar.component(.hour, from: now) >= Self.weekAheadHour
    }

    /// The phone was unlocked: a week skipped while it was locked is worked out now, without waiting for the next run.
    func deviceDidUnlock() async {
        guard homeWeekRebuildPending else { return }
        await checkHomeWeek()
    }

    /// During the day: the calendar is read again and the week worked out from it. When no day changed, nothing is
    /// kept or rescheduled; when some did, the week is kept, only the changed days are asked of the AI again
    /// (`aiPicks`) and the reminders follow.
    func updateHomeWeek() async {
        await refreshBusy()
        guard userRules.isOn, let rules = planRules,
              let week = HomeWeek.from(engine: await rules.planContext(rows: memoryRows, now: now)["homeWeek"], madeOn: todayISO),
              week.days != homeWeek?.days else { return }
        await rememberHomeWeek()
        await scheduleNotifications()
    }

    /// Works the days out again, keeps the week, fills in what each day holds, and puts the reminders and calendar right.
    func refreshHomeWeek() async {
        await refreshDayKinds()
        await rememberHomeWeek()
        await scheduleNotifications()
    }

    /// The week table's own load: the week worked out if it is missing or from another day, then what each day holds.
    /// Ends `.ready`, `.offline` (the week stands on the rules' content because the AI couldn't be reached) or
    /// `.failed` (no week could be worked out).
    func loadHomeWeek() async {
        homeWeekLoad = .loading
        let stale = homeWeek == nil || homeWeek?.madeOn != todayISO
        if stale { await refreshHomeWeek() }
        // Offline last time: asked again, so the AI's choice comes back with the network.
        if !stale, homeWeekContent.isEmpty || homeWeekOffline { await fillHomeWeek() }
        homeWeekLoad = homeWeek == nil ? .failed : homeWeekOffline ? .offline : .ready
    }

    /// What each training day of the kept week holds: the engine's week content, then, with an AI key, the movements the
    /// AI chose for each day where they passed every content check (ContentAgent). Kept until the week, the rules or the
    /// log change, so the AI is asked once for each.
    func fillHomeWeek() async {
        await loadMovements()
        guard let week = homeWeek else { clearHomeWeekContent(); return }
        let days = week.days.filter(\.trains).map { ContentAgent.Day(day: $0.day, id: "home-\($0.day)", focus: $0.focus ?? "full") }
        let minutes = userRules.sessionMax, lighter = isLighterWeek
        guard !days.isEmpty,
              let filled = await contentEngine.week(days.map { (id: $0.id, focus: $0.focus) }, minutes: minutes,
                                                    basis: BundleContent.Basis(rules: userRules, log: workoutLog, lighter: lighter))
        else { clearHomeWeekContent(); return }
        var contents = Dictionary(filled.contents.compactMap { content in
            content.sessionId.map { (String($0.dropFirst("home-".count)), content) }
        }, uniquingKeysWith: { first, _ in first })
        let request = ContentAgent.Request(days: days, minutes: minutes, rules: userRules, log: workoutLog, lighter: lighter,
                                           rulesWeek: filled.contents)
        let picked = await aiPicks(request)
        for (day, pick) in picked { contents[day] = pick.content }
        homeWeekContent = contents
        homeWeekReasons = picked.mapValues(\.reason)
        // The note counts the rules' sets; with days the AI chose it may not fit them, so it is left to the rules' week.
        homeWeekNote = picked.isEmpty ? filled.note : nil
    }

    private func clearHomeWeekContent() {
        homeWeekContent = [:]
        homeWeekNote = nil
        homeWeekReasons = [:]
        homeWeekOffline = false
    }

    nonisolated static let aiPicksKey = "home_week_ai_picks"

    /// The AI's choices for the request's days. What it was asked before stands while the length, the lighter week,
    /// the rules and the log are as they were: only days that are new or work something else are asked again, and the
    /// whole week is checked once more with them in place. No answer (offline, a key problem) is asked again next
    /// time; an answer, even one that didn't pass, is kept.
    private func aiPicks(_ request: ContentAgent.Request) async -> [String: ContentAgent.Picked] {
        homeWeekOffline = false
        guard let model = languageModel else { return [:] }
        let base = aiPicksBaseKey(request)
        let saved = SavedPicks.load(from: settings).flatMap { $0.base == base ? $0 : nil }
        let focus = Dictionary(request.days.map { ($0.day, $0.focus) }, uniquingKeysWith: { first, _ in first })
        let kept = (saved?.picks ?? [:]).filter { focus[$0.key] != nil && saved?.asked[$0.key] == focus[$0.key] }
        let toAsk = request.days.filter { saved?.asked[$0.day] != $0.focus }
        if toAsk.isEmpty { return kept }
        let agent = ContentAgent(model: model, modelId: AIModels.model(), engine: contentEngine)
        guard let picks = await askAgain(agent, AskRound(request: request, days: toAsk, kept: kept)) else {
            return kept.isEmpty ? [:] : await agent.settled(kept, request)
        }
        var asked = (saved?.asked ?? [:]).filter { focus[$0.key] != nil }
        for day in toAsk { asked[day.day] = day.focus }
        SavedPicks(base: base, asked: asked, picks: picks).save(to: settings)
        return picks
    }

    /// One round of asking the AI again: the week's request, the days to ask, and the choices kept for the other days.
    private struct AskRound {
        var request: ContentAgent.Request
        var days: [ContentAgent.Day]
        var kept: [String: ContentAgent.Picked]
    }

    /// Asks the AI for the round's days only, with the kept days' choices in their place in the week, then checks the whole
    /// week once more with every choice in place. Nil when it couldn't be asked; offline is noted for the week table.
    private func askAgain(_ agent: ContentAgent, _ round: AskRound) async -> [String: ContentAgent.Picked]? {
        var asking = round.request
        asking.days = round.days
        asking.rulesWeek = round.request.week(with: round.kept)
        let answer = await agent.pick(asking)
        guard let picks = answer.picks else {
            homeWeekOffline = answer.isOffline
            return nil
        }
        return round.kept.isEmpty ? picks : await agent.settled(round.kept.merging(picks) { _, new in new }, round.request)
    }

    /// The AI's last choices, and what they rest on.
    private struct SavedPicks: Codable {
        /// The length, the lighter week, the rules and the log they were chosen from.
        var base: String
        /// Each day asked, with what it worked then.
        var asked: [String: String]
        var picks: [String: ContentAgent.Picked]

        /// Nil when nothing was kept or it can't be read (a copy from before `asked` was kept is asked again).
        static func load(from defaults: UserDefaults) -> SavedPicks? {
            guard let data = defaults.data(forKey: AppModel.aiPicksKey) else { return nil }
            do { return try JSONDecoder().decode(SavedPicks.self, from: data) } catch {
                Logger.workout.error("The AI's kept choices couldn't be read: \(String(describing: error), privacy: .public)")
                return nil
            }
        }

        func save(to defaults: UserDefaults) {
            do { defaults.set(try JSONEncoder().encode(self), forKey: AppModel.aiPicksKey) } catch {
                Logger.workout.error("The AI's choices couldn't be kept: \(String(describing: error), privacy: .public)")
            }
        }
    }

    /// Everything the AI's choice rests on besides each day: the length, the lighter week, the rules and what was done.
    private func aiPicksBaseKey(_ request: ContentAgent.Request) -> String {
        let log = request.log
        return ["\(request.minutes)", request.lighter ? "lighter" : "",
                request.rules.cacheText, "\(log.entries.count)", log.entries.last?.day ?? "",
                log.loads.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ","),
                log.lastPain.map(String.init) ?? "", log.lastFeeling?.rawValue ?? ""].joined(separator: "#")
    }

    /// A day's movements as one line: "Lower-body: Sit down and stand up, Hip hinge, Bridge."
    func movementLine(_ day: String) -> String? {
        guard let content = homeWeekContent[day], let focus = homeWeek?.day(day)?.focus else { return nil }
        let names = content.items.compactMap { movement($0.movementId)?.name }
        guard !names.isEmpty else { return nil }
        let words = HomeWorkoutRow.words[focus] ?? "full-body"
        return words.prefix(1).uppercased() + words.dropFirst() + ": " + names.joined(separator: ", ") + "."
    }

    /// The calendar events' notes: each training day's movements.
    var calendarNotes: [String: String] {
        Dictionary(uniqueKeysWithValues: homeWeekContent.keys.compactMap { day in movementLine(day).map { (day, $0) } })
    }
}
