import Foundation

/// One thing a suggestion rests on, shown as a chip under it: a line of what
/// is remembered (from Health) or the free time found on the calendar. Bases
/// are built only from the session's memory keys and the calendar, never
/// from the model's own words.
extension Basis {
    /// Whether a suggestion's reason only says its one remembered usual time again
    /// ("Your usual Tuesday 7 AM run." over "You usually run Tuesday around 7 AM.").
    static func restates(_ reason: String, _ bases: [Basis]) -> Bool {
        guard bases.count == 1, bases[0].isUsualTime else { return false }
        let said = reason.lowercased()
        return said.contains("usual") && said.count < 60
    }
}

struct Basis: Equatable, Identifiable, Sendable {
    enum Source: Equatable, Sendable {
        case health, calendar

        /// The small icon on the chip.
        var symbol: String { self == .health ? "heart" : "calendar" }
        var spoken: String { self == .health ? "From Apple Health" : "From your calendar" }
    }

    var id: String
    var source: Source
    /// The chip: "You usually run Sunday around 8 AM."
    var text: String
    /// The longer line in the Why sheet: how much data it comes from, or what is around the free time.
    var detail: String
    /// The memory key behind it, for "Not true for me". Nil for a calendar basis.
    var key: String?
    /// True for a usual time: when the suggestion's own sentence already says "as usual", the chip would only repeat it.
    var isUsualTime = false

    /// A session's bases: one for each of its keys that is a usable memory row, then the calendar, when it says something.
    static func list(for session: WeekPlan.Session, rows: [MemoryRow], busy: [Busy]?, calendar: Calendar) -> [Basis] {
        var seen = Set<String>()
        var bases = (session.basedOn ?? []).filter { seen.insert($0).inserted }.compactMap { key -> Basis? in
            guard let row = rows.first(where: { $0.key == key && $0.isUsable }) else { return nil }
            return Basis(id: key, source: .health, text: RowWords.sentence(row), detail: RowWords.support(row), key: key, isUsualTime: row.kind == "usual_slot")
        }
        if let busy, let slot = session.after, let free = freeTime(around: slot, busy: busy, calendar: calendar) {
            bases.append(free)
        }
        return bases
    }

    /// The bases worth a chip under a suggestion: only what its own sentence doesn't already say
    /// (a number, a calendar gap). The Why sheet still lists every basis.
    static func chips(_ bases: [Basis], for session: WeekPlan.Session) -> [Basis] {
        let saysUsual = PlainWords.reason(session.reason).lowercased().contains("usual")
        return bases.filter { !($0.isUsualTime && saysUsual) }
    }

    /// The calendar's part in a slot, when it is worth a chip: the slot sits
    /// between two things on the calendar, or in a free stretch under four
    /// hours. An open day says nothing, so it gives none.
    static func freeTime(around slot: Slot, busy: [Busy], calendar: Calendar) -> Basis? {
        let day = calendar.startOfDay(for: slot.start)
        guard let open = calendar.date(byAdding: .hour, value: 6, to: day), let close = calendar.date(byAdding: .hour, value: 22, to: day),
              slot.start >= open, slot.end <= close,
              !busy.contains(where: { $0.start < slot.end && $0.end > slot.start })
        else { return nil }
        let before = busy.filter { $0.end <= slot.start && $0.end > open }.map(\.end).max()
        let after = busy.filter { $0.start >= slot.end && $0.start < close }.map(\.start).min()
        let from = before ?? open, to = after ?? close
        let between = before != nil && after != nil
        guard between || to.timeIntervalSince(from) < 4 * 3600 else { return nil }
        let weekday = slot.start.formatted(.dateTime.weekday(.wide))
        let detail = [
            before.map { "Before it, you’re busy until \($0.clock)." } ?? "Nothing on your calendar before it that day.",
            after.map { "After it, you’re busy from \($0.clock)." } ?? "Nothing on your calendar after it that day.",
        ].joined(separator: " ")
        // What the person was busy with before it started, and what starts after it.
        let earlier = busy.filter { $0.end <= slot.start && $0.end > open }.max { $0.end < $1.end }?.start
        let text = if let earlier, let after {
            "Between your \(hour(earlier, calendar)) and \(hour(after, calendar)) meetings"
        } else {
            "Free \(span(from, to, calendar: calendar)) \(weekday)"
        }
        return Basis(id: "free-\(Int(slot.start.timeIntervalSince1970))", source: .calendar, text: text, detail: detail, key: nil)
    }

    /// "9 AM", "1:30 PM".
    static func hour(_ date: Date, _ calendar: Calendar) -> String {
        let hour = calendar.component(.hour, from: date), minute = calendar.component(.minute, from: date)
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return (minute == 0 ? "\(twelve)" : String(format: "%d:%02d", twelve, minute)) + (hour < 12 ? " AM" : " PM")
    }

    /// "6–9 AM", "11 AM–2 PM", "6:30–9 AM".
    static func span(_ from: Date, _ to: Date, calendar: Calendar) -> String {
        func parts(_ date: Date) -> (clock: String, half: String) {
            let hour = calendar.component(.hour, from: date), minute = calendar.component(.minute, from: date)
            let twelve = hour % 12 == 0 ? 12 : hour % 12
            return (minute == 0 ? "\(twelve)" : String(format: "%d:%02d", twelve, minute), hour < 12 ? "AM" : "PM")
        }
        let a = parts(from), b = parts(to)
        return a.half == b.half ? "\(a.clock)–\(b.clock) \(b.half)" : "\(a.clock) \(a.half)–\(b.clock) \(b.half)"
    }
}
