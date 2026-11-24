import Foundation

/// The home workout page wired to the plan: what today's session holds, the
/// movements' words, and what finishing it does (the log, Apple Health, the
/// reminders left today, the rules' "can" and "can't do").
extension AppModel {
    /// The engine's content functions, from the same bundle as the plan rules.
    var contentEngine: BundleContent { BundleContent(bundle: Self.planBundle) }

    /// What today's home session works ("lower", "upper", "full"…), when today is a day at home with one.
    var homeFocusToday: String? {
        guard userRules.isOn, dayKinds[todayISO] == .home else { return nil }
        return homeFocus[todayISO]
    }

    /// Minutes of today's home session: the one on the plan, else the longest the rules allow.
    var homeMinutesToday: Int {
        let strength = plan.first { item in
            LocalTime(item.slot.start, in: calendar.timeZone).day == todayISO && ActivityKind(healthType: item.slot.activityType) == .strength
        }
        return strength.map { min($0.slot.minutes, userRules.sessionMax) } ?? userRules.sessionMax
    }

    /// Done today: finished on the page, marked done another way, or a strength workout in Apple Health.
    var homeDoneToday: Bool { workoutLog.didHomeSession(on: todayISO) || trainedStrength(on: todayISO) }

    func movement(_ id: String) -> Movement? { movements.first { $0.id == id } }

    /// Reads every movement's words once.
    func loadMovements() async {
        guard movements.isEmpty else { return }
        movements = await contentEngine.library()
    }

    /// What the workout page opens on: today's session, none (no session today, or it's done), or failed to be worked out.
    struct TodayWorkout {
        var progress: WorkoutProgress?
        var failed = false
    }

    /// Today's session: what was left half done, or a new one built from the rules and the log. Failed when today has a
    /// session but its movements or content couldn't be read.
    func workoutToday() async -> TodayWorkout {
        await loadMovements()
        if let saved = WorkoutProgress.load(from: settings, day: todayISO) { return TodayWorkout(progress: saved) }
        guard let focus = homeFocusToday, !homeDoneToday else { return TodayWorkout() }
        guard !movements.isEmpty,
              let content = await contentEngine.session(id: "home-\(todayISO)", focus: focus, minutes: homeMinutesToday,
                                                        rules: userRules, log: workoutLog, turn: workoutLog.turn, lighter: isLighterWeek)
        else { return TodayWorkout(failed: true) }
        let progress = WorkoutProgress(day: todayISO, content: content,
                                       results: content.items.map { WorkoutResult(movementId: $0.movementId, load: $0.load) },
                                       startedAt: Date())
        progress.save(to: settings)
        return TodayWorkout(progress: progress)
    }

    func saveProgress(_ progress: WorkoutProgress) { progress.save(to: settings) }

    /// "Can you do one?" answered for a new movement: yes marks it "can"; no marks it "can't do", and the easier one stands in.
    func answerCanDo(_ id: String, can: Bool) async {
        var rules = userRules
        rules.movements[id] = can ? .can : .cannot
        await saveRules(rules, quiet: true)
    }

    /// "Swap": the movements next to this one on its chain, one easier and one harder, that the rules leave open.
    func swapChoices(for current: Movement) -> [Movement] {
        [current.easier, current.harder].compactMap { $0 }.compactMap { movement($0) }.filter { isOpen($0) }
    }

    /// Whether the rules leave a movement open: its things are at hand, it isn't left out and it isn't marked "can't do".
    func isOpen(_ move: Movement) -> Bool {
        let owned = Set(userRules.equipment.map(\.rawValue) + Self.alwaysAtHand)
        return move.equipment.allSatisfy(owned.contains) && !userRules.avoid.contains(move.id) && userRules.movements[move.id] != .cannot
    }

    /// What every home has.
    static let alwaysAtHand = ["floor", "wall"]

    /// "Too hard" on a movement with an easier one: it goes on the avoid list, so it isn't given again until the person takes
    /// it off in My rules (Leave out).
    func leaveOut(_ id: String) async {
        guard !userRules.avoid.contains(id) else { return }
        var rules = userRules
        rules.avoid.append(id)
        await saveRules(rules, quiet: true)
    }

    /// On how many days a movement was done, for the short version of its steps from the third time.
    func timesDone(_ id: String) -> Int {
        Set(workoutLog.entries.filter { $0.movementId == id }.map(\.day)).count
    }

    /// A set done below the low end of its range: the movement is marked "can't do" so the easier one comes next time.
    /// It goes on the avoid list only when the person picks that in My rules.
    func markCannot(_ id: String) async {
        guard userRules.movements[id] != .cannot else { return }
        var rules = userRules
        rules.movements[id] = .cannot
        await saveRules(rules, quiet: true)
    }

