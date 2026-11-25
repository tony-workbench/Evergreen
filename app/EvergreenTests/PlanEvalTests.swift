import Foundation
import Testing
@testable import Evergreen

/// The planning agent on a fixed set of cases: three people in five
/// situations. Whatever the model answers, the week that is shown must hold
/// the same lines. Here the model is a script that first plans carelessly
/// and then fixes it; `RealAIEval` runs the same people and situations against
/// the real API.
struct PlanEvalTests {
    typealias F = PlanFakes

    struct Person: Sendable, CustomTestStringConvertible {
        var name: String
        var rows: [MemoryRow]
        var testDescription: String { name }

        static func slot(_ key: String, _ activity: String, _ weekday: Int, _ hour: Int, _ minutes: Int, _ said: String) -> MemoryRow {
            F.row(key, statement: said, data: ["activity": .string(activity), "weekday": .number(Double(weekday)), "hour": .number(Double(hour)), "minutes": .number(Double(minutes)), "weeksSeen": 5, "weeksTotal": 6])
        }

        /// A person as the memory engine would hand them over: the usual times, then the rows it always
        /// makes beside them (the weekly volume and the mix of activities, both worked out from those times).
        init(name: String, slots: [MemoryRow]) {
            let minutes = slots.compactMap { $0.data["minutes"]?.number }.reduce(0, +)
            var mix: [String: JSONValue] = [:]
            for slot in slots {
                guard let activity = slot.data["activity"]?.string else { continue }
                mix[activity] = .number((mix[activity]?.number ?? 0) + 4)
            }
            let key = String(name.prefix(1))
            self.init(name: name, rows: slots + [
                F.row("\(key)v", kind: "weekly_volume", statement: "\(slots.count) \(slots.count == 1 ? "workout" : "workouts") and \(Int(minutes)) minutes a week over the last 4 weeks.",
                      data: ["workoutsPerWeek": .number(Double(slots.count)), "minutesPerWeek": .number(minutes)]),
                F.row("\(key)x", kind: "mix", statement: "Workouts by activity over the last 28 days: \(mix.keys.sorted().map { "\($0) \(Int(mix[$0]?.number ?? 0))" }.joined(separator: ", ")).",
                      data: ["byActivity": .object(mix)]),
            ])
        }

        init(name: String, rows: [MemoryRow]) {
            self.name = name
            self.rows = rows
        }

        /// Four weeks of workouts that are the person's usual times, as Apple Health would hold them, and the nights behind them.
        /// Under a high load the last week has half as much again; after poor sleep the last seven nights are short.
        func history(_ situation: Situation, now: Date, calendar: Calendar) -> HistoryPayload {
            let types: [String: String] = ["run": "Running", "long_run": "Running", "walk": "Walking", "yoga": "Yoga", "strength": "TraditionalStrengthTraining"]
            let today = calendar.startOfDay(for: now)
            var workouts: [Workout] = [], days: [HealthHistory.Day] = []
            for back in 1...28 {
                guard let day = calendar.date(byAdding: .day, value: -back, to: today) else { continue }
                days.append(HealthHistory.Day(date: day, sleepMin: situation == .poorSleep && back <= 7 ? 306 : 432, restingHeartRate: 56))
                let weekday = (calendar.component(.weekday, from: day) + 5) % 7
                for slot in rows where slot.kind == "usual_slot" && slot.data["weekday"]?.number == Double(weekday) {
                    guard let hour = slot.data["hour"]?.number, let minutes = slot.data["minutes"]?.number, let activity = slot.data["activity"]?.string,
                          let start = calendar.date(bySettingHour: Int(hour), minute: 0, second: 0, of: day) else { continue }
                    // A heavy last week: every session half as long again.
                    let length = minutes * (situation == .highLoad && back <= 7 ? 1.5 : 1)
                    workouts.append(Workout(id: "\(name)-\(back)-\(slot.key)", activityType: types[activity] ?? "Other", start: start, end: start.addingTimeInterval(length * 60),
                                            effort: nil, avgHeartRate: 138, source: .health, distanceKm: activity.contains("run") ? minutes / 6 : nil, indoor: false))
                }
            }
            return HistoryPayload(workouts: workouts.sorted { $0.start < $1.start }, days: days.sorted { $0.date < $1.date }, cal: calendar)
        }

