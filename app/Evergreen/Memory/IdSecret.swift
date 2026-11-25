import Foundation
import Security

/// The per-install secret behind every opaque id the memory bundle sends
/// (`usr_`, `occ_`): HMAC under it, so an id can't be tied back to a
/// person or a workout. Made once and kept in the Keychain on this device.
/// Where the Keychain can't keep it (an unsigned simulator build has none), it's
/// kept in a file in Application Support instead, so the ids, and with them the
/// person's memory, stay the same from one launch to the next.
enum IdSecret {
    private static let account = "memory_id_secret"

    static func load() -> String {
        if let saved = read() { return saved }
        #if DEBUG && targetEnvironment(simulator)
        if let saved = readFile() { return saved }
        #endif
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let secret = bytes.map { String(format: "%02x", $0) }.joined()
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(secret.utf8),
        ]
        #if DEBUG && targetEnvironment(simulator)
        // No Keychain on an unsigned simulator build: a file stands in there, and nowhere else.
        if SecItemAdd(add as CFDictionary, nil) != errSecSuccess {
            try? FileManager.default.createDirectory(at: URL.applicationSupportDirectory, withIntermediateDirectories: true)
            try? Data(secret.utf8).write(to: fileURL, options: [.atomic, .completeFileProtection])
        }
        #else
        SecItemAdd(add as CFDictionary, nil)
        #endif
        return read() ?? secret
    }

    private static var fileURL: URL { URL.applicationSupportDirectory.appending(path: "memory-id-secret") }

    private static func readFile() -> String? {
        (try? String(contentsOf: fileURL, encoding: .utf8)).flatMap { $0.count >= 16 ? $0 : nil }
    }

    private static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
