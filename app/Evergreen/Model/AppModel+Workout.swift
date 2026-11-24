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

    /// Today's session: what was left half done, or a new one built from the rules and the log.
    func workoutToday() async -> WorkoutProgress? {
        await loadMovements()
        if let saved = WorkoutProgress.load(from: settings, day: todayISO) { return saved }
        guard let focus = homeFocusToday,
              let content = await contentEngine.session(id: "home-\(todayISO)", focus: focus, minutes: homeMinutesToday,
                                                        rules: userRules, log: workoutLog, turn: workoutLog.turn, lighter: isLighterWeek)
        else { return nil }
        let progress = WorkoutProgress(day: todayISO, content: content,
                                       results: content.items.map { WorkoutResult(movementId: $0.movementId, load: $0.load) },
                                       startedAt: Date())
        progress.save(to: settings)
        return progress
    }

    func saveProgress(_ progress: WorkoutProgress) { progress.save(to: settings) }

    /// "Can you do one?" answered for a new movement: yes marks it "can"; no marks it "can't do", and the easier one stands in.
    func answerCanDo(_ id: String, can: Bool) async {
        var rules = userRules
        rules.movements[id] = can ? .can : .cannot
        await saveRules(rules, quiet: true)
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
    /// and no more reminders today.
    func finishWorkout(_ progress: WorkoutProgress, pain: Int?, feeling: WorkoutFeeling?) async {
        var record = workoutLog
        record.record(day: progress.day, results: progress.results, pain: pain)
        record.lastFeeling = feeling
        record.turn += 1
        record.settleLoads(progress.results, feeling: feeling)
        workoutLog = record
        record.save(to: settings)
        WorkoutProgress.clear(from: settings)
        for result in progress.results {
            guard let item = progress.content.items.first(where: { $0.movementId == result.movementId }),
                  result.sets.contains(where: { $0 < item.low }), movement(result.movementId)?.usesBackpack == false else { continue }
            await markCannot(result.movementId)
        }
        noteComeback(progress.day)
        let saved = onDevice ? await WorkoutWriter.saveStrength(start: progress.startedAt, end: Date()) : false
        log(saved ? "Your home workout is done and saved to Apple Health" : "Your home workout is done")
        celebration += 1
        if onDevice { await notifier.cancelHomeReminders(day: progress.day) }
        if saved { await refreshHealth() }
    }

    /// "I did it another way": today counts as done, so nothing is carried and today's reminders go. Nothing is written to Health.
    func doneAnotherWay() async {
        workoutLog.markDone(todayISO)
        workoutLog.save(to: settings)
        WorkoutProgress.clear(from: settings)
        log("You did today’s workout another way")
        if onDevice { await notifier.cancelHomeReminders(day: todayISO) }
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
