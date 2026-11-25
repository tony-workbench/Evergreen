import SwiftUI

/// Onboarding screen 3, "What I noticed": the buddy beside the person's real
/// last 4 weeks, and at most three short lines from memory's first roll. The
/// moment the person sees Evergreen already knows them. A line that comes
/// from a memory row ("You train at home, without gym equipment.") has
/// "Not true for me", which rejects that row.
struct NoticedView: View {
    let onContinue: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    /// Reduce Motion, or a UI test's `-reduceMotion` (Design/Motion.swift).
    private var reduceMotion: Bool { Motion.reduced(systemReduceMotion) }
    @State private var ready = false

    /// The buddy's height beside the four weeks.
    private static let buddyHeight: CGFloat = 148
    /// How long the lines take to fade in; with Reduce Motion on they just appear.
    private static let fadeIn: Double = 0.25
    /// "See my week" while the lines are still being read.
    private static let waitingOpacity: Double = 0.4

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("What I noticed")
                .agentFont(Theme.pageTitleSize, relativeTo: .title)
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, Theme.xl)
            Spacer(minLength: Theme.lg)
            if ready { noticed } else { reading }
            Spacer(minLength: Theme.lg)
            Button("See my week", action: onContinue)
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!ready)
                .opacity(ready ? 1 : Self.waitingOpacity)
                .accessibilityIdentifier("noticed.seeMyWeek")
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Theme.surface)
        .task { await readFirstLook() }
    }

    /// The buddy beside the four weeks, and the lines under them.
    @ViewBuilder private var noticed: some View {
        HStack(alignment: .center, spacing: Theme.md) {
            PineBuddy(pose: .standing)
                .frame(height: Self.buddyHeight)
                .accessibilityHidden(true)
            RecentWeeksGrid(weeks: model.recentWeeks)
                .accessibilityIdentifier("noticed.weeks")
        }
        VStack(alignment: .leading, spacing: 0) {
            // Each line keeps its own identity (its key, or its words), so removing one doesn't re-identify the rest.
            ForEach(Array(model.memoryBrief.noticedLines(rows: model.memoryRows).enumerated()), id: \.element.id) { index, line in
                NoticedRow(text: line.text, index: index, notTrue: notTrue(line.key))
            }
        }
        .padding(.top, Theme.lg)
        .transition(.opacity)
    }

    private var reading: some View {
        HStack(spacing: Theme.sm) {
            ProgressView()
            Text("Reading your last few weeks…")
                .font(.body)
                .foregroundStyle(Theme.textMuted)
        }
        .padding(.top, Theme.xl)
        .accessibilityIdentifier("noticed.reading")
    }

    /// "Not true for me" on a line from a memory row: that row is stopped, as anywhere else.
    private func notTrue(_ key: String?) -> (() -> Void)? {
        guard let key else { return nil }
        return { Task { await model.stop(key: key) } }
    }

    /// Works out the first look on the phone, then shows it: a short fade, or at once with Reduce Motion.
    private func readFirstLook() async {
        await model.prepareFirstLook()
        withAnimation(reduceMotion ? nil : .easeOut(duration: Self.fadeIn)) { ready = true }
    }
}

/// One line of what was noticed. A line from a memory row (where the person trains) can be said no to, as anywhere else.
private struct NoticedRow: View {
    let text: String
    let index: Int
    /// "Not true for me", for a line from a memory row; nil for the others.
    let notTrue: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.md) {
            Text(text)
                .font(.body.weight(.medium))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("noticed.line.\(index)")
            Spacer(minLength: Theme.sm)
            if let notTrue {
                Button("Not true for me", action: notTrue)
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .frame(minHeight: TapTargetButtonStyle.minSide)
                    .accessibilityLabel("Not true for me: \(text)")
                    .accessibilityIdentifier("noticed.notTrue.\(index)")
            }
        }
        .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
        Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
    }
}
