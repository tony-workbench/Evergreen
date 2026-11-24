import Foundation

/// The reminders of a day at home and their buttons: Start, Later today, Skip today with a reason,
/// and "I'm going out tomorrow" the evening before. What they say is in WorkoutReminders and NotificationCopy.
extension AppModel {
    /// Days whose reminders wait until a later time: "Later today" on a reminder or on Today. By day, the time it waits for.
    static let remindAfterKey = "home_remind_after"

    /// Whether a plan item is the session of a day at home, which has the reminders here.
    func isHomeSession(_ item: PlanItem) -> Bool {
        guard userRules.isOn, ActivityKind(healthType: item.slot.activityType) == .strength else { return false }
        return homeWeek?.day(LocalTime(item.slot.start, in: calendar.timeZone).day)?.trains == true
    }

    /// What a day's reminders say about its session: the words for its focus, its minutes and how many movements.
    func reminderSession(_ day: HomeWeek.Day) -> WorkoutReminders.Session {
        let content = homeWeekContent[day.day]
        return WorkoutReminders.Session(focusWords: HomeWorkoutRow.words[day.focus ?? "full"] ?? "full-body",
                                        minutes: content?.minutes ?? userRules.sessionMax, movements: content?.items.count ?? 4)
    }

    /// Every reminder of the coming days at home that is still to do: not done, not skipped, not a day out.
    func homeReminders() -> [WorkoutReminder] {
        guard userRules.isOn, let week = homeWeek else { return [] }
        let keep = Automatic.keepReminding.isOn(settings)
        let after = remindAfter
        return week.days.filter { $0.day >= todayISO && $0.kind == .home && $0.trains }
            .filter { !workoutLog.didHomeSession(on: $0.day) && !trainedStrength(on: $0.day) && !workoutLog.didSkip($0.day) }
            .flatMap { day in
                WorkoutReminders.plan(day: day, session: reminderSession(day), keepReminding: keep, now: now, calendar: calendar)
                    .filter { reminder in after[day.day].map { reminder.kind == .evening || reminder.fires >= $0 } ?? true }
            }
    }

    private var remindAfter: [String: Date] {
        let raw = settings.dictionary(forKey: Self.remindAfterKey) as? [String: Double] ?? [:]
        return raw.filter { $0.key >= todayISO }.mapValues { Date(timeIntervalSince1970: $0) }
    }

    /// A button on a reminder, or the same choice on Today.
    func handleWorkoutAction(_ action: Notifier.WorkoutAction, day: String) async {
        switch action {
        case .start:
            if day == todayISO { workoutRequested = true }
        case .later:
            await laterToday(day)
        case .goingOut:
            log("You’re out on \(day); no workout that day")
            await setGoingOut(true, day: day)
        case .skipOut, .skipUnwell, .skipNotToday:
            await skipDay(day, reason: action.skipReason ?? "not_today")
        }
    }

    /// "Later today": the session waits for the next later time that day, and so do its reminders. Nothing moves when none is left.
    func laterToday(_ day: String? = nil) async {
        let day = day ?? todayISO
        guard let planned = homeWeek?.day(day), let next = WorkoutReminders.nextLater(planned, after: now) else { return }
        var raw = settings.dictionary(forKey: Self.remindAfterKey) as? [String: Double] ?? [:]
        raw = raw.filter { $0.key >= todayISO }
        raw[day] = next.timeIntervalSince1970
        settings.set(raw, forKey: Self.remindAfterKey)
        if let item = plan.first(where: { isHomeSession($0) && LocalTime($0.slot.start, in: calendar.timeZone).day == day && completion(for: $0) == nil }),
           item.slot.start < next {
            move(item, to: next)
        }
        if onDevice { await notifier.dropHomeReminders(day: day, before: next) }
        log("Your home workout waits until \(next.clock)")
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
        if reason == "out" { await setGoingOut(false, day: day) } else { await scheduleNotifications() }
    }
}
