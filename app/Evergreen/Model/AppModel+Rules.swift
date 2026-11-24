import Foundation

/// The person's own rules and the kind of each day, wired to the plan: saving a
/// rule, a day out ("I'm going out today", an event away from home, the phone far
/// from home when the app opens), and a missed session carried to the next day at home.
/// What decides is on the phone; the engine is given only each day's word.
extension AppModel {
    static let goingOutKey = "going_out_days"
    static let stayingHomeKey = "staying_home_days"
    static let farDayKey = "far_from_home_day"
    static let homeFocusKey = "home_week_focus"
    /// A missed session older than this isn't carried: the week has moved on.
    static let carryDays = 3

    var todayISO: String { LocalTime(now, in: calendar.timeZone).day }

    /// Days the person said they go out, from today on.
    var goingOutDays: Set<String> {
        Set((settings.stringArray(forKey: Self.goingOutKey) ?? []).filter { $0 >= todayISO })
    }

    /// Days the person said they are home, overriding an event the phone took for a day out.
    var stayingHomeDays: Set<String> {
        Set((settings.stringArray(forKey: Self.stayingHomeKey) ?? []).filter { $0 >= todayISO })
    }

    var isGoingOutToday: Bool { dayKinds[todayISO] == .out }

    /// Whether the day of `date` is a day out, so it gets no reminders and no workout.
    func isDayOut(_ date: Date) -> Bool {
        userRules.isOn && dayKinds[LocalTime(date, in: calendar.timeZone).day] == .out
    }

    // MARK: Changing the rules

    /// Saves the rules, works the days out again and plans the week again.
    func saveRules(_ rules: UserRules, quiet: Bool = false) async {
        guard rules.isValid else { return }
        userRules = rules
        rules.save(to: settings)
        if !quiet { log("Your rules changed; the week was planned again") }
        await replanForRules()
    }

    /// "I'm going out today", and "I'm home" to correct a day taken for a day out.
    func setGoingOut(_ out: Bool, day: String? = nil) async {
        let day = day ?? todayISO
        var going = goingOutDays, staying = stayingHomeDays
        if out { going.insert(day); staying.remove(day) } else { going.remove(day); staying.insert(day) }
        settings.set(going.sorted(), forKey: Self.goingOutKey)
        settings.set(staying.sorted(), forKey: Self.stayingHomeKey)
        if !out, day == todayISO, settings.string(forKey: Self.farDayKey) == day { settings.removeObject(forKey: Self.farDayKey) }
        // "I'm home" takes back a "Skip today: I'm out" too, so the day trains with its reminders again.
        if !out, workoutLog.skipped?[day] == "out" {
            workoutLog.skipped?.removeValue(forKey: day)
            workoutLog.save(to: settings)
        }
        await replanForRules()
    }

    /// When the app comes forward: a phone far from home makes today a day out, and what is left of today's reminders goes.
    /// Needs a home and When In Use location, so it only works with the app open.
    func checkFarFromHome() async {
        guard onDevice, userRules.isOn, let home = userRules.home, settings.string(forKey: Self.farDayKey) != todayISO else { return }
        let location = DeviceLocation()
        guard location.permission == .allowed, let here = await location.current(),
              home.isFar(here, kilometres: userRules.farKilometres) else { return }
        settings.set(todayISO, forKey: Self.farDayKey)
        await replanForRules()
    }

    // MARK: Working the days out

    /// Each of the next seven days as home, out or rest. Nothing without rules.
    func refreshDayKinds() async {
        guard userRules.isOn else { dayKinds = [:]; return }
        dayKinds = await DayKinds.classify(rules: userRules, busy: busyNow, goingOut: goingOutDays, stayingHome: stayingHomeDays,
                                           farToday: settings.string(forKey: Self.farDayKey) == todayISO,
                                           from: now, calendar: calendar, geocoder: SystemGeocoder())
    }

    private func replanForRules() async {
        await refreshDayKinds()
        await scheduleNotifications()
        _ = try? await loadWeekPlan(quiet: true)
        await rememberHomeWeek()
    }

    /// For the week cache's key: the rules and each day's kind, so a change plans the week again.
    var rulesCacheText: String {
        guard userRules.isOn else { return "" }
        let kinds = dayKinds.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.rawValue)" }.joined(separator: ",")
        let planned = queue.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
        return userRules.cacheText + "#" + kinds + "#" + carry.joined(separator: ",") + "#" + planned
    }

    // MARK: Carrying a missed session

    /// What the engine planned each day at home to work, kept so a missed day can be carried.
    var homeFocus: [String: String] {
        (settings.dictionary(forKey: Self.homeFocusKey) as? [String: String]) ?? [:]
    }

    /// Reads the week the rules make and keeps it: each day's focus (for a missed day), its times and fallbacks
    /// (for the week table and the reminders), and which days were planned (for the lighter fifth week).
    /// Called after the week is planned, and by the week's own checks (AppModel+HomeWeek.swift).
    func rememberHomeWeek() async {
        guard userRules.isOn, let rules = planRules,
              let week = HomeWeek.from(engine: await rules.planContext(rows: memoryRows, now: now)["homeWeek"], madeOn: todayISO)
        else { return }
        homeWeek = week
        week.save(to: settings)
        var kept = homeFocus.filter { $0.key >= dayISO(offset: -7) }
        for day in week.days {
            if let focus = day.focus { kept[day.day] = focus } else { kept.removeValue(forKey: day.day) }
        }
        settings.set(kept, forKey: Self.homeFocusKey)
        var planned = PlannedDays.load(from: settings)
        planned.update(with: week, today: todayISO)
        planned.save(to: settings)
        await fillHomeWeek()
    }

    /// The focus of each day at home in the last three days that had a session planned and no strength workout done,
    /// oldest first. The engine moves it to the next day at home.
    var carry: [String] {
        guard userRules.isOn else { return [] }
        let focus = homeFocus
        return (1...Self.carryDays).reversed().compactMap { back -> String? in
            let day = dayISO(offset: -back)
            guard let wanted = focus[day], !trainedStrength(on: day), !workoutLog.didHomeSession(on: day) else { return nil }
            return wanted
        }
    }

    /// What each day at home from today to Sunday was last planned to work, so the week's split stays as it was planned
    /// and a day that drops out passes its focus on. Today is left out once it's done.
    var queue: [String: String] {
        guard userRules.isOn else { return [:] }
        let today = todayISO
        let sunday = dayISO(offset: Self.daysToSunday(now, calendar: calendar))
        let doneToday = trainedStrength(on: today) || workoutLog.didHomeSession(on: today)
        return homeFocus.filter { $0.key >= today && $0.key <= sunday && !($0.key == today && doneToday) }
    }

    /// Days from `date` to the Sunday that ends its Monday-to-Sunday week: 0 on a Sunday, 6 on a Monday.
    nonisolated static func daysToSunday(_ date: Date, calendar: Calendar) -> Int {
        (8 - calendar.component(.weekday, from: date)) % 7
    }

    /// A strength workout in Apple Health (or logged here) on that day.
    func trainedStrength(on day: String) -> Bool {
        workouts.contains { workout in
            LocalTime(workout.start, in: calendar.timeZone).day == day && ActivityKind(healthType: workout.activityType) == .strength
        }
    }

    func dayISO(offset: Int) -> String {
        LocalTime(calendar.date(byAdding: .day, value: offset, to: now) ?? now, in: calendar.timeZone).day
    }
}
