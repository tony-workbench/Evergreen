import Foundation

/// One number about the body with what is usual for it, for the three
/// figures on What I remember: sleep, resting heart rate, training load.
struct BodyFigure: Identifiable, Equatable {
    var title: String
    /// "8.6 h", "49 bpm", "+14%"
    var value: String
    /// "usual 7.2 h"
    var usual: String
    /// The row behind it, for stopping it.
    var key: String

    var id: String { key }

    /// The figures the rows hold, in a fixed order; a row whose numbers can't be read gives none.
    static func figures(_ rows: [MemoryRow]) -> [BodyFigure] {
        func one(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0...1))) }
        return ["sleep", "resting_hr", "load"].compactMap { kind in
            guard let row = rows.first(where: { $0.kind == kind && $0.isUsable }) else { return nil }
            func number(_ name: String) -> Double? { row.data[name]?.number }
            switch kind {
            case "sleep":
                guard let now = number("hours7d") else { return nil }
                return BodyFigure(title: "Sleep", value: "\(one(now)) h", usual: number("hours28d").map { "usual \(one($0)) h" } ?? "a night", key: row.key)
            case "resting_hr":
                guard let now = number("bpm7d") else { return nil }
                return BodyFigure(title: "Resting heart", value: "\(Int(now.rounded())) bpm", usual: number("bpm28d").map { "usual \(Int($0.rounded()))" } ?? "this week", key: row.key)
            default:
                guard let ratio = number("ratioToUsual") else { return nil }
                let percent = Int(((ratio - 1) * 100).rounded())
                return BodyFigure(title: "Training", value: percent == 0 ? "Steady" : "\(percent > 0 ? "+" : "−")\(abs(percent))%",
                                  usual: percent == 0 ? "about your usual" : "against your usual", key: row.key)
            }
        }
    }
}
