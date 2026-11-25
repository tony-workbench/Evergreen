import SwiftUI

/// The AI service, in Settings and as the last onboarding step: where
/// things go, the service (Gemini, fixed), the model, the key with Paste,
/// one button that checks the connection and saves, with its result beside
/// it, and "Remove key".
struct AIServiceBlock: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AIModels.settingKey) private var chosenModel = AIModels.standard
    @State private var key = ""
    @State private var checking = false
    /// The result of the last check, in words; and whether it failed.
    @State private var result: String?
    @State private var failed = false

    /// The key's row, a little taller than a tap target to hold the paste button's capsule.
    private static let keyRowHeight: CGFloat = 52

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Evergreen talks to one AI service, Google’s Gemini, with your key. What else leaves this phone, and for what, is under What I use.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, Theme.sm)
            rule
            row("Service") { Text("Gemini").foregroundStyle(Theme.textMuted) }
            rule
            row("Model") { modelChoice }
            rule
            keyRow
            rule
            checkRow
            if model.aiKeyTail?.isEmpty == false { removeRow }
            rule
        }
    }

    @ViewBuilder private var modelChoice: some View {
        if model.aiModels.isEmpty {
            TextField(AIModels.standard, text: $chosenModel)
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundStyle(Theme.textMuted)
                .accessibilityIdentifier("ai.model")
        } else {
            // After a check, the account's own models to pick from.
            Picker("Model", selection: $chosenModel) {
                ForEach(model.modelChoices(keeping: chosenModel), id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden()
            .tint(Theme.textMuted)
            .accessibilityIdentifier("ai.model")
        }
    }

    private var keyRow: some View {
        HStack(spacing: Theme.sm) {
            SecureField(placeholder, text: $key)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(check)
                .accessibilityLabel("Gemini API key")
                .accessibilityIdentifier("ai.key")
            // The system's own paste button: it reads the clipboard only when tapped.
            PasteButton(payloadType: String.self) { strings in
                key = strings.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                result = nil
            }
            .labelStyle(.titleOnly)
            .buttonBorderShape(.capsule)
            .tint(Theme.accent)
        }
        .frame(minHeight: Self.keyRowHeight)
    }

    private var checkRow: some View {
        HStack(alignment: .center, spacing: Theme.md) {
            Button(checking ? "Checking…" : "Check connection & save", action: check)
                .buttonStyle(GhostButtonStyle())
                .fixedSize()
                .disabled(checking || (key.isEmpty && !model.aiConnected))
                .accessibilityIdentifier("ai.check")
            if let result {
                Text(result)
                    .font(.footnote)
                    .foregroundStyle(failed ? Theme.warning : Theme.success)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, Theme.sm)
    }

    @ViewBuilder private var removeRow: some View {
        rule
        Button("Remove key", action: remove)
            .font(.body)
            .foregroundStyle(Theme.text)
            .frame(minHeight: TapTargetButtonStyle.minSide)
            .accessibilityHint("Takes the key off this phone")
            .accessibilityIdentifier("ai.remove")
    }

    /// The field never shows a key: connected, it says so with the last four characters.
    private var placeholder: String {
        guard let tail = model.aiKeyTail else { return "Gemini API key" }
        return tail.isEmpty ? "Connected for this run" : "Connected · key ending \(tail)"
    }

    private var rule: some View { Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth) }

    private func row(_ title: String, @ViewBuilder value: () -> some View) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.text)
            Spacer(minLength: Theme.md)
            value()
        }
        .font(.body)
        .frame(minHeight: TapTargetButtonStyle.minSide)
    }

    private func check() {
        guard !checking else { return }
        checking = true
        let typed = key
        Task {
            let problem = await model.connectAI(key: typed)
            failed = problem != nil
            result = problem.map { "Connection failed: \($0)" } ?? AIServiceBlock.connected(saved: !typed.isEmpty, models: model.aiModels.count)
            // The field never keeps a key that was accepted.
            if problem == nil { key = "" }
            checking = false
        }
    }

    /// "Connected and saved · 12 models available"
    static func connected(saved: Bool, models: Int) -> String {
        "Connected\(saved ? " and saved" : "") · \(models) \(models == 1 ? "model" : "models") available"
    }

    private func remove() {
        model.disconnectAI()
        result = nil
    }
}