        static let all = [
            Person(name: "runner", slots: [
                slot("r1", "long_run", 6, 8, 75, "You usually do a long run on Sunday mornings."),
                slot("r2", "run", 1, 6, 40, "You usually run on Tuesday mornings."),
                slot("r3", "run", 3, 6, 40, "You usually run on Thursday mornings."),
            ]),
            Person(name: "mixed", slots: [
                slot("m1", "yoga", 2, 18, 45, "You usually do yoga on Wednesday evenings."),
                slot("m2", "strength", 0, 7, 50, "You usually lift on Monday mornings."),
                slot("m3", "run", 5, 9, 35, "You usually run on Saturday mornings."),
            ]),
            Person(name: "beginner", slots: [
                slot("b1", "walk", 5, 10, 30, "You usually walk on Saturday mornings."),
            ]),
        ]
    }

    enum Situation: String, CaseIterable, Sendable {
        case normal, highLoad, poorSleep, stoppedSlot, raceWeek

        /// The rows as this situation leaves them, and the week's cap in minutes.
        func apply(_ person: Person) -> (rows: [MemoryRow], cap: Int) {
            var rows = person.rows
            let usual = rows.compactMap { $0.data["minutes"]?.number }.reduce(0, +)
            switch self {
            case .normal:
                return (rows, Int(usual * 1.1))
            case .highLoad:
                rows.append(F.row("load", kind: "load", statement: "Training is 40% above your usual.", data: ["minutes7d": .number(usual * 1.4), "ratioToUsual": 1.4]))
                return (rows, Int(usual * 0.7))
            case .poorSleep:
                rows.append(F.row("sleep", kind: "sleep", statement: "You slept about 5 hours a night this week.", data: ["hours7d": 5.1, "hours28d": 7.2]))
                return (rows, Int(usual * 0.8))
            case .stoppedSlot:
                rows[0].state = "rejected"
                return (rows, Int(usual * 1.1))
            case .raceWeek:
                rows.append(F.row("goal", kind: "goal", statement: "You have a 10 km race on Sunday.", data: ["what": "10 km race", "date": "2026-11-29"]))
                return (rows, Int(usual * 0.6))
            }
        }
    }

    /// A week with every remembered slot at its usual length (`careful` false: stopped ones too), or at half.
    static func scripted(_ rows: [MemoryRow], careful: Bool) -> Result<ModelReply, ModelFailure> {
        let slots = rows.filter { $0.kind == "usual_slot" && (!careful || $0.isUsable) }
        return F.answer(slots.map { row in
            let weekday = Int(row.data["weekday"]?.number ?? 0)
            let minutes = Int(row.data["minutes"]?.number ?? 30)
            return (String(format: "2026-11-%02d", 23 + weekday), String(format: "%02d:00", Int(row.data["hour"]?.number ?? 7)),
                    row.data["activity"]?.string ?? "walk", careful ? max(5, minutes / 2) : minutes, [row.key])
        })
    }

