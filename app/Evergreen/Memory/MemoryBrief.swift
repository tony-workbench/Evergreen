import Foundation

/// The bundle's brief (`memoryBrief`): what memory holds as short lines in
/// two groups, each with the key that stops it, and what the person stopped.
/// The bundle's own wording is what is sent; `sentence` is how each line is
/// said to the person.
struct MemoryBrief: Equatable, Sendable {
    enum Group: String, CaseIterable, Identifiable, Sendable {
        case routine, body

        var id: String { rawValue }
        var title: String { self == .routine ? "Your routine" : "Your body" }
    }

    struct Line: Equatable, Sendable {
        var group: Group
        /// What kind of line it is: usual_time, workouts_per_week, mix, recent_weeks, load, sleep, resting_hr, thin.
        var id: String
        /// What can be stopped; nil for a line that can't (the thin-history line).
        var key: String?
        /// The line as it is sent.
        var text: String

        /// The usual time a `usual_time` line is about, read from its text.
        var usualTime: UsualTime? { id == "usual_time" ? UsualTime(line: text) : nil }

        /// What the line is about, in a few words: "Sunday 6 AM runs", "Sleep".
        var title: String {
            switch id {
            case "usual_time": usualTime?.title ?? text
            case "sleep": "Sleep"
            case "resting_hr": "Resting heart rate"
            case "load": "Training load"
            case "workouts_per_week": "Workouts per week"
            case "mix": "Workouts by type"
            case "recent_weeks": "Recent weeks"
            default: text
            }
        }

        /// The line as a sentence for the person, built from its numbers. A
        /// line whose numbers can't be read is shown as it is sent.
        var sentence: String {
            func numbers(_ pattern: Regex<(Substring, Substring, Substring)>) -> (Double, Double)? {
                text.firstMatch(of: pattern).flatMap { found in
                    Double(found.1).flatMap { a in Double(found.2).map { (a, $0) } }
                }
            }
            switch id {
            case "usual_time":
                guard let usual = usualTime else { return text }
                return "You usually \(usual.verb) \(usual.weekdayName) around \(PlainWords.clock(usual.hour))."
            case "workouts_per_week":
                guard let found = text.firstMatch(of: /Workouts: ([\d.]+) a week/) else { return text }
                return "You do about \(found.1) workouts a week."
            case "mix":
                guard let found = text.wholeMatch(of: /Mix over 4 weeks: (.+)\./) else { return text }
                let parts = found.1.split(separator: ", ").map { part -> String in
                    guard let item = part.wholeMatch(of: /(.+) (\d+)/) else { return String(part) }
                    return "\(item.2) \(item.1.lowercased())"
                }
                return "In the last 4 weeks: \(parts.joined(separator: ", "))."
            case "recent_weeks":
                guard let found = text.wholeMatch(of: /Last (\d+) fully logged weeks?: (.+) workouts\./) else { return text }
                return "Your last \(found.1) full weeks: \(found.2) workouts."
            case "load":
                guard let ratio = text.firstMatch(of: /([\d.]+)× the 28-day weekly average/).flatMap({ Double($0.1) }) else { return text }
                let percent = Int(((ratio - 1) * 100).rounded())
                return abs(percent) < 3 ? "This week's training is about your usual."
                    : "This week's training is \(abs(percent))% \(percent > 0 ? "above" : "below") your usual."
            case "sleep":
                guard let (now, usual) = numbers(/Average sleep: ([\d.]+) h a night over 7 days \(28-day average ([\d.]+) h\)/) else { return text }
                return "You sleep about \(Self.short(now)) hours a night, \(Self.against(now, usual, close: 0.3)) \(Self.short(usual))."
            case "resting_hr":
                guard let (now, usual) = numbers(/Resting heart rate: ([\d.]+) bpm over 7 days \(28-day average ([\d.]+) bpm\)/) else { return text }
                return "Your resting heart rate is about \(Self.short(now)), \(Self.against(now, usual, close: 2)) \(Self.short(usual))."
            case "thin":
                guard let found = text.firstMatch(of: /(\d+) days? of data/) else { return text }
                return "I have \(found.1) \(found.1 == "1" ? "day" : "days") of your workouts so far. Two weeks in, this fills up."
            default:
                return text
            }
        }

        /// "close to your usual", "up from your usual" or "down from your usual".
        private static func against(_ now: Double, _ usual: Double, close: Double) -> String {
            abs(now - usual) < close ? "close to your usual" : now > usual ? "up from your usual" : "down from your usual"
        }

