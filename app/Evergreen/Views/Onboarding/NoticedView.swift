import SwiftUI

/// Onboarding screen 3, "What I noticed": the buddy beside the person's real
/// last 4 weeks, and at most three short lines from memory's first roll. The
/// moment the person sees Evergreen already knows them.
struct NoticedView: View {
    let onContinue: () -> Void

    @Environment(AppModel.self) private var model
    @State private var ready = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("What I noticed")
                .agentFont(30, relativeTo: .title)
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, Theme.xl)
            Spacer(minLength: Theme.lg)
            if ready {
                HStack(alignment: .center, spacing: Theme.md) {
                    PineBuddy(pose: .standing)
                        .frame(height: 148)
                        .accessibilityHidden(true)
                    RecentWeeksGrid(weeks: model.recentWeeks)
                }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(model.memoryBrief.noticed, id: \.self) { line in
                        Text(line)
                            .font(.body.weight(.medium))
                            .foregroundStyle(Theme.text)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        Rectangle().fill(Theme.rule).frame(height: 1)
                    }
                }
                .padding(.top, Theme.lg)
                .transition(.opacity)
            } else {
                HStack(spacing: Theme.sm) {
                    ProgressView()
                    Text("Reading your last few weeks…")
                        .font(.body)
                        .foregroundStyle(Theme.textMuted)
                }
                .padding(.top, Theme.xl)
            }
            Spacer(minLength: Theme.lg)
            Button("See my week", action: onContinue)
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!ready)
                .opacity(ready ? 1 : 0.4)
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Theme.surface)
        .task {
            await model.prepareFirstLook()
            withAnimation(.easeOut(duration: 0.25)) { ready = true }
        }
    }
}
