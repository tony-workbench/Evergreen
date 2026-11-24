import Foundation

/// The reminders of a day at home and their buttons: Start, Later today, Already done, Skip today with a reason,
/// and on the evening before "Only at …" (one time picked) and "I'm going out tomorrow". A time can also be picked in the
/// week table; once picked, only that time reminds. What they say is in WorkoutReminders and NotificationCopy.
extension AppModel {
    /// Whether a plan item is the session of a day at home, which has the reminders here.
    func isHomeSession(_ item: PlanItem) -> Bool {
        guard userRules.isOn, ActivityKind(healthType: item.slot.activityType) == .strength else { return false }
        return homeWeek?.day(LocalTime(item.slot.start, in: calendar.timeZone).day)?.trains == true
    }

    /// The session of a day at home on the plan, not yet done there.
    func homeSessionItem(_ day: String) -> PlanItem? {
        plan.first { isHomeSession($0) && LocalTime($0.slot.start, in: calendar.timeZone).day == day && completion(for: $0) == nil }
    }

    /// What a day's reminders say about its session: the words for its focus, its minutes and how many movements.
    func reminderSession(_ day: HomeWeek.Day) -> WorkoutReminders.Session {
        let content = homeWeekContent[day.day]
        let focus = day.focus ?? Self.wholeBody
        return WorkoutReminders.Session(focusWords: HomeWorkoutRow.words[focus] ?? HomeWorkoutRow.words[Self.wholeBody] ?? focus,
                                        minutes: content?.minutes ?? userRules.sessionMax,
                                        movements: content?.items.count ?? Self.usualMovements)
    }

    /// The focus a day takes when the week gives none.
    static let wholeBody = "full"
    /// How many movements a session has before its content is worked out (four or five).
    static let usualMovements = 4

    /// How a day's reminders go: the two switches in Settings and the time picked for it.
    func reminderChoice(_ day: String) -> WorkoutReminders.Choice {
        WorkoutReminders.Choice(keepReminding: Automatic.keepReminding.isOn(settings), pickEachDay: Automatic.pickEachDay.isOn(settings),
                                picked: pickedTimes[day])
    }

    /// Every reminder of the coming days at home that is still to do: not done any way, not skipped, not a day out.
    func homeReminders() -> [WorkoutReminder] {
        guard userRules.isOn, let week = homeWeek else { return [] }
        let out = goingOutDays
        return week.days.filter { $0.day >= todayISO && $0.kind == .home && $0.trains && !out.contains($0.day) }
            .filter { !workoutLog.didHomeSession(on: $0.day) && !trainedStrength(on: $0.day) && !workoutLog.didSkip($0.day) }
            .flatMap { day in
                WorkoutReminders.plan(day: day, session: reminderSession(day), choice: reminderChoice(day.day), now: now, calendar: calendar)
            }
    }

    /// Plans the days-at-home reminders again. Needs nothing the locked phone keeps from the app, so a button on a reminder
    /// pressed on the lock screen takes effect at once.
    func scheduleHomeNotifications() async {
        guard onDevice else { return }
        await notifier.scheduleHomeReminders(calendar: calendar) { [weak self] in self?.homeReminders() ?? [] }
    }

    /// The time picked for each day from today on.
    var pickedTimes: [String: String] { ChosenSlot.all(in: settings, from: todayISO) }

    /// Keeps one time for a day (any of its times, the first included), or with nil every time again. The session on the
    /// plan moves to it, and the reminders are planned again.
    func pickTime(_ clock: String?, day: String) async {
        ChosenSlot.set(clock, day: day, from: todayISO, in: settings)
        let target = (clock ?? homeWeek?.day(day)?.first?.clock).flatMap { WorkoutReminders.date(day, clock: $0, calendar: calendar) }
        if let target, let item = homeSessionItem(day), item.slot.start != target, target > now { move(item, to: target) }
        log(clock.map { "On \(day) only \($0) reminds you" } ?? "On \(day) every time reminds you again")
        await scheduleHomeNotifications()
    }

    /// A button on a reminder, or the same choice on Today.
    func handleWorkoutAction(_ action: Notifier.WorkoutAction, day: String) async {
        switch action {
        case .start:
            if day == todayISO { workoutRequested = true }
        case .later:
            await laterToday(day)
        case .alreadyDone:
            await doneAnotherWay(day: day)
        case .goingOut:
            log("You’re out on \(day); no workout that day")
            await setGoingOut(true, day: day)
        case .skipOut, .skipUnwell, .skipNotToday:
            await skipDay(day, reason: action.skipReason ?? "not_today")
        }
    }

    /// "Later today": the next time after the one kept (or after now) is picked, so only it reminds and the session moves
    /// to it. Nothing moves when none is left.
    func laterToday(_ day: String? = nil) async {
        let day = day ?? todayISO
        guard let planned = homeWeek?.day(day) else { return }
        let kept = WorkoutReminders.keptTime(planned, choice: reminderChoice(day), calendar: calendar)
        guard let next = WorkoutReminders.nextLater(planned, after: max(now, kept?.date ?? now)) else { return }
        await pickTime(next.clock, day: day)
    }

    /// "Skip today" with a reason. "I'm out" also makes the day a day out, so the week is worked out again without it.
    func skipDay(_ day: String, reason: String) async {
        workoutLog.skip(day, reason: reason)
        workoutLog.save(to: settings)
        if onDevice { await notifier.cancelHomeReminders(day: day) }
        log("You skipped the home workout on \(day)")
        if reason == "out" { await setGoingOut(true, day: day) } else { await scheduleNotifications() }
    }

    /// Takes a skip back ("Train today after all" on Today): the day trains again, with its reminders.
    func unskipDay(_ day: String) async {
        let reason = workoutLog.skipped?[day]
        workoutLog.skipped?.removeValue(forKey: day)
        workoutLog.save(to: settings)
        log("You’re training on \(day) after all")
        if reason == "out" { await setGoingOut(false, day: day) } else { await scheduleHomeNotifications() }
    }
}
