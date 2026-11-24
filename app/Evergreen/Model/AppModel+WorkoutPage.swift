import Foundation

/// What the workout page's buttons do to the session on screen, kept out of the view: a set done, moving on, "Too hard",
/// "Too easy", "Swap", "Not yet" to a new movement, and "Train anyway" on a day without a session; and what the page asks,
/// says and counts down (asking first, the next set, the rest between sets, the count's range). Each change is saved
/// as it is made, so leaving and coming back the same day picks up where it stopped. The ones the page explains return
/// the sentence it says.
extension AppModel {
    // MARK: Sets and moving on

    /// Logs a set of the movement on screen. True when that was its last set.
    func logSet(_ progress: inout WorkoutProgress, count: Int) -> Bool {
        guard let item = progress.pageItem, progress.pageResult != nil else { return true }
        progress.results[progress.index].sets.append(count)
        saveProgress(progress)
        return progress.results[progress.index].sets.count >= item.sets
    }

    /// Moves on to the next movement. True when there is none: the page then asks how it went.
    func advance(_ progress: inout WorkoutProgress) -> Bool {
        guard progress.index + 1 < progress.content.items.count else { return true }
        progress.index += 1
        saveProgress(progress)
        return false
    }

    // MARK: Too hard, too easy

    /// "Too hard" (plan 4.2, 5.C and 5.C.1). While a backpack movement's weight is being found (`isCalibrating`), it first
    /// drops a kilogram, down to the least. Otherwise, and at the least: below the bottom of the range this session (a set
    /// logged under it, or the count entered now under it) the movement is marked "can't do", which it stays until the
    /// person changes it in My rules, and the easier one on its chain comes instead; in the range, the easier one comes
    /// instead and the harder one is left out from now on (the avoid list).
    func tooHard(_ progress: inout WorkoutProgress, entered count: Int) -> String? {
        guard let item = progress.pageItem, let result = progress.pageResult, let move = movement(item.movementId) else { return nil }
        if isCalibrating(result), let load = progress.backpackLoad, load > BackpackWater.leastKg {
            let lighter = progress.backpackTooHard()
            saveProgress(progress)
            return lighter.map { "One litre less: " + BackpackWater.words($0) + "." }
        }
        if isBelowRange(progress, entered: count) { return cannotDo(move, in: &progress) }
        return leaveOutForEasier(move, in: &progress)
    }

    /// "Too easy", only while a backpack movement's weight is being found: two kilograms more now and next time, up to what
    /// a backpack holds. After that the weight goes up by itself, a kilogram after a session with every set at the top.
    func tooEasy(_ progress: inout WorkoutProgress) -> String? {
        guard offersTooEasy(progress) else { return nil }
        let heavier = progress.backpackTooEasy()
        saveProgress(progress)
        return heavier.map { "Two litres more: " + BackpackWater.words($0) + "." } ?? "That’s as much as a backpack holds."
    }

    /// Whether the page shows "Too easy" for the movement on screen: a backpack movement whose weight is being found.
    func offersTooEasy(_ progress: WorkoutProgress) -> Bool {
        guard progress.backpackLoad != nil, let result = progress.pageResult else { return false }
        return isCalibrating(result)
    }

    /// A backpack movement with no weight kept from an earlier session: this session finds its weight (plan 5.C). Decided
    /// when the session started (`WorkoutResult.calibrating`), or from the log for a session saved by an older build.
    func isCalibrating(_ result: WorkoutResult) -> Bool {
        guard movement(result.movementId)?.usesBackpack == true else { return false }
        return result.calibrating ?? (workoutLog.savedLoad(result.movementId) == nil)
    }

    /// What a new result of the movement says about calibrating, from the log as it stands: nil without a backpack.
    func calibrationAtStart(_ movementId: String) -> Bool? {
        guard movement(movementId)?.usesBackpack == true else { return nil }
        return workoutLog.savedLoad(movementId) == nil
    }

