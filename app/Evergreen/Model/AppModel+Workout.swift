import Foundation

/// The home workout page wired to the plan: what today's session holds, the
/// movements' words, and what finishing it does (the log, Apple Health, the
/// reminders left today, the rules' "can" and "can't do").
extension AppModel {
    /// The engine's content functions, from the same bundle as the plan rules.
    var contentEngine: BundleContent { BundleContent(bundle: Self.planBundle) }

    /// The person's rules, their log and this week's lightness, as every content call is given them.
    var contentBasis: BundleContent.Basis { BundleContent.Basis(rules: userRules, log: workoutLog, lighter: isLighterWeek) }

    /// Today's home session as the engine knows it: its id, what it works and its length.
    func todaySession(_ focus: String) -> BundleContent.Session {
        BundleContent.Session(id: "home-\(todayISO)", focus: focus, minutes: homeMinutesToday)
    }

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
        await refreshClosedMovements()
        if let saved = WorkoutProgress.load(from: settings, day: todayISO) { return TodayWorkout(progress: saved) }
        guard let focus = homeFocusToday, !homeDoneToday else { return TodayWorkout() }
        guard !movements.isEmpty else { return TodayWorkout(failed: true) }
        let picked = await aiPickedToday(focus: focus)
        var chosen = picked?.content
        if chosen == nil {
            chosen = await contentEngine.session(todaySession(focus), basis: contentBasis, turn: workoutLog.turn)
        }
        guard let content = chosen else { return TodayWorkout(failed: true) }
        let progress = WorkoutProgress(day: todayISO, content: content, results: startingResults(content), startedAt: now, reason: picked?.reason)
        saveProgress(progress)
        return TodayWorkout(progress: progress)
    }

    /// Today's movements as the AI chose them for the week, dosed again from the log as it is now and checked again for
    /// today's length and rules. Nil when the AI didn't choose today's, or its choice no longer passes: then the rules'.
    func aiPickedToday(focus: String) async -> (content: WorkoutContent, reason: String)? {
        if homeWeekContent.isEmpty { await fillHomeWeek() }
        let today = todayISO
        guard let reason = homeWeekReasons[today], let chosen = homeWeekContent[today] else { return nil }
        let proposal = BundleContent.Proposal(proposal: ContentAgent.proposal(of: chosen), session: todaySession(focus))
        guard let checked = await contentEngine.propose(proposal, basis: contentBasis), checked.pass,
              let content = checked.content else { return nil }
        return (content, reason)
    }

    /// Keeps the session as it goes. Opening it on the workout page quiets today's reminders while it runs (`homeReminders`).
    func saveProgress(_ progress: WorkoutProgress) {
        let wasOpen = WorkoutProgress.load(from: settings, day: progress.day) != nil
        progress.save(to: settings)
        if !wasOpen, progress.day == todayISO { Task { await scheduleHomeNotifications() } }
    }

    /// A reminder isn't sent while a session is under way: from opening it to its length and this much more. Left open
    /// with nothing done, the reminders come back after that.
    static let underWayGrace: TimeInterval = 30 * 60

    /// Until when today's session counts as under way; nil when it wasn't opened today.
    var sessionUnderWayUntil: Date? {
        guard let progress = WorkoutProgress.load(from: settings, day: todayISO) else { return nil }
        return progress.startedAt.addingTimeInterval(TimeInterval(progress.content.minutes) * ClockUnits.minute + Self.underWayGrace)
    }

    /// "Can you do one?" answered for a new movement: yes marks it "can"; no marks it "can't do", and the easier one stands in.
    func answerCanDo(_ id: String, can: Bool) async {
        var rules = userRules
        rules.movements[id] = can ? .can : .cannot
        await saveRules(rules, quiet: true)
    }

    /// "Swap": the movements next to this one on its chain, one easier and one harder, that are open to the person. The
    /// harder one only once the engine has said it is earned (`closedMovements`), so a swap never unlocks what the
    /// rules keep for later.
    func swapChoices(for current: Movement) -> [Movement] {
        let easier = current.easier.flatMap { movement($0) }.filter { isOpen($0) }
        let harder = current.harder.flatMap { movement($0) }.filter { isOpen($0) && closedMovements != nil }
        return [easier, harder].compactMap { $0 }
    }

    /// Whether a movement is open: its things are at hand, it isn't left out or marked "can't do", and the engine hasn't
    /// found it closed (not earned yet). Before the engine was asked, the rules alone decide.
    func isOpen(_ move: Movement) -> Bool {
        let owned = Set(userRules.equipment.map(\.rawValue) + Self.alwaysAtHand)
        return move.equipment.allSatisfy(owned.contains) && !userRules.avoid.contains(move.id) && userRules.movements[move.id] != .cannot
            && closedMovements?.contains(move.id) != true
    }

    /// Asks the engine which movements the rules and the log leave closed now. After the rules or the log change.
    func refreshClosedMovements() async {
        await loadMovements()
        guard !movements.isEmpty else { return }
        if let closed = await contentEngine.closed(movements.map(\.id), rules: userRules, log: workoutLog) { closedMovements = closed }
    }

    /// What every home has.
    static let alwaysAtHand = ["floor", "wall"]

    /// On how many days a movement was done, for the short version of its steps from the third time.
    func timesDone(_ id: String) -> Int {
        Set(workoutLog.entries.filter { $0.movementId == id }.map(\.day)).count
    }

    /// Done on this many days before, a movement's steps come as three short lines, with the full steps a tap away.
    static let shortStepsAfter = 2

    /// Whether the workout page gives a movement's steps as three short lines: from the third time it is done.
    func showsShortSteps(_ id: String) -> Bool {
        timesDone(id) >= Self.shortStepsAfter
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
    func finishWorkout(_ finished: WorkoutProgress, pain: Int?, feeling: WorkoutFeeling?) async {
        guard !workoutLog.finishedOnPage(finished.day) else { WorkoutProgress.clear(from: settings); return }
        // Whether each backpack movement was finding its weight is read before this session goes into the log.
        let progress = withCalibration(finished)
        let healthHasOne = trainedStrength(on: progress.day)
        recordFinished(progress, pain: pain, feeling: feeling)
        await markCannotFromSets(progress)
        noteComeback(progress.day)
        let end = now
        let saved = onDevice && !healthHasOne ? await writeStrength(progress.startedAt, end) : false
        log(saved ? "Your home workout is done and saved to Apple Health" : "Your home workout is done")
        celebration += 1
        if onDevice { await notifier.cancelHomeReminders(day: progress.day) }
        showWhenDone(progress.day, start: progress.startedAt, end: end)
        if onDevice, !healthHasOne, !saved { keepWithoutHealth(progress, end: end) }
        await refreshClosedMovements()
        if saved { await refreshHealth() }
    }

    /// A set done below the low end of its range marks the movement "can't do", so the easier one comes next time, as
    /// "Too hard" on the page does. A backpack movement too, unless this session was finding its weight with more than
    /// the least in it: then the weight was too much, not the movement (it drops a kilogram first).
    private func markCannotFromSets(_ progress: WorkoutProgress) async {
        for result in progress.results where isBelowRange(result, in: progress.content) && !wasFindingWeight(result) {
            await markCannot(result.movementId)
        }
    }

    /// A set of `result` under the bottom of its movement's range in the session.
    private func isBelowRange(_ result: WorkoutResult, in content: WorkoutContent) -> Bool {
        guard let item = content.items.first(where: { $0.movementId == result.movementId }) else { return false }
        return result.sets.contains { $0 < item.low }
    }

    /// A backpack movement calibrating with more than the least weight in it.
    private func wasFindingWeight(_ result: WorkoutResult) -> Bool {
        isCalibrating(result) && (result.load ?? BackpackWater.leastKg) > BackpackWater.leastKg
    }

    /// The session with each result's calibrating said, from the log as it stood before the session is recorded.
    private func withCalibration(_ progress: WorkoutProgress) -> WorkoutProgress {
        var stamped = progress
        for index in stamped.results.indices where stamped.results[index].calibrating == nil {
            stamped.results[index].calibrating = calibrationAtStart(stamped.results[index].movementId)
        }
        return stamped
    }

    /// Apple Health couldn't take the session (no permission, or the write failed): it is kept in the app's own store,
    /// so it still counts towards earned screen time and the week, as the page finished it.
    private func keepWithoutHealth(_ progress: WorkoutProgress, end: Date) {
        guard end > progress.startedAt else { return }
        store.logWorkout(Workout(id: "page-\(progress.day)", activityType: ActivityKind.strength.healthType, start: progress.startedAt, end: end,
                                 effort: nil, avgHeartRate: nil, source: .demo))
        save()
        refreshEarnedTime()
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
        // With no time known (another day, nothing in Apple Health), the event stays where it was planned, marked done.
        if let done = doneAt(day), showWhenDone(day, start: done.start, end: done.end) { return }
        save()
    }

    /// Takes back "I did it another way" or "Already done", on any day: the day is to do again, with its reminders, and
    /// the session on the calendar loses its "done" and goes back to the time kept for it (or the next time left that
    /// day); a day whose times have all passed keeps its event where it is.
    func undoDoneAnotherWay(day: String? = nil) async {
        let day = day ?? todayISO
        guard workoutLog.didOtherWay(day) else { return }
        workoutLog.undoOtherWay(day)
        workoutLog.save(to: settings)
        log("Your home workout on \(day) isn’t done yet")
        if let item = homeSessionItem(day), let back = timeToTrain(day), back != item.slot.start { move(item, to: back) } else { save() }
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
        let minutes = homeSessionItem(day).map { $0.slot.end.timeIntervalSince($0.slot.start) } ?? TimeInterval(userRules.sessionMax) * ClockUnits.minute
        return DateInterval(start: now.addingTimeInterval(-minutes), end: now)
    }

    /// The time a day still to train waits for: the one kept for it if it hasn't passed, else the next time left that day.
    func timeToTrain(_ day: String) -> Date? {
        guard let planned = homeWeek?.day(day) else { return nil }
        if let kept = WorkoutReminders.keptTime(planned, choice: reminderChoice(day), calendar: calendar), kept.date > now { return kept.date }
        return WorkoutReminders.times(of: planned).first { $0.date > now }?.date
    }

    /// The session on the calendar moves to the time it was done, so the calendar shows what happened. True when it moved.
    @discardableResult
    private func showWhenDone(_ day: String, start: Date, end: Date) -> Bool {
        guard end > start, let item = homeSessionItem(day), item.slot.start != start || item.slot.end != end else { return false }
        move(item, to: (start, end), reason: "When you trained.")
        return true
    }
}

/// The last question on the workout page.
/// The soreness answers at the end of a workout, on a scale of 0 to 10, each kept as its value: 0–3 is kept as 2,
/// 4 takes a set off next time, 5 or more says to rest.
enum SorenessAnswer: Int, CaseIterable, Sendable {
    case low = 2
    case fewerSets = 4
    case rest = 5

    var title: String {
        switch self {
        case .low: "0–3"
        case .fewerSets: "4"
        case .rest: "5 or more"
        }
    }

    /// What the page says under the answer, and whether it is said as a warning; nothing for a low one.
    var followUp: (words: String, warning: Bool)? {
        switch self {
        case .low: nil
        case .fewerSets: ("Next time has one set fewer.", false)
        // Read straight after a workout: body text, not a footnote.
        case .rest: ("That’s a lot. Rest today. If it’s sharp, or still there in a couple of days, ask a doctor or physio.", true)
        }
    }
}

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
