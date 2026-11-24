import SwiftUI

/// First open: four short scenes that show the real app at work inside a
/// phone frame, each with a caption and one supporting line. Swipe or wait to
/// move on; Skip is always there, and the last scene has the button.
struct TourView: View {
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
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

    /// The buddy's height, and the caption row that holds it.
    private static let buddyHeight: CGFloat = 140
    private static let captionRowHeight: CGFloat = 148
    /// The page dots: the current one is a longer capsule.
    private static let dotSide: CGFloat = 8
    private static let currentDotWidth: CGFloat = 24
    private static let startWidth: CGFloat = 180
    /// The caption's title wraps to three lines at most; title and line shrink this far before they cut.
    private static let titleLines = 3
    /// A scene's line under the title takes two lines at most.
    private static let lineLines = 2
    private static let titleShrink = 0.8
    private static let lineShrink = 0.9
    /// How far a drag goes before it counts, and before it turns the scene.
    private static let dragStart: CGFloat = 24
    private static let swipeDistance: CGFloat = 40

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            skipRow
            // One scene at a time: the old one fades out before the new one
            // fades in, so nothing from one scene shows in another.
            scene
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .id(page)
                .transition(change)
            captionRow
            footer
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.md)
        .background(Theme.surface)
        .contentShape(.rect)
        .gesture(swipe)
        .accessibilityAction(named: "Next scene") { go(to: page + 1) }
        .accessibilityAction(named: "Previous scene") { go(to: page - 1) }
        .task(id: page) { await moveOn() }
    }

    private var skipRow: some View {
        HStack {
            Spacer()
            Button("Skip", action: onDone)
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                .accessibilityIdentifier("tour.skip")
        }
    }

    /// The caption on the left; the buddy always in the same place on the right.
    private var captionRow: some View {
        HStack(alignment: .bottom, spacing: Theme.sm) {
            caption
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(page)
                .transition(change)
            TourBuddy(move: Self.moves[page], fired: reactions)
                .frame(height: Self.buddyHeight)
        }
        .frame(height: Self.captionRowHeight, alignment: .bottom)
        .padding(.top, Theme.md)
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: Theme.xs) {
            Text(Self.scenes[page].title)
                .agentFont(Theme.captionTitleSize, relativeTo: .title)
                .foregroundStyle(Theme.text)
                .lineLimit(Self.titleLines)
                .minimumScaleFactor(Self.titleShrink)
                .accessibilityAddTraits(.isHeader)
            Text(Self.scenes[page].line)
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .lineLimit(Self.lineLines)
                .minimumScaleFactor(Self.lineShrink)
        }
    }

    private var footer: some View {
        HStack(spacing: Theme.md) {
            HStack(spacing: Theme.sm) {
                ForEach(Array(Self.scenes.enumerated()), id: \.element.title) { index, _ in
                    Capsule()
                        .fill(index == page ? Theme.text : Theme.rule)
                        .frame(width: index == page ? Self.currentDotWidth : Self.dotSide, height: Self.dotSide)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("Scene \(page + 1) of \(Self.scenes.count)")
            Spacer()
            Button("Get started", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .frame(width: Self.startWidth)
                .opacity(last ? 1 : 0)
                .disabled(!last)
                .accessibilityHidden(!last)
                .accessibilityIdentifier("tour.start")
        }
        .padding(.top, Theme.md)
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: Self.dragStart).onEnded { drag in
            if drag.translation.width < -Self.swipeDistance { go(to: page + 1) }
            if drag.translation.width > Self.swipeDistance { go(to: page - 1) }
        }
    }

    /// Moves on by itself, unless motion is reduced or this is the last scene.
    private func moveOn() async {
        guard !reduceMotion, !last else { return }
        try? await Task.sleep(for: .seconds(Self.dwell))
        if !Task.isCancelled { go(to: page + 1) }
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
