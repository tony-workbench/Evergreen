import Foundation

/// What has already been said, so nothing is said twice: one key per event,
/// session and day ("rain|plan-me-2026-11-22-running|2026-11-22").
@MainActor
struct NotifiedLedger {
    static let storeKey = "notified"
    /// Keys older than this are dropped; nothing that old can come up again.
    static let keep: TimeInterval = 45 * 24 * 3600

    let store: any TriggerStore

    /// True the first time a key is seen, and never again.
    func firstTime(_ key: String, now: Date) -> Bool {
        var seen = store.value([String: Date].self, for: Self.storeKey) ?? [:]
        guard seen[key] == nil else { return false }
        seen = seen.filter { now.timeIntervalSince($0.value) < Self.keep }
        seen[key] = now
        store.save(seen, for: Self.storeKey)
        return true
    }

    func contains(_ key: String) -> Bool {
        store.value([String: Date].self, for: Self.storeKey)?[key] != nil
    }
}
