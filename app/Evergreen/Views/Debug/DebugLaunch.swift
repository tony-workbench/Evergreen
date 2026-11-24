#if DEBUG
import SwiftUI

/// Debug builds only, and only on a seeded launch (`-uiTest <name>`, see
/// Background/UITestSeed.swift): the app runs on made-up history with a
/// scripted AI (no key, no network), and these arguments open a screen
/// without tapping, for checks and screenshots:
///
///   -uiScreen memory|settings|permissions|noticed|connect|earned   open that screen
///   -uiAsk "sentence"                              ask Evergreen that sentence
///   -uiNoKey YES                                   stay without an AI key, to see the connect card
///   -uiAnswers YES                                 add the top suggestion and say not now to the next
///
/// all read through UITestArguments.swift, with the ones listed there: `-uiTestRoute` is taken here, once the week is
/// worked out.
struct DebugLaunch: ViewModifier {
    enum Screen: String, Identifiable {
        case memory, settings, permissions, noticed, connect, earned
        var id: String { rawValue }
    }

    @Environment(AppModel.self) private var model
    @State private var screen: Screen?
    /// How long the first tick, memory sync and week take to land after launch.
    private static let settleSeconds = 3

    func body(content: Content) -> some View {
        content
            .task { await run() }
            .sheet(item: $screen) { screen in
                switch screen {
                case .memory: MemoryView()
                case .settings: SettingsView()
                case .earned: EarnedTimeView()
                case .permissions: PermissionsView(onContinue: { self.screen = nil })
                case .noticed: NoticedView(onContinue: { self.screen = nil })
                case .connect: ConnectAIView(leave: "Not now", onDone: { self.screen = nil })
                }
            }
    }

    private func run() async {
        // A normal launch takes none of this.
        guard UITestArguments.isSeeded() else { return }
        if !UITestArguments.staysWithoutKey() { useScriptedModel() }
        // Let the first tick, memory sync and week land before a screen reads them.
        try? await Task.sleep(for: .seconds(Self.settleSeconds))
        if UITestArguments.answersSuggestions() { await answerSuggestions() }
        if let sentence = UITestArguments.question() { model.ask(sentence) }
        // As a tap on a reminder: Today goes there (TodayView.takeWorkoutRoute).
        if let route = UITestArguments.route() { model.workoutRoute = route }
        screen = UITestArguments.screen().flatMap(Screen.init(rawValue:))
    }

    /// A scripted AI: no key, no network.
    private func useScriptedModel() {
        model.scriptedModel = DebugModel()
        model.memoryWithoutModel = true
        model.askWithoutModel = true
        model.aiKeyTail = "0000"
    }

    /// Adds the top suggestion and says not now to the next.
    private func answerSuggestions() async {
        guard let plan = await model.planIfPossible() else { return }
        let open = model.answerableSuggestions(in: plan)
        if let first = open.first { await model.accept(first) }
        if let next = open.dropFirst().first { await model.decline(next) }
    }
}
#endif
