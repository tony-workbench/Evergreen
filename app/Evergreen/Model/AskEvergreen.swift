import Foundation
import Observation

/// "Ask Evergreen": one sentence in, one card out. A small router picks the
/// agent; the agent works with its tools; the answer shows on the card at the
/// top of Today. Everything here needs the person's own AI key, which is
/// connected, checked and removed here too.
@Observable
@MainActor
final class AskEvergreen {
    /// The app model this is part of: the clock, the plan, the engines and the other parts are read from it.
    @ObservationIgnored unowned let app: AppModel
    /// The last four characters of the connected AI key ("…a1b2"); nil when none is connected.
    var aiKeyTail: String?
    @ObservationIgnored let aiKeyStore: AIKey
    /// A key given for this run only, through the environment of a debug build: never stored, logged or shown.
    @ObservationIgnored var sessionKey: String?
    /// The models the connected key can use, from the last check.
    var aiModels: [String] = []
    /// Calls and tokens today.
    @ObservationIgnored let aiUsage = AIUsage()
    /// A model that answers from a script instead of the API (tests and debug screenshots).
    @ObservationIgnored var scriptedModel: (any LanguageModel)?
    /// The network session the AI is reached through (tests give a fake one).
    @ObservationIgnored var aiSession: URLSession = GeminiClient.privateSession
    /// Where "Ask Evergreen" stands.
    var ask = AskState.idle
    /// The question in flight, so it can be cancelled.
    @ObservationIgnored var askTask: Task<Void, Never>?
    /// A memory change the person asked for, waiting for their confirmation.
    var pendingMemory: PendingMemory?
    /// "One day" on the forget question: Today opens What I remember, where the days are.
    var memorySheetAsked = false
    /// "Ask Evergreen" answers from the engines' own rules instead of a model (debug screens and tests).
    @ObservationIgnored var askWithoutModel = false

    init(app: AppModel, key: AIKey) {
        self.app = app
        aiKeyStore = key
        aiKeyTail = app.onDevice ? key.load().map(AIKey.lastFour) : nil
    }

    /// Whether an AI key is connected.
    var aiConnected: Bool { aiKeyTail != nil }

    /// "Check connection & save": asks the API for this key's models, and
    /// saves the key in the Keychain only when that works. Nil when
    /// connected; otherwise one plain sentence on what went wrong, never
    /// with the key in it. An empty key checks the one already saved.
    func connectAI(key: String) async -> String? {
        let typed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let key = typed.isEmpty ? currentKey : typed else { return "Paste your key first." }
        do {
            aiModels = try await GeminiClient.models(key: key, session: aiSession)
        } catch {
            return AppModel.keyProblem(error)
        }
        if !typed.isEmpty {
            guard aiKeyStore.save(key) else { return "That didn’t save. Try again." }
            aiKeyTail = AIKey.lastFour(key)
        }
        app.log("AI connected: \(aiModels.count) models available")
        return nil
    }

    /// Removes the key from this phone.
    func disconnectAI() {
        aiKeyStore.remove()
        aiKeyTail = sessionKey == nil ? nil : ""
        aiModels = []
        ask = .idle
    }

    /// The key in use: one given for this run only (debug builds), else the saved one.
    var currentKey: String? { sessionKey ?? aiKeyStore.load() }

    /// The model to talk to: a scripted one when set (tests, debug), else the API with the person's key.
    var languageModel: (any LanguageModel)? {
        scriptedModel ?? currentKey.map { GeminiClient(key: $0, session: aiSession, usage: aiUsage) }
    }

    func dismissAsk() { ask = .idle }

    /// Asks in a task that the working card's Cancel can stop.
    func ask(_ sentence: String) {
        askTask?.cancel()
        // The task keeps the app model for as long as the question runs.
        askTask = Task { [app] in await app.askEvergreen(sentence) }
    }

