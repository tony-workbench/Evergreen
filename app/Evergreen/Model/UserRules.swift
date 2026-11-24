import Foundation
import os

/// The rules the person set: what they said, kept as they said it and never
/// worked out from data. Memory is what Evergreen noticed; these are what the
/// person decided, so they live apart, in UserDefaults under `user_rules`.
///
/// Answering "How you train", skipping it (the defaults below) or importing a
/// profile turns them on. Until then, and for someone who trains "somewhere
/// else", `isOn` is false and the planner keeps its usual week.
struct UserRules: Codable, Equatable, Sendable {
    static let storeKey = "user_rules"

    /// What a movement is to the person: not tried yet, can do it, can't do it (plan 5.C.1). "Can't do" is never planned or
    /// offered as a swap: the easier one on its chain comes instead, until the person changes it in My rules.
    enum MovementState: String, Codable, Sendable, CaseIterable {
        case untried, can, cannot

        var title: String {
            switch self {
            case .untried: "Not tried yet"
            case .can: "I can do it"
            case .cannot: "Can’t do yet"
            }
        }
    }

    /// Things to train with at home. Floor and wall are always there.
    enum Equipment: String, Codable, Sendable, CaseIterable, Identifiable {
        case backpack, chair, table, sofa, book, step
        var id: String { rawValue }
        var title: String {
            switch self {
            case .backpack: "Backpack"
            case .chair: "Sturdy chair"
            case .table: "Sturdy table"
            case .sofa: "Sofa"
            case .book: "Thick book"
            case .step: "A step or stairs"
            }
        }
    }

    /// True once the person answered "How you train" or imported a profile.
    var isOn = false
    /// Weekdays never planned, Monday = 0 … Sunday = 6 (the engine's numbering).
    var restWeekdays: [Int] = [2, 5, 6]
    var sessionMin = 20
    var sessionMax = 25
    /// The earliest and latest start, as "HH:MM".
    var windowFrom = "12:00"
    var windowTo = "20:30"
    /// Off unless the person turns it on: mornings let a session start from 06:00.
    var mornings = false
    var equipment: [Equipment] = Equipment.allCases
    /// Movement ids the person never wants planned.
    var avoid: [String] = []
    /// Movement id -> what it is to the person.
    var movements: [String: MovementState] = [:]
    /// Where home is, set once from the phone's own location. Never leaves the phone.
    var home: HomePlace?
    /// How far from home the phone has to be, when the app is opened, for today to count as a day out.
    var farKilometres: Double = HomePlace.defaultFarKilometres

    // MARK: Saved

    static func load(from defaults: UserDefaults = .standard) -> UserRules {
        guard let data = defaults.data(forKey: storeKey) else { return UserRules() }
        return Logger.model.attempt("The saved rules couldn't be read; the defaults stand") {
            try JSONDecoder().decode(UserRules.self, from: data)
        } ?? UserRules()
    }

    func save(to defaults: UserDefaults = .standard) {
        if let data = Logger.model.attempt("The rules couldn't be kept", { try JSONEncoder().encode(self) }) {
            defaults.set(data, forKey: Self.storeKey)
        }
    }

    // MARK: To the engine

    /// The rules as the plan engine reads them (`recommend-agent/src/rules.mjs`). Home and the far line stay on the phone.
    var engineValue: JSONValue {
        var fields: [String: JSONValue] = [
            "restWeekdays": .array(restWeekdays.sorted().map { .number(Double($0)) }),
            "sessionMinutes": ["min": .number(Double(sessionMin)), "max": .number(Double(sessionMax))],
            "window": ["from": .string(windowFrom), "to": .string(windowTo)],
            "mornings": .bool(mornings),
            "equipment": .array(equipment.map { .string($0.rawValue) }),
            "avoid": .array(avoid.map { .string($0) }),
        ]
        fields["movements"] = .object(movements.mapValues { .string($0.rawValue) })
        return .object(fields)
    }

    /// One line for the week cache's key: a changed rule plans the week again.
    var cacheText: String {
        guard isOn else { return "" }
        let states = movements.map { "\($0.key)=\($0.value.rawValue)" }.sorted().joined(separator: ",")
        return [restWeekdays.sorted().map(String.init).joined(separator: ","), "\(sessionMin)-\(sessionMax)", windowFrom, windowTo,
                mornings ? "m" : "", equipment.map(\.rawValue).sorted().joined(separator: ","), avoid.sorted().joined(separator: ","), states]
            .joined(separator: "|")
    }

    // MARK: For the screens

    static let weekdayShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    /// Monday = 0 … Sunday = 6.
    static let weekdays = 0...6

