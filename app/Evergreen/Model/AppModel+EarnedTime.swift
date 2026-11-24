import Foundation

extension AppModel {
    /// Counts the workouts into earned screen time (after every Apple Health read) and locks unlocks that ran out.
    func refreshEarnedTime() {
        earnedTime.refresh(workouts: workouts, now: now, calendar: calendar)
    }

    /// A new workout in Apple Health, even with the app closed: read Health, which adds it to the earned time.
    /// While the phone is locked Health can't be read, so the answer is false and HealthKit delivers it again later.
    func watchWorkoutsForEarnedTime() {
        guard onDevice, persona.isReal else { return }
        earnedTime.watchWorkouts { [weak self] in
            guard let self, await self.deviceUnlocked else { return false }
            await self.refreshHealth()
            return true
        }
    }

    /// Finishing the workout page after a missed training day gives every group its comeback minutes today.
    func noteComeback(_ day: String) {
        let planned = (homeWeek?.days ?? []).filter(\.trains).map(\.day)
        let done = workoutLog.doneDays.filter { $0 != day }
        guard EarnMath.isComeback(today: day, planned: planned, done: done) else { return }
        earnedTime.markComeback(day)
        log("Back after a missed day: \(EarnRules.comebackMinutes) more minutes of each locked group today")
    }
}
