import SwiftUI

/// One thing Evergreen does by itself, with its switch and a one-line hint.
struct AutomaticToggle: View {
    let what: Automatic

    @Environment(AppModel.self) private var model
    @State private var isOn = true

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Toggle(what.title, isOn: $isOn)
                .font(.body)
                .tint(Theme.accent)
                .frame(minHeight: 44)
            Text(what.hint)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, Theme.sm)
            Rectangle().fill(Theme.rule).frame(height: 1)
        }
        .onAppear { isOn = what.isOn(model.settings) }
        .onChange(of: isOn) { _, on in model.settings.set(on, forKey: what.rawValue) }
    }
}
