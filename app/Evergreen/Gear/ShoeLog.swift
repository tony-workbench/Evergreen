import Foundation

/// The person's current running shoes: when they started using them and,
/// if they said, what they are. The distance on them is never typed in; it is
/// the running distance Apple Health recorded since that day.
struct ShoeLog: Codable, Equatable, Sendable {
    static let storeKey = "shoes"
    /// A heads-up from here…
    static let headsUpKm = 480.0
    /// …and time to replace from here.
    static let replaceKm = 640.0

    var name: String?
    var startedOn: Date

    /// Kilometres run since the shoes were started: each run once, in its recorded distance.
    static func km(_ workouts: [Workout], since start: Date, until now: Date) -> Double {
        StandInAgent.mergeDuplicates(workouts.filter { $0.activityType == "Running" && $0.start >= start && $0.start <= now })
            .reduce(0) { $0 + ($1.distanceKm ?? 0) }
    }
}

/// What the distance on the shoes means.
enum ShoeEvent: String, Codable, Equatable, Sendable {
    case headsUp = "heads_up"
    case replace

    init?(km: Double) {
        if km >= ShoeLog.replaceKm { self = .replace } else if km >= ShoeLog.headsUpKm { self = .headsUp } else { return nil }
    }
}

/// The shoes and the distance on them now.
struct ShoeStatus: Equatable, Sendable {
    var log: ShoeLog
    var km: Double

    var event: ShoeEvent? { ShoeEvent(km: km) }

    /// "your running shoes", or their name.
    var item: String {
        let name = QuotedData.name(log.name ?? "")
        return name.isEmpty ? "running shoes" : name
    }

    /// "Your running shoes", with their name when the person gave one.
    private var subject: String {
        item == "running shoes" ? "Your running shoes" : "Your running shoes (\(item))"
    }

    /// The one line the person reads; nil while the shoes are fine.
    var line: String? {
        switch event {
        case .headsUp: "\(subject) have \(Int(km.rounded())) km on them. Worth checking how the soles look."
        case .replace: "\(subject) have \(Int(km.rounded())) km on them. Time for a new pair."
        case nil: nil
        }
    }

    /// The shoes as a memory row of kind `gear`: `{ item, km, boughtOn }`.
    func memoryRow(now: Date, calendar: Calendar = .current) -> MemoryRow? {
        let started = RainCheck.day(log.startedOn, calendar)
        let offset = calendar.timeZone.secondsFromGMT(for: now) / 60
        guard let updated = LocalTime(day: RainCheck.day(now, calendar), time: RainCheck.clock(now, calendar), offsetMinutes: offset) else { return nil }
        let whole = (km * 10).rounded() / 10
        return MemoryRow(
            memoryId: "gear-running-shoes-\(started)", key: "gear:running_shoes", slot: "gear:running_shoes",
            group: "gear", kind: "gear",
            statement: "\(item.prefix(1).uppercased() + item.dropFirst()) in use since \(started), \(Int(km.rounded())) km run in them.",
            data: .object(["item": .string(item), "km": .number(whole), "boughtOn": .string(started)]),
            state: "saved", confidence: 1, since: started, updated: updated.text
        )
    }
}
