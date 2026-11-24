import Foundation
import SwiftData
import os

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
    static var startedFresh: Bool { fresh.withLock { $0 } }
    private static let fresh = OSAllocatedUnfairLock(initialState: false)

    static func container(at url: URL = Storage.url) -> ModelContainer {
        let schema = Schema(versionedSchema: StoreV1.self)
        let configuration = ModelConfiguration(schema: schema, url: url)
        if let container = open(schema, configuration) { return container }
        // Set the unreadable store aside rather than deleting it.
        fresh.withLock { $0 = true }
        setAside(url)
        if let container = open(schema, configuration) { return container }
        // Nothing on disk works: run in memory so the app still opens.
        let memory = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        // An in-memory store can't fail to open for a fixed schema.
        return try! ModelContainer(for: schema, configurations: memory)
    }

    /// The store on disk, opened and migrated; nil with the reason in the log.
    private static func open(_ schema: Schema, _ configuration: ModelConfiguration) -> ModelContainer? {
        Logger.model.attempt("The saved store couldn't be opened") {
            try ModelContainer(for: schema, migrationPlan: StoreMigration.self, configurations: configuration)
        }
    }

    /// Renames the store and its side files to `.unreadable-<time>`. A side file that isn't there is skipped.
    private static func setAside(_ url: URL) {
        let files = FileManager.default
        _ = Logger.model.attempt("The store's folder couldn't be made") {
            try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        }
        let path = url.path(percentEncoded: false), stamp = Int(Date().timeIntervalSince1970)
        for suffix in ["", "-shm", "-wal"] where files.fileExists(atPath: path + suffix) {
            _ = Logger.model.attempt("The unreadable store couldn't be set aside") {
                try files.moveItem(at: URL(filePath: path + suffix), to: URL(filePath: path + ".unreadable-\(stamp)" + suffix))
            }
        }
    }
}
