import Foundation
@testable import Evergreen

/// Test data only: a made-up person's month of workouts, from
/// `EvergreenTests/Fixtures/<name>.json`, re-anchored so it ends the day before
/// the story day. The app itself bundles nobody; a name with no file is an
/// empty history.
enum PersonaFixture {
    static let folder = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "Fixtures")

    static func data(_ file: String) throws -> Data {
        try Data(contentsOf: folder.appending(path: file))
    }

    private struct File: Decodable {
        struct Entry: Decodable {
            let id: String
            let activityType: String
            let start: String
            let end: String
            let avgHeartRate: Int?
            let effort: Double?
        }
        struct Day: Decodable {
            let date: String
            let restingHeartRate: Double?
            let sleepMin: Double?
        }
        let name: String
        let historyStart: String
        let historyEnd: String
        let workouts: [Entry]
        let dailySummaries: [Day]?
    }

    struct Person {
        var name: String
        var historyStart: Date
        var workouts: [Workout] = []
        var days: [HealthHistory.Day] = []

        /// The same history as Apple Health would hand it over.
        var health: HealthHistory { HealthHistory(workouts: workouts, days: days, readAt: nil) }
    }

    static func load(_ name: String, storyDay: Date, calendar: Calendar = .current) -> Person {
        guard let data = try? data("\(name).json"), let file = try? JSONDecoder().decode(File.self, from: data) else {
            return Person(name: name, historyStart: storyDay)
        }
        // Mock times are wall-clock times, read in the test's time zone.
        let parse = DateFormatter()
        parse.calendar = calendar
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.timeZone = calendar.timeZone
        parse.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        let dayParse = DateFormatter()
        dayParse.calendar = calendar
        dayParse.locale = Locale(identifier: "en_US_POSIX")
        dayParse.timeZone = calendar.timeZone
        dayParse.dateFormat = "yyyy-MM-dd"

        let historyEnd = dayParse.date(from: file.historyEnd) ?? storyDay
        let lastDay = calendar.date(byAdding: .day, value: -1, to: storyDay)!
        let shift = calendar.dateComponents([.day], from: historyEnd, to: lastDay).day ?? 0
        func shifted(_ date: Date) -> Date { calendar.date(byAdding: .day, value: shift, to: date) ?? date }

        let workouts: [Workout] = file.workouts.compactMap { entry in
            guard let start = parse.date(from: entry.start), let end = parse.date(from: entry.end) else { return nil }
            return Workout(id: entry.id, activityType: entry.activityType, start: shifted(start), end: shifted(end),
                           effort: entry.effort, avgHeartRate: entry.avgHeartRate, source: .mock)
        }
        let days: [HealthHistory.Day] = (file.dailySummaries ?? []).compactMap { day in
            dayParse.date(from: day.date).map {
                HealthHistory.Day(date: shifted($0), sleepMin: day.sleepMin, restingHeartRate: day.restingHeartRate)
            }
        }
        return Person(name: file.name, historyStart: shifted(dayParse.date(from: file.historyStart) ?? storyDay),
                      workouts: workouts, days: days)
    }
}
