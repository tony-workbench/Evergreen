import SwiftUI

/// Onboarding until it's done, then Today.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model
        Group {
            if model.onboarded {
                TodayView()
            } else {
                OnboardingView()
            }
        }
        // The same colour as the launch screen, behind everything, so nothing flashes white while the first screen draws.
        .background(Theme.surface.ignoresSafeArea())
        #if DEBUG
        .modifier(DebugLaunch())
        #endif
        .tint(Theme.text)
        // Tabular numbers everywhere, so times and minutes line up down a column.
        .monospacedDigit()
        .task { await model.keepTicking() }
        // Midnight, a new time zone, a changed clock: the day may have moved on while the app stayed open.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)) { _ in
            if model.refreshDay() { Task { await model.tick() } }
        }
        .onChange(of: scenePhase) { _, phase in
            // Leaving the app ends the moment the last "Not now" line is for.
            if phase == .background { model.lastDecline = nil }
            guard phase == .active else { return }
            // A new day since the app was last in front: move on to it before anything reads the day.
            model.refreshDay()
            Task {
                if model.persona.isReal { await model.refreshHealth() }
                await model.tick()
                await model.checkTriggers(foreground: true)
            }
        }
    }
}
