import Foundation

/// Sentences that ask to forget or stop something, recognised by code
/// before any model is asked: "forget everything", "delete what you know
/// about me", "forget last Tuesday", "stop planning Sunday mornings". They
/// become a confirmation card; nothing is changed until the person confirms.
enum MemoryCommand {
    static let forgetVerbs = ["forget", "delete", "erase", "wipe", "remove", "clear"]
    static let stopPhrases = ["stop remembering", "stop planning", "stop using", "stop suggesting", "don't plan", "dont plan", "do not plan", "no more"]
    static let everything = ["everything", "all you know", "what you know", "all of it", "all my data", "all your memory", "your memory of me", "everything you know", "all of my data", "all that you know"]
    /// Words that make "everything" smaller than everything: a stretch of time or one kind of fact. Code can't place these, so it asks.
    static let narrower = ["about my ", " week", " month", " days", " sleep", " heart", " run", " workout", " shoes", " since ", " except ", " but "]
    static let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

    /// The change the sentence asks for; nil when it isn't one of these (the agents then handle it).
    /// `days` are the days that can be forgotten; `rows` what is remembered; `today` is YYYY-MM-DD.
    /// A sentence that names a day forgets that day and never more; "everything" needs to be said with no day
    /// and nothing narrower; what can't be placed becomes the question "one day, or everything?".
    static func match(_ sentence: String, today: String, days: [String], rows: [MemoryRow]) -> PendingMemory? {
        let said = " " + sentence.lowercased().replacing("’", with: "'") + " "
        let stops = stopPhrases.contains { said.contains($0) }
        // A stop sentence names a habit: a weekday, and a part of the day when said.
        if stops { return usualTimes(in: said, rows: rows) }
        guard forgetVerbs.contains(where: { said.contains(" \($0) ") }) else { return nil }
        // Only about memory: a workout to cancel is the calendar's.
        let explicit = ["remember", "memory", "you know", "know about me", "learned", "learnt", "my data", "about me"].contains(where: said.contains)
        let all = everything.contains(where: said.contains)
        guard explicit || said.contains(" forget ") else {
            // "Delete everything about last week": not clearly memory's, and not the calendar's either, so it asks.
            return all && !["calendar", "plan", "schedule"].contains(where: said.contains) ? .forgetWhich : nil
        }

        // "Forget my Sunday morning runs" is a habit, not a day.
        let habit = said.contains("morning") || said.contains("afternoon") || said.contains("evening") || said.contains(" every ") || said.contains(" usual")
            || SentenceFacts.weekdays.contains { $0.names.contains { said.range(of: #"\b\#($0)s\b"#, options: .regularExpression) != nil } }
        if habit, let stop = usualTimes(in: said, rows: rows) { return stop }

        if let day = namedDay(in: said, today: today) {
            // The day named, and only that day. With nothing kept for it, there is nothing for code to do.
            return days.contains(day) ? .forgetDay(day) : all ? .forgetWhich : nil
        }
        if all { return narrower.contains(where: said.contains) ? .forgetWhich : .forgetEverything }
        return explicit ? .forgetWhich : nil
    }

    /// The day a sentence names, as YYYY-MM-DD, never after today: an ISO date, "today", "yesterday",
    /// a weekday (the most recent one before today), "Nov 21" or "21 November", or "the 21st".
    static func namedDay(in said: String, today: String) -> String? {
        func back(_ range: ClosedRange<Int>, where matches: (_ month: Int, _ day: Int, _ date: String) -> Bool) -> String? {
            for offset in range {
                guard let date = CalendarAgent.day(today, plus: -offset) else { continue }
                let parts = date.split(separator: "-").compactMap { Int($0) }
                if parts.count == 3, matches(parts[1], parts[2], date) { return date }
            }
            return nil
        }
        if let iso = said.firstMatch(of: /\b(\d{4}-\d{2}-\d{2})\b/) {
            let date = String(iso.1)
            return CalendarAgent.day(date, plus: 0) == date && date <= today ? date : nil
        }
        if said.contains("day before yesterday") { return CalendarAgent.day(today, plus: -2) }
        if said.contains("yesterday") { return CalendarAgent.day(today, plus: -1) }
        if said.range(of: #"\btoday\b"#, options: .regularExpression) != nil { return today }
        let month = months.joined(separator: "|")
        if let named = said.firstMatch(of: try! Regex("\\b(\(month))[a-z]*\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b", as: (Substring, Substring, Substring).self))
            ?? said.firstMatch(of: try! Regex("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(\(month))[a-z]*\\b", as: (Substring, Substring, Substring).self)) {
            let (first, second) = (String(named.1), String(named.2))
            guard let number = Int(first) ?? Int(second), let index = months.firstIndex(of: Int(first) == nil ? first : second) else { return nil }
            return back(0...366) { m, d, _ in m == index + 1 && d == number }
        }
        if let ordinal = said.firstMatch(of: /\b(\d{1,2})(?:st|nd|rd|th)\b/), let number = Int(ordinal.1) {
            return back(0...31) { _, d, _ in d == number }
        }
        for weekday in SentenceFacts.weekdays where weekday.names.contains(where: { said.range(of: #"\b\#($0)\b"#, options: .regularExpression) != nil }) {
            return back(1...7) { _, _, date in CalendarAgent.weekdayName(date) == PlainWords.weekdays[weekday.index] }
        }
        return nil
    }

    /// The remembered usual times a sentence names: a weekday, and a part of the day or an activity when said.
    static func usualTimes(in said: String, rows: [MemoryRow]) -> PendingMemory? {
        guard let weekday = SentenceFacts.weekdays.first(where: { $0.names.contains { said.range(of: #"\b\#($0)(?:s)?\b"#, options: .regularExpression) != nil } })?.index else { return nil }
        let part: ClosedRange<Int>? = said.contains("morning") ? 0...11 : said.contains("afternoon") ? 12...16 : said.contains("evening") || said.contains("night") ? 17...23 : nil
        let matching = rows.filter { row in
            guard row.kind == "usual_slot", row.isUsable, row.data["weekday"]?.number.map(Int.init) == weekday,
                  let hour = row.data["hour"]?.number.map(Int.init) else { return false }
            return part?.contains(hour) ?? true
        }
        guard !matching.isEmpty else { return nil }
        let partWord = said.contains("morning") ? " mornings" : said.contains("afternoon") ? " afternoons" : said.contains("evening") || said.contains("night") ? " evenings" : "s"
        return .stop(keys: matching.map(\.key), title: "\(PlainWords.weekdays[weekday])\(partWord)")
    }
}
