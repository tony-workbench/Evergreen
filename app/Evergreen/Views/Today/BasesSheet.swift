import SwiftUI

/// "Why" for a suggestion: each thing it rests on in full, with where it
/// comes from. A remembered line can be answered "Not true for me", which
/// stops it and plans the week again.
struct BasesSheet: View {
    let session: WeekPlan.Session

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(SuggestionWords.headline(session))
                        .agentFont(24, relativeTo: .title2)
                        .foregroundStyle(Theme.accent)
                        .accessibilityAddTraits(.isHeader)
                    let bases = model.bases(for: session)
                    // A reason that only says the one remembered line again is left to that line.
                    if !Basis.restates(PlainWords.reason(session.reason), bases) {
                        Text(PlainWords.reason(session.reason))
                            .font(.body)
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, Theme.sm)
                    }
                    Color.clear.frame(height: Theme.md)
                    if bases.isEmpty {
                        Text("This one comes from a general rule, not from anything I’ve learned about you yet.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textMuted)
                    }
                    ForEach(bases) { basis in
                        Rectangle().fill(Theme.rule).frame(height: 1)
                        row(basis)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.md)
                .padding(.vertical, Theme.lg)
            }
            .background(Theme.surface)
            .navigationTitle("Why this")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        // Half the screen for one or two lines; it can be pulled up when there is more.
        .presentationDetents([.medium, .large])
    }

    private func row(_ basis: Basis) -> some View {
        VStack(alignment: .leading, spacing: Theme.xs) {
            Label(basis.source == .health ? "Apple Health" : "Calendar", systemImage: basis.source.symbol)
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.textMuted)
            Text(basis.text)
                .font(.body.weight(.medium))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(basis.detail)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            if let key = basis.key {
                Button("Not true for me") {
                    dismiss()
                    Task { await model.rejectBasis(key) }
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.text)
                .frame(minHeight: 44)
                .accessibilityHint("Stops using this and plans your week again")
            }
        }
        .padding(.top, Theme.md)
        .padding(.bottom, basis.key == nil ? Theme.md : 0)
    }
}
