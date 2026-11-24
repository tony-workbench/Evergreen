import Foundation

/// The week the rules make, kept up to date like a study plan: worked out
/// again the first time the app opens each day (the calendar, a day out, a
/// missed session), and for the week ahead on Sunday evening. What each day
/// holds is filled in for the week table and the calendar's notes.
extension AppModel {
    static let checkedDayKey = "home_week_checked_day"
    static let weekAheadKey = "home_week_ahead_day"
    /// Sunday (1 in the Gregorian calendar) at 20:00 the week ahead is ready.
    nonisolated static let weekAheadWeekday = 1
    nonisolated static let weekAheadHour = 20

    /// Monday of this week, YYYY-MM-DD.
    var thisMonday: String {
        let weekday = (calendar.component(.weekday, from: now) + 5) % 7   // Monday 0
        return dayISO(offset: -weekday)
    }

    /// The fifth week after four full ones has a set fewer of everything.
    var isLighterWeek: Bool {
        let done = Set(workoutLog.doneDays + workouts.filter { ActivityKind(healthType: $0.activityType) == .strength }
            .map { LocalTime($0.start, in: calendar.timeZone).day })
        return PlannedDays.load(from: settings).isLighterWeek(monday: thisMonday, done: done, calendar: calendar)
    }

    /// Run with the other checks: the first time each day, and on Sunday evening for the week ahead.
    func checkHomeWeek() async {
        guard onDevice, userRules.isOn else { return }
        let today = todayISO
        let sundayEvening = calendar.component(.weekday, from: now) == Self.weekAheadWeekday
            && calendar.component(.hour, from: now) >= Self.weekAheadHour
        let due = settings.string(forKey: Self.checkedDayKey) != today || (sundayEvening && settings.string(forKey: Self.weekAheadKey) != today)
        guard due else { return }
        await refreshHomeWeek()
        settings.set(today, forKey: Self.checkedDayKey)
        if sundayEvening { settings.set(today, forKey: Self.weekAheadKey) }
    }

    /// Works the days out again, keeps the week, fills in what each day holds, and puts the reminders and calendar right.
    func refreshHomeWeek() async {
        await refreshDayKinds()
        await rememberHomeWeek()
        await scheduleNotifications()
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
              let filled = await contentEngine.week(days.map { (id: $0.id, focus: $0.focus) }, minutes: minutes, rules: userRules, log: workoutLog, lighter: lighter)
        else { clearHomeWeekContent(); return }
        var contents = Dictionary(filled.contents.compactMap { content in
            content.sessionId.map { (String($0.dropFirst("home-".count)), content) }
        }, uniquingKeysWith: { first, _ in first })
        let picked = await aiPicks(days, minutes: minutes, lighter: lighter, rulesWeek: filled.contents)
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
    }

    static let aiPicksKey = "home_week_ai_picks"

    /// The AI's choices for these days, from the last time it was asked when nothing it was asked from has changed since.
    private func aiPicks(_ days: [ContentAgent.Day], minutes: Int, lighter: Bool, rulesWeek: [WorkoutContent]) async -> [String: ContentAgent.Picked] {
        guard let model = languageModel else { return [:] }
        let key = aiPicksCacheKey(days, minutes: minutes, lighter: lighter)
        if let data = settings.data(forKey: Self.aiPicksKey),
           let saved = try? JSONDecoder().decode(SavedPicks.self, from: data), saved.key == key { return saved.picks }
        let agent = ContentAgent(model: model, modelId: AIModels.model(), engine: contentEngine)
        // No answer (offline, a key problem) is asked again next time; an answer, even one that didn't pass, is kept.
        guard let picks = await agent.pick(days, minutes: minutes, rules: userRules, log: workoutLog, lighter: lighter, rulesWeek: rulesWeek)
        else { return [:] }
        if let data = try? JSONEncoder().encode(SavedPicks(key: key, picks: picks)) { settings.set(data, forKey: Self.aiPicksKey) }
        return picks
    }

    private struct SavedPicks: Codable {
        var key: String
        var picks: [String: ContentAgent.Picked]
    }

    /// Everything the AI's choice rests on: the days and what each works, the length, the rules and what was done.
    private func aiPicksCacheKey(_ days: [ContentAgent.Day], minutes: Int, lighter: Bool) -> String {
        let log = workoutLog
        return [days.map { "\($0.day)=\($0.focus)" }.joined(separator: ","), "\(minutes)", lighter ? "lighter" : "",
                userRules.cacheText, "\(log.entries.count)", log.entries.last?.day ?? "",
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
