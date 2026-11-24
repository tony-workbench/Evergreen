import Foundation
import os

/// The person's own rules and the kind of each day, wired to the plan: saving a
/// rule, a day out ("I'm going out today", an event away from home, the phone far
/// from home when the app opens), and a missed session carried to the next day at home.
/// What decides is on the phone; the engine is given only each day's word.
extension AppModel {
    static let goingOutKey = "going_out_days"
    static let stayingHomeKey = "staying_home_days"
    static let farDayKey = "far_from_home_day"
    static let homeFocusKey = "home_week_focus"
    /// Missed days whose focus was already passed on to the week, so working the week out again doesn't pass it on twice.
    static let carriedKey = "home_carried_days"
    /// A missed session older than this isn't carried: the week has moved on.
    static let carryDays = 3
    /// Past days whose planned focus and carry are kept: a week.
    static let keptDays = 7

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
        // A day out loses its reminders now, before anything else: from the lock screen the rest may wait for the phone
        // to be unlocked, and the reminders must not fire meanwhile.
        if out, onDevice { await notifier.cancelHomeReminders(day: day) }
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
        // "I'm home" said today stands: being far again later the same day doesn't make it a day out again.
        guard onDevice, userRules.isOn, let home = userRules.home, settings.string(forKey: Self.farDayKey) != todayISO,
              !stayingHomeDays.contains(todayISO) else { return }
        let location = deviceLocation(Self.farAccuracyMetres)
        guard location.permission == .allowed, let here = await location.current(),
              home.isFar(here, kilometres: userRules.farKilometres) else { return }
        settings.set(todayISO, forKey: Self.farDayKey)
        await replanForRules()
    }

    /// "Far from home" needs a kilometre; home is a 200 m circle, so setting it asks for a hundred metres.
    static let farAccuracyMetres = 1000.0
    static let homeAccuracyMetres = 100.0

    /// Where the phone is now, as home: asks for location if it hasn't been asked. Nil when location is off or there's no fix.
    func locateHome() async -> HomePlace? {
        let location = deviceLocation(Self.homeAccuracyMetres)
        guard await location.request(), let here = await location.current() else { return nil }
        return HomePlace(place: here)
    }

    // MARK: Working the days out

    /// Each of the next seven days as home, out or rest. Nothing without rules.
    func refreshDayKinds() async {
        guard userRules.isOn else { dayKinds = [:]; return }
        dayKinds = await DayKinds.classify(rules: userRules, busy: busyNow + placedCache, goingOut: goingOutDays,
                                           stayingHome: stayingHomeDays, farToday: settings.string(forKey: Self.farDayKey) == todayISO,
                                           from: now, calendar: calendar, geocoder: geocoder, previous: dayKinds)
    }

    private func replanForRules() async {
        await refreshDayKinds()
        await scheduleNotifications()
        do { _ = try await loadWeekPlan(quiet: true) } catch {
            // With no AI key the rules' own week stands, which is the usual case; engines that didn't load are a fault.
            if error == .unavailable { Logger.workout.error("The plan engines didn't load when the rules changed") }
        }
        await rememberHomeWeek()
    }

    /// For the week cache's key: the rules and each day's kind, so a change plans the week again.
    var rulesCacheText: String {
        guard userRules.isOn else { return "" }
        let kinds = dayKinds.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.rawValue)" }.joined(separator: ",")
        let planned = queue.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")
        return userRules.cacheText + "#" + kinds + "#" + carry.joined(separator: ",") + "#" + planned + (homeDoneToday ? "#done" : "")
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
        var kept = homeFocus.filter { $0.key >= dayISO(offset: -Self.keptDays) }
        for day in week.days {
            if let focus = day.focus { kept[day.day] = focus } else { kept.removeValue(forKey: day.day) }
        }
        settings.set(kept, forKey: Self.homeFocusKey)
        markCarried()
        var planned = PlannedDays.load(from: settings)
        planned.update(with: week, today: todayISO)
        planned.save(to: settings)
        await fillHomeWeek()
    }

    /// The focus of each day at home in the last three days that had a session planned and no strength workout done,
    /// oldest first, and not passed on yet. The engine moves it to the next day at home.
    var carry: [String] {
        let focus = homeFocus
        return missedDays.compactMap { focus[$0] }
    }

    /// The days behind `carry`.
    var missedDays: [String] {
        guard userRules.isOn else { return [] }
        let focus = homeFocus, carried = carriedDays
        return (1...Self.carryDays).reversed().map { dayISO(offset: -$0) }.filter { day in
            focus[day] != nil && !carried.contains(day) && !trainedStrength(on: day) && !workoutLog.didHomeSession(on: day)
        }
    }

    /// Missed days already passed on, from the last week.
    var carriedDays: Set<String> {
        Set((settings.stringArray(forKey: Self.carriedKey) ?? []).filter { $0 >= dayISO(offset: -Self.keptDays) })
    }

    /// Once the week is kept with a missed day's focus passed on, that focus is part of what each day was planned to work
    /// (`queue`): it is passed on once, and the rest of the week doesn't shift again each time the week is worked out.
    func markCarried() {
        let missed = missedDays
        guard !missed.isEmpty else { return }
        settings.set(carriedDays.union(missed).sorted(), forKey: Self.carriedKey)
    }

    /// What each day at home from today to Sunday was last planned to work, so the week's split stays as it was planned
    /// and a day that drops out passes its focus on. Today keeps its own once done too, so working the week out again
    /// later that day doesn't give today another focus or move the days after it.
    var queue: [String: String] {
        guard userRules.isOn else { return [:] }
        let today = todayISO
        let sunday = dayISO(offset: Self.daysToSunday(now, calendar: calendar))
        return homeFocus.filter { $0.key >= today && $0.key <= sunday }
    }

    /// A day at home earlier this Monday-to-Sunday week that had a session planned, and how it went, so the week table
    /// keeps the whole week and its count once those days have passed.
    struct EarlierDay: Identifiable, Equatable {
        enum Outcome: Equatable { case done, skipped, missed }
        let day: String
        let focus: String?
        let outcome: Outcome
        var id: String { day }
    }

    var earlierThisWeek: [EarlierDay] {
        guard userRules.isOn else { return [] }
        let today = todayISO
        let monday = dayISO(offset: Self.daysToSunday(now, calendar: calendar) - (Self.daysInWeek - 1))
        let focus = homeFocus
        return PlannedDays.load(from: settings).days.filter { $0 >= monday && $0 < today }.map { day in
            let outcome: EarlierDay.Outcome = workoutLog.didHomeSession(on: day) || trainedStrength(on: day) ? .done
                : workoutLog.didSkip(day) ? .skipped : .missed
            return EarlierDay(day: day, focus: focus[day], outcome: outcome)
        }
    }

    /// Days from `date` to the Sunday that ends its Monday-to-Sunday week: 0 on a Sunday, 6 on a Monday.
    nonisolated static func daysToSunday(_ date: Date, calendar: Calendar) -> Int {
        // Calendar weekdays run 1 (Sunday) to 7 (Saturday): Monday, 2, is six days from Sunday.
        (sunday + daysInWeek - calendar.component(.weekday, from: date)) % daysInWeek
    }

    private nonisolated static let sunday = 1
    private nonisolated static let daysInWeek = 7

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
