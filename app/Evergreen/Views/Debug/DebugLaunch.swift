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
struct DebugLaunch: ViewModifier {
    enum Screen: String, Identifiable {
        case memory, settings, permissions, noticed, connect, earned
        var id: String { rawValue }
    }

    @Environment(AppModel.self) private var model
    @State private var screen: Screen?

    func body(content: Content) -> some View {
        content
            .task { await run() }
            .sheet(item: $screen) { screen in
                switch screen {
                case .memory: MemoryView()
                case .settings: SettingsView()
                case .earned: EarnedTimeView()
                case .permissions: PermissionsView(onContinue: {})
                case .noticed: NoticedView(onContinue: { self.screen = nil })
                case .connect: ConnectAIView(leave: "Not now", onDone: { self.screen = nil })
                }
            }
    }

    private func run() async {
        // A normal launch takes none of this.
        guard UITestSeed.name(in: ProcessInfo.processInfo.arguments) != nil else { return }
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: "uiNoKey") {
            model.scriptedModel = DebugModel()
            model.memoryWithoutModel = true
            model.askWithoutModel = true
            model.aiKeyTail = "0000"
        }
        // Let the first tick, memory sync and week land before a screen reads them.
        try? await Task.sleep(for: .seconds(3))
        if defaults.bool(forKey: "uiAnswers"), let plan = try? await model.loadWeekPlan() {
            let open = plan.sessions.filter { $0.after != nil && model.suggestionState($0) == .open }
            if let first = open.first { await model.accept(first) }
            if let next = open.dropFirst().first { await model.decline(next) }
        }
        if let sentence = defaults.string(forKey: "uiAsk") {
            model.ask(sentence)
        }
        screen = defaults.string(forKey: "uiScreen").flatMap(Screen.init(rawValue:))
    }
}
#endif
