import Foundation

/// Words for what went wrong with the AI, and the short list of what happened for Settings.
extension AppModel {
    /// Why a key couldn't be connected.
    nonisolated static func keyProblem(_ failure: ModelFailure) -> String {
        switch failure {
        case .keyRefused, .noKey:
            "Google didn’t accept that key. Check that you copied all of it."
        case .limited:
            "That key has hit its limit, or its credit has run out. Check it in Google AI Studio, then try again."
        case .invalid(let message) where message.lowercased().contains("billing") || message.lowercased().contains("free tier"):
            "That key needs billing turned on in Google AI Studio."
        case .unreachable:
            "I couldn’t reach Google. Check your connection and try again."
        case .unavailable, .invalid, .unreadable:
            "Google couldn’t check the key just now. Try again in a moment."
        }
    }

    /// Adds a line to the activity list in Settings: "07:02 Memory updated".
    func log(_ line: String) {
        activity = Array((["\(Date().formatted(date: .omitted, time: .shortened)) \(line)"] + activity).prefix(5))
    }

    /// A failure in words for the person. Never anything about the key itself.
    nonisolated static func plain(_ failure: ModelFailure) -> String {
        switch failure {
        case .noKey: "Connect your AI key first."
        case .keyRefused: "Your AI key was refused. Check it in Settings."
        case .limited: "Your AI key has hit its limit for now. Try again in a little while."
        case .unavailable, .unreachable: "I couldn't reach your AI just now. Try again in a moment."
        case .invalid, .unreadable: "Something went wrong with that request. Try saying it another way."
        }
    }
}

/// Ask Evergreen and the AI key as the views and the other parts of the app model reach them (AskEvergreen.swift).
extension AppModel {
    var aiKeyTail: String? {
        get { asking.aiKeyTail }
        set { asking.aiKeyTail = newValue }
    }

    var sessionKey: String? {
        get { asking.sessionKey }
        set { asking.sessionKey = newValue }
    }

    var aiModels: [String] {
        get { asking.aiModels }
        set { asking.aiModels = newValue }
    }

    var aiUsage: AIUsage { asking.aiUsage }

    var scriptedModel: (any LanguageModel)? {
        get { asking.scriptedModel }
        set { asking.scriptedModel = newValue }
    }

    var aiSession: URLSession {
        get { asking.aiSession }
        set { asking.aiSession = newValue }
    }

    var ask: AskState {
        get { asking.ask }
        set { asking.ask = newValue }
    }

    var askTask: Task<Void, Never>? {
        get { asking.askTask }
        set { asking.askTask = newValue }
    }

    var pendingMemory: PendingMemory? {
        get { asking.pendingMemory }
        set { asking.pendingMemory = newValue }
    }

    var memorySheetAsked: Bool {
        get { asking.memorySheetAsked }
        set { asking.memorySheetAsked = newValue }
    }

    var askWithoutModel: Bool {
        get { asking.askWithoutModel }
        set { asking.askWithoutModel = newValue }
    }

    var aiConnected: Bool { asking.aiConnected }

    func connectAI(key: String) async -> String? { await asking.connectAI(key: key) }

    func disconnectAI() { asking.disconnectAI() }

    var currentKey: String? { asking.currentKey }

    var languageModel: (any LanguageModel)? { asking.languageModel }

    func dismissAsk() { asking.dismissAsk() }

    func ask(_ sentence: String) { asking.ask(sentence) }

    func cancelAsk() { asking.cancelAsk() }

    func confirmPendingMemory() async { await asking.confirmPendingMemory() }

    func askEvergreen(_ sentence: String) async { await asking.askEvergreen(sentence) }
}