    /// The results a new session starts with: nothing done yet, each with its planned weight and whether it is calibrating.
    func startingResults(_ content: WorkoutContent) -> [WorkoutResult] {
        content.items.map { item in
            WorkoutResult(movementId: item.movementId, load: item.load, slow: item.slow, calibrating: calibrationAtStart(item.movementId))
        }
    }

    /// Below the bottom of the movement's range this session: a set logged under it, or the count entered now under it.
    func isBelowRange(_ progress: WorkoutProgress, entered count: Int) -> Bool {
        guard let item = progress.pageItem, let result = progress.pageResult else { return false }
        return count < item.low || result.sets.contains { $0 < item.low }
    }

    /// Marked "can't do" now, not at the end, and never offered again until the person changes it in My rules.
    private func cannotDo(_ move: Movement, in progress: inout WorkoutProgress) -> String {
        changeRulesNow { $0.movements[move.id] = .cannot }
        guard let easier = openEasier(than: move) else {
            progress.results[progress.index].tooHard = true
            saveProgress(progress)
            return "\(move.name) is marked “can’t do yet” and won’t be given again. There’s nothing easier for it: do what you can, or skip it."
        }
        swapMovement(&progress, to: easier, tooHard: true)
        return "Swapped to \(easier.name). \(move.name) is marked “can’t do yet”; you can change that in My rules."
    }

    /// The easier one stands in from now on: the harder one goes on the avoid list. With no easier one it stays, marked.
    private func leaveOutForEasier(_ move: Movement, in progress: inout WorkoutProgress) -> String {
        guard let easier = openEasier(than: move) else {
            progress.results[progress.index].tooHard = true
            saveProgress(progress)
            return "There’s nothing easier for this one. Do what you can; the next session goes lighter."
        }
        changeRulesNow { rules in if !rules.avoid.contains(move.id) { rules.avoid.append(move.id) } }
        swapMovement(&progress, to: easier, tooHard: true)
        return "Swapped to \(easier.name). \(move.name) is left out from now on; you can bring it back in My rules."
    }

    /// A rule a page button changes: in `userRules` at once, so the page and its swap list read it now, then saved with the
    /// week planned again in the background, each save after the one before. `pageSaved()` waits for them.
    private func changeRulesNow(_ change: (inout UserRules) -> Void) {
        var rules = userRules
        change(&rules)
        guard rules != userRules else { return }
        userRules = rules
        let before = pageSave
        pageSave = Task { [weak self] in
            await before?.value
            guard let self else { return }
            await self.saveRules(self.userRules, quiet: true)
        }
    }

    /// Waits until the rule changes the page's buttons made are saved and the week planned again with them.
    func pageSaved() async {
        await pageSave?.value
    }

    /// The nearest easier movement on the chain that the rules leave open (one marked "can't do" or left out is passed over).
    func openEasier(than move: Movement) -> Movement? {
        var next = move.easier.flatMap { movement($0) }
        while let candidate = next, !isOpen(candidate) { next = candidate.easier.flatMap { movement($0) } }
        return next
    }

    // MARK: Swapping

    /// "Not yet" to "Can you do one?" on a movement just unlocked: back to the easier one, with nothing marked, so it isn't
    /// counted as a failure; it is offered again later. Nil when there is no easier one: the page moves on instead.
    func notYet(_ progress: inout WorkoutProgress, move: Movement) -> String? {
        guard let easier = openEasier(than: move) else { return nil }
        swapMovement(&progress, to: easier)
        return "Back to \(easier.name) for now. \(move.name) comes again once \(easier.name) is easy for you."
    }

    /// Puts another movement in the place of the one on screen. Sets already done stay with the first movement, which
    /// keeps "Too hard" when that was why.
    func swapMovement(_ progress: inout WorkoutProgress, to move: Movement, tooHard: Bool = false) {
        guard let item = progress.pageItem, let result = progress.pageResult else { return }
        let done = result.sets.count
        let next = swapItem(move, sets: max(1, item.sets - done))
        let fresh = WorkoutResult(movementId: move.id, load: next.load, swappedFrom: item.movementId,
                                  calibrating: calibrationAtStart(move.id))
        if tooHard { progress.results[progress.index].tooHard = true }
        if done == 0 {
            progress.content.items[progress.index] = next
            progress.results[progress.index] = fresh
        } else {
            progress.content.items[progress.index].sets = done
            progress.content.items.insert(next, at: progress.index + 1)
            progress.results.insert(fresh, at: progress.index + 1)
            progress.index += 1
        }
        saveProgress(progress)
    }

