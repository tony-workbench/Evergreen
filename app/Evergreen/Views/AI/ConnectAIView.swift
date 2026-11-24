import SwiftUI

/// "Connect your AI", the last onboarding step: the same AI service block
/// as Settings, with where a key comes from. It can be put off.
struct ConnectAIView: View {
    /// The one line under the title.
    var line = "Connect your key and I’ll plan your week. It stays on this phone."
    /// The label of the way out: "Not now" until a key is connected.
    var leave = "Not now"
    let onDone: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    @State private var showSteps = true
    @State private var showStudio = false

    static let studio = URL(string: "https://aistudio.google.com/apikey")!
    /// The waving buddy beside the steps.
    private static let buddySize = CGSize(width: 100, height: 120)
    /// The column the step numbers sit in.
    private static let numberColumn: CGFloat = 16
    /// How long the steps take to open or close.
    private static let toggleSeconds = 0.2
    /// Where to find a key, in order.
    private static let steps = ["Sign in to Google AI Studio.", "Choose “Create API key”.", "Copy it and paste it above."]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.sm) {
                    header
                    AIServiceBlock()
                    steps
                }
                .padding(.top, Theme.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            leaveButton
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .background(Theme.surface)
        .sheet(isPresented: $showStudio) { SafariView(url: Self.studio).ignoresSafeArea() }
    }

    @ViewBuilder private var header: some View {
        Text("Connect your AI")
            .agentFont(Theme.heroTitleSize, relativeTo: .largeTitle)
            .foregroundStyle(Theme.text)
            .accessibilityAddTraits(.isHeader)
        Text(line)
            .font(.body)
            .foregroundStyle(Theme.text)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, Theme.sm)
    }

    /// "Done" once a key is connected; until then the quiet way out ("Not now").
    @ViewBuilder private var leaveButton: some View {
        if model.aiConnected {
            Button("Done", action: onDone)
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("connect.done")
        } else {
            Button(leave, action: onDone)
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide)
                .accessibilityIdentifier("connect.leave")
        }
    }

    /// "Where do I get a key?": three steps and the one link.
    private var steps: some View {
        VStack(alignment: .leading, spacing: 0) {
            stepsToggle
            if showSteps {
                // The buddy stands beside the steps, so the lower half of the screen isn't empty.
                HStack(alignment: .bottom, spacing: Theme.md) {
                    stepList
                    WavingBuddy(loops: true)
                        .frame(width: Self.buddySize.width, height: Self.buddySize.height)
                        .accessibilityHidden(true)
                }
                .padding(.bottom, Theme.md)
                .transition(.opacity)
            }
            Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
        }
    }

    private var stepsToggle: some View {
        Button {
            withAnimation(reduceMotion ? nil : .easeInOut(duration: Self.toggleSeconds)) { showSteps.toggle() }
        } label: {
            HStack {
                Text("Where do I get a key?")
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.text)
                Spacer()
                Image(systemName: showSteps ? "chevron.up" : "chevron.down")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
            }
            .frame(minHeight: PrimaryButtonStyle.standardHeight)
        }
        .accessibilityValue(showSteps ? "Open" : "Closed")
        .accessibilityIdentifier("connect.whereKey")
    }

    private var stepList: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            ForEach(Array(Self.steps.enumerated()), id: \.element) { index, words in step(index + 1, words) }
            Button("Open Google AI Studio") { showStudio = true }
                .buttonStyle(GhostButtonStyle())
                .padding(.top, Theme.xs)
                .accessibilityHint("Opens aistudio.google.com in Safari inside the app")
                .accessibilityIdentifier("connect.openStudio")
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
            Text("\(number)")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: Self.numberColumn, alignment: .leading)
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
