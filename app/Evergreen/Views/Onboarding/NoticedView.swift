import SwiftUI

/// Onboarding screen 3, "What I noticed": the buddy beside the person's real
/// last 4 weeks, and at most three short lines from memory's first roll. The
/// moment the person sees Evergreen already knows them. A line that comes
/// from a memory row ("You train at home, without gym equipment.") has
/// "Not true for me", which rejects that row.
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
                    ForEach(model.memoryBrief.noticedLines(rows: model.memoryRows)) { line in
                        HStack(alignment: .firstTextBaseline, spacing: Theme.md) {
                            Text(line.text)
                                .font(.body.weight(.medium))
                                .foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: Theme.sm)
                            // A line from a memory row (where the person trains) can be said no to, as anywhere else.
                            if let key = line.key {
                                Button("Not true for me") { Task { await model.stop(key: key) } }
                                    .font(.footnote)
                                    .foregroundStyle(Theme.textMuted)
                                    .frame(minHeight: 44)
                                    .accessibilityLabel("Not true for me: \(line.text)")
                            }
                        }
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