    /// Finishes the session: the log, the soreness and how hard it was, a strength workout in Apple Health,
    /// no more reminders that day, and the session on the calendar at the time it was done. Finished once only: a second
    /// tap, or the page left open after it was finished, records nothing more, and Apple Health gets no second workout
    /// for a day that already has one. "Already done" pressed while the page was open is replaced by this session.
    func finishWorkout(_ progress: WorkoutProgress, pain: Int?, feeling: WorkoutFeeling?) async {
        guard !workoutLog.finishedOnPage(progress.day) else { WorkoutProgress.clear(from: settings); return }
        let healthHasOne = trainedStrength(on: progress.day)
        recordFinished(progress, pain: pain, feeling: feeling)
        for result in progress.results {
            guard let item = progress.content.items.first(where: { $0.movementId == result.movementId }),
                  result.sets.contains(where: { $0 < item.low }), movement(result.movementId)?.usesBackpack == false else { continue }
            await markCannot(result.movementId)
        }
        noteComeback(progress.day)
        let end = Date()
        let saved = onDevice && !healthHasOne ? await writeStrength(progress.startedAt, end) : false
        log(saved ? "Your home workout is done and saved to Apple Health" : "Your home workout is done")
        celebration += 1
        if onDevice { await notifier.cancelHomeReminders(day: progress.day) }
        showWhenDone(progress.day, start: progress.startedAt, end: end)
        if saved { await refreshHealth() }
    }

    private func recordFinished(_ progress: WorkoutProgress, pain: Int?, feeling: WorkoutFeeling?) {
        var record = workoutLog
        record.record(day: progress.day, results: progress.results, pain: pain)
        record.lastFeeling = feeling
        record.turn += 1
        record.settleLoads(progress.results, feeling: feeling)
        workoutLog = record
        record.save(to: settings)
        WorkoutProgress.clear(from: settings)
    }

    /// "I did it another way" on Today, or "Already done" on a reminder: the day counts as done, so nothing is carried,
    /// the rest of that day's reminders go (other days' stay) and the session on the calendar moves to when it was done.
    /// A session half done on the page is kept, so "Undo" brings it back. Nothing is written to Health.
    func doneAnotherWay(day: String? = nil) async {
        let day = day ?? todayISO
        guard !workoutLog.didHomeSession(on: day) else { return }
        workoutLog.markDoneAnotherWay(day)
        workoutLog.save(to: settings)
        log(day == todayISO ? "You did today’s workout another way" : "You did the workout of \(day) another way")
        if onDevice { await notifier.cancelHomeReminders(day: day) }
        if let done = doneAt(day) { showWhenDone(day, start: done.start, end: done.end) }
    }

    /// Takes back "I did it another way" or "Already done": the day is to do again, with its reminders, and the session
    /// on the calendar goes back to the time kept for it (or the next time left today).
    func undoDoneAnotherWay(day: String? = nil) async {
        let day = day ?? todayISO
        guard workoutLog.didOtherWay(day) else { return }
        workoutLog.undoOtherWay(day)
        workoutLog.save(to: settings)
        log("Your home workout on \(day) isn’t done yet")
        if let item = homeSessionItem(day), let back = timeToTrain(day) { move(item, to: back) }
        await scheduleHomeNotifications()
    }

    /// When a session done another way was done: the strength workout in Apple Health that day, or, today, the session's
    /// length up to now. Nil for another day with nothing in Health.
    func doneAt(_ day: String) -> DateInterval? {
        if let workout = workouts.last(where: { LocalTime($0.start, in: calendar.timeZone).day == day
                                                  && ActivityKind(healthType: $0.activityType) == .strength }), workout.end > workout.start {
            return DateInterval(start: workout.start, end: workout.end)
        }
        guard day == todayISO else { return nil }
        let minutes = homeSessionItem(day).map { $0.slot.end.timeIntervalSince($0.slot.start) } ?? TimeInterval(userRules.sessionMax * 60)
        return DateInterval(start: now.addingTimeInterval(-minutes), end: now)
    }

    /// The time a day still to train waits for: the one kept for it if it hasn't passed, else the next time left that day.
    func timeToTrain(_ day: String) -> Date? {
        guard let planned = homeWeek?.day(day) else { return nil }
        if let kept = WorkoutReminders.keptTime(planned, choice: reminderChoice(day), calendar: calendar), kept.date > now { return kept.date }
        return WorkoutReminders.times(of: planned).first { $0.date > now }?.date
    }

    /// The session on the calendar moves to the time it was done, so the calendar shows what happened.
    private func showWhenDone(_ day: String, start: Date, end: Date) {
        guard end > start, let item = homeSessionItem(day), item.slot.start != start || item.slot.end != end else { return }
        move(item, to: start, end: end, reason: "When you trained.")
    }
}

/// The last question on the workout page.
enum WorkoutFeeling: String, Codable, Sendable, CaseIterable {
    case easy, right, hard

    var title: String {
        switch self {
        case .easy: "Too easy"
        case .right: "About right"
        case .hard: "Too hard"
        }
    }
}
