import Foundation

/// The rules behind the agent card, on the phone: which planned workouts
/// are done, and moving one off a meeting that lands on it
/// (StandInAgent+SlotDefense.swift). No network.
struct StandInAgent {
    /// A window counts as missed 30 minutes after it ends, and a workout up to 30
    /// minutes late still finishes it.
    static let grace: TimeInterval = 30 * 60

    func tick(_ s: TickSnapshot) -> TickResponse {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: s.timeZone) ?? .current

        let counted = Self.mergeDuplicates(s.workouts)
            .filter { $0.minutes >= 10 && $0.start <= s.now }
            .sorted { $0.start < $1.start }

        // Completions: each workout finishes the first open item that day whose
        // window hadn't already passed when the workout started.
        let plan = s.plan.sorted { $0.slot.start < $1.slot.start }
        var completions: [Completion] = []
        var done = Set<String>()
        for workout in counted {
            guard let item = plan.first(where: {
                !done.contains($0.id)
                    && cal.isDate($0.slot.start, inSameDayAs: workout.start)
                    && $0.slot.end.addingTimeInterval(Self.grace) >= workout.start
            }) else { continue }
            done.insert(item.id)
            completions.append(Completion(planItemId: item.id, workoutId: workout.id))
        }

        var actions: [AgentAction] = []
        let known = Set(s.actions.map(\.id)).union(s.undoneActionIds)

        var booked = plan

        // Slot defense: an upcoming workout a busy time landed on moves before
        // it can be missed. One action per workout and conflict, so an undone
        // move isn't made again.
        for item in booked.sorted(by: { $0.slot.start < $1.slot.start })
        where !done.contains(item.id) && item.slot.start > s.now {
            guard let conflict = s.busy.first(where: { $0.start < item.slot.end && $0.end > item.slot.start }) else {
                continue
            }
            let id = "defend-\(item.id)-\(Int(conflict.start.timeIntervalSince1970))"
            guard !known.contains(id),
                  let slot = Self.defendedSlot(
                      for: item, conflict: conflict, busy: s.busy,
                      others: booked.filter { $0.id != item.id }, now: s.now, cal: cal
                  ),
                  let index = booked.firstIndex(where: { $0.id == item.id })
            else { continue }
            booked[index].slot = slot
            let shrunk = slot.minutes < item.slot.minutes
            let at = conflict.start.formatted(date: .omitted, time: .shortened)
            actions.append(AgentAction(
                id: id, kind: shrunk ? .shrink : .move, planItemId: item.id,
                before: item.slot, after: slot,
                reason: shrunk
                    ? "Your calendar is busy around \(at), so I made it \(slot.minutes) minutes to fit."
                    : "That's the nearest free time, so it stays close to when you planned it.",
                createdAt: s.now
            ))
        }

        return TickResponse(actions: actions, completions: completions)
    }

    /// Same-type workouts overlapping by more than half of the shorter one count
    /// once, keeping the longer.
    static func mergeDuplicates(_ workouts: [Workout]) -> [Workout] {
        var kept: [Workout] = []
        for workout in workouts.sorted(by: { $0.minutes > $1.minutes }) {
            let duplicate = kept.contains { other in
                guard other.activityType == workout.activityType else { return false }
                let overlap = min(other.end, workout.end).timeIntervalSince(max(other.start, workout.start))
                return overlap > min(other.minutes, workout.minutes) * 60 / 2
            }
            if !duplicate { kept.append(workout) }
        }
        return kept
    }
}
