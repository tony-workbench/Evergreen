import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import os

/// The apps a person earns time for by working out, in two groups with their own rate.
enum FunGroup: String, CaseIterable, Codable, Sendable, Identifiable {
    case videos, games

    var id: String { rawValue }
    var title: String { self == .videos ? "Videos" : "Games" }
    var noun: String { rawValue }
    /// Minutes of this group earned per minute of workout, until the person changes it.
    var defaultRate: Double { self == .videos ? 1 : 0.5 }
}

/// The workouts that have earned time, each counted once and kept even after Apple Health
/// stops returning it (Evergreen reads 60 days), so earned time never shrinks.
struct EarnLedger: Codable, Equatable, Sendable {
    struct Span: Codable, Equatable, Sendable {
        var start: Date
        var end: Date
        var minutes: Double { end.timeIntervalSince(start) / 60 }

        func overlap(_ other: Span) -> Double {
            max(0, min(end, other.end).timeIntervalSince(max(start, other.start)) / 60)
        }
    }

    /// Workouts that start on or after this moment count; set the first time the feature is turned on.
    var countsFrom: Date?
    /// Counted workouts by id.
    var counted: [String: Span] = [:]
    /// Workouts that were the same session as a counted one.
    var merged: Set<String> = []

    var earned: Double { counted.values.reduce(0) { $0 + $1.minutes } }

    /// The first turn-on starts counting at the start of that day, so a workout done that morning
    /// already earns. Turning on again later keeps the start and what was counted.
    mutating func start(now: Date, calendar: Calendar) {
        if countsFrom == nil { countsFrom = calendar.startOfDay(for: now) }
    }

    /// Adds finished workouts not counted yet. Two workouts that overlap by more than half of the
    /// shorter one are the same session (logged here and in Apple Health): only the longer counts,
    /// whichever arrived first, and the other is remembered so it is never added later.
    mutating func count(_ workouts: [(id: String, start: Date, end: Date)], now: Date) {
        guard let from = countsFrom else { return }
        for w in workouts.sorted(by: { $0.start < $1.start })
        where counted[w.id] == nil && !merged.contains(w.id) && w.start >= from && w.end <= now && w.end > w.start {
            let span = Span(start: w.start, end: w.end)
            let same = counted.filter { $0.value.overlap(span) > min($0.value.minutes, span.minutes) / 2 }
            // Kept only when longer than every copy it matches; then those copies give way to it.
            if same.values.contains(where: { $0.minutes >= span.minutes }) { merged.insert(w.id); continue }
            for id in same.keys {
                counted[id] = nil
                merged.insert(id)
            }
            counted[w.id] = span
        }
    }
}

/// The arithmetic of earning and spending, kept apart so tests can check it.
/// Credit is counted in workout minutes; each group turns it into its own minutes at its rate.
enum EarnMath {
    /// Minutes of finished workouts that started on or after `since`.
    static func workoutMinutes(_ spans: [(start: Date, end: Date)], since: Date, now: Date) -> Double {
        spans.filter { $0.start >= since && $0.end <= now && $0.end > $0.start }
            .reduce(0) { $0 + $1.end.timeIntervalSince($1.start) / 60 }
    }

    /// Whole minutes of a group the credit buys.
    static func available(credit: Double, rate: Double) -> Int {
        guard credit > 0, rate > 0 else { return 0 }
        return Int((credit * rate + 0.0001).rounded(.down))
    }

    /// The schedule that locks an unlock again: it starts when the time is up and lasts the
    /// 15 minutes Screen Time needs at least; its start is what locks.
    static func relockWindow(now: Date, minutes: Int) -> (start: Date, end: Date) {
        let start = now.addingTimeInterval(Double(minutes) * 60)
        return (start, start.addingTimeInterval(15 * 60))
    }

    /// Workout minutes that `minutes` of a group cost.
    static func cost(minutes: Int, rate: Double) -> Double {
        rate > 0 ? Double(minutes) / rate : .infinity
    }

    /// One unlock: up to `block` minutes of the group, and what it costs. Nil when the credit buys less than a minute.
    static func spend(credit: Double, rate: Double, block: Int) -> (minutes: Int, cost: Double)? {
        let minutes = min(block, available(credit: credit, rate: rate))
        guard minutes >= 1 else { return nil }
        return (minutes, cost(minutes: minutes, rate: rate))
    }

