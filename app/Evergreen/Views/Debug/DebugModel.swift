#if DEBUG
import Foundation

/// Debug builds only: stands in for the API so the app can be looked at
/// without a key or a network (`-debug_ai YES`). It never answers: with it,
/// the week comes from the plan rules, the memory table from the memory
/// bundle's own rules, and "Ask Evergreen" from each engine's rules.
struct DebugModel: LanguageModel {
    func reply(to request: ModelRequest) async throws(ModelFailure) -> ModelReply {
        throw .unavailable
    }
}
#endif
