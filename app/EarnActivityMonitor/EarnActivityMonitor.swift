import DeviceActivity

/// Locks a group again when its unlocked time is up: the relock schedule starts at that moment.
/// Its end locks too, in case the start was missed.
final class EarnActivityMonitor: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        EarnedTime.relock(activity)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        EarnedTime.relock(activity)
    }
}
