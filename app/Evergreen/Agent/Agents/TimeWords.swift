import Foundation

/// Loose times as a clock time, for when the model hands back something the
/// calendar engine can't read ("6ish", "half past six", "7pm"). Only used
/// on a time field that isn't already HH:MM. An hour from 1 to 7 with no
/// "am" or "morning" is taken as the afternoon or evening, when people train.
enum TimeWords {
    static let numbers = ["one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "noon": 12, "midday": 12]

    /// "HH:MM", or nil when there is no time in the words.
    static func clock(_ words: String) -> String? {
        let said = words.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if said.wholeMatch(of: /([01]\d|2[0-3]):[0-5]\d/) != nil { return said }
        if said.contains("midnight") { return "00:00" }
        var minutes = 0
        if said.contains("half past") || said.contains("thirty") { minutes = 30 }
        if said.contains("quarter past") { minutes = 15 }
        let toTheHour = said.contains("quarter to")
        // The hour: digits ("6", "6:30", "18.30") or a word ("six").
        var hour: Int?
        if let found = said.firstMatch(of: /(\d{1,2})(?:[:.](\d{2}))?/) {
            hour = Int(found.1)
            if let stated = found.2.flatMap({ Int($0) }) { minutes = stated }
        } else if let word = numbers.first(where: { said.contains($0.key) }) {
            hour = word.value
        }
        guard var hour, (0...23).contains(hour), (0...59).contains(minutes) else { return nil }
        let morning = said.contains("am") || said.contains("a.m") || said.contains("morning")
        let evening = said.contains("pm") || said.contains("p.m") || said.contains("evening") || said.contains("tonight") || said.contains("afternoon")
        if evening, hour < 12 { hour += 12 } else if morning, hour == 12 { hour = 0 } else if !morning, !evening, (1...7).contains(hour) { hour += 12 }
        if toTheHour { hour = (hour + 23) % 24; minutes = 45 }
        return String(format: "%02d:%02d", hour, minutes)
    }
}
