import JavaScriptCore

/// The file bridge the memory bundle expects before its script runs:
/// `globalThis.memoryIO` (memory-agent/docs/PHONE.md), on top of `MemoryFiles`.
enum MemoryHost {
    static func install(in context: JSContext) {
        guard let host = JSValue(newObjectIn: context) else { return }
        func set(_ name: String, _ block: Any) {
            host.setObject(block, forKeyedSubscript: name as NSString)
        }
        let one: [(String, @convention(block) (String) -> [String: Any])] = [
            ("readFile", { MemoryFiles.readFile($0) }), ("fsyncFile", { MemoryFiles.fsyncFile($0) }),
            ("fsyncDir", { MemoryFiles.fsyncDir($0) }), ("remove", { MemoryFiles.remove($0) }),
            ("mkdir", { MemoryFiles.mkdir($0) }), ("lstat", { MemoryFiles.lstat($0) }),
            ("realpath", { MemoryFiles.realpath($0) }), ("readdir", { MemoryFiles.readdir($0) }),
        ]
        for (name, block) in one { set(name, unsafeBitCast(block, to: AnyObject.self)) }
        let two: [(String, @convention(block) (String, String) -> [String: Any])] = [
            ("writeFile", { MemoryFiles.writeFile($0, $1) }), ("rename", { MemoryFiles.rename($0, $1) }),
        ]
        for (name, block) in two { set(name, unsafeBitCast(block, to: AnyObject.self)) }
        let sha256: @convention(block) (String) -> String = { MemoryFiles.sha256($0) }
        let hmac: @convention(block) (String, String) -> String = { MemoryFiles.hmac($0, $1) }
        set("sha256", unsafeBitCast(sha256, to: AnyObject.self))
        set("hmac", unsafeBitCast(hmac, to: AnyObject.self))
        context.setObject(host, forKeyedSubscript: "__memoryHost" as NSString)
        context.evaluateScript("""
        (() => {
          const h = globalThis.__memoryHost;
          const r = (x) => {
            if (x.e !== undefined) { const error = new Error(x.e); error.code = x.e; throw error; }
            return x.v;
          };
          globalThis.memoryIO = {
            platform: 'posix',
            readFile: (p) => r(h.readFile(p)),
            writeFile: (p, t) => { r(h.writeFile(p, t)); },
            fsyncFile: (p) => { r(h.fsyncFile(p)); },
            fsyncDir: (p) => { r(h.fsyncDir(p)); },
            rename: (a, b) => { r(h.rename(a, b)); },
            remove: (p) => { r(h.remove(p)); },
            mkdir: (p) => { r(h.mkdir(p)); },
            lstat: (p) => r(h.lstat(p)),
            realpath: (p) => r(h.realpath(p)),
            readdir: (p) => r(h.readdir(p)),
            sha256: (t) => h.sha256(t),
            hmac: (s, d) => h.hmac(s, d),
          };
        })();
        """)
    }
}