    /// The movement that comes in: the sets left, its own range and rest, and for a backpack the load it was last left at.
    private func swapItem(_ move: Movement, sets: Int) -> WorkoutContent.Item {
        let load = move.usesBackpack ? (workoutLog.savedLoad(move.id) ?? move.load ?? BackpackWater.startKg) : nil
        return WorkoutContent.Item(movementId: move.id, sets: sets, reps: move.dose.reps, seconds: move.dose.seconds,
                                   load: load, rest: move.rest, isNew: false)
    }

    // MARK: Starting

    /// Today has a home session still to do (not done, not skipped): Today pins "Start" at the bottom for it.
    var homeStartableToday: Bool {
        homeFocusToday != nil && !homeDoneToday && !workoutLog.didSkip(todayISO)
    }

    // MARK: No session today

    /// Why the workout page has no session, in its words: today's is done, or today has none (a rest day, a day out, no
    /// free half hour).
    var noWorkoutWords: String {
        homeDoneToday
            ? "Today’s home workout is done. The week shows what the next one holds."
            : "There’s no home workout on the plan today: it’s a rest day, a day out, or there was no free half hour. You can still train."
    }

    /// "Train anyway" on a day with no session: the rules' full-body session at the shortest length, kept as today's.
    /// Not offered once today's is done, since a day is finished on the page once.
    func extraWorkoutToday() async -> TodayWorkout {
        guard !homeDoneToday else { return TodayWorkout() }
        await loadMovements()
        guard !movements.isEmpty,
              let content = await contentEngine.session(.init(id: "home-\(todayISO)", focus: "full", minutes: userRules.sessionMin),
                                                        basis: contentBasis, turn: workoutLog.turn)
        else { return TodayWorkout(failed: true) }
        let progress = WorkoutProgress(day: todayISO, content: content, results: startingResults(content), startedAt: now)
        saveProgress(progress)
        return TodayWorkout(progress: progress)
    }

    // MARK: The week table

    /// Done that day: finished on the page, done another way, or a strength workout in Apple Health.
    func homeDone(on day: String) -> Bool { workoutLog.didHomeSession(on: day) || trainedStrength(on: day) }

    /// The week table's first line, over the whole Monday-to-Sunday week: the days already past and the days to come.
    func weekSummary(_ week: HomeWeek) -> String {
        let earlier = earlierThisWeek
        // A day at home counts once done, also today when it was too late for a time to be left on it.
        let ahead = week.days.filter { ($0.trains || $0.kind == .home) && homeDone(on: $0.day) }.count
        let done = ahead + earlier.filter { $0.outcome == .done }.count
        let home = week.homeDays == 1 ? "1 day at home" : "\(week.homeDays) days at home"
        let planned = week.trainingDays + earlier.count
        return earlier.isEmpty ? "\(home) ahead, \(planned) planned, \(done) done."
                               : "This week: \(planned) planned, \(done) done. \(home) ahead."
    }

    /// The times one can be picked from for a day still to train, the first included, and the one picked when it is no
    /// longer among them. Empty when there is nothing to pick: one time only, done, or skipped.
    func pickableTimes(_ day: HomeWeek.Day, picked: String?) -> [String] {
        let clocks: [String] = WorkoutReminders.times(of: day).map(\.clock)
        guard day.trains, clocks.count > 1, !homeDone(on: day.day), !workoutLog.didSkip(day.day) else { return [] }
        guard let picked, !clocks.contains(picked) else { return clocks }
        return clocks + [picked]
    }

