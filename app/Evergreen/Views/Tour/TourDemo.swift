import SwiftData
import SwiftUI

/// The state the tour's scenes play: a throwaway model with a fixed week at
/// 4 PM, kept in memory. The scenes show the app's real screens on it, and the
/// real rules decide what happens; nothing here reaches the calendar,
/// notifications, Apple Health or the network.
@MainActor
final class TourDemo {
    private let container: ModelContainer
    let model: AppModel

    init() {
        let schema = Schema([Run.self, ActionRecord.self, LoggedWorkout.self])
        // An in-memory store can't fail to open for a fixed schema.
        container = try! ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: true))
        container.mainContext.insert(Run(persona: .tour, storyDay: Calendar.current.startOfDay(for: Date())))
        model = AppModel(context: container.mainContext, memory: nil, onDevice: false)
        model.run.clockMinutes = 16 * 60
        model.save()
        // One usual time, so "Not now" has something real to stop: the 6 AM run the last scene suggests.
        let day = model.calendar.date(byAdding: .day, value: 4, to: model.storyDay) ?? model.storyDay
        let weekday = (model.calendar.component(.weekday, from: day) + 5) % 7
        let since = LocalTime(model.storyDay, in: model.calendar.timeZone).day
        model.memoryRows = [MemoryRow(
            memoryId: "tour-usual-run", key: "tour-usual-run", slot: "usual_slot/run/\(weekday)/6", group: "routine", kind: "usual_slot",
            statement: "You usually run on \(PlainWords.weekdays[weekday]) around 6 AM.",
            data: ["activity": "run", "weekday": .number(Double(weekday)), "hour": 6, "minutes": 40, "weeksSeen": 4, "weeksTotal": 4],
            state: "saved", confidence: 1, since: since, updated: since)]
    }

    /// "Saturday, Nov 21 · 4:00 PM", the way Today writes it.
    var dateLine: String {
        "\(model.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())) · \(model.now.clock)"
    }

    /// Tonight's 6 PM run.
    var tonight: PlanItem? { model.todayPlan.first }

    /// A meeting lands on tonight's run: the move the agent makes, 45 minutes later.
    func moveTonight() -> AgentAction? {
        guard let item = tonight else { return nil }
        var after = item.slot
        after.start = item.slot.start.addingTimeInterval(45 * 60)
        after.end = item.slot.end.addingTimeInterval(45 * 60)
        let action = AgentAction(id: "defend-tour", kind: .move, planItemId: item.id, before: item.slot, after: after,
                                 reason: "A meeting landed on your workout.", createdAt: model.now)
        model.record(action)
        model.save()
        return action
    }

    /// Rain on tomorrow's first outdoor workout, with a dry afternoon and one gym nearby. The tour's own script: no forecast is read.
    func rainAsk() -> RainAsk? {
        let tomorrow = model.calendar.date(byAdding: .day, value: 1, to: model.calendar.startOfDay(for: model.now)) ?? model.now
        guard let session = model.plan.first(where: { model.calendar.isDate($0.slot.start, inSameDayAs: tomorrow) && $0.slot.activityType == "Running" }),
              let dry = model.calendar.date(bySettingHour: 14, minute: 0, second: 0, of: tomorrow)
        else { return nil }
        return RainAsk(session: session, wetHours: [.init(start: session.slot.start, probability: 80, millimeters: 2)],
                       dryWindow: DateInterval(start: dry, duration: 3 * 3600), intent: CalendarIntent(kind: "move", targetWorkoutId: session.id),
                       places: [IndoorPlace(name: "A gym nearby", coordinate: Coordinate(latitude: 0, longitude: 0), distanceMeters: 800)],
                       key: "tour-rain")
    }

    /// The workout at its new time, as the plan shows it once moved.
    func move(_ item: PlanItem, to start: Date) -> PlanItem {
        model.move(item, to: start)
        return model.plan.first { $0.id == item.id } ?? item
    }

    /// A run suggested for a free day at `hour`, from the usual time when `usual`.
    func suggestion(hour: Int, usual: Bool) -> WeekPlan.Session {
        let day = model.calendar.date(byAdding: .day, value: 4, to: model.storyDay) ?? model.storyDay
        let start = model.calendar.date(bySettingHour: hour, minute: hour == 8 ? 30 : 0, second: 0, of: day) ?? day
        let short = start.formatted(.dateTime.weekday(.abbreviated).locale(Locale(identifier: "en_US")))
        return WeekPlan.Session(
            id: "wk-tour-running", kind: "addWorkout", title: "Planned a 40-minute run",
            after: Slot(start: start, end: start.addingTimeInterval(40 * 60), activityType: "Running"),
            reason: usual ? "40 min run: your usual \(short) 06:00 slot (memory)." : "40 min run: your usual \(short) run.", basedOn: usual ? ["slot:running:\(short.lowercased()):06"] : []
        )
    }
}
