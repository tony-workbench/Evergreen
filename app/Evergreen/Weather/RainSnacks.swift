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

    /// What the breaks have to fit around: the workouts on the plan, the busy times on the calendar, the time now, and
    /// the calendar the days are read in.
    struct SnackRoomBasis {
        var plan: [PlanItem]
        var busy: [Busy]
        var now: Date
        var calendar: Calendar
    }

    /// A day is this long, for "the day hasn't ended yet".
    static let snackDayLength: TimeInterval = 24 * 3600

    /// Each day at home with rain likely in the afternoon gets its breaks; a day where fewer than two fit gets none.
    static func snacks(days: [RainHomeDay], forecast: Forecast, around basis: SnackRoomBasis) -> [RainSnacks] {
        days.compactMap { home in
            let calendar = basis.calendar
            let start = calendar.startOfDay(for: home.day)
            guard start.addingTimeInterval(snackDayLength) > basis.now, start <= basis.now.addingTimeInterval(horizon),
                  let from = calendar.date(bySettingHour: snackFromHour, minute: 0, second: 0, of: start),
                  let to = calendar.date(bySettingHour: snackToHour, minute: 0, second: 0, of: start),
                  let worst = forecast.hours(from: from, to: to).filter({ $0.probability >= wetFrom }).map(\.probability).max()
            else { return nil }
            let blocks = snackBlocks(on: start, session: home.session, around: basis)
            guard blocks.count >= snackFewest else { return nil }
            return RainSnacks(day: start, blocks: blocks, worstProbability: worst, key: snackKey(start, calendar: calendar))
        }
    }

    /// Up to three breaks between 12:00 and 20:00, each free on the calendar and the plan, an hour or more from each
    /// other and from the session, and not sooner than half an hour from now.
    static func snackBlocks(on day: Date, session: DateInterval?, around basis: SnackRoomBasis) -> [DateInterval] {
        guard let close = basis.calendar.date(bySettingHour: snackToHour, minute: 0, second: 0, of: day) else { return [] }
        let taken = basis.busy.map { DateInterval(start: $0.start, end: max($0.start, $0.end)) }
            + basis.plan.map { DateInterval(start: $0.slot.start, end: max($0.slot.start, $0.slot.end)) }
        let room = SnackRoom(earliest: basis.now.addingTimeInterval(snackNotice), close: close, taken: taken, session: session)
        var chosen: [DateInterval] = []
        for anchor in snackAnchors where chosen.count < snackMost {
            guard let from = basis.calendar.date(bySettingHour: anchor.hour, minute: anchor.minute, second: 0, of: day),
                  let block = room.firstFit(from: from, besides: chosen) else { continue }
            chosen.append(block)
        }
        return chosen.sorted { $0.start < $1.start }
    }

    /// No break sooner than this from now: time to see it and get up.
    static let snackNotice: TimeInterval = 30 * 60
}

/// Where a break may go on one afternoon: after `earliest`, ending by `close`, clear of everything `taken`, and a gap
/// away from the session and from the breaks already chosen.
private struct SnackRoom {
    let earliest: Date
    let close: Date
    let taken: [DateInterval]
    let session: DateInterval?

    private static let secondsPerMinute: TimeInterval = 60

    /// The first break that fits, looking on from `start` in steps.
    func firstFit(from start: Date, besides chosen: [DateInterval]) -> DateInterval? {
        let length = TimeInterval(RainCheck.snackMinutes) * Self.secondsPerMinute
        var cursor = start
        while cursor.addingTimeInterval(length) <= close {
            let block = DateInterval(start: cursor, duration: length)
            if fits(block, besides: chosen) { return block }
            cursor = cursor.addingTimeInterval(RainCheck.snackStep)
        }
        return nil
    }

    private func fits(_ block: DateInterval, besides chosen: [DateInterval]) -> Bool {
        guard block.start >= earliest, block.end <= close else { return false }
        if taken.contains(where: { $0.start < block.end && block.start < $0.end }) { return false }
        if let session, isNear(block, session) { return false }
        return !chosen.contains { isNear(block, $0) }
    }

    /// Within the gap of another block.
    private func isNear(_ block: DateInterval, _ other: DateInterval) -> Bool {
        block.end > other.start.addingTimeInterval(-RainCheck.snackGap) && block.start < other.end.addingTimeInterval(RainCheck.snackGap)
    }
}