        /// "8.7", "49": no trailing ".0".
        private static func short(_ value: Double) -> String {
            value == value.rounded() ? String(Int(value)) : String(value)
        }
    }

    struct Stopped: Equatable, Sendable {
        var key: String
        /// "Running, Sunday 8 AM"
        var label: String

        /// The same few words a line has for it: "Sunday 8 AM runs", "Sleep".
        var title: String {
            UsualTime(label: label)?.title ?? (label == "Activity mix" ? "Workouts by type" : label)
        }
    }

    var lines: [Line] = []
    var stopped: [Stopped] = []

    func lines(_ group: Group) -> [Line] { lines.filter { $0.group == group } }

    /// Weekdays with a usual time, 1 (Monday) to 7 (Sunday).
    var usualWeekdays: Set<Int> {
        Set(lines.compactMap { $0.usualTime?.weekday })
    }

    /// Days of data, when there are fewer than 14 and memory says nothing else yet ("9 days of data, fewer than 14.").
    var thinDays: Int? {
        lines.first { $0.id == "thin" }.flatMap { $0.text.firstMatch(of: /(\d+) days? of data/) }.flatMap { Int($0.1) }
    }

    /// One line of "What I noticed", with the memory key behind it when the
    /// person can answer it "Not true for me".
    struct NoticedLine: Equatable, Identifiable, Sendable {
        var text: String
        var key: String? = nil
        /// Who the line is in the list: its memory key, or else its words (with
        /// how often they came before, when two lines read the same), so a
        /// line keeps its identity when another line is removed.
        var id: String

        /// Lines without a key, each told apart by its words and, when the
        /// words repeat, by how many times they came before.
        static func plain(_ texts: [String]) -> [NoticedLine] {
            zip(texts, TextIdentity.ids(texts)).map { NoticedLine(text: $0, id: $1) }
        }
    }

    /// The first screen's "What I noticed" shows this many lines at most.
    static let noticedMost = 3
    /// A line short enough for that screen has this many words or fewer.
    static let shortLineWords = 8
    /// Before this hour is a morning, before `eveningHour` an afternoon, then an evening.
    private static let afternoonHour = 12
    private static let eveningHour = 17

    /// At most three short lines (8 words or fewer) for the first screen: what
    /// Evergreen already knows. With under 14 days of data, a friendly version that says so.
    var noticed: [String] {
        if let thinDays { return Self.thinLines(thinDays) }
        let found = shortLines
        return found.isEmpty
            ? ["I don't have your history yet.", "A few workouts and I'll learn your routine.", "Until then, a gentle week to start."]
            : Array(found.prefix(Self.noticedMost))
    }

    /// The same first screen with the memory table's rows: where the person
    /// trains, when memory holds it ("You train at home, without gym
    /// equipment."), takes the third place and can be answered "Not true for
    /// me" by its key. A row kind this code doesn't know changes nothing.
    func noticedLines(rows: [MemoryRow]) -> [NoticedLine] {
        let brief = NoticedLine.plain(noticed)
        guard thinDays == nil, let home = rows.first(where: { $0.kind == "training_place" && $0.isUsable }) else { return brief }
        let place = NoticedLine(text: RowWords.sentence(home), key: home.key, id: home.key)
        // The place takes the last of the screen's lines.
        return NoticedLine.plain(Array(shortLines.prefix(Self.noticedMost - 1))) + [place]
    }

    private static func thinLines(_ days: Int) -> [String] {
        [
            "I have \(days) \(days == 1 ? "day" : "days") of your workouts.",
            "Two more weeks and I'll know your routine.",
            "Until then, a gentle week to start.",
        ]
    }

    /// What the brief's lines say in 8 words or fewer, best first.
    private var shortLines: [String] {
        func line(_ id: String) -> Line? { lines.first { $0.id == id } }
        let usual = line("usual_time")?.usualTime.map {
            "You usually \($0.verb) \($0.weekdayName) \(Self.partOfDay($0.hour))."
        }
        // The first clause of the sleep sentence is short enough on its own.
        let sleep = line("sleep").map(\.sentence).flatMap { $0.contains(",") ? String($0.prefix { $0 != "," }) + "." : nil }
        return [usual, line("load")?.sentence, sleep, line("workouts_per_week")?.sentence].compactMap(\.self)
            .filter { $0.split(separator: " ").count <= Self.shortLineWords }
    }

    /// "mornings", "afternoons" or "evenings" for an hour of the day.
    private static func partOfDay(_ hour: Int) -> String {
        hour < afternoonHour ? "mornings" : hour < eveningHour ? "afternoons" : "evenings"
    }
}
