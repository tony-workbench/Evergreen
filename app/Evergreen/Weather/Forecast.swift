import Foundation

/// The hours ahead: for each, the chance of rain and how much.
struct Forecast: Codable, Equatable, Sendable {
    struct Hour: Codable, Equatable, Sendable {
        /// The hour's first moment.
        var start: Date
        /// Chance of precipitation, 0 to 100.
        var probability: Int
        var millimeters: Double
    }

    var hours: [Hour]
    var fetchedAt: Date
    /// Where it is for, rounded.
    var place: Coordinate

    /// The hours that overlap a stretch of time.
    func hours(from start: Date, to end: Date) -> [Hour] {
        hours.filter { $0.start < end && $0.start.addingTimeInterval(3600) > start }
    }
}

extension Forecast {
    /// Open-Meteo's answer to `hourly=precipitation_probability,precipitation&timezone=auto`:
    /// local hours without an offset, and the offset once for all of them.
    private struct OpenMeteo: Decodable {
        struct Hourly: Decodable {
            var time: [String]
            var precipitation_probability: [Int?]
            var precipitation: [Double?]?
        }
        var utc_offset_seconds: Int
        var hourly: Hourly
    }

    init(openMeteo data: Data, fetchedAt: Date, place: Coordinate) throws {
        let answer = try JSONDecoder().decode(OpenMeteo.self, from: data)
        let parse = DateFormatter()
        parse.calendar = Calendar(identifier: .gregorian)
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.timeZone = TimeZone(secondsFromGMT: answer.utc_offset_seconds)
        parse.dateFormat = "yyyy-MM-dd'T'HH:mm"
        var hours: [Hour] = []
        for (index, time) in answer.hourly.time.enumerated() {
            // An hour without a probability says nothing, so it is left out.
            guard let start = parse.date(from: time), index < answer.hourly.precipitation_probability.count,
                  let probability = answer.hourly.precipitation_probability[index] else { continue }
            let amounts = answer.hourly.precipitation ?? []
            hours.append(Hour(start: start, probability: probability, millimeters: (index < amounts.count ? amounts[index] : nil) ?? 0))
        }
        self.init(hours: hours, fetchedAt: fetchedAt, place: place)
    }
}
