import Foundation

/// Which model Evergreen thinks with: one, for every step (sorting a
/// sentence, the calendar, the plan, the daily memory update, shoes). The
/// person can pick another of their account's models in Settings.
enum AIModels {
    static let standard = "gemini-3.8-flash"
    static let settingKey = "ai_model"

    static func model(defaults: UserDefaults = .standard) -> String {
        let chosen = defaults.string(forKey: settingKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // A model id is letters, digits, dots and dashes; anything else falls back.
        return chosen.wholeMatch(of: /[A-Za-z0-9][A-Za-z0-9.\-]{2,63}/) != nil ? chosen : standard
    }
}
