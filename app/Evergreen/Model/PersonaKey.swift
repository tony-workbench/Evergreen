import Foundation

/// Whose week a model shows: the person's own, from Apple Health, or the
/// fixed week the onboarding tour plays on its throwaway model.
enum PersonaKey: String {
    case me
    case tour

    /// Read from Apple Health.
    var isReal: Bool { self == .me }
}
