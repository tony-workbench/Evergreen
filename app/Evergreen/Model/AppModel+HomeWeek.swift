import Foundation

/// The week the rules make, kept up to date like a study plan: worked out
/// again the first time the app opens each day (the calendar, a day out, a
/// missed session), and for the week ahead on Sunday evening. What each day
/// holds is filled in for the week table and the calendar's notes.
extension AppModel {
    static let checkedDayKey = "home_week_checked_day"
    static let weekAheadKey = "home_week_ahead_day"
    /// Sunday (1 in the Gregorian calendar) at 20:00 the week ahead is ready.
    static let weekAheadWeekday = 1
    static let weekAheadHour = 20

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

    /// What each training day of the kept week holds, from the engine's week content.
    func fillHomeWeek() async {
        await loadMovements()
        guard let week = homeWeek else { homeWeekContent = [:]; homeWeekNote = nil; return }
        let sessions = week.days.filter(\.trains).map { (id: "home-\($0.day)", focus: $0.focus ?? "full") }
        guard !sessions.isEmpty,
              let filled = await contentEngine.week(sessions, minutes: userRules.sessionMax, rules: userRules, log: workoutLog, lighter: isLighterWeek)
        else { homeWeekContent = [:]; homeWeekNote = nil; return }
        homeWeekContent = Dictionary(filled.contents.compactMap { content in
            content.sessionId.map { (String($0.dropFirst("home-".count)), content) }
        }, uniquingKeysWith: { first, _ in first })
        homeWeekNote = filled.note
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
