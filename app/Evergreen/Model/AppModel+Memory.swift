import Foundation

/// What memory shows the person, and what it stops and forgets. Memory comes
/// only from data: no answer to a suggestion is written into it.
extension AppModel {
    /// The last 4 weeks as a grid of days, with the usual weekdays from memory.
    var recentWeeks: RecentWeeks {
        RecentWeeks(workouts: workouts, usualWeekdays: memoryBrief.usualWeekdays, today: storyDay, calendar: calendar)
    }

    /// Before the first look at what Evergreen noticed: read Apple Health and roll memory.
    func prepareFirstLook() async {
        await refreshHealth()
        await tick()
        if !memoryRead { await syncMemory() }
    }
}

/// Memory as the views and the other parts of the app model reach it (MemoryModel.swift).
extension AppModel {
    var memoryRead: Bool { memoryModel.memoryRead }

    var memoryState: MemoryState {
        get { memoryModel.memoryState }
        set { memoryModel.memoryState = newValue }
    }

    var memoryBrief: MemoryBrief {
        get { memoryModel.memoryBrief }
        set { memoryModel.memoryBrief = newValue }
    }

    var memoryRows: [MemoryRow] {
        get { memoryModel.memoryRows }
        set { memoryModel.memoryRows = newValue }
    }

    var reviewRows: [MemoryRow] {
        get { memoryModel.reviewRows }
        set { memoryModel.reviewRows = newValue }
    }

    var memoryWithoutModel: Bool {
        get { memoryModel.memoryWithoutModel }
        set { memoryModel.memoryWithoutModel = newValue }
    }

    var memoryTask: Task<Void, Never>? {
        get { memoryModel.memoryTask }
        set { memoryModel.memoryTask = newValue }
    }

    var lastMemoryUpdate: Date? {
        get { memoryModel.lastMemoryUpdate }
        set { memoryModel.lastMemoryUpdate = newValue }
    }

    var remembered: [(key: String, text: String)] { memoryModel.remembered }

    var stoppedEntries: [(key: String, label: String)] { memoryModel.stoppedEntries }

    func title(for key: String) -> String { memoryModel.title(for: key) }

    var memoryTable: EngineMemory? { memoryModel.memoryTable }

    func refreshMemory() async { await memoryModel.refreshMemory() }

    var stoppedKeys: [String] { memoryModel.stoppedKeys }

    func stop(key: String) async { await memoryModel.stop(key: key) }

    func restore(key: String) async { await memoryModel.restore(key: key) }

    func answerReview(_ row: MemoryRow, right: Bool) async { await memoryModel.answerReview(row, right: right) }

    func forget(_ what: MemoryEngine.Forget) async { await memoryModel.forget(what) }

    func restore(_ what: MemoryEngine.Restore) async { await memoryModel.restore(what) }

    func shown(_ rows: [MemoryRow]) -> [MemoryRow] { memoryModel.shown(rows) }

    var memoryInput: MemoryInput { memoryModel.memoryInput }

    func syncMemory() async { await memoryModel.syncMemory() }
}
