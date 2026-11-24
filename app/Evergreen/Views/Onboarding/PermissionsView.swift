import SwiftUI

/// Onboarding screen 2: the four permissions on one page, each with its own
/// Allow button and one plain line on what it is for, read before the system
/// asks. Every row works the same way: Allow, answer, "Allowed". A denial never
/// blocks the app. What each row asks and how it stands lives in the model
/// (AppModel+ViewLogic.swift).
struct PermissionsView: View {
    let onContinue: () -> Void

    @Environment(AppModel.self) private var model
    /// The rows tapped on this page, for the answers the system doesn't report (Apple Health) or not at once.
    @State private var asked: Set<SetupPermission> = []
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    ForEach(SetupPermission.allCases, id: \.self) { permission in row(permission) }
                }
                .padding(.top, Theme.xl)
            }
            Button("I’m ready", action: onContinue)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.top, Theme.md)
                .accessibilityIdentifier("permissions.ready")
        }
        .disabled(busy)
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .background(Theme.surface)
    }

    @ViewBuilder private var header: some View {
        Text("Four quick things, then we’re off")
            .agentFont(Theme.pageTitleSize, relativeTo: .title)
            .foregroundStyle(Theme.text)
            .accessibilityAddTraits(.isHeader)
        Text("I tailor your training with the apps you already use. To plan, a short summary goes to the AI you connect, with your own key. Settings › What I use says what leaves this phone.")
            .font(.footnote)
            .foregroundStyle(Theme.textMuted)
            .padding(.top, Theme.sm)
            .padding(.bottom, Theme.lg)
    }

    private func row(_ permission: SetupPermission) -> some View {
        PermissionRow(permission: permission, state: model.permissionState(permission, asked: asked)) { allow(permission) }
    }

    private func allow(_ permission: SetupPermission) {
        busy = true
        Task {
            await model.askPermission(permission)
            asked.insert(permission)
            busy = false
        }
    }
}

/// One permission: icon, name, one line on why, and its Allow button.
struct PermissionRow: View {
    let permission: SetupPermission
    let state: PermissionState
    let action: () -> Void

    /// The icon's size and the column it sits in.
    private static let symbolSize: CGFloat = 24
    private static let symbolColumn: CGFloat = 28

    var body: some View {
        HStack(spacing: Theme.md) {
            Image(systemName: permission.symbol)
                .font(.system(size: Self.symbolSize, weight: .regular))
                .foregroundStyle(Theme.text)
                .frame(width: Self.symbolColumn)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Theme.xxs) {
                Text(permission.title).font(.body.weight(.medium)).foregroundStyle(Theme.text)
                Text(permission.detail).font(.footnote).foregroundStyle(Theme.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.vertical, Theme.md)
        .frame(minHeight: TapTargetButtonStyle.minSide)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("permissions.row.\(permission.rawValue)")
    }

    @ViewBuilder
    private var trailing: some View {
        switch state {
        case .ask:
            Button("Allow", action: action)
                .buttonStyle(GhostButtonStyle())
                .fixedSize()
                .accessibilityLabel("Allow \(permission.title)")
                .accessibilityIdentifier("permissions.allow.\(permission.rawValue)")
        case .on, .asked:
            allowed
        case .off:
            Text("Off")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .frame(minHeight: TapTargetButtonStyle.minSide)
                .accessibilityIdentifier("permissions.off.\(permission.rawValue)")
        }
    }

    /// Health never says whether it was granted, so an answered prompt reads the same as every other row.
    private var allowed: some View {
        Label("Allowed", systemImage: "checkmark")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.success)
            .frame(minHeight: TapTargetButtonStyle.minSide)
            .accessibilityIdentifier("permissions.allowed.\(permission.rawValue)")
    }
}

/// How the first-setup page names each permission and says what it is for, before the system asks.
private extension SetupPermission {
    var title: String {
        switch self {
        case .calendar: "Calendar"
        case .health: "Apple Health"
        case .notifications: "Notifications"
        case .screenTime: "Screen Time"
        }
    }

    var symbol: String {
        switch self {
        case .calendar: "calendar"
        case .health: "heart"
        case .notifications: "bell"
        case .screenTime: "hourglass"
        }
    }

    var detail: String {
        switch self {
        case .calendar: "I find the time you actually have and work around meetings."
        case .health: "I read your workouts, heart rate, sleep and resting heart rate to plan your week."
        case .notifications: "I let you know when I adjust your plan, and why."
        case .screenTime: "Your workouts can earn time in apps you choose to lock; nothing is locked until you turn it on in Settings."
        }
    }
}
