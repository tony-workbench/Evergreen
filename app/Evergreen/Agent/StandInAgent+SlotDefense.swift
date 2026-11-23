import Foundation

extension StandInAgent {
    /// The earliest a defended workout may start, and the latest it may end,
    /// relative to when it was planned. Defense keeps it near the person's chosen time.
    static let defenseEarlier: TimeInterval = 60 * 60
    static let defenseLater: TimeInterval = 90 * 60
    /// A workout is never shrunk below this.
    static let shortestWorkout: TimeInterval = 15 * 60

    /// Slot defense: where an upcoming workout goes when a busy
    /// time lands on it. Right after the conflict first, then right before. If
    /// neither fits at full length, it shrinks into the biggest free gap of at
    /// least 15 minutes. Nil when nothing nearby is free; the workout stays put.
    static func defendedSlot(
        for item: PlanItem, conflict: Busy, busy: [Busy], others: [PlanItem], now: Date, cal: Calendar
    ) -> Slot? {
        let length = item.slot.end.timeIntervalSince(item.slot.start)
        let day = cal.startOfDay(for: item.slot.start)
        let earliest = max(
            item.slot.start.addingTimeInterval(-defenseEarlier),
            now.addingTimeInterval(15 * 60),
            day.addingTimeInterval(6 * 3600)
        )
        let latest = min(item.slot.end.addingTimeInterval(defenseLater), day.addingTimeInterval(22 * 3600))
        let blocks = (busy.map { ($0.start, $0.end) } + others.map { ($0.slot.start, $0.slot.end) })
            .sorted { $0.0 < $1.0 }

        func free(_ start: Date, _ end: Date) -> Bool {
            start >= earliest && end <= latest && !blocks.contains { $0.0 < end && $0.1 > start }
        }
        func slot(_ start: Date, _ end: Date) -> Slot {
            Slot(start: start, end: end, activityType: item.slot.activityType)
        }

        // Right after: step past every block in the way.
        var start = conflict.end
        while let block = blocks.first(where: { $0.0 < start.addingTimeInterval(length) && $0.1 > start }) {
            start = block.1
        }
        if free(start, start.addingTimeInterval(length)) {
            return slot(start, start.addingTimeInterval(length))
        }

        // Right before.
        var end = conflict.start
        while let block = blocks.last(where: { $0.0 < end && $0.1 > end.addingTimeInterval(-length) }) {
            end = block.0
        }
        if free(end.addingTimeInterval(-length), end) {
            return slot(end.addingTimeInterval(-length), end)
        }

        // Shrink into the biggest free gap nearby, as close to the planned start as it fits.
        var gaps: [(Date, Date)] = []
        var cursor = earliest
        for block in blocks where block.1 > cursor && block.0 < latest {
            if block.0 > cursor { gaps.append((cursor, block.0)) }
            cursor = max(cursor, block.1)
        }
        if cursor < latest { gaps.append((cursor, latest)) }
        guard let gap = gaps.max(by: { $0.1.timeIntervalSince($0.0) < $1.1.timeIntervalSince($1.0) }) else {
            return nil
        }
        let room = gap.1.timeIntervalSince(gap.0)
        let shorter = (min(room, length) / 300).rounded(.down) * 300
        guard shorter >= shortestWorkout else { return nil }
        let begin = min(max(item.slot.start, gap.0), gap.1.addingTimeInterval(-shorter))
        return slot(begin, begin.addingTimeInterval(shorter))
    }
}
