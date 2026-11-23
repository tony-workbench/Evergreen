import Foundation

/// Looks at the forecast for the hours of each outdoor workout in the next two
/// days. Rain likely during one makes a `RainAsk`, with the next dry, free
/// stretch that day when there is one. No network and no clock of its own.
enum RainCheck {
    /// How far ahead a workout is checked.
    static let horizon: TimeInterval = 48 * 3600
    /// A workout hour is wet from this chance of rain.
    static let wetFrom = 60
    /// An hour to move into has to be clearly dry.
    static let dryBelow = 30
    /// Workouts are only moved between these hours of the day.
    static let earliestHour = 6
    static let latestHour = 22

    /// Outdoors, in the names Apple Health and the plan use.
    static let outdoorTypes: Set<String> = ["Running", "Walking", "Cycling"]

    /// The plan's outdoor workouts that start within 48 hours. One already moved indoors doesn't count.
    static func outdoorSessions(_ plan: [PlanItem], now: Date) -> [PlanItem] {
        plan.filter {
            outdoorTypes.contains($0.slot.activityType) && $0.slot.place == nil
                && $0.slot.start > now && $0.slot.start <= now.addingTimeInterval(horizon)
        }
        .sorted { $0.slot.start < $1.slot.start }
    }

    static func key(for session: PlanItem, calendar: Calendar) -> String {
        "rain|\(session.id)|\(day(session.slot.start, calendar))"
    }

    /// One ask per outdoor workout with rain likely. `plan` is the whole plan, so a window never lands on another workout.
    static func asks(plan: [PlanItem], forecast: Forecast, busy: [Busy], now: Date, calendar: Calendar) -> [RainAsk] {
        outdoorSessions(plan, now: now).compactMap { session in
            let wet = forecast.hours(from: session.slot.start, to: session.slot.end).filter { $0.probability >= wetFrom }
            guard !wet.isEmpty else { return nil }
            let window = dryWindow(for: session, plan: plan, forecast: forecast, busy: busy, now: now, calendar: calendar)
            return RainAsk(
                session: session,
                wetHours: wet.map { RainAsk.WetHour(start: $0.start, probability: $0.probability, millimeters: $0.millimeters) },
                dryWindow: window,
                intent: window.map { intent(moving: session, into: $0, calendar: calendar) },
                key: key(for: session, calendar: calendar)
            )
        }
    }

    /// The first stretch on the workout's own day, from now on, that is dry in
    /// the forecast, free on the calendar and the plan, and long enough.
    static func dryWindow(for session: PlanItem, plan: [PlanItem], forecast: Forecast, busy: [Busy],
                          now: Date, calendar: Calendar) -> DateInterval? {
        let day = calendar.startOfDay(for: session.slot.start)
        guard let open = calendar.date(byAdding: .hour, value: earliestHour, to: day),
              let close = calendar.date(byAdding: .hour, value: latestHour, to: day) else { return nil }
        let from = max(open, now.addingTimeInterval(30 * 60))
        guard from < close else { return nil }
        let length = session.slot.end.timeIntervalSince(session.slot.start)

        // Dry hours, joined into stretches.
        var dry: [DateInterval] = []
        for hour in forecast.hours(from: from, to: close).sorted(by: { $0.start < $1.start }) where hour.probability < dryBelow {
            let end = hour.start.addingTimeInterval(3600)
            if let last = dry.last, last.end == hour.start {
                dry[dry.count - 1] = DateInterval(start: last.start, end: end)
            } else {
                dry.append(DateInterval(start: hour.start, end: end))
            }
        }
        let taken = (busy.map { ($0.start, $0.end) }
            + plan.filter { $0.id != session.id }.map { ($0.slot.start, $0.slot.end) })
            .sorted { $0.0 < $1.0 }

        for stretch in dry {
            var cursor = max(stretch.start, from)
            let end = min(stretch.end, close)
            for block in taken where block.1 > cursor && block.0 < end {
                if block.0.timeIntervalSince(cursor) >= length { return DateInterval(start: cursor, end: block.0) }
                cursor = max(cursor, block.1)
            }
            if end.timeIntervalSince(cursor) >= length { return DateInterval(start: cursor, end: end) }
        }
        return nil
    }

    /// `{ kind: "move", targetWorkoutId, day, after, before }`: the calendar engine picks the exact time inside.
    static func intent(moving session: PlanItem, into window: DateInterval, calendar: Calendar) -> CalendarIntent {
        CalendarIntent(kind: "move", targetWorkoutId: session.id, day: day(window.start, calendar),
                       after: clock(window.start, calendar), before: clock(window.end, calendar))
    }

    /// The local day, `YYYY-MM-DD`.
    static func day(_ date: Date, _ calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// The local time, `HH:MM`.
    static func clock(_ date: Date, _ calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}