    /// The eval's people are made of the rows the memory engine really produces: each row holds to the
    /// contract's memory-row schema, and each person has a weekly volume and a mix that agree with their usual times.
    @Test func theEvalsPeopleAreMadeOfRealMemoryRows() async throws {
        let file = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../contract/schemas/memory-row.schema.json")
        let schema = try #require(JSONValue.parse(String(decoding: try Data(contentsOf: file), as: UTF8.self)))
        let kinds = try #require(schema["oneOf"]?.array)
        func problems(_ row: MemoryRow) -> [String] {
            var wrong: [String] = []
            for (field, value) in [("group", row.group), ("kind", row.kind), ("state", row.state)]
            where schema["properties"]?[field]?["enum"]?.array?.contains(.string(value)) != true { wrong.append("\(field) \(value)") }
            for field in ["memoryId", "key", "slot", "statement"] where JSONValue.from(row)[field]?.string?.isEmpty != false { wrong.append("empty \(field)") }
            for day in [row.since, row.updated] where day.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) == nil { wrong.append("day \(day)") }
            guard let data = kinds.first(where: { $0["properties"]?["kind"]?["const"]?.string == row.kind })?["properties"]?["data"] else { return wrong + ["no schema for \(row.kind)"] }
            let given = Set(row.data.object?.keys.map { $0 } ?? [])
            for name in data["required"]?.array?.compactMap(\.string) ?? [] where !given.contains(name) { wrong.append("\(row.kind) without \(name)") }
            if data["additionalProperties"] == .bool(false), let allowed = data["properties"]?.object?.keys {
                for name in given.subtracting(allowed) { wrong.append("\(row.kind) with unknown \(name)") }
            }
            return wrong
        }
        let rules = BundlePlanRules(bundle: AppModel.planBundle, history: HistoryPayload(workouts: [], days: [], cal: .current), busy: [], timeZone: TimeZone(secondsFromGMT: -8 * 3600) ?? .current)
        for person in Person.all {
            for situation in Situation.allCases {
                let rows = situation.apply(person).rows
                #expect(rows.flatMap(problems).isEmpty, "\(person.name)/\(situation.rawValue): \(rows.flatMap(problems))")
                // The rules take the session limit from the weekly volume: one more than the person usually does.
                let volume = try #require(rows.first { $0.kind == "weekly_volume" && $0.isUsable })
                let context = await rules.planContext(rows: rows, now: F.now)
                #expect(context["maxSessions"]?.number == (volume.data["workoutsPerWeek"]?.number ?? 0).rounded(.up) + 1, "\(person.name)/\(situation.rawValue): \(context["maxSessions"]?.text ?? "none")")
            }
            let slots = person.rows.filter { $0.kind == "usual_slot" }
            let volume = try #require(person.rows.first { $0.kind == "weekly_volume" })
            #expect(volume.data["workoutsPerWeek"]?.number == Double(slots.count))
            #expect(volume.data["minutesPerWeek"]?.number == slots.compactMap { $0.data["minutes"]?.number }.reduce(0, +))
            let mix = try #require(person.rows.first { $0.kind == "mix" }?.data["byActivity"]?.object)
            #expect(Set(mix.keys) == Set(slots.compactMap { $0.data["activity"]?.string }))
        }
    }

    /// What must hold for any week that is shown.
    static func check(_ week: PlanAgent.Week, rows: [MemoryRow], cap: Int, _ label: String) {
        let usable = Set(rows.filter(\.isUsable).map(\.key))
        #expect(week.sessions.reduce(0) { $0 + $1.minutes } <= cap, "\(label): over the cap")
        #expect(week.sessions.allSatisfy { Set($0.basedOn).isSubset(of: usable) }, "\(label): rests on a key it may not use")
        #expect(week.sessions.allSatisfy { !$0.reason.isEmpty && (5...240).contains($0.minutes) || $0.activity == .rest }, "\(label): a session is malformed")
        #expect(week.sessions.allSatisfy { ("2026-11-22"..."2026-11-29").contains($0.day) }, "\(label): outside the 7 days")
    }

    @Test(arguments: Person.all, Situation.allCases)
    func everyShownWeekHoldsTheLines(person: Person, situation: Situation) async {
        let (rows, cap) = situation.apply(person)
        let model = ScriptedModel([Self.scripted(rows, careful: false), Self.scripted(rows, careful: true)])
        let rules = CapRules(capMinutes: cap, fallback: [F.session("2026-11-23", "07:00", .walk, 20, reason: "An easy walk.")])
        let week = await F.agent(model, rules: rules, rows: rows).week()
        Self.check(week, rows: rows, cap: cap, "\(person.name)/\(situation.rawValue)")
        // The careless first week only passes when nothing is in its way.
        #expect(week.source == .agent)
        #expect(week.revisions == (situation == .normal ? 0 : 1))
    }
}
