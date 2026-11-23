import Foundation

/// What a calendar sentence plainly says, read by code: the day, the part of
/// the day, a time, a length, a distance. Used only to fill a field of the
/// intent that the model left empty; a value the model gave is never changed.
struct SentenceFacts: Equatable, Sendable {
    var day: String?
    var partOfDay: String?
    var after: String?
    var minutes: Int?
    var distanceKm: Double?

    static let weekdays: [(names: [String], index: Int)] = [
        (["monday", "mon"], 0), (["tuesday", "tues", "tue"], 1), (["wednesday", "wed"], 2), (["thursday", "thurs", "thu"], 3),
        (["friday", "fri"], 4), (["saturday", "sat"], 5), (["sunday", "sun"], 6),
    ]

    /// `today` is the local day, YYYY-MM-DD. For a move, the day is where it moves to (the day named after "to"), not the day it is on now.
    init(_ sentence: String, today: String, moving: Bool = false) {
        let said = " " + sentence.lowercased().replacing("’", with: "'") + " "
        let words = said.split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != ":" && $0 != "." && $0 != "'" }).map(String.init)

        // Part of the day.
        if said.contains("morning") { partOfDay = "morning" }
        else if said.contains("afternoon") || said.contains("lunch") { partOfDay = "afternoon" }
        else if said.contains("evening") || said.contains("tonight") || said.contains("tonite") { partOfDay = "evening" }

        // The day: for a move, only what follows "to"; otherwise the first day named.
        let scope = moving ? (said.range(of: " to ").map { String(said[$0.upperBound...]) } ?? "") : said
        day = Self.day(in: scope, today: today)

        // A time, after a word that introduces one.
        for lead in ["half past ", "quarter past ", "quarter to ", "after ", "around ", "at ", "like ", "from ", "by "] {
            guard let found = said.range(of: lead) else { continue }
            let rest = String(said[found.lowerBound...]).split(separator: " ").prefix(lead.hasPrefix("half") || lead.hasPrefix("quarter") ? 6 : 4).joined(separator: " ")
            // "after 10", "at 6ish", "like 6pm", "half past six", with the part of the day when it is said.
            let phrase = rest.replacing(/\b(\d+)\s?(min|mins|minutes|minute|k|km)\b/, with: "")
            let hasHour = phrase.contains(/\d/) || TimeWords.numbers.keys.contains { phrase.split(separator: " ").contains(Substring($0)) }
            if hasHour, let clock = TimeWords.clock(phrase + (partOfDay.map { " \($0)" } ?? "")) {
                after = clock
                break
            }
        }

        // A length.
        if let found = said.firstMatch(of: /(\d+)\s?(?:minutes|minute|mins|min)\b/) { minutes = Int(found.1) }
        else if said.contains("half an hour") || said.contains("half hour") { minutes = 30 }
        else if said.contains("an hour and a half") { minutes = 90 }
        else if said.contains("an hour") || said.contains("1 hour") || said.contains("one hour") { minutes = 60 }
        else if let found = said.firstMatch(of: /(\d+)\s?(?:hours|hour|hrs|hr)\b/), let hours = Int(found.1) { minutes = hours * 60 }

        // A distance.
        if said.contains("half marathon") { distanceKm = 21.1 }
        else if said.contains("marathon") { distanceKm = 42.2 }
        else if let found = said.firstMatch(of: /(\d+(?:\.\d+)?)\s?(?:km|k)\b/) { distanceKm = Double(found.1) }
        _ = words
    }

    /// The first day named in the words, as YYYY-MM-DD on or after today.
    static func day(in words: String, today: String) -> String? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        let parts = today.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let start = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return nil }
        func day(_ offset: Int) -> String? {
            calendar.date(byAdding: .day, value: offset, to: start).map { date in
                let c = calendar.dateComponents([.year, .month, .day], from: date)
                return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
            }
        }
        let todayIndex = (calendar.component(.weekday, from: start) + 5) % 7
        // The earliest mention wins.
        var found: (at: String.Index, offset: Int)?
        func note(_ word: String, _ offset: Int) {
            if let range = words.range(of: word), found == nil || range.lowerBound < found!.at { found = (range.lowerBound, offset) }
        }
        for word in ["today", "tonight", "tonite", "this morning", "this afternoon", "this evening"] { note(word, 0) }
        for word in ["tomorrow", "tomorow", "tommorow", "tmrw"] { note(word, 1) }
        for weekday in weekdays {
            for name in weekday.names {
                // A whole word, also as "sundays" or "sunday's".
                if let range = words.range(of: #"\b\#(name)(?:'?s)?\b"#, options: .regularExpression), found == nil || range.lowerBound < found!.at {
                    found = (range.lowerBound, (weekday.index - todayIndex + 7) % 7)
                }
            }
        }
        return found.flatMap { day($0.offset) }
    }

    /// The intent with every empty field this sentence speaks to filled in.
    func filling(_ intent: CalendarIntent) -> CalendarIntent {
        var filled = intent
        if filled.kind == "race" {
            filled.distanceKm = filled.distanceKm ?? distanceKm
            return filled
        }
        if filled.kind != "cancel" {
            filled.day = filled.day ?? day
            // A time and a part of the day say the same thing twice; the time is the exact one.
            filled.after = filled.after ?? after
            if filled.after == nil, filled.before == nil { filled.partOfDay = filled.partOfDay ?? partOfDay }
            if filled.kind != "move" { filled.minutes = filled.minutes ?? minutes }
        }
        return filled
    }
}
