import Foundation

/// Where the triggers keep their small facts: the running shoes, what was
/// already notified, what was shown for the first time, the last forecast.
/// One value per key, as JSON.
@MainActor
protocol TriggerStore: AnyObject {
    func data(for key: String) -> Data?
    func set(_ data: Data?, for key: String)
}

extension TriggerStore {
    func value<Value: Decodable>(_ type: Value.Type, for key: String) -> Value? {
        data(for: key).flatMap { try? JSONDecoder.contract.decode(type, from: $0) }
    }

    func save<Value: Encodable>(_ value: Value?, for key: String) {
        set(value.flatMap { try? JSONEncoder.contract.encode($0) }, for: key)
    }
}

/// The app's store: one small file per key in Application Support/Triggers.
@MainActor
final class FileTriggerStore: TriggerStore {
    private let folder: URL

    init(folder: URL = URL.applicationSupportDirectory.appending(path: "Triggers")) {
        self.folder = folder
    }

    func data(for key: String) -> Data? {
        try? Data(contentsOf: folder.appending(path: "\(key).json"))
    }

    func set(_ data: Data?, for key: String) {
        let file = folder.appending(path: "\(key).json")
        guard let data else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

/// A store that lives only as long as the model: tests, and a seeded launch.
@MainActor
final class MemoryTriggerStore: TriggerStore {
    private var values: [String: Data] = [:]

    func data(for key: String) -> Data? { values[key] }
    func set(_ data: Data?, for key: String) { values[key] = data }
}
