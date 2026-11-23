import Foundation

/// The memory bundle (memory-agent, built to Resources/Memory/memory-phone.js)
/// over this phone's memory folder. A sync rolls the person's memory.
/// It also reads the planner text, stops single facts and forgets what the
/// person asks it to. Memory comes only from data: answers to suggestions are
/// never written into it. Memory lives in Application Support/Memory, one folder
/// per person.
actor MemoryEngine {
    /// What the person can ask memory to forget (memory-agent/docs/MEMORY-LOGIC.md, section 6).
    enum Forget: Sendable, Equatable {
        /// One day, as `YYYY-MM-DD`: it's left out of every later roll and total.
        case day(String)
        /// Stop summarising one kind of fact until it's restored.
        case type(String)
        /// Everything computed: the profile and the rolling summaries.
        case everything
    }

    /// Undoes `Forget.type` or `Forget.everything`.
    enum Restore: Sendable, Equatable {
        case type(String)
        case everything
    }

    /// The memory bundle with its file bridge; when the bundle is missing every call fails safely.
    private let bundle: JSBundle
    /// The engine runs on its bundle's actor. A step that makes several calls
    /// into the bundle (a sync's two rolls, forgetting everything) then runs
    /// from start to end with no other step of the engine in between.
    nonisolated var unownedExecutor: UnownedSerialExecutor { bundle.unownedExecutor }
    private let root: String
    private let secret: String
    /// The last midnight rolled for each person, kept in `rolled.json` beside
    /// their folders, so a relaunch doesn't roll the same day again and the
    /// record goes when the memory does.
    private var rolled: [String: String]

    /// Nil when the person's folder can't be made. The bundle itself is
    /// loaded at the first call, on the actor, so starting the app doesn't wait for it.
    init?(root: URL, secret: String, bundle: Bundle = .main) {
        guard (try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)) != nil,
              let resolved = MemoryFiles.realpath(root.path)["v"] as? String
        else { return nil }
        // The store refuses paths that leave the person's folder, so give it the real path (/var is a symlink on a phone).
        self.root = resolved
        self.secret = secret
        self.bundle = JSBundle(resource: "memory-phone", bundle: bundle, prepare: MemoryHost.install(in:))
        rolled = (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: Self.rolledFile(resolved)))) ?? [:]
    }

    /// The memory folder in Application Support, with this install's id secret.
    static func standard() -> MemoryEngine? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        return MemoryEngine(root: support.appending(path: "Memory"), secret: IdSecret.load())
    }

    /// The person's opaque user id: the same HMAC the bundle uses for its own ids.
    func userId(_ personaKey: String) -> String {
        "usr_" + MemoryFiles.hmac(secret, "usr\u{0}persona|\(personaKey)").prefix(16)
    }

    /// Rolls yesterday (once) and today so far.
    func sync(_ input: MemoryInput) {
        let user = userId(input.personaKey)
        let midnight = input.timestamp(input.midnight)
        if rolled[user] != midnight, roll(user, snapshot: input.snapshot(exportDate: input.midnight), now: midnight) {
            remember(midnight, for: user)
        }
        if input.now > input.midnight {
            _ = roll(user, snapshot: input.snapshot(exportDate: input.now), now: input.timestamp(input.now))
        }
    }

    // MARK: Reading and answers

    /// What is sent for this person: the brief and the fact lines behind it,
    /// without what they stopped. Nil when memory can't answer safely (the
    /// planner then goes without it).
    func plannerMemory(_ personaKey: String) -> PhoneMemory? {
        let user = userId(personaKey)
        let text = call("memoryPlannerText", user: user)
        let brief = call("memoryBrief", user: user)
        guard text.isOK, let plannerText = text["text"]?.string, brief.isOK, let facts = brief["facts"]?.array else { return nil }
        return PhoneMemory(plannerText: plannerText, facts: facts.compactMap { fact in
            fact["text"]?.string.map { PhoneMemory.Fact(text: $0, kind: fact["kind"]?.string) }
        })
    }

    /// What memory holds as short lines with their keys, and what is stopped.
    func brief(_ personaKey: String) -> MemoryBrief? {
        let answer = call("memoryBrief", user: userId(personaKey))
        guard answer.isOK else { return nil }
        let lines = (answer["lines"]?.array ?? []).compactMap { line -> MemoryBrief.Line? in
            guard let group = line["group"]?.string.flatMap(MemoryBrief.Group.init(rawValue:)), let text = line["text"]?.string else { return nil }
            return MemoryBrief.Line(group: group, id: line["id"]?.string ?? "", key: line["key"]?.string, text: text)
        }
        let stopped = (answer["stopped"]?.array ?? []).compactMap { entry -> MemoryBrief.Stopped? in
            guard let key = entry["key"]?.string else { return nil }
            return MemoryBrief.Stopped(key: key, label: entry["label"]?.string ?? key)
        }
        return MemoryBrief(lines: lines, stopped: stopped)
    }

    // MARK: Stopping one fact
    // The one place that knows how a key is stopped: the bundle's `memoryForget`
    // and `memoryRestore` with `what: "stop"`. A stopped fact is deleted at once
    // and later rolls don't write it; a restored one comes back with the next
    // roll, so restoring also lets yesterday roll again.

    /// Stops one fact: it isn't sent again until restored.
    @discardableResult
    func stop(key: String, personaKey: String) -> Bool {
        change("memoryForget", userId(personaKey), ["what": "stop", "key": .string(key)])
    }

    @discardableResult
    func restore(key: String, personaKey: String) -> Bool {
        let user = userId(personaKey)
        remember(nil, for: user)
        return change("memoryRestore", user, ["what": "stop", "key": .string(key)])
    }

    /// What can be forgotten and what is forgotten now.
    func state(_ personaKey: String) -> MemoryState? {
        let answer = call("memoryState", user: userId(personaKey))
        guard answer.isOK else { return nil }
        func list(_ key: String) -> [String] { answer[key]?.array?.compactMap(\.string) ?? [] }
        return MemoryState(days: list("days"), types: list("types"), stoppedTypes: list("stoppedTypes"),
                           forgottenDays: list("forgottenDays"), forgottenKinds: list("forgottenKinds"))
    }

    /// Forgets what the person asked. The next sync rolls yesterday again, so
    /// the totals are rebuilt without it.
    @discardableResult
    func forget(_ what: Forget, personaKey: String, input: MemoryInput? = nil) -> Bool {
        let user = userId(personaKey)
        let done: Bool
        switch what {
        case .day(let date):
            // With the current data alongside, the table is worked out again without that day instead of emptied.
            var arguments: [String: JSONValue] = ["what": "day", "date": .string(date)]
            if let input { arguments["snapshot"] = input.snapshot(exportDate: input.now) }
            done = change("memoryForget", user, arguments)
        case .type(let type): done = change("memoryForget", user, ["what": "type", "type": .string(type)])
        case .everything:
            done = Self.computedKinds.allSatisfy { change("memoryForget", user, ["what": "derived", "kind": .string($0)]) }
        }
        remember(nil, for: user)
        return done
    }

    /// Lets memory write a stopped kind of fact, or everything computed, again.
    @discardableResult
    func restore(_ what: Restore, personaKey: String) -> Bool {
        let user = userId(personaKey)
        let done: Bool
        switch what {
        case .type(let type): done = change("memoryRestore", user, ["what": "type", "type": .string(type)])
        case .everything:
            done = Self.computedKinds.allSatisfy { change("memoryRestore", user, ["what": "derived", "kind": .string($0)]) }
        }
        remember(nil, for: user)
        return done
    }

    private static let computedKinds = ["profile", "rolling"]

    private func change(_ name: String, _ user: String, _ arguments: [String: JSONValue]) -> Bool {
        call(name, user: user, arguments).isOK
    }

    private func roll(_ user: String, snapshot: JSONValue, now: String) -> Bool {
        call("memoryRoll", user: user, ["snapshot": snapshot, "now": .string(now)]).isOK
    }

    private static func rolledFile(_ root: String) -> URL { URL(filePath: root).appending(path: "rolled.json") }

    /// Saves (or, with nil, clears) the midnight last rolled for a person.
    private func remember(_ midnight: String?, for user: String) {
        rolled[user] = midnight
        try? JSONEncoder().encode(rolled).write(to: Self.rolledFile(root), options: .atomic)
    }

    // MARK: The daily memory agent

    /// Calls one of the memory agent's functions for a person, with JSON in and out.
    func agentCall(_ name: String, personaKey: String, _ more: [String: JSONValue] = [:]) -> JSONValue {
        call(name, user: userId(personaKey), more)
    }

    /// Every call into the bundle: one of its functions, for one person's folder. It is made in place, since
    /// the engine is already on the bundle's actor. A failure comes back as `{ok: false, error: {code, text}}`.
    private func call(_ name: String, user: String, _ more: [String: JSONValue] = [:]) -> JSONValue {
        var arguments = more
        arguments["root"] = .string(root)
        arguments["user"] = .string(user)
        return bundle.assumeIsolated { $0.call(name, .object(arguments)) }
    }

    /// Lets the day roll and be consolidated again (after something was restored).
    func forgetRolled(_ personaKey: String) {
        remember(nil, for: userId(personaKey))
    }

    /// The rows this person rejected, kept beside the store: the table lists
    /// only rows in use, and "Stopped" and Restore need the ones that aren't.
    func rejectedRows(_ personaKey: String) -> [MemoryRow] {
        (try? JSONDecoder().decode([MemoryRow].self, from: Data(contentsOf: rejectedFile(personaKey)))) ?? []
    }

    func setRejectedRows(_ rows: [MemoryRow], personaKey: String) {
        try? JSONEncoder().encode(rows).write(to: rejectedFile(personaKey), options: .atomic)
    }

    private func rejectedFile(_ personaKey: String) -> URL {
        URL(filePath: root).appending(path: "rejected-\(userId(personaKey)).json")
    }
}
