import SwiftData
import SwiftUI

@main
struct EvergreenApp: App {
    private let container: ModelContainer
    @State private var model: AppModel

    init() {
        Theme.registerFonts()
        #if DEBUG
        // `-uiTest <name>`: a throwaway in-memory store with made-up history (Background/UITestSeed.swift).
        if let seeded = UITestSeed.launch() {
            container = seeded.container
            _model = State(initialValue: seeded.model)
            return
        }
        #endif
        let container = Storage.container()
        self.container = container
        _model = State(initialValue: AppModel(context: container.mainContext))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
        .modelContainer(container)
        .backgroundTask(.appRefresh(Refresh.taskId)) { [model] in await Refresh.run(model) }
    }
}