    var restDaysText: String {
        restWeekdays.isEmpty ? "None" : restWeekdays.sorted().map { Self.weekdayShort[$0] }.joined(separator: "  ")
    }

    var lengthText: String { sessionMin == sessionMax ? "\(sessionMax) min" : "\(sessionMin)–\(sessionMax) min" }

    /// The hour notifications may start: 09:00, or the hour the person's own sessions may start when that is earlier.
    var notificationsFrom: Int {
        let start = mornings ? NotificationBudget.earliestSessionHour : (Self.minutes(windowFrom) ?? 0) / ClockUnits.minutesPerHour
        return max(NotificationBudget.earliestSessionHour, min(NotificationBudget.quietUntilHour, start))
    }

    var windowText: String { "\(mornings ? "06:00" : windowFrom) – \(windowTo)" }

    var equipmentText: String {
        equipment.isEmpty ? "None" : "None · " + equipment.map(\.title).joined(separator: " · ")
    }

    /// Calendar weekdays run 1 (Sunday) to 7 (Saturday): adding this and wrapping at a week makes Monday 0 and Sunday 6.
    private static let mondayFirstShift = 5

    /// The weekday of a date in the engine's numbering (Monday = 0).
    static func weekdayIndex(_ date: Date, calendar: Calendar) -> Int {
        (calendar.component(.weekday, from: date) + mondayFirstShift) % ClockUnits.daysPerWeek
    }

    func isRestDay(_ date: Date, calendar: Calendar) -> Bool {
        restWeekdays.contains(Self.weekdayIndex(date, calendar: calendar))
    }

    // MARK: Movements

    /// What a movement is to the person; "not tried yet" when nothing was said.
    func state(of id: String) -> MovementState { movements[id] ?? .untried }

    /// Sets what a movement is to the person. "Not tried yet" is kept as nothing said, as older rules saved it.
    mutating func setState(_ state: MovementState, of id: String) {
        movements[id] = state == .untried ? nil : state
    }

    // MARK: Checks

    static let shortestSession = 10
    static let longestSession = 90
    /// The session steppers move by this many minutes.
    static let sessionStep = 5

    /// What can be wrong with the rules, each said beside the answer it is about as soon as it is wrong.
    enum Problem: Equatable, Sendable {
        case restDays, shortest, lengths, longest, clock, window, movements

        var words: String {
            switch self {
            case .restDays: "A rest day here isn’t a weekday. Pick the days again."
            case .shortest: "The shortest session is \(UserRules.shortestSession) minutes at least."
            case .lengths: "The longest session is shorter than the shortest one. Make it at least as long."
            case .longest: "The longest session is \(UserRules.longestSession) minutes at most."
            case .clock: "A time here couldn’t be read. Pick it again."
            case .window: "“Latest start” is before “From”. Move one of them so the hours don’t cross."
            case .movements: "A movement in these rules isn’t one the app knows. Import the profile again."
            }
        }
    }

    /// Everything wrong with the rules, in the order the screen shows the answers; empty when they make sense.
    var problems: [Problem] {
        var found: [Problem] = []
        if !restWeekdays.allSatisfy({ Self.weekdays.contains($0) }) { found.append(.restDays) }
        if sessionMin < Self.shortestSession { found.append(.shortest) }
        if sessionMax < sessionMin { found.append(.lengths) }
        if sessionMax > Self.longestSession { found.append(.longest) }
        if let from = Self.minutes(windowFrom), let to = Self.minutes(windowTo) {
            if to < from { found.append(.window) }
        } else {
            found.append(.clock)
        }
        if !(avoid.allSatisfy(Self.isMovementId) && movements.keys.allSatisfy(Self.isMovementId)) { found.append(.movements) }
        return found
    }

    /// Whether the rules make sense, so the screens never save one the engine would refuse.
    var isValid: Bool { problems.isEmpty }

    /// "HH:MM" is five characters.
    private static let clockLength = 5
    /// A movement id is at most this long.
    private static let longestMovementId = 48

