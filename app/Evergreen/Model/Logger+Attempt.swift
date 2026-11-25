import os

extension Logger {
    /// The app's model: the plan, the week, the rules and what is kept on the phone.
    static let model = Logger(subsystem: "com.evergreentraining.app", category: "model")
    /// Apple Health: reading the history and writing a finished home workout.
    static let health = Logger(subsystem: "com.evergreentraining.app", category: "health")
    /// The AI and the engines: the key kept on the phone, the bundles, and the answers from the network.
    static let agent = Logger(subsystem: "com.evergreentraining.app", category: "agent")

    /// `try?` that says what went wrong: the value, or nil with `failure` and the error in the log.
    func attempt<T>(_ failure: String, _ work: () throws -> T) -> T? {
        do {
            return try work()
        } catch {
            failed(failure, error)
            return nil
        }
    }

    /// `failure` and the error in the log, for a `do`/`catch` around an `await`, which `attempt` can't take.
    func failed(_ failure: String, _ error: any Error) {
        self.error("\(failure, privacy: .public): \(String(describing: error), privacy: .public)")
    }
}

extension KeyedDecodingContainer {
    /// One saved field, read on its own so the rest still reads: nil when it is missing, and nil with the error in the log
    /// when it is there but can't be read.
    func field<T: Decodable>(_ type: T.Type, _ key: Key, log: Logger = .model) -> T? {
        log.attempt("A saved field (\(key.stringValue)) couldn't be read; it takes its default") {
            try decodeIfPresent(type, forKey: key)
        } ?? nil
    }
}
