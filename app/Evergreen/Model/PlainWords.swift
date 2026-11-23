import Foundation

/// Turns the backend's technical wording into what a person would say. Each
/// rule matches one known sentence shape; anything that doesn't match is shown
/// as it came.
enum PlainWords {
    /// A session's reason. The backend's own reasons read
    /// "89 min run: your usual Sun 06:00 slot (memory); long run."
    static func reason(_ text: String) -> String {
        sentences(text)?.joined(separator: " ") ?? text
    }

    static let keptShort = "Kept short so this week stays close to your normal."

    /// A known reason as plain sentences, one per rule; nil when it isn't one of the backend's own.
    private static func sentences(_ text: String) -> [String]? {
        if text == "Race day. Rest and fuel." { return [text] }
        guard let lead = text.wholeMatch(of: /(\d+) min ([^:]+): (.+?)\.?/) else { return nil }
        let noun = String(lead.2)
        var sentences: [String] = []
        for rule in lead.3.split(separator: "; ") {
            guard let sentence = sentence(String(rule), noun: noun) else { return nil }
            sentences.append(sentence)
        }
        return sentences
    }

    private static func sentence(_ rule: String, noun: String) -> String? {
        if let slot = rule.wholeMatch(of: /your usual (\w{3}) (\d\d):00 slot \(memory\)/),
           let day = weekday(String(slot.1)), let hour = Int(slot.2) {
            return "Your usual \(day) \(clock(hour)) \(noun)."
        }
        if let usual = rule.wholeMatch(of: /your usual (\w{3}) (.+)/), let day = weekday(String(usual.1)) {
            return "Your usual \(day) \(usual.2)."
        }
        if let taper = rule.wholeMatch(of: /taper: race in (\d+) days?/) {
            return "Shorter, because your race is in \(taper.1) days."
        }
        if let ease = rule.wholeMatch(of: /ease off: (.+) → easy/) {
            let why = ease.1.split(separator: ", ").map { part -> String in
                if let sleep = part.wholeMatch(of: /sleep down (\d+) min\/night/) {
                    return "your sleep is down \(sleep.1) minutes a night"
                }
                if let rate = part.wholeMatch(of: /resting HR up ([\d.]+) bpm/) {
                    return "your resting heart rate is up \(rate.1)"
                }
                return String(part)
            }
            return "Kept easy, because \(why.joined(separator: " and "))."
        }
        if rule.wholeMatch(of: /shoes at \d+% → off the road/) != nil {
            return "Off the road while your shoes are worn out."
        }
        switch rule {
        case "long run": return "Your long run of the week."
        case "break-in run in the new pair": return "An easy run to break in your new shoes."
        case "trimmed to stay under your weekly load cap": return keptShort
        case "moved after a calendar conflict": return "Moved to after something on your calendar."
        case "no free slot that day": return "Your day looks full, so this one may not fit."
        default: return nil
        }
    }

    /// The line above the week: "Your last 7 days carried 0.63× your usual
    /// training load, so this week is planned at 1917 (cap 1913). Readiness: normal."
    static func summary(_ text: String, keptShort: Bool = false) -> String {
        let said = summary(text)
        return keptShort && said != text ? said + " Sessions are a little shorter, to stay close to your normal." : said
    }

    private static func summary(_ text: String) -> String {
        let shape = /Your last 7 days carried ([\d.]+)× your usual training load, so this week is planned at \d+ \(cap \d+\)\. Readiness: ([^.]+(?:\.\d[^.]*)?)\.(.*)/
        guard let match = text.wholeMatch(of: shape), let ratio = Double(match.1) else { return text }
        var lines = [
            ratio < 0.9 ? "A lighter week than usual, so there is room to build."
                : ratio > 1.1 ? "A bigger week than usual, so this one holds steady."
                : "A week much like your usual, so this one keeps the rhythm.",
        ]
        if match.2 != "normal" { lines.append("One session is kept easy so you can recover.") }
        let rest = match.3.trimmingCharacters(in: .whitespaces)
        if !rest.isEmpty { lines.append(rest) }
        return lines.joined(separator: " ")
    }

    /// Why an optional extra is suggested, without the closing note about load.
    static func extra(_ text: String) -> String {
        text.replacingOccurrences(of: " Optional, and it fits your weekly load.", with: " Optional.")
    }

    /// "You already have a run on Sunday"
    static func alreadyPlanned(_ slot: Slot) -> String {
        let noun = Activity.noun(slot)
        let article = "aeiou".contains(noun.prefix(1)) ? "an" : "a"
        return "You already have \(article) \(noun) on \(slot.start.formatted(.dateTime.weekday(.wide)))"
    }

    static let weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    /// "Sunday" for "Sun".
    static func weekday(_ short: String) -> String? {
        ["Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday", "Thu": "Thursday",
         "Fri": "Friday", "Sat": "Saturday", "Sun": "Sunday"][short]
    }

    /// "6 AM" for 6, "6 PM" for 18.
    static func clock(_ hour: Int) -> String {
        "\(hour % 12 == 0 ? 12 : hour % 12) \(hour < 12 ? "AM" : "PM")"
    }
}