    /// Stops the question in flight.
    func cancelAsk() {
        askTask?.cancel()
        askTask = nil
        ask = .idle
    }

    /// Carries out the memory change the person confirmed on its card.
    func confirmPendingMemory() async {
        guard let pending = pendingMemory else { return }
        pendingMemory = nil
        switch pending {
        case .stop(let keys, let title):
            for key in keys { await app.stop(key: key) }
            app.log("Stopped planning around \(title)")
        case .forgetDay(let day):
            await app.forget(.day(day))
            app.log("Forgot \(MemoryForgetControls.dayTitle(day))")
        case .forgetEverything:
            await app.forget(.everything)
            app.log("Forgot everything")
        case .forgetWhich:
            // A question, not a change: its buttons lead to one of the cases above.
            return
        }
        ask = .idle
        if app.weekPlan != nil { _ = try? await app.loadWeekPlan() }
    }

    /// Sorts the sentence and lets the right agent answer.
    func askEvergreen(_ sentence: String) async {
        let sentence = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sentence.isEmpty else { return }
        app.lastDecline = nil
        // Forgetting and stopping are recognised by code, before any model: they become a card to confirm.
        if aiConnected, let pending = MemoryCommand.match(sentence, today: LocalTime(app.now, in: app.calendar.timeZone).day, days: app.memoryState.days, rows: app.memoryRows) {
            pendingMemory = pending
            ask = .idle
            return
        }
        guard let model = languageModel else {
            ask = .problem("Connect your AI key first.")
            return
        }
        // Without a model (debug screens and tests) every agent answers from its engine's own rules,
        // so what is shown is still true to what was typed.
        if askWithoutModel {
            await askByRules(sentence)
            return
        }
        ask = .working(nil)
        do {
            let zone = app.calendar.timeZone
            let planned = app.plan.map { ($0.id, ActivityKind(healthType: $0.slot.activityType), LocalTime($0.slot.start, in: zone), $0.slot.minutes) }
            let sorter = CalendarAgent(model: model, modelId: AIModels.model(), schema: [:], now: LocalTime(app.now, in: zone), planned: planned)
            let names = sorter.target(in: " " + sentence.lowercased().replacing("’", with: "'") + " ") != nil
            let routed = try await Router(model: model, modelId: AIModels.model()).sort(sentence, memoryCommand: false, namesPlannedWorkout: names)
            guard !Task.isCancelled else { return }
            if routed.fellBack { app.fallbacks["router", default: 0] += 1 }
            let kind = routed.kind
            ask = .working(kind)
            switch kind {
            case .memory, .plan:
                try await answerInWords(sentence, as: kind, with: model)
            case .calendar:
                guard let engine = app.calendarEngine else {
                    ask = .problem("I can’t reach your calendar on this phone just now.")
                    return
                }
                let agent = CalendarAgent(model: model, modelId: AIModels.model(), schema: await engine.intentSchema(), now: LocalTime(app.now, in: zone),
                                          planned: planned)
                let read = await agent.intent(for: sentence)
                // The model's intent, or, when it couldn't give one, the sentence read by the engine's own rules.
                let result: CalendarResult? = if let intent = read.intent {
                    await engine.plan(intent, memory: app.calendarMemory, now: app.now)
                } else {
                    await engine.plan(request: sentence, memory: app.calendarMemory, now: app.now)
                }
                if read.source == .rules { app.fallbacks["calendar", default: 0] += 1 }
                // When the sentence asked for two things, the first is done and the person is told to ask again for the other.
                show(result, note: read.more ? "I did the first thing you asked. Ask again for the second." : nil)
            case .week:
                await answerWithAFreshWeek()
            case .none:
                ask = .answer(agent: .none, text: "That's not something I do. I plan your training, keep it on your calendar and remember your routine.")
            }
        } catch {
            ask = .problem(AppModel.plain(error))
        }
    }

