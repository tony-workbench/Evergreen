import Foundation

/// A day at home in the next two days, for the rain check: the day, and its home session when it has one.
struct RainHomeDay: Equatable, Sendable {
    var day: Date
    var session: DateInterval?
}

/// Rain through the afternoon of a day at home: two or three short breaks of a few minutes, spread through the
/// afternoon, to stand in for a walk the rain takes away. They don't replace the strength session, don't count
/// towards the week's sets and don't unlock screen time.
struct RainSnacks: Equatable, Sendable, Identifiable {
    var day: Date
    var blocks: [DateInterval]
    var worstProbability: Int
    /// One per day, so it is said once and "Not now" holds for the day.
    var key: String

    var id: String { key }
    var minutes: Int { RainCheck.snackMinutes }

    /// What each break is called on the plan and the calendar.
    static let title = "Short break"
}

extension RainCheck {
    /// The afternoon looked at, and the chance of rain that counts (the same 60% as a workout hour).
    static let snackFromHour = 12
    static let snackToHour = 20
    /// Each break: a few minutes (the research behind it used 5 to 8), and no fewer than two in a day, at most three.
    static let snackMinutes = 6
    static let snackFewest = 2
    static let snackMost = 3
    /// At least this long between two breaks, and between a break and the strength session.
    static let snackGap: TimeInterval = 3600
    /// Where each break is looked for first, so they spread through the afternoon; each search runs on from there.
    static let snackAnchors: [(hour: Int, minute: Int)] = [(12, 30), (15, 30), (18, 30)]
    static let snackStep: TimeInterval = 15 * 60

    static func snackKey(_ day: Date, calendar: Calendar) -> String { "snacks|\(Self.day(day, calendar))" }

    /// Each day at home with rain likely in the afternoon gets its breaks; a day where fewer than two fit gets none.
    static func snacks(days: [RainHomeDay], plan: [PlanItem], forecast: Forecast, busy: [Busy], now: Date, calendar: Calendar) -> [RainSnacks] {
        days.compactMap { home in
            let start = calendar.startOfDay(for: home.day)
            guard start.addingTimeInterval(24 * 3600) > now, start <= now.addingTimeInterval(horizon),
                  let from = calendar.date(bySettingHour: snackFromHour, minute: 0, second: 0, of: start),
                  let to = calendar.date(bySettingHour: snackToHour, minute: 0, second: 0, of: start) else { return nil }
            let wet = forecast.hours(from: from, to: to).filter { $0.probability >= wetFrom }
            guard let worst = wet.map(\.probability).max() else { return nil }
            let blocks = snackBlocks(on: start, session: home.session, plan: plan, busy: busy, now: now, calendar: calendar)
            guard blocks.count >= snackFewest else { return nil }
            return RainSnacks(day: start, blocks: blocks, worstProbability: worst, key: snackKey(start, calendar: calendar))
        }
    }

    /// Up to three breaks between 12:00 and 20:00, each free on the calendar and the plan, an hour or more from each
    /// other and from the session, and not sooner than half an hour from now.
    static func snackBlocks(on day: Date, session: DateInterval?, plan: [PlanItem], busy: [Busy], now: Date, calendar: Calendar) -> [DateInterval] {
        let length = TimeInterval(snackMinutes * 60)
        guard let close = calendar.date(bySettingHour: snackToHour, minute: 0, second: 0, of: day) else { return [] }
        let taken = busy.map { DateInterval(start: $0.start, end: max($0.start, $0.end)) }
            + plan.map { DateInterval(start: $0.slot.start, end: max($0.slot.start, $0.slot.end)) }
        let earliest = now.addingTimeInterval(30 * 60)
        var chosen: [DateInterval] = []

        func fits(_ block: DateInterval) -> Bool {
            guard block.start >= earliest, block.end <= close else { return false }
            if taken.contains(where: { $0.start < block.end && block.start < $0.end }) { return false }
            if let session, block.end > session.start.addingTimeInterval(-snackGap), block.start < session.end.addingTimeInterval(snackGap) { return false }
            return !chosen.contains { block.end > $0.start.addingTimeInterval(-snackGap) && block.start < $0.end.addingTimeInterval(snackGap) }
        }

        for anchor in snackAnchors where chosen.count < snackMost {
            guard var cursor = calendar.date(bySettingHour: anchor.hour, minute: anchor.minute, second: 0, of: day) else { continue }
            while cursor.addingTimeInterval(length) <= close {
                let block = DateInterval(start: cursor, duration: length)
                if fits(block) { chosen.append(block); break }
                cursor = cursor.addingTimeInterval(snackStep)
            }
        }
        return chosen.sorted { $0.start < $1.start }
    }
}
