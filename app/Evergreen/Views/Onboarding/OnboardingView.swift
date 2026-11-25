import SwiftUI

/// Onboarding: the tour, the four permissions on one page, "How you train"
/// (five skippable questions that become the person's rules), what Evergreen
/// noticed (worked out on the phone, the pay-off for the permissions), then
/// "Connect your AI" (which can be put off), and straight into Today, where
/// the first week is being planned.
struct OnboardingView: View {
    enum Step { case tour, permissions, howYouTrain, noticed, connect }

    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    @State private var step = Step.tour
    /// How long one step takes to slide in.
    private static let stepSeconds = 0.25

    var body: some View {
        Group {
            switch step {
            case .tour:
                TourView(onDone: { step = .permissions })
            case .permissions:
                PermissionsView(onContinue: { step = .howYouTrain })
                    .transition(.move(edge: .trailing))
            case .howYouTrain:
                HowYouTrainView(onContinue: { step = .noticed })
                    .transition(.move(edge: .trailing))
            case .noticed:
                NoticedView(onContinue: { if model.aiConnected { model.completeOnboarding() } else { step = .connect } })
                    .transition(.move(edge: .trailing))
            case .connect:
                ConnectAIView(line: "Connect your key and I’ll plan your week. It stays on this phone.", leave: "Not now", onDone: model.completeOnboarding)
                    .transition(.move(edge: .trailing))
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: Self.stepSeconds), value: step)
    }
}
