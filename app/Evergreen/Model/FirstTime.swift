import Foundation

/// The three things Evergreen does on its own. The first time each one really
/// happens, one muted line says what it was; after that, never again.
enum FirstTimeKind: String, Codable, CaseIterable, Sendable {
    case movedWorkout = "moved_workout"
    case rain
    case shoes

    /// The line, shown once.
    var line: String {
        switch self {
        case .movedWorkout: "That’s the first workout I’ve moved for you. Undo puts it back."
        case .rain: "That’s my first rain check. I only look at the hours of your outdoor workouts."
        case .shoes: "That’s my first shoe check. The distance comes from your runs in Apple Health."
        }
    }
}

/// Which first-time lines have been shown.
@MainActor
struct FirstTime {
    static let storeKey = "first-time"

    let store: any TriggerStore

    /// The line for this kind, until it has been shown.
    func line(for kind: FirstTimeKind) -> String? {
        shown.contains(kind.rawValue) ? nil : kind.line
    }

    func markShown(_ kind: FirstTimeKind) {
        var shown = shown
        guard shown.insert(kind.rawValue).inserted else { return }
        store.save(shown.sorted(), for: Self.storeKey)
    }

    private var shown: Set<String> {
        Set(store.value([String].self, for: Self.storeKey) ?? [])
    }
}
