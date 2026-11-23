import SwiftUI

/// Onboarding screen 2: the three permissions on one page, each with its own
/// Allow button. Every row works the same way: Allow, answer, "Allowed".
/// A denial never blocks the app.
struct PermissionsView: View {
    let onContinue: () -> Void

    @Environment(AppModel.self) private var model
    @State private var healthAsked = false
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Three quick things, then we’re off")
                        .agentFont(30, relativeTo: .title)
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("I tailor your training with the apps you already use. What I read stays on this phone; to plan, a short summary goes to the AI you connect, with your own key.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textMuted)
                        .padding(.top, Theme.sm)
                        .padding(.bottom, Theme.lg)
                    PermissionRow(symbol: "calendar", title: "Calendar",
                                  detail: "I find the time you actually have and work around meetings.",
                                  state: state(model.calendarAccess == .on, asked: model.calendarAccess != .notAsked),
                                  action: allowCalendar)
                    PermissionRow(symbol: "heart", title: "Apple Health",
                                  detail: "I read your workouts, heart rate, sleep and resting heart rate to plan your week.",
                                  state: healthAsked ? .asked : .ask,
                                  action: allowHealth)
                    PermissionRow(symbol: "bell", title: "Notifications",
                                  detail: "I let you know when I adjust your plan, and why.",
                                  state: state(model.notificationAccess == .on, asked: model.notificationAccess != .notAsked),
                                  action: allowNotifications)
                }
                .padding(.top, Theme.xl)
            }
            Button("I’m ready", action: onContinue)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.top, Theme.md)
        }
        .disabled(busy)
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .background(Theme.surface)
    }

    private func state(_ on: Bool, asked: Bool) -> PermissionRow.Status {
        on ? .on : asked ? .off : .ask
    }

    private func allowCalendar() {
        run { await model.requestCalendarAccess() }
    }

    private func allowHealth() {
        run {
            await Permissions.requestHealth()
            healthAsked = true
        }
    }

    private func allowNotifications() {
        run { await model.requestNotificationAccess() }
    }

    private func run(_ work: @escaping () async -> Void) {
        busy = true
        Task {
            await work()
            busy = false
        }
    }
}

/// One permission: icon, name, one line on why, and its Allow button.
struct PermissionRow: View {
    enum Status { case ask, asked, on, off }

    let symbol: String
    let title: String
    let detail: String
    let state: Status
    let action: () -> Void

    var body: some View {
        HStack(spacing: Theme.md) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .regular))
                .foregroundStyle(Theme.text)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(Theme.text)
                Text(detail).font(.footnote).foregroundStyle(Theme.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.vertical, Theme.md)
        .frame(minHeight: 44)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.rule).frame(height: 1)
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch state {
        case .ask:
            Button("Allow", action: action)
                .buttonStyle(GhostButtonStyle())
                .fixedSize()
                .accessibilityLabel("Allow \(title)")
        case .on, .asked:
            // Health never says whether it was granted, so an answered prompt
            // reads the same as every other row.
            Label("Allowed", systemImage: "checkmark")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.success)
                .frame(minHeight: 44)
        case .off:
            Text("Off")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .frame(minHeight: 44)
        }
    }
}