    static func minutes(_ clock: String) -> Int? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count == ClockUnits.clockParts, (0..<ClockUnits.hoursPerDay).contains(parts[0]), (0..<ClockUnits.minutesPerHour).contains(parts[1]),
              clock.count == clockLength else { return nil }
        return parts[0] * ClockUnits.minutesPerHour + parts[1]
    }

    static func isMovementId(_ id: String) -> Bool {
        !id.isEmpty && id.count <= longestMovementId && id.allSatisfy { ($0.isASCII && ($0.isLowercase || $0.isNumber)) || $0 == "_" }
    }

    // MARK: Importing a profile

    /// A profile file the person made away from the app and imports once (Settings › My rules › Import a profile…).
    /// Every field is optional; what is there replaces the answer, what isn't keeps it. Unknown fields are ignored.
    struct Profile: Decodable {
        var restWeekdays: [Int]?
        var sessionMinutes: Length?
        var window: Window?
        var mornings: Bool?
        var equipment: [String]?
        var avoid: [String]?
        var movements: [String: MovementState]?
        var farKilometres: Double?

        struct Length: Decodable { var min: Int; var max: Int }
        struct Window: Decodable { var from: String; var to: String }
    }

    enum ImportError: Error, Equatable {
        case unreadable
        case outOfRange
    }

    /// The rules with a profile's answers in them, turned on. Throws without changing anything when a value can't be used,
    /// a movement id that isn't in `library` (the movement library's ids, when it could be read) included.
    func importing(_ data: Data, library: Set<String> = []) throws -> UserRules {
        guard let profile = Logger.model.attempt("The rules file couldn't be read", { try JSONDecoder().decode(Profile.self, from: data) }) else {
            throw ImportError.unreadable
        }
        var rules = self
        rules.isOn = true
        rules.takeSchedule(from: profile)
        try rules.takeEquipment(from: profile)
        try rules.takeMovements(from: profile, library: library)
        guard rules.isValid else { throw ImportError.outOfRange }
        return rules
    }

    /// The days, session length, hours and mornings a profile gives.
    private mutating func takeSchedule(from profile: Profile) {
        if let days = profile.restWeekdays { restWeekdays = Array(Set(days)).sorted() }
        if let length = profile.sessionMinutes { sessionMin = length.min; sessionMax = length.max }
        if let window = profile.window { windowFrom = window.from; windowTo = window.to }
        if let mornings = profile.mornings { self.mornings = mornings }
    }

    /// What the person has and how far is "far from home". Floor and wall are always there; anything else the app
    /// doesn't know is refused, not dropped.
    private mutating func takeEquipment(from profile: Profile) throws {
        if let owned = profile.equipment {
            let known = owned.compactMap(Equipment.init(rawValue:))
            guard known.count == owned.filter({ !Self.alwaysThere.contains($0) }).count else { throw ImportError.outOfRange }
            equipment = Equipment.allCases.filter(known.contains)
        }
        if let far = profile.farKilometres {
            guard far > 0, far <= Self.mostFarKilometres else { throw ImportError.outOfRange }
            farKilometres = far
        }
    }

    /// Movements to leave out and each movement's state; every id has to be in the library when it could be read.
    private mutating func takeMovements(from profile: Profile, library: Set<String>) throws {
        let named = (profile.avoid ?? []) + (profile.movements.map { Array($0.keys) } ?? [])
        guard library.isEmpty || named.allSatisfy(library.contains) else { throw ImportError.outOfRange }
        if let avoid = profile.avoid { self.avoid = Array(Set(avoid)).sorted() }
        if let states = profile.movements { movements.merge(states) { _, new in new } }
    }

    private static let alwaysThere: Set<String> = ["floor", "wall"]
    private static let mostFarKilometres = 500.0
}

extension UserRules {
    enum CodingKeys: String, CodingKey {
        case isOn, restWeekdays, sessionMin, sessionMax, windowFrom, windowTo, mornings, equipment, avoid, movements, home, farKilometres
    }

    /// Reads saved rules field by field: a field an older version didn't save, or one this version can't read, takes its
    /// default, so adding a rule later never wipes or turns off the ones already saved.
    init(from decoder: any Decoder) throws {
        self.init()
        let saved = try decoder.container(keyedBy: CodingKeys.self)
        func read<T: Decodable>(_ key: CodingKeys, _ type: T.Type) -> T? { saved.field(type, key) }
        isOn = read(.isOn, Bool.self) ?? isOn
        restWeekdays = read(.restWeekdays, [Int].self) ?? restWeekdays
        sessionMin = read(.sessionMin, Int.self) ?? sessionMin
        sessionMax = read(.sessionMax, Int.self) ?? sessionMax
        windowFrom = read(.windowFrom, String.self) ?? windowFrom
        windowTo = read(.windowTo, String.self) ?? windowTo
        mornings = read(.mornings, Bool.self) ?? mornings
        equipment = read(.equipment, [String].self).map { $0.compactMap(Equipment.init(rawValue:)) } ?? equipment
        avoid = read(.avoid, [String].self) ?? avoid
        movements = read(.movements, [String: String].self).map { $0.compactMapValues(MovementState.init(rawValue:)) } ?? movements
        home = read(.home, HomePlace.self) ?? home
        farKilometres = read(.farKilometres, Double.self) ?? farKilometres
    }
}
