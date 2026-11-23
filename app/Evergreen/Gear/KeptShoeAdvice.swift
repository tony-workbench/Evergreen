import Foundation

/// The search's answer for one pair of shoes, kept so the same pair isn't searched for twice.
struct KeptShoeAdvice: Codable, Equatable, Sendable {
    static let storeKey = "shoe-advice"

    /// The pair: the day it was started and its name.
    var pair: String
    var advice: ShoeAdvice

    static func pair(_ log: ShoeLog) -> String {
        "\(Int(log.startedOn.timeIntervalSince1970))|\(log.name ?? "")"
    }

    static func load(for log: ShoeLog, from defaults: UserDefaults) -> ShoeAdvice? {
        guard let kept = defaults.data(forKey: storeKey).flatMap({ try? JSONDecoder().decode(KeptShoeAdvice.self, from: $0) }),
              kept.pair == pair(log) else { return nil }
        return kept.advice
    }

    static func save(_ advice: ShoeAdvice, for log: ShoeLog, to defaults: UserDefaults) {
        defaults.set(try? JSONEncoder().encode(KeptShoeAdvice(pair: pair(log), advice: advice)), forKey: storeKey)
    }
}
