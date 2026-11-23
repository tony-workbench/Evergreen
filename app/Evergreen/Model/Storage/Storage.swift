import Foundation
import SwiftData

/// The store's shape, versioned so a later change can migrate what is saved.
enum StoreV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)
    static var models: [any PersistentModel.Type] { [Run.self, ActionRecord.self, LoggedWorkout.self] }
}

/// How one version of the store becomes the next. One version so far, so no steps.
enum StoreMigration: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] { [StoreV1.self] }
    static var stages: [MigrationStage] { [] }
}

/// Opens the app's store. It never crashes the app: a store that can't be
/// opened or migrated is set aside (kept, renamed) and a fresh one started;
/// if even that fails, the app runs on a store in memory. `startedFresh`
/// says so, and the app tells the person once.
enum Storage {
    static let url = URL.applicationSupportDirectory.appending(path: "Evergreen.store")
    /// True when the saved store couldn't be used and the app began again.
    nonisolated(unsafe) private(set) static var startedFresh = false

    static func container(at url: URL = Storage.url) -> ModelContainer {
        let schema = Schema(versionedSchema: StoreV1.self)
        let configuration = ModelConfiguration(schema: schema, url: url)
        if let container = try? ModelContainer(for: schema, migrationPlan: StoreMigration.self, configurations: configuration) {
            return container
        }
        // Set the unreadable store aside rather than deleting it.
        startedFresh = true
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let stamp = Int(Date().timeIntervalSince1970)
        for suffix in ["", "-shm", "-wal"] {
            let file = URL(filePath: url.path(percentEncoded: false) + suffix)
            try? FileManager.default.moveItem(at: file, to: URL(filePath: url.path(percentEncoded: false) + ".unreadable-\(stamp)" + suffix))
        }
        if let container = try? ModelContainer(for: schema, migrationPlan: StoreMigration.self, configurations: configuration) {
            return container
        }
        // Nothing on disk works: run in memory so the app still opens.
        let memory = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        // An in-memory store can't fail to open for a fixed schema.
        return try! ModelContainer(for: schema, configurations: memory)
    }
}
