import CryptoKit
import Foundation
import os
import Security

/// The person's own Gemini API key. Kept only in the Keychain on this phone,
/// sent only to Google's Gemini API, never logged or put in an event, and
/// removed with one tap. The app shows "Connected" and the last four
/// characters, never the key.
///
/// Development only: an unsigned simulator build has no Keychain. There the
/// key is kept sealed with AES-GCM in Application Support, with the 32-byte
/// sealing key in its own owner-only file beside it, so a copied file
/// carries no usable key. That code exists only in a debug build for the simulator; every other build uses the Keychain alone.
struct AIKey: Sendable {
    /// The Keychain account, so tests can use their own.
    var account = "gemini_api_key"

    static let prefix = "enc:v1:"

    func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: AnyObject?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data, let key = String(data: data, encoding: .utf8), !key.isEmpty {
            return key
        }
        #if DEBUG && targetEnvironment(simulator)
        guard Self.exists(sealedFile) else { return nil }
        return Logger.agent.attempt("The sealed key file couldn't be read") { try String(contentsOf: sealedFile, encoding: .utf8) }.flatMap(open)
        #else
        return nil
        #endif
    }

    /// Saves the key (whitespace trimmed). False when it's empty or nothing could be stored.
    @discardableResult
    func save(_ key: String) -> Bool {
        let key = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return false }
        remove()
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(key.utf8),
        ]
        if SecItemAdd(add as CFDictionary, nil) == errSecSuccess { return true }
        #if DEBUG && targetEnvironment(simulator)
        // No Keychain on an unsigned simulator build: the sealed file stands in. Nowhere else.
        guard let sealed = seal(key), Logger.agent.attempt("The sealed key file couldn't be written", {
            try Data(sealed.utf8).write(to: sealedFile, options: [.atomic, .completeFileProtection])
        }) != nil else { return false }
        Self.ownerOnly(sealedFile)
        return true
        #else
        return false
        #endif
    }

    func remove() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        for file in [sealedFile, boxKeyFile] where Self.exists(file) {
            _ = Logger.agent.attempt("A key file couldn't be removed") { try FileManager.default.removeItem(at: file) }
        }
    }

    private static func exists(_ file: URL) -> Bool { FileManager.default.fileExists(atPath: file.path(percentEncoded: false)) }

    /// "…a1b2": all the app ever shows of a key.
    static func lastFour(_ key: String) -> String { "…" + key.suffix(4) }

    // MARK: The sealed file (development builds without a Keychain)

    var sealedFile: URL { URL.applicationSupportDirectory.appending(path: "\(account).sealed") }
    var boxKeyFile: URL { URL.applicationSupportDirectory.appending(path: "\(account).boxkey") }

    /// AES-256: a 32-byte sealing key.
    private static let boxKeyBytes = 32

    /// The 32-byte sealing key, made once and kept in its own owner-only file.
    private func boxKey(create: Bool) -> SymmetricKey? {
        if Self.exists(boxKeyFile), let data = Logger.agent.attempt("The sealing key couldn't be read", { try Data(contentsOf: boxKeyFile) }),
           data.count == Self.boxKeyBytes {
            return SymmetricKey(data: data)
        }
        guard create else { return nil }
        _ = Logger.agent.attempt("The key folder couldn't be made") {
            try FileManager.default.createDirectory(at: URL.applicationSupportDirectory, withIntermediateDirectories: true)
        }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        guard FileManager.default.createFile(atPath: boxKeyFile.path(percentEncoded: false), contents: data, attributes: [.posixPermissions: 0o600]) else { return nil }
        return key
    }

    /// "enc:v1:<base64 of nonce, ciphertext and tag>".
    func seal(_ text: String) -> String? {
        guard let key = boxKey(create: true),
              let box = Logger.agent.attempt("A value couldn't be sealed", { try AES.GCM.seal(Data(text.utf8), using: key, authenticating: Data(account.utf8)) }),
              let combined = box.combined
        else { return nil }
        return Self.prefix + combined.base64EncodedString()
    }

    /// The text of a sealed value; nil when it isn't one, was sealed with another key, or was changed.
    func open(_ value: String) -> String? {
        guard value.hasPrefix(Self.prefix), let raw = Data(base64Encoded: String(value.dropFirst(Self.prefix.count))),
              let key = boxKey(create: false),
              let data = Logger.agent.attempt("A sealed value couldn't be opened (another key, or changed)", {
                  try AES.GCM.open(AES.GCM.SealedBox(combined: raw), using: key, authenticating: Data(account.utf8))
              })
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func ownerOnly(_ file: URL) {
        _ = Logger.agent.attempt("A key file couldn't be made owner-only") {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path(percentEncoded: false))
        }
    }
}
