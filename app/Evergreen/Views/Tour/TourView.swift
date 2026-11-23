import SwiftUI

/// First open: four short scenes that show the real app at work inside a
/// phone frame, each with a caption and one supporting line. Swipe or wait to
/// move on; Skip is always there, and the last scene has the button.
struct TourView: View {
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page = 0
    /// Goes up when a scene asks the buddy to react.
    @State private var reactions = 0

    static let scenes: [(title: String, line: String)] = [
        ("A plan that fits your week", "Built from your routine and your calendar."),
        ("A meeting lands. Your run moves.", "No tap needed. You can always undo."),
        ("Rain? It finds a way.", "You choose; it does the moving."),
        ("It listens when you say no.", "One tap, and it stops planning that."),
    ]
    /// How long a scene stays before the next one comes in.
    static let dwell = 5.5

    private var last: Bool { page == Self.scenes.count - 1 }

    /// The buddy's reaction to each scene.
    static let moves: [TourBuddy.Move] = [.wave, .hop, .hop, .celebrate]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                Button("Skip", action: onDone)
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
                    .frame(minWidth: 44, minHeight: 44)
            }
            // One scene at a time: the old one fades out before the new one
            // fades in, so nothing from one scene shows in another.
            scene
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .id(page)
                .transition(change)
            // The caption on the left; the buddy always in the same place on the right.
            HStack(alignment: .bottom, spacing: Theme.sm) {
                VStack(alignment: .leading, spacing: Theme.xs) {
                    Text(Self.scenes[page].title)
                        .agentFont(28, relativeTo: .title)
                        .foregroundStyle(Theme.text)
                        .lineLimit(3)
                        .minimumScaleFactor(0.8)
                        .accessibilityAddTraits(.isHeader)
                    Text(Self.scenes[page].line)
                        .font(.body)
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(2)
                        .minimumScaleFactor(0.9)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(page)
                .transition(change)
                TourBuddy(move: Self.moves[page], fired: reactions)
                    .frame(height: 140)
            }
            .frame(height: 148, alignment: .bottom)
            .padding(.top, Theme.md)
            HStack(spacing: Theme.md) {
                HStack(spacing: Theme.sm) {
                    ForEach(Self.scenes.indices, id: \.self) { index in
                        Capsule()
                            .fill(index == page ? Theme.text : Theme.rule)
                            .frame(width: index == page ? 24 : 8, height: 8)
                    }
                }
                .accessibilityElement()
                .accessibilityLabel("Scene \(page + 1) of \(Self.scenes.count)")
                Spacer()
                Button("Get started", action: onDone)
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(width: 180)
                    .opacity(last ? 1 : 0)
                    .disabled(!last)
                    .accessibilityHidden(!last)
            }
            .padding(.top, Theme.md)
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.md)
        .background(Theme.surface)
        .contentShape(.rect)
        .gesture(DragGesture(minimumDistance: 24).onEnded { drag in
            if drag.translation.width < -40 { go(to: page + 1) }
            if drag.translation.width > 40 { go(to: page - 1) }
        })
        .accessibilityAction(named: "Next scene") { go(to: page + 1) }
        .accessibilityAction(named: "Previous scene") { go(to: page - 1) }
        .task(id: page) {
            // Moves on by itself, unless motion is reduced or this is the last scene.
            guard !reduceMotion, !last else { return }
            try? await Task.sleep(for: .seconds(Self.dwell))
            if !Task.isCancelled { go(to: page + 1) }
        }
    }

    private var change: AnyTransition {
        reduceMotion ? .identity : .asymmetric(
            insertion: .opacity.animation(.easeOut(duration: 0.22).delay(0.2)),
            removal: .opacity.animation(.easeIn(duration: 0.18))
        )
    }

    @ViewBuilder
    private var scene: some View {
        let react = { reactions += 1 }
        switch page {
        case 0: PlanScene(react: react)
        case 1: MoveScene(react: react)
        case 2: RainScene(react: react)
        default: ListenScene(react: react)
        }
    }

    private func go(to next: Int) {
        guard Self.scenes.indices.contains(next) else { return }
        withAnimation { page = next }
    }
}
