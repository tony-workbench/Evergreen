import Foundation
import Observation

/// What Evergreen remembers, as the app last read it from the memory engine:
/// the table's rows, the facts' own lines, what is stopped and what can be
/// forgotten. Rolling, stopping, restoring, reviewing and forgetting go
/// through here. Memory comes only from data: no answer to a suggestion is
/// written into it.
@Observable
@MainActor
final class MemoryModel {
    /// The app model this is part of: the clock, the person's workouts and the other parts are read from it.
    @ObservationIgnored unowned let app: AppModel
    /// The memory bundle over this phone's memory folder; nil if the folder can't be made.
    @ObservationIgnored let memory: MemoryEngine?
    /// Whether memory has been read on this launch; the first tick and the first plan read it before going on.
    @ObservationIgnored var memoryRead = false
    /// What the person can forget and what is forgotten now.
    var memoryState = MemoryState()
    /// Memory as short lines in two groups, each with its key, and what is stopped.
    var memoryBrief = MemoryBrief()
    /// The memory table behind the week on screen.
    var memoryRows: [MemoryRow] = []
    /// Rows waiting for "Is this right?".
    var reviewRows: [MemoryRow] = []
    /// The memory agent answers from its own rules instead of a model (debug screens and tests).
    @ObservationIgnored var memoryWithoutModel = false
    /// The day's memory update while it runs behind a week that is already shown.
    @ObservationIgnored var memoryTask: Task<Void, Never>?
    /// When the memory agent last updated the table.
    var lastMemoryUpdate: Date? {
        get { app.settings.object(forKey: "last_memory_update") as? Date }
        set { app.settings.set(newValue, forKey: "last_memory_update") }
    }

    init(app: AppModel, memory: MemoryEngine?) {
        self.app = app
        self.memory = memory
    }

    /// What is remembered and in use, as sentences with their keys: the table's rows, or the facts' own lines before there is a table.
    var remembered: [(key: String, text: String)] {
        let rows = memoryRows.filter(\.isUsable).map { (key: $0.key, text: RowWords.sentence($0)) }
        return rows.isEmpty ? memoryBrief.lines.compactMap { line in line.key.map { (key: $0, text: line.sentence) } } : rows
    }

    /// What is stopped, with a label for each.
    var stoppedEntries: [(key: String, label: String)] {
        let rejected = memoryRows.filter(\.isRejected)
        return memoryBrief.stopped.filter { entry in !rejected.contains { $0.key == entry.key } }.map { ($0.key, $0.label) }
            + rejected.map { ($0.key, RowWords.sentence($0)) }
    }

    /// A few words for what a memory key names, from its row, its line of the facts, or its stopped entry: "Sunday 8 AM runs".
    func title(for key: String) -> String {
        memoryRows.first { $0.key == key }.map(RowWords.title)
            ?? memoryBrief.lines.first { $0.key == key }?.title
            ?? memoryBrief.stopped.first { $0.key == key }?.title
            ?? key
    }

    /// The memory agent's engine for this person.
    var memoryTable: EngineMemory? {
        memory.map { engine in
            EngineMemory(engine: engine, personaKey: app.persona.rawValue, timeZone: app.calendar.timeZone,
                         extras: app.triggers.shoes?.memoryRow(now: app.now, calendar: app.calendar).map { ["gear": $0.data] }, withoutModel: memoryWithoutModel)
        }
    }

    /// Reads the text that is sent, what can be forgotten and what is stopped.
    func refreshMemory() async {
        guard let memory else { return }
        let key = app.persona.rawValue
        memoryRead = true
        memoryState = await memory.state(key) ?? MemoryState()
        memoryBrief = await memory.brief(key) ?? MemoryBrief()
        memoryRows = shown(await memoryTable?.table() ?? [])
        reviewRows = await memoryTable?.reviewQueue() ?? []
    }

    /// The keys the person stopped.
    var stoppedKeys: [String] {
        let rejected = memoryRows.filter(\.isRejected).map(\.key)
        return memoryBrief.stopped.map(\.key).filter { !rejected.contains($0) } + rejected
    }

    /// "Stop using this": the fact isn't sent again until it's restored.
    func stop(key: String) async {
        guard let memory else { return }
        // A table row is rejected; a line of the facts alone is stopped.
        if memoryRows.contains(where: { $0.key == key }), let memoryTable {
            await memoryTable.reject(key: key, now: app.now)
        } else {
            await memory.stop(key: key, personaKey: app.persona.rawValue)
        }
        await refreshMemory()
    }

    /// Uses a stopped fact again; it comes back with the roll that follows.
    func restore(key: String) async {
        guard let memory else { return }
        if memoryRows.contains(where: { $0.key == key }), let memoryTable {
            await memoryTable.restore(key: key, now: app.now)
        } else {
            await memory.restore(key: key, personaKey: app.persona.rawValue)
        }
        await syncMemory()
        // Its suggestion can come back: the "not now" that stopped it is taken back and the week is planned again.
        await app.week.restored(key: key)
    }

    /// "Is this right?": yes keeps the row, no rejects it.
    func answerReview(_ row: MemoryRow, right: Bool) async {
        if right { await memoryTable?.confirm(key: row.key, now: app.now) } else { await memoryTable?.reject(key: row.key, now: app.now) }
        await refreshMemory()
    }

    /// Forgets what the person asked, then rolls again so every total is rebuilt without it.
    func forget(_ what: MemoryEngine.Forget) async {
        guard let memory else { return }
        // A memory update still running behind the week must not bring back a week planned from what is being forgotten.
        memoryTask?.cancel()
        memoryTask = nil
        app.planGeneration += 1
        app.planTask = nil
        app.planning = false
        await memory.forget(what, personaKey: app.persona.rawValue, input: memoryInput)
        // What the app itself kept about memory goes too: the rows the person rejected, and the week planned from it.
        if case .everything = what { await memory.setRejectedRows([], personaKey: app.persona.rawValue) }
        app.weekCache = nil
        app.settings.removeObject(forKey: WeekCache.storeKey)
        app.weekPlan = nil
        app.plannedSessions = []
        app.sentToAI = ""
        await syncMemory()
    }

    func restore(_ what: MemoryEngine.Restore) async {
        guard let memory else { return }
        await memory.restore(what, personaKey: app.persona.rawValue)
        await syncMemory()
    }

    /// The memory rows the app shows and plans from. A load compared with the
    /// usual means nothing until there are two weeks of workouts behind it,
    /// so that row is left out until then.
    func shown(_ rows: [MemoryRow]) -> [MemoryRow] {
        app.historyDepth.isThin ? rows.filter { $0.kind != "load" } : rows
    }

    /// The person's data as the memory engine reads it.
    var memoryInput: MemoryInput {
        MemoryInput(personaKey: app.persona.rawValue, historyStart: app.historyStart, now: app.now, workouts: app.workouts,
                    days: app.health.days, calendar: app.calendar)
    }

    /// Rolls the person's memory with today's Health data. Never blocks the agent.
    func syncMemory() async {
        guard let memory else { return }
        await memory.sync(memoryInput)
        await refreshMemory()
    }
}
