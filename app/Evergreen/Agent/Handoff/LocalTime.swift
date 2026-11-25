import Foundation

/// A moment as the agents write it: `YYYY-MM-DDTHH:MM:SS`, an optional
/// fraction, then `+HH:MM` or `-HH:MM`. `Z` is not accepted, because the
/// local day and hour are read straight from the text.
struct LocalTime: Codable, Equatable, Hashable, Sendable {
    let text: String

    init?(_ text: String) {
        guard text.wholeMatch(of: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}/) != nil else { return nil }
        self.text = text
    }

    /// A local day (`YYYY-MM-DD`) and time (`HH:MM`) at an offset from UTC.
    init?(day: String, time: String, offsetMinutes: Int) {
        let sign = offsetMinutes < 0 ? "-" : "+"
        let offset = String(format: "%02d:%02d", abs(offsetMinutes) / 60, abs(offsetMinutes) % 60)
        self.init("\(day)T\(time):00\(sign)\(offset)")
    }

    /// A moment as it reads on the clock in a time zone.
    init(_ date: Date, in zone: TimeZone) {
        let format = ISO8601DateFormatter()
        format.timeZone = zone
        format.formatOptions = [.withInternetDateTime]
        let text = format.string(from: date)
        // The formatter writes UTC as "Z"; the agents want the offset spelled out.
        self.text = text.hasSuffix("Z") ? String(text.dropLast()) + "+00:00" : text
    }

    init(from decoder: Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let time = LocalTime(text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a time with an offset: \(text)"))
        }
        self = time
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(text)
    }

    /// The local day, `YYYY-MM-DD`.
    var day: String { String(text.prefix(10)) }
    /// The local time, `HH:MM`.
    var clock: String { String(text.dropFirst(11).prefix(5)) }

    /// The moment itself.
    var date: Date? {
        let whole = ISO8601DateFormatter()
        let fraction = ISO8601DateFormatter()
        fraction.formatOptions.insert(.withFractionalSeconds)
        return whole.date(from: text) ?? fraction.date(from: text)
    }
}