    /// "Ask Evergreen" with no model: the sentence is sorted by a few words, a
    /// calendar sentence is read by the calendar engine's own rules, and the
    /// plan and memory answers are read straight from the week and the table.
    private func askByRules(_ sentence: String) async {
        let kind = Router.byWords(sentence)
        ask = .working(kind)
        switch kind {
        case .calendar:
            show(await app.calendarEngine?.plan(request: sentence, memory: app.calendarMemory, now: app.now))
        case .week:
            await answerWithAFreshWeek()
        case .plan:
            if app.plannedSessions.isEmpty { _ = try? await app.loadWeekPlan() }
            ask = .answer(agent: .plan, text: app.topSuggestion.map { "\(SuggestionWords.headline($0)). \(PlainWords.reason($0.reason))" }
                ?? "Nothing new to suggest this week.")
        case .memory:
            await app.refreshMemory()
            let lines = app.remembered.prefix(3).map(\.text)
            ask = .answer(agent: .memory, text: lines.isEmpty ? "Nothing yet. I learn your routine from your workouts." : lines.joined(separator: " "))
        case .none:
            ask = .answer(agent: .none, text: "That’s not something I do. I plan your training, keep it on your calendar and remember your routine.")
        }
    }

    /// What the calendar engine made of a sentence: its words when there is nothing to place, else the preview.
    private func show(_ result: CalendarResult?, note: String? = nil) {
        guard let result else {
            ask = .problem("I couldn’t work that out. Try saying it another way.")
            return
        }
        if result.proposed.isEmpty, result.question == nil {
            ask = .answer(agent: .calendar, text: result.message)
        } else {
            // The preview waits on Today; nothing is written until it is confirmed.
            app.placement = Placement(sessionKey: nil, result: result, note: note)
            ask = .idle
        }
    }

    /// Recommend, then place: the week is planned again, and each session the person accepts goes through the calendar.
    private func answerWithAFreshWeek() async {
        guard let week = try? await app.loadWeekPlan(fresh: true) else {
            ask = .problem("I couldn’t plan your week just now. Try again in a moment.")
            return
        }
        let count = app.openSuggestions.count
        ask = .answer(agent: .week, text: [week.summary, count == 0 ? "Nothing new to suggest this week." : "\(count) \(count == 1 ? "suggestion is" : "suggestions are") below. Add the ones you want."]
            .compactMap(\.self).joined(separator: " "))
    }

    /// The memory agent or the plan agent answers in words: the same loop, each with its own instructions and
    /// tools, and its own sentence from the data for when the model's answer can't be shown.
    private func answerInWords(_ sentence: String, as kind: AgentKind, with model: any LanguageModel) async throws(ModelFailure) {
        let aboutMemory = kind == .memory
        if !aboutMemory, app.plannedSessions.isEmpty { _ = try? await app.loadWeekPlan() }
        let loop = AgentLoop(model: model, modelId: AIModels.model(), system: aboutMemory ? MemoryAgent.system : PlanTalk.system,
                             tools: aboutMemory ? MemoryAgent.tools(app) : PlanTalk.tools(app))
        let result = try await loop.run(sentence)
        guard !Task.isCancelled else { return }
        // An answer carrying the system's own words is never shown: the same thing is said from the data instead.
        let fallback = aboutMemory ? MemoryAgent.fallback(app) : PlanTalk.fallback(app)
        switch result.ending {
        case .answered(let text):
            if ShownText.problem(with: text) != nil { app.fallbacks[kind.rawValue, default: 0] += 1 }
            // A change to memory waiting on its card is the answer.
            ask = pendingMemory != nil ? .idle : .answer(agent: kind, text: ShownText.shown(text, else: fallback))
        case .cancelled:
            ask = .idle
        case .tooManySteps, .stopped:
            app.fallbacks[kind.rawValue, default: 0] += 1
            ask = pendingMemory != nil ? .idle : .answer(agent: kind, text: fallback)
        }
    }
}
