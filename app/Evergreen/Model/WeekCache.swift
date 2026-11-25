import CryptoKit
import Foundation
import os

/// The planned week, kept so the AI is asked once and not at every launch.
/// A week is planned again only when its key changes: another local day,
/// other memory rows (or other stopped ones), or other busy times on the
/// calendar. Or when the person asks.
struct WeekCache: Codable, Equatable, Sendable {
    var key: String
    var week: PlanAgent.Week

    static let storeKey = "planned_week"
    /// Bytes of the digest kept in a key: enough to tell weeks apart, short enough to read in the log.
    static let digestBytes = 8

    /// What a week depends on: the day, what is remembered, the busy times, and the rules' text ("" without rules).
    struct Basis {
        var day: String
        var rows: [MemoryRow]
        var busy: [Busy]
        var rules = ""
    }

    /// What a week depends on, as one short string.
    static func key(_ basis: Basis) -> String {
        let memory = basis.rows.map { "\($0.key)|\($0.state)|\($0.statement)|\($0.data.text)" }.sorted().joined(separator: "\n")
        let calendar = basis.busy.map { "\(Int($0.start.timeIntervalSince1970))-\(Int($0.end.timeIntervalSince1970))" }
            .sorted().joined(separator: ",")
        // The rules and each day's kind: a changed rule or a day that became a day out plans the week again.
        // Without rules this adds nothing, so a week kept before rules existed still matches.
        let text = basis.rules.isEmpty ? "\(memory)\n#\n\(calendar)" : "\(memory)\n#\n\(calendar)\n#\n\(basis.rules)"
        let digest = SHA256.hash(data: Data(text.utf8))
        return basis.day + ":" + digest.prefix(digestBytes).map { String(format: "%02x", $0) }.joined()
    }

    /// The busy times that can change a week planned now: those in the eight days from today, between
    /// 5 AM and 11 PM, the only hours a workout is suggested for. A meeting next month or at 3 AM doesn't plan the week again.
    static func planning(_ busy: [Busy], now: Date, calendar: Calendar) -> [Busy] {
        let start = calendar.startOfDay(for: now)
        guard let end = calendar.date(byAdding: .day, value: 8, to: start) else { return busy }
        return busy.filter { time in
            guard time.end > start, time.start < end else { return false }
            let day = calendar.startOfDay(for: time.start)
            guard let open = calendar.date(byAdding: .hour, value: 5, to: day),
                  let close = calendar.date(byAdding: .hour, value: 23, to: day) else { return true }
            return time.end > open && time.start < close
        }
    }

    static func load(from defaults: UserDefaults?) -> WeekCache? {
        defaults?.data(forKey: storeKey).flatMap { data in
            Logger.model.attempt("The kept week couldn't be read; it is planned again") { try JSONDecoder().decode(WeekCache.self, from: data) }
        }
    }

    func save(to defaults: UserDefaults?) {
        defaults?.set(Logger.model.attempt("The planned week couldn't be kept") { try JSONEncoder().encode(self) }, forKey: Self.storeKey)
    }
}
