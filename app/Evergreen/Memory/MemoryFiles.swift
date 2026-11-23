import CryptoKit
import Darwin
import Foundation

/// The file side of the memory bundle's `memoryIO` (memory-agent/docs/PHONE.md),
/// with the same POSIX rules as the Node version (`src/store/node/io-node.mjs`):
/// new files only, no following a symlink at the last component, atomic
/// rename. Each call returns `["v": value]` or `["e": "ENOENT"]`; a small JS
/// shim in `MemoryHost` turns the error into a throw with that `code`.
enum MemoryFiles {
    typealias Answer = [String: Any]

    static func readFile(_ path: String) -> Answer {
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return failure() }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do {
            let data = try handle.readToEnd() ?? Data()
            return ["v": String(decoding: data, as: UTF8.self)]
        } catch {
            return ["e": "EIO"]
        }
    }

    static func writeFile(_ path: String, _ text: String) -> Answer {
        let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { return failure() }
        defer { close(fd) }
        let bytes = Array(text.utf8)
        var written = 0
        while written < bytes.count {
            let n = bytes[written...].withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
            if n < 0 { return failure() }
            written += n
        }
        return done
    }

    static func fsyncFile(_ path: String) -> Answer {
        sync(open(path, O_RDWR | O_NOFOLLOW | O_CLOEXEC))
    }

    static func fsyncDir(_ path: String) -> Answer {
        sync(open(path, O_RDONLY | O_CLOEXEC))
    }

    static func rename(_ from: String, _ to: String) -> Answer {
        Darwin.rename(from, to) == 0 ? done : failure()
    }

    /// Deletes a file or symlink; already gone is fine.
    static func remove(_ path: String) -> Answer {
        unlink(path) == 0 || errno == ENOENT ? done : failure()
    }

    static func mkdir(_ path: String) -> Answer {
        Darwin.mkdir(path, 0o700) == 0 ? done : failure()
    }

    static func lstat(_ path: String) -> Answer {
        var info = stat()
        guard Darwin.lstat(path, &info) == 0 else { return failure() }
        return ["v": fields(info)]
    }

    static func realpath(_ path: String) -> Answer {
        guard let resolved = Darwin.realpath(path, nil) else { return failure() }
        defer { free(resolved) }
        return ["v": String(cString: resolved)]
    }

    static func readdir(_ path: String) -> Answer {
        guard let dir = opendir(path) else { return failure() }
        defer { closedir(dir) }
        var entries: [[String: Any]] = []
        while let entry = Darwin.readdir(dir) {
            let name = withUnsafeBytes(of: entry.pointee.d_name) { raw in
                String(decoding: raw.prefix(Int(entry.pointee.d_namlen)), as: UTF8.self)
            }
            guard name != ".", name != ".." else { continue }
            var info = stat()
            guard Darwin.lstat("\(path)/\(name)", &info) == 0 else { return failure() }
            entries.append(fields(info).merging(["name": name]) { $1 })
        }
        return ["v": entries]
    }

    static func sha256(_ text: String) -> String {
        hex(SHA256.hash(data: Data(text.utf8)))
    }

    /// Lowercase hex HMAC-SHA256 of `data` under `secret`, as `hostHmac` expects.
    static func hmac(_ secret: String, _ data: String) -> String {
        hex(HMAC<SHA256>.authenticationCode(for: Data(data.utf8), using: SymmetricKey(data: Data(secret.utf8))))
    }

    // MARK: Helpers

    private static var done: Answer { ["v": NSNull()] }

    private static func sync(_ fd: Int32) -> Answer {
        guard fd >= 0 else { return failure() }
        defer { close(fd) }
        return fsync(fd) == 0 ? done : failure()
    }

    private static func fields(_ info: stat) -> [String: Any] {
        let type = info.st_mode & S_IFMT
        return [
            "isFile": type == S_IFREG, "isDirectory": type == S_IFDIR, "isSymbolicLink": type == S_IFLNK,
            "dev": Int(info.st_dev), "ino": Int(truncatingIfNeeded: info.st_ino),
        ]
    }

    private static func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func failure(_ code: Int32 = errno) -> Answer {
        let names: [Int32: String] = [
            ENOENT: "ENOENT", EEXIST: "EEXIST", ELOOP: "ELOOP", ENOTDIR: "ENOTDIR", EISDIR: "EISDIR",
            EACCES: "EACCES", EPERM: "EPERM", ENOTEMPTY: "ENOTEMPTY", ENOSPC: "ENOSPC", EIO: "EIO",
            EINVAL: "EINVAL", ENOTSUP: "ENOTSUP", EOPNOTSUPP: "EOPNOTSUPP", EBADF: "EBADF",
        ]
        return ["e": names[code] ?? "E\(code)"]
    }
}
