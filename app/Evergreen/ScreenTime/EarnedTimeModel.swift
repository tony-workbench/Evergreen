import FamilyControls
import Foundation
import HealthKit
import Observation
import os
import UIKit

/// Screen time earned by working out: the person picks the apps to lock (social, videos and games),
/// sets how many minutes of each a workout minute earns, and spends them from the locked-app screen,
/// each day's free time first.
/// The credit lives in the App Group, where the Screen Time extensions read and spend it.
@Observable
@MainActor
final class EarnedTimeModel {
    private(set) var isOn = EarnedTime.isOn
    private(set) var credit = EarnedTime.credit
    /// Workout minutes since the start of this week, shown before the feature is on.
    private(set) var weekMinutes: Double = 0
    private(set) var rates = Dictionary(uniqueKeysWithValues: FunGroup.allCases.map { ($0, EarnedTime.rate($0)) })
    private(set) var selections = Dictionary(uniqueKeysWithValues: FunGroup.allCases.map { ($0, EarnedTime.selection($0)) })
    /// Free minutes of each group left today, and whether the weekly escape is still there.
    private(set) var baseLeft = Dictionary(uniqueKeysWithValues: FunGroup.allCases.map { ($0, $0.baseMinutes) })
    private(set) var escapeLeft = true
    /// Said under the button when turning on did not work.
    var problem: String?

    /// Minutes of a group to show: what is left to spend once on, what this week earned before that.
    func minutes(_ group: FunGroup) -> Int {
        EarnMath.available(credit: isOn ? credit : weekMinutes, rate: rates[group] ?? group.defaultRate)
    }

    /// Minutes of a group the page shows: once on, today's free time left plus what the credit buys; before that, what
    /// this week earned.
    func usable(_ group: FunGroup) -> Int {
        Self.usable(minutes: minutes(group), baseLeft: baseLeft[group], isOn: isOn)
    }

    static func usable(minutes: Int, baseLeft: Int?, isOn: Bool) -> Int {
        minutes + (isOn ? baseLeft ?? 0 : 0)
    }

    /// Today's free minutes of a group left, for its row once on.
    func baseLeftMinutes(_ group: FunGroup) -> Int { baseLeft[group] ?? 0 }

    /// The groups with an app or category picked, for "Lock these apps?".
    var pickedGroups: [FunGroup] { FunGroup.allCases.filter { picked($0) > 0 } }

    func picked(_ group: FunGroup) -> Int {
        guard let s = selections[group] else { return 0 }
        return s.applicationTokens.count + s.categoryTokens.count + s.webDomainTokens.count
    }

    /// Counts the finished workouts again and writes the earned minutes where the extensions read them.
    func refresh(workouts: [Workout], now: Date, calendar: Calendar) {
        EarnedTime.relockExpired(now: now)
        let spans = workouts.map { (start: $0.start, end: $0.end) }
        let weekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? calendar.startOfDay(for: now)
        weekMinutes = EarnMath.workoutMinutes(spans, since: weekStart, now: now)
        if isOn {
            var ledger = EarnedTime.ledger
            ledger.start(now: now, calendar: calendar)
            ledger.count(workouts.map { (id: $0.id, start: $0.start, end: $0.end) }, now: now)
            EarnedTime.ledger = ledger
        }
        credit = EarnedTime.credit
        for group in FunGroup.allCases { baseLeft[group] = EarnedTime.baseLeft(group, now: now, calendar: calendar) }
        escapeLeft = EarnedTime.escapeLeft(now: now, calendar: calendar)
    }

    /// A workout finished on `day` after a missed one: every group gets the comeback minutes that day.
    func markComeback(_ day: String) {
        EarnedTime.comebackDay = day
    }

    func turnOn(workouts: [Workout], now: Date, calendar: Calendar) async {
        problem = nil
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
            problem = "Screen Time access was not given, so no app can be locked."
            return
        }
        var ledger = EarnedTime.ledger
        ledger.start(now: now, calendar: calendar)
        EarnedTime.ledger = ledger
        EarnedTime.isOn = true
        isOn = true
        refresh(workouts: workouts, now: now, calendar: calendar)
        EarnedTime.lockAll()
    }

    func turnOff() {
        EarnedTime.isOn = false
        EarnedTime.clearAll()
        isOn = false
    }

    func setRate(_ rate: Double, for group: FunGroup) {
        EarnedTime.setRate(rate, group)
        rates[group] = rate
    }

    func setSelection(_ selection: FamilyActivitySelection, for group: FunGroup) {
        EarnedTime.setSelection(selection, group)
        // Saving one group can take apps out of the other.
        for g in FunGroup.allCases {
            selections[g] = EarnedTime.selection(g)
            if isOn, !EarnedTime.isOpen(g) { EarnedTime.lock(g) }
        }
    }

    // MARK: New workouts while the app is closed

    @ObservationIgnored private var watching = false

    /// Wakes the app when Apple Health gets a new workout, so the credit grows without opening Evergreen.
    /// Health can't be read while the phone is locked, so it is read again as soon as the phone is unlocked.
    func watchWorkouts(_ onNew: @escaping @Sendable () async -> Bool) {
        guard !watching, HKHealthStore.isHealthDataAvailable() else { return }
        watching = true
        let store = Permissions.healthStore
        store.execute(Self.observer(onNew))
        store.enableBackgroundDelivery(for: .workoutType(), frequency: .immediate) { _, error in
            if let error { EarnedTime.log.error("Workout background delivery is off: \(error.localizedDescription, privacy: .public)") }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification,
                                               object: nil, queue: .main) { _ in Task { _ = await onNew() } }
    }

    /// Built off the main actor: HealthKit calls it on its own queue.
    private nonisolated static func observer(_ onNew: @escaping @Sendable () async -> Bool) -> HKObserverQuery {
        HKObserverQuery(sampleType: .workoutType(), predicate: nil) { _, done, error in
            guard error == nil else { done(); return }
            // Called at most once, after the read; left uncalled when Health could not be read yet, so HealthKit tries again.
            let finish = HealthDone(done)
            Task {
                if await onNew() { finish.call() }
            }
        }
    }
}

/// HealthKit's "done" for one observer call. Its handler isn't Sendable, so it is kept behind a lock to reach the task
/// that reads Health, and handed out once: calling it twice does nothing.
final class HealthDone: Sendable {
    private let handler: OSAllocatedUnfairLock<(() -> Void)?>

    init(_ done: @escaping () -> Void) { handler = OSAllocatedUnfairLock(uncheckedState: done) }

    func call() {
        let once = handler.withLockUnchecked { held -> (() -> Void)? in
            defer { held = nil }
            return held
        }
        once?()
    }
}
