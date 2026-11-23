import SwiftUI

/// A frame that shows the app's real screens, scaled to fit. The frame has
/// one shape in every scene (as wide as the page, `aspect` times as tall),
/// and a scene's content is laid out at `layoutWidth` and scaled up to fill
/// it: a scene with little in it is laid out narrower, so it reads larger.
/// The content is centred in the frame. A scene keeps every part in its
/// layout from the start and shows it by opacity, so nothing moves when a
/// part appears. What's inside can't be tapped; a scene's
/// accessibility label says what it shows.
struct TourPhone<Content: View>: View {
    /// The width the content is laid out at; the app's own is 393.
    var layoutWidth: CGFloat = 393
    @ViewBuilder let content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    /// The frame's height for its width: what the tallest scene (the moved workout) fills.
    static var aspect: CGFloat { 1.14 }

    var body: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width, proxy.size.height / Self.aspect)
            let height = width * Self.aspect
            let scale = width / layoutWidth
            let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
            content()
                // Its own height, like in the app's scrolling screens, so text wraps the way it does there.
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.md)
                .frame(width: layoutWidth, height: height / scale, alignment: .center)
                .background(Theme.surface)
                .scaleEffect(scale)
                .frame(width: width, height: height)
                .clipShape(shape)
                .overlay { shape.strokeBorder(Theme.rule, lineWidth: 1) }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .scaleEffect(shown || reduceMotion ? 1 : 0.96)
        .opacity(shown || reduceMotion ? 1 : 0)
        .onAppear {
            withAnimation(.easeOut(duration: 0.25)) { shown = true }
        }
    }
}
