import Foundation

/// The engines behind the agents and the loop that connects them. Everything
/// runs on the phone except the model, which is reached with the person's own key.
extension AppModel {
    /// The plan rules and the calendar engine, loaded once.
    nonisolated static let planBundle = JSBundle(resource: BundlePlanRules.resource)
    nonisolated static let calendarBundle = JSBundle(resource: BundleCalendar.resource)

    /// Busy times on the person's other calendars as last read; none when the calendar is off. Reading them is a calendar fetch, so it isn't done on every access.
    var busyNow: [Busy] { busyCache }

    /// Reads the calendar's busy times again (on a tick or a calendar change) and keeps them.
    @discardableResult
    func refreshBusy() async -> [Busy] {
        busyCache = onDevice ? await calendarSync.busyTimes(from: storyDay) : []
        // An event away from home makes its day a day out, so the days are worked out again with the calendar.
        await refreshDayKinds()
        return busyCache
    }

    /// The plan rules over this person's Health history and calendar.
    var planRules: BundlePlanRules? {
        Optional(Self.planBundle).map {
            BundlePlanRules(bundle: $0, history: HistoryPayload(workouts: workouts, days: health.days, cal: calendar),
                            busy: busyNow, timeZone: calendar.timeZone,
                            rules: userRules.isOn ? userRules : nil, dayKinds: dayKinds, carry: carry, queue: queue,
                            doneToday: homeDoneToday)
        }
    }

    /// The calendar engine over this person's busy times and plan.
    var calendarEngine: BundleCalendar? {
        BundleCalendar(bundle: Self.calendarBundle, busy: busyNow, planned: plan, timeZone: calendar.timeZone)
    }

    /// Yesterday's planned sessions and whether Health shows them done, for the memory agent.
    var yesterdayOutcomes: [Outcome] {
        guard let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now)) else { return [] }
        let day = LocalTime(yesterday, in: calendar.timeZone).day
        let records = plan.map { item -> PlanRecord in
            let activity = ActivityKind(healthType: item.slot.activityType)
            let start = LocalTime(item.slot.start, in: calendar.timeZone)
            return PlanRecord(sessionId: item.id, day: start.day, activity: activity, plannedStart: start)
        }
        let done = workouts.map {
            HealthWorkout(activityType: $0.activityType, start: LocalTime($0.start, in: calendar.timeZone).text,
                          durationMin: $0.end.timeIntervalSince($0.start) / 60)
        }
        return HandOff.outcomesFor(records, workouts: done, day: day)
    }

    /// The loop, when there is a model to think with and the engines loaded.
    func orchestrator() -> Orchestrator? {
        guard let model = languageModel, let memoryTable, let planRules, let calendarEngine else { return nil }
        let writer = ClosureWriter { @MainActor [weak self] blocks in self?.write(blocks) ?? false }
        return Orchestrator(memory: memoryTable, rules: planRules, calendar: calendarEngine, writer: writer,
                            model: model, modelId: AIModels.model(), timeZone: calendar.timeZone)
    }

    /// Writes confirmed calendar blocks into the plan (the calendar follows
    /// the plan): a new block is added like any agent action, so Undo works;
    /// a moved or resized one moves its workout; a cancelled one is taken off.
    func write(_ blocks: [PreviewBlock]) -> Bool {
        guard !blocks.isEmpty else { return false }
        for block in blocks {
            guard let start = block.start.date, let end = block.end.date else { return false }
            let id = block.sessionId ?? block.id
            let existing = plan.first { $0.id == id || $0.id == block.id }
            switch block.status {
            case "cancelled":
                // Off the plan altogether, wherever it had been moved to.
                if let existing { remove(existing) }
            case "moved", "resized":
                // The block's own start and end: a resize changes the length.
                if let existing { move(existing, to: start, end: end) }
            default:
                guard block.activity != .rest, existing == nil else { continue }
                // An activity outside the list is kept by its own name, so the calendar and the rows can say it.
                let named = block.activity == .other ? Activity.label(block.title) : nil
                let slot = Slot(start: start, end: end, activityType: named ?? block.activity.healthType)
                store.add(AgentAction(id: id, kind: .addWorkout, title: "Added a \(slot.minutes)-minute \(Activity.noun(slot))",
                                      planItemId: id, after: slot, reason: block.reason, createdAt: now))
            }
        }
        save()
        return true
    }
}
