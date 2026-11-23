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
    @State private var showSteps = true
    @State private var showStudio = false

    static let studio = URL(string: "https://aistudio.google.com/apikey")!

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.sm) {
                    Text("Connect your AI")
                        .agentFont(34, relativeTo: .largeTitle)
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text(line)
                        .font(.body)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, Theme.sm)
                    AIServiceBlock()
                    steps
                }
                .padding(.top, Theme.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            if model.aiConnected {
                Button("Done", action: onDone).buttonStyle(PrimaryButtonStyle())
            } else {
                Button(leave, action: onDone)
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .background(Theme.surface)
        .sheet(isPresented: $showStudio) { SafariView(url: Self.studio).ignoresSafeArea() }
    }

    /// "Where do I get a key?": three steps and the one link.
    private var steps: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { showSteps.toggle() }
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
                .frame(minHeight: 48)
            }
            .accessibilityValue(showSteps ? "Open" : "Closed")
            if showSteps {
                // The buddy stands beside the steps, so the lower half of the screen isn't empty.
                HStack(alignment: .bottom, spacing: Theme.md) {
                    VStack(alignment: .leading, spacing: Theme.sm) {
                        step(1, "Sign in to Google AI Studio.")
                        step(2, "Choose “Create API key”.")
                        step(3, "Copy it and paste it above.")
                        Button("Open Google AI Studio") { showStudio = true }
                            .buttonStyle(GhostButtonStyle())
                            .padding(.top, Theme.xs)
                            .accessibilityHint("Opens aistudio.google.com in Safari inside the app")
                    }
                    WavingBuddy(loops: true)
                        .frame(width: 100, height: 120)
                        .accessibilityHidden(true)
                }
                .padding(.bottom, Theme.md)
                .transition(.opacity)
            }
            Rectangle().fill(Theme.rule).frame(height: 1)
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
            Text("\(number)")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 16, alignment: .leading)
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
