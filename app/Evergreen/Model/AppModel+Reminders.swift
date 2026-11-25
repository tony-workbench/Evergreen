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
                                picked: pickedTimes[day], quietUntil: userRules.notificationsFrom)
    }

    /// Every reminder of the coming days at home that is still to do: not done any way, not skipped, not a day out, and
    /// none of today's while a session is under way; and the evening before each day out, its own.
    func homeReminders() -> [WorkoutReminder] {
        guard userRules.isOn, let week = homeWeek else { return [] }
        // The whole of today is planned, the part already sent included, so it counts against today's six.
        let from = calendar.startOfDay(for: now)
        let home = week.days.filter { isStillToTrain($0) }.flatMap { day in
            WorkoutReminders.plan(.init(day: day, session: reminderSession(day), choice: reminderChoice(day.day)), now: from, calendar: calendar)
        }
        let underWay = sessionUnderWayUntil
        let quiet = home.filter { reminder in underWay.map { reminder.day != todayISO || reminder.fires >= $0 } ?? true }
        let out = goingOutDays
        let outDays = week.days.filter { $0.day > todayISO && ($0.kind == .out || out.contains($0.day) || dayKinds[$0.day] == .out) }
        let all = quiet + outDays.compactMap { WorkoutReminders.outEvening(day: $0.day, now: from, calendar: calendar) }
        let others = keptOtherReminders
        return NotificationBudget.fit(all, room: { self.roomForHomeReminders(on: $0, others: others) }, calendar: calendar)
            .filter { $0.fires > now }
    }

    /// A day of the week at home, from today on, that still trains: not a day out by any word, not done any way, not skipped.
    private func isStillToTrain(_ day: HomeWeek.Day) -> Bool {
        day.day >= todayISO && day.kind == .home && day.trains && !goingOutDays.contains(day.day) && dayKinds[day.day] != .out
            && !workoutLog.didHomeSession(on: day.day) && !trainedStrength(on: day.day) && !workoutLog.didSkip(day.day)
    }

    /// What is left of a day's six for the day-at-home reminders once the other notifications are counted: sent at once
    /// that day, "Your week ahead" on a Sunday, and the 30-minute reminders of other workouts that go (`keptOtherReminders`).
    func roomForHomeReminders(on day: String, others: [PlanItem]? = nil) -> Int {
        let kept = (others ?? keptOtherReminders).filter { reminderDay($0) == day }
        return roomForAnyReminder(on: day) - kept.count
    }

    /// A day's six less what was sent at once that day and "Your week ahead" on a Sunday.
    private func roomForAnyReminder(on day: String) -> Int {
        let weekAhead = userRules.isOn && WorkoutReminders.date(day, clock: "12:00", calendar: calendar)
            .map { calendar.component(.weekday, from: $0) == Self.weekAheadWeekday } == true
        return NotificationBudget.maxPerDay - NotificationBudget.sent(on: day, in: settings) - (weekAhead ? 1 : 0)
    }

    /// The day a workout's 30-minute reminder fires on.
    private func reminderDay(_ item: PlanItem) -> String {
        LocalTime(item.slot.start.addingTimeInterval(-Notifier.reminderLead), in: calendar.timeZone).day
    }

    /// The workouts on the plan that could get the 30-minute reminder: not done, not on a day out, not a day-at-home session.
    var otherReminderItems: [PlanItem] {
        plan.filter { completion(for: $0) == nil && !isDayOut($0.slot.start) && !isHomeSession($0) }
    }

    /// Those whose 30-minute reminder goes: in the week ahead, not at night (before 09:00, or the person's own earlier
    /// hours, nor from 22:00), and within what is left of each day's six, the earliest first. They share the six with
    /// everything else (`NotificationBudget`), and the day-at-home reminders make room for them.
    var keptOtherReminders: [PlanItem] {
        let horizon = now.addingTimeInterval(Notifier.reminderHorizon)
        let quietUntil = userRules.isOn ? userRules.notificationsFrom : NotificationBudget.quietUntilHour
        let due = otherReminderItems.filter { item in
            let fires = item.slot.start.addingTimeInterval(-Notifier.reminderLead)
            return fires > now && fires < horizon && !NotificationBudget.isQuiet(fires, calendar: calendar, from: quietUntil)
        }.sorted { $0.slot.start < $1.slot.start }
        var used: [String: Int] = [:]
        return due.filter { item in
            let day = reminderDay(item)
            guard used[day, default: 0] < roomForAnyReminder(on: day) else { return false }
            used[day, default: 0] += 1
            return true
        }
    }

    /// A notification sent at once (rain, a move off a meeting, shoes): not at night, and not past today's six. It goes
    /// before the day-at-home reminders, which are planned again to make room for it. Its place in the six is taken before
    /// anything waits, so two sent together can't both take the sixth.
    func notifyNow(_ copy: (title: String, body: String), id: String) async {
        let from = userRules.isOn ? userRules.notificationsFrom : NotificationBudget.quietUntilHour
        guard !NotificationBudget.isQuiet(now, calendar: calendar, from: from), NotificationBudget.claim(on: todayISO, in: settings) else {
            log("A notification was held back: night, or six already today")
            return
        }
        await notifier.send(copy, id: id)
        await scheduleHomeNotifications()
    }

    /// Plans the days-at-home reminders again, or only `day`'s. Needs nothing the locked phone keeps from the app, so a
    /// button on a reminder pressed on the lock screen takes effect at once.
    func scheduleHomeNotifications(day: String? = nil) async {
        guard onDevice else { return }
        await notifier.scheduleHomeReminders(calendar: calendar, day: day) { [weak self] in self?.homeReminders() ?? [] }
    }

    /// The time picked for each day from today on.
    var pickedTimes: [String: String] { ChosenSlot.all(in: settings, from: todayISO) }

    /// Keeps one time for a day (any of its times, the first included), or with nil every time again. The session on the
    /// plan moves to it, and the reminders are planned again.
    func pickTime(_ clock: String?, day: String) async {
        ChosenSlot.set(.init(clock: clock, day: day, today: todayISO), in: settings)
        let target = (clock ?? homeWeek?.day(day)?.first?.clock).flatMap { WorkoutReminders.date(day, clock: $0, calendar: calendar) }
        if let target, let item = homeSessionItem(day), item.slot.start != target, target > now { move(item, to: target) }
        log(clock.map { "On \(day) only \($0) reminds you" } ?? "On \(day) every time reminds you again")
        await scheduleHomeNotifications()
    }

    /// A button on a reminder, or the same choice on Today.
    func handleWorkoutAction(_ action: Notifier.WorkoutAction, day: String) async {
        switch action {
        case .start:
            // Today's opens the workout page; another day's (a reminder tapped after midnight, the evening before) opens
            // the week table on that day, where it can be looked at and its time picked.
            workoutRoute = day == todayISO ? .session : .week(day: day)
        case .later:
            await laterToday(day)
        case .alreadyDone:
            await doneAnotherWay(day: day)
        case .goingOut:
            log("You’re out on \(day); no workout that day")
            await setGoingOut(true, day: day)
        case .homeTomorrow:
            log("You’re home on \(day) after all")
            await setGoingOut(false, day: day)
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

    // MARK: A time passed without a start

    /// With no time picked, a time of today's session that passed twenty minutes ago without a start hands the session on
    /// to the next time, as its "Moved to …" reminder says: the plan and the calendar move with it. Run when the app comes
    /// forward, in the background, each minute while it is open, and when a notification is shown or tapped. Nothing
    /// moves with a time picked (only "Move to …" moves it then), with "Keep reminding me" off, once the session is
    /// opened, done or skipped, on a day out, or after the last time.
    func moveMissedHomeTimes() {
        guard onDevice, deviceUnlocked, userRules.isOn, let day = homeWeek?.day(todayISO), isStillToTrain(day),
              WorkoutProgress.load(from: settings, day: todayISO) == nil,
              Automatic.keepReminding.isOn(settings), !Automatic.pickEachDay.isOn(settings), pickedTimes[todayISO] == nil,
              let item = homeSessionItem(todayISO), item.slot.start.addingTimeInterval(WorkoutReminders.movedAfter) <= now,
              let due = WorkoutReminders.dueTime(day, now: now), due.date > item.slot.start else { return }
        move(item, to: due.date, reason: "Moved to \(due.date.clock): the earlier time passed without a start.")
        log("Today’s workout moved to \(due.clock)")
    }
}

/// Where a tap on a reminder asks the screens to go. The root view watches `AppModel.workoutRoute`, goes there and sets
/// it back to nil.
enum WorkoutRoute: Equatable, Sendable {
    /// Today's session: the workout page.
    case session
    /// Another day's session: the week table, on that day (YYYY-MM-DD).
    case week(day: String)
}