    /// The picker's choice for no one time: every time, or with "Always ask me to pick one time" on, the first only.
    func unpickedLabel(first clock: String) -> String {
        Automatic.pickEachDay.isOn(settings) ? "Not picked yet: only at \(clock)" : "At every time"
    }
}

/// The movement on screen and what was done of it; nil when the session holds nothing at its index.
extension WorkoutProgress {
    var pageItem: WorkoutContent.Item? { content.items.indices.contains(index) ? content.items[index] : nil }
    var pageResult: WorkoutResult? { results.indices.contains(index) ? results[index] : nil }

    /// Whether the movement on screen is the session's last (also when the session holds nothing there).
    var isLastMovement: Bool { index + 1 >= content.items.count }

    /// The set the page is on, counted from 1: the one after those done.
    var nextSetNumber: Int { (pageResult?.sets.count ?? 0) + 1 }

    /// The same, never past the movement's last set: "Set 3 of 3" once every set is done.
    var shownSetNumber: Int { min(nextSetNumber, pageItem?.sets ?? nextSetNumber) }

    /// The slow step, before any weight or harder movement: the same movement, every rep lowered
    /// `WorkoutContent.slowExtraSeconds` slower than its usual tempo. Nil off the slow step or for a movement with no tempo.
    func slowLine(for move: Movement) -> String? {
        guard pageItem?.slow == true, let tempo = move.tempo else { return nil }
        let down = tempo.down + WorkoutContent.slowExtraSeconds
        return "Slower this time: lower in \(down) seconds instead of \(tempo.down)."
    }
}

/// What the page asks, says and counts down, kept out of the view.
extension AppModel {
    /// A movement not done before asks first whether the person can do one: until a set of it is logged, and while the
    /// rules hold no answer for it.
    func asksFirst(_ progress: WorkoutProgress, move: Movement) -> Bool {
        (progress.pageItem?.isNew ?? false) && (progress.pageResult?.sets.isEmpty ?? true) && userRules.movements[move.id] == nil
    }

    /// "Next: Split squat, set 2 of 3.", under the rest countdown; nothing when the movement can't be read.
    func nextSetLine(_ progress: WorkoutProgress?) -> String {
        guard let progress, let item = progress.pageItem, let move = movement(item.movementId) else { return "" }
        return "Next: \(move.name), set \(progress.nextSetNumber) of \(item.sets)."
    }

    // MARK: Rest between sets

    /// What "−15 s" and "+15 s" change.
    nonisolated static let restStep: TimeInterval = 15

    /// When the rest after a set of `item` ends, from now.
    func restEnd(after item: WorkoutContent.Item) -> Date {
        now.addingTimeInterval(TimeInterval(item.rest))
    }

    /// A rest that ends at `until`, made `restStep` longer or shorter.
    nonisolated static func rest(_ until: Date, longer: Bool) -> Date {
        until.addingTimeInterval(longer ? restStep : -restStep)
    }

    /// How long is left until `end` by the model's clock; below zero once it has passed.
    func timeLeft(until end: Date) -> TimeInterval {
        end.timeIntervalSince(now)
    }

    /// "40 seconds", "1 minute 5 seconds": what VoiceOver reads of a rest.
    nonisolated static func restWords(_ interval: TimeInterval) -> String {
        let left = max(0, Int(interval.rounded(.up)))
        let minutes = left / ClockUnits.secondsPerMinute, seconds = left % ClockUnits.secondsPerMinute
        let secondsPart = seconds == 1 ? "1 second" : "\(seconds) seconds"
        guard minutes > 0 else { return secondsPart }
        let minutesPart = minutes == 1 ? "1 minute" : "\(minutes) minutes"
        return seconds == 0 ? minutesPart : minutesPart + " " + secondsPart
    }
}

extension WorkoutContent.Item {
    /// The count can go up to twice the top of the range, and to 30 at least.
    static let countRoom = 2
    static let leastCount = 30

    /// What the reps or seconds stepper allows.
    var countRange: ClosedRange<Int> { 0...max(high * Self.countRoom, Self.leastCount) }
}