    /// A moment as Screen Time schedule parts, with its date, so a relock that falls after
    /// midnight is set for the next day rather than for a time already past today.
    static func scheduleParts(_ date: Date, calendar: Calendar) -> DateComponents {
        calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    }

    /// The groups whose unlock has run out by `now`.
    static func expired(_ openUntil: [FunGroup: Date], now: Date) -> [FunGroup] {
        FunGroup.allCases.filter { (openUntil[$0] ?? .distantFuture) <= now }
    }
}

/// What the app and its Screen Time extensions share through the App Group:
/// the chosen apps, the rates, the credit, and locking and unlocking a group.
enum EarnedTime {
    static let appGroup = "group.com.evergreentraining.app"
    /// The most one unlock opens, in minutes.
    static let block = 15

    static let log = Logger(subsystem: "com.evergreentraining.app", category: "earned-time")

    /// The App Group's store. Without it the app and the extensions would each keep their own credit.
    static var defaults: UserDefaults {
        guard let shared = UserDefaults(suiteName: appGroup) else {
            log.fault("App Group \(appGroup, privacy: .public) is missing from the entitlements")
            assertionFailure("App Group \(appGroup) is missing")
            return .standard
        }
        return shared
    }

    static var isOn: Bool {
        get { defaults.bool(forKey: "earn.on") }
        set { defaults.set(newValue, forKey: "earn.on") }
    }
    /// The counted workouts. Written only by the app, after each Apple Health read.
    static var ledger: EarnLedger {
        get { defaults.data(forKey: "earn.ledger").flatMap { try? JSONDecoder().decode(EarnLedger.self, from: $0) } ?? EarnLedger() }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "earn.ledger") }
    }
    static var earned: Double { ledger.earned }
    /// Workout minutes already spent on unlocks. Written only by the unlock, so the app's
    /// writes to the ledger and the shield's writes here never overwrite each other.
    static var spent: Double {
        get { defaults.double(forKey: "earn.spent") }
        set { defaults.set(newValue, forKey: "earn.spent") }
    }
    static var credit: Double { max(0, earned - spent) }

    static func rate(_ group: FunGroup) -> Double {
        defaults.object(forKey: "earn.rate.\(group.rawValue)") as? Double ?? group.defaultRate
    }
    static func setRate(_ rate: Double, _ group: FunGroup) {
        defaults.set(rate, forKey: "earn.rate.\(group.rawValue)")
    }

    static func available(_ group: FunGroup) -> Int {
        EarnMath.available(credit: credit, rate: rate(group))
    }

    static func selection(_ group: FunGroup) -> FamilyActivitySelection {
        guard let data = defaults.data(forKey: "earn.apps.\(group.rawValue)"),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else {
            return FamilyActivitySelection()
        }
        return selection
    }
    /// Saves the group's apps and takes them out of the other group, so one app is never locked twice.
    /// Whole categories belong to one group only: the shield's button is told the app, not its
    /// category, so with categories in both groups it could not tell which group to charge.
    static func setSelection(_ selection: FamilyActivitySelection, _ group: FunGroup) {
        defaults.set(try? JSONEncoder().encode(selection), forKey: "earn.apps.\(group.rawValue)")
        for other in FunGroup.allCases where other != group {
            var theirs = self.selection(other)
            theirs.applicationTokens.subtract(selection.applicationTokens)
            if !selection.categoryTokens.isEmpty { theirs.categoryTokens = [] }
            theirs.webDomainTokens.subtract(selection.webDomainTokens)
            defaults.set(try? JSONEncoder().encode(theirs), forKey: "earn.apps.\(other.rawValue)")
        }
    }

    /// When the group's current unlock ends; nil while it is locked.
    static func openUntil(_ group: FunGroup) -> Date? {
        defaults.object(forKey: "earn.until.\(group.rawValue)") as? Date
    }
    private static func setOpenUntil(_ date: Date?, _ group: FunGroup) {
        defaults.set(date, forKey: "earn.until.\(group.rawValue)")
    }

    static func isOpen(_ group: FunGroup, now: Date = Date()) -> Bool {
        (openUntil(group) ?? .distantPast) > now
    }

    // MARK: Locking

    static func store(_ group: FunGroup) -> ManagedSettingsStore {
        ManagedSettingsStore(named: .init("earn.\(group.rawValue)"))
    }

    static func activity(_ group: FunGroup) -> DeviceActivityName { .init("earn.\(group.rawValue)") }

    static func group(of activity: DeviceActivityName) -> FunGroup? {
        FunGroup.allCases.first { self.activity($0) == activity }
    }

    static func lock(_ group: FunGroup) {
        let chosen = selection(group)
        let store = store(group)
        store.shield.applications = chosen.applicationTokens.isEmpty ? nil : chosen.applicationTokens
        // An app picked in the other group stays out of this group's category lock, so its own unlock opens it.
        let othersApps = FunGroup.allCases.filter { $0 != group }.reduce(into: Set<ApplicationToken>()) {
            $0.formUnion(selection($1).applicationTokens)
        }
        store.shield.applicationCategories = chosen.categoryTokens.isEmpty ? nil : .specific(chosen.categoryTokens, except: othersApps)
        store.shield.webDomains = chosen.webDomainTokens.isEmpty ? nil : chosen.webDomainTokens
        setOpenUntil(nil, group)
    }

    static func lockAll() { FunGroup.allCases.forEach(lock) }

    static func clearAll() {
        DeviceActivityCenter().stopMonitoring(FunGroup.allCases.map(activity))
        for group in FunGroup.allCases {
            store(group).clearAllSettings()
            setOpenUntil(nil, group)
        }
    }

    /// Opens the group for up to `block` minutes, paid from the credit, and returns the minutes.
    /// The apps lock again when the time is up: a schedule starts at that moment and its
    /// start locks them (the most dependable Screen Time callback; usage thresholds can fire early).
    /// Nil when there is nothing to spend or the schedule could not be set.
    @discardableResult
    static func unlock(_ group: FunGroup, now: Date = Date(), calendar: Calendar = .current) -> Int? {
        guard let spend = EarnMath.spend(credit: credit, rate: rate(group), block: block) else { return nil }
        let minutes = spend.minutes
        let window = EarnMath.relockWindow(now: now, minutes: minutes)
        let schedule = DeviceActivitySchedule(intervalStart: EarnMath.scheduleParts(window.start, calendar: calendar),
                                              intervalEnd: EarnMath.scheduleParts(window.end, calendar: calendar),
                                              repeats: false)
        let center = DeviceActivityCenter()
        center.stopMonitoring([activity(group)])
        do {
            try center.startMonitoring(activity(group), during: schedule)
        } catch {
            log.error("Relock schedule for \(group.rawValue, privacy: .public) not set: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        spent += spend.cost
        store(group).clearAllSettings()
        setOpenUntil(window.start, group)
        return minutes
    }

    /// The unlock's time is up: lock the group again.
    static func relock(_ activity: DeviceActivityName) {
        guard let group = group(of: activity) else { return }
        DeviceActivityCenter().stopMonitoring([activity])
        if isOn { lock(group) }
    }

    /// Locks any group whose unlock has run out, in case the schedule's callback never came.
    static func relockExpired(now: Date = Date()) {
        guard isOn else { return }
        let open = Dictionary(uniqueKeysWithValues: FunGroup.allCases.compactMap { g in openUntil(g).map { (g, $0) } })
        for group in EarnMath.expired(open, now: now) { relock(activity(group)) }
    }

    /// Which group a shielded app, category or website belongs to.
    static func group(app token: ApplicationToken) -> FunGroup? {
        FunGroup.allCases.first { selection($0).applicationTokens.contains(token) }
    }
    static func group(web token: WebDomainToken) -> FunGroup? {
        FunGroup.allCases.first { selection($0).webDomainTokens.contains(token) }
    }
    static func group(category token: ActivityCategoryToken) -> FunGroup? {
        FunGroup.allCases.first { selection($0).categoryTokens.contains(token) }
    }
    /// An app locked through a whole category reaches the shield's button as the app alone,
    /// so it belongs to the one group that locks categories.
    static func group(lockedApp token: ApplicationToken) -> FunGroup? {
        group(app: token) ?? FunGroup.allCases.first { !selection($0).categoryTokens.isEmpty }
    }
}
