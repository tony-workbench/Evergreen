import Foundation

/// The rules the person set: what they said, kept as they said it and never
/// worked out from data. Memory is what Evergreen noticed; these are what the
/// person decided, so they live apart, in UserDefaults under `user_rules`.
///
/// Answering "How you train", skipping it (the defaults below) or importing a
/// profile turns them on. Until then, and for someone who trains "somewhere
/// else", `isOn` is false and the planner keeps its usual week.
struct UserRules: Codable, Equatable, Sendable {
    static let storeKey = "user_rules"

    /// What a movement is to the person: not tried yet, can do it, can't do it.
    enum MovementState: String, Codable, Sendable, CaseIterable {
        case untried, can, cannot
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
        guard let data = defaults.data(forKey: storeKey), let rules = try? JSONDecoder().decode(UserRules.self, from: data) else { return UserRules() }
        return rules
    }

    func save(to defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.storeKey) }
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

    var restDaysText: String {
        restWeekdays.isEmpty ? "None" : restWeekdays.sorted().map { Self.weekdayShort[$0] }.joined(separator: "  ")
    }

    var lengthText: String { sessionMin == sessionMax ? "\(sessionMax) min" : "\(sessionMin)–\(sessionMax) min" }

    var windowText: String { "\(mornings ? "06:00" : windowFrom) – \(windowTo)" }

    var equipmentText: String {
        equipment.isEmpty ? "None" : "None · " + equipment.map(\.title).joined(separator: " · ")
    }

    /// The weekday of a date in the engine's numbering (Monday = 0).
    static func weekdayIndex(_ date: Date, calendar: Calendar) -> Int {
        (calendar.component(.weekday, from: date) + 5) % 7
    }

    func isRestDay(_ date: Date, calendar: Calendar) -> Bool {
        restWeekdays.contains(Self.weekdayIndex(date, calendar: calendar))
    }

    // MARK: Checks

    /// Whether the rules make sense, so the screens never save one the engine would refuse.
    var isValid: Bool {
        guard restWeekdays.allSatisfy({ (0...6).contains($0) }), sessionMin >= 10, sessionMax >= sessionMin, sessionMax <= 90,
              let from = Self.minutes(windowFrom), let to = Self.minutes(windowTo), to >= from else { return false }
        return avoid.allSatisfy(Self.isMovementId) && movements.keys.allSatisfy(Self.isMovementId)
    }

    static func minutes(_ clock: String) -> Int? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]), clock.count == 5 else { return nil }
        return parts[0] * 60 + parts[1]
    }

    static func isMovementId(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 48 && id.allSatisfy { ($0.isASCII && ($0.isLowercase || $0.isNumber)) || $0 == "_" }
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

    /// The rules with a profile's answers in them, turned on. Throws without changing anything when a value can't be used.
    func importing(_ data: Data) throws -> UserRules {
        guard let profile = try? JSONDecoder().decode(Profile.self, from: data) else { throw ImportError.unreadable }
        var rules = self
        rules.isOn = true
        if let days = profile.restWeekdays { rules.restWeekdays = Array(Set(days)).sorted() }
        if let length = profile.sessionMinutes { rules.sessionMin = length.min; rules.sessionMax = length.max }
        if let window = profile.window { rules.windowFrom = window.from; rules.windowTo = window.to }
        if let mornings = profile.mornings { rules.mornings = mornings }
        if let owned = profile.equipment {
            let known = owned.compactMap(Equipment.init(rawValue:))
            // Floor and wall are always there; anything else the app doesn't know is refused, not dropped.
            guard known.count == owned.filter({ !["floor", "wall"].contains($0) }).count else { throw ImportError.outOfRange }
            rules.equipment = Equipment.allCases.filter(known.contains)
        }
        if let avoid = profile.avoid { rules.avoid = Array(Set(avoid)).sorted() }
        if let states = profile.movements { rules.movements.merge(states) { _, new in new } }
        if let far = profile.farKilometres {
            guard far > 0, far <= 500 else { throw ImportError.outOfRange }
            rules.farKilometres = far
        }
        guard rules.isValid else { throw ImportError.outOfRange }
        return rules
    }
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
        func read<T: Decodable>(_ key: CodingKeys, _ type: T.Type) -> T? { (try? saved.decodeIfPresent(type, forKey: key)) ?? nil }
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
