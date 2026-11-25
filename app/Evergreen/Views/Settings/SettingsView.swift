import CoreLocation
import SwiftUI

/// Settings, from the gear on Today: your memory, the AI service, what
/// Evergreen uses and what leaves the phone for each, what it does by
/// itself, how it is going, and forgetting everything. Each section is a
/// small muted title over a ruled block.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var showMemory = false
    @State private var showEarnedTime = false
    @State private var showRules = false
    @State private var confirmForget = false
    @State private var usage = AIUsage.Day()

    var body: some View {
        NavigationStack {
            page
                .navigationTitle("Settings")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("settings.done") } }
                .sheet(isPresented: $showMemory) { MemoryView() }
                .sheet(isPresented: $showEarnedTime) { EarnedTimeView() }
                .sheet(isPresented: $showRules) { MyRulesView() }
                .confirmationDialog("Forget everything?", isPresented: $confirmForget, titleVisibility: .visible) {
                    Button("Forget everything", role: .destructive) { Task { await model.forget(.everything) } }
                    Button("Keep", role: .cancel) {}
                } message: {
                    Text("Everything I worked out about your routine and your body is deleted from this phone. Your workouts in Apple Health stay.")
                }
                .task { usage = await model.aiUsage.day() }
        }
    }

    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.lg) {
                SettingsSection("My rules") { rulesBlock }
                SettingsSection("Your memory") { memoryBlock }
                SettingsSection("Screen time") { screenTimeBlock }
                SettingsSection("AI service") { AIServiceBlock() }
                SettingsSection("What I use") { SourcesBlock() }
                SettingsSection("Automatic") { ForEach(Automatic.allCases) { AutomaticToggle(what: $0) } }
                SettingsSection("Status") { StatusBlock(usage: usage) }
                SettingsSection("Your data") { dataBlock }
            }
            .padding(.horizontal, Theme.md)
            .padding(.vertical, Theme.lg)
        }
        .background(Theme.surface)
    }

    // MARK: Blocks

    @ViewBuilder private var rulesBlock: some View {
        Button { showRules = true } label: { RulesSummary(rules: model.userRules) }
            .accessibilityIdentifier("settings.myRules")
        SettingsRule()
    }

    @ViewBuilder private var memoryBlock: some View {
        let waiting = model.reviewRows.count
        Button { showMemory = true } label: {
            OpenRow(title: "What I remember", value: waiting == 0 ? "" : "\(waiting) to review", valueColor: Theme.accent)
        }
        .accessibilityIdentifier("settings.memory")
        SettingsRule()
    }

    @ViewBuilder private var screenTimeBlock: some View {
        let earned = model.earnedTime
        Button { showEarnedTime = true } label: {
            OpenRow(title: "Earned screen time", value: earned.isOn ? "\(earned.usable(.social)) min" : "Off",
                    valueColor: Theme.textMuted)
        }
        .accessibilityIdentifier("settings.earnedTime")
        SettingsRule()
    }

    @ViewBuilder private var dataBlock: some View {
        Button("Forget everything") { confirmForget = true }
            .font(.body)
            .foregroundStyle(Theme.warning)
            .frame(minHeight: TapTargetButtonStyle.minSide)
            .accessibilityIdentifier("settings.forget")
        SettingsRule()
    }
}

/// One section of Settings: a small muted title over a ruled block.
private struct SettingsSection<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, Theme.sm)
            SettingsRule()
            content
        }
    }
}

/// The line under each row of Settings.
private struct SettingsRule: View {
    var body: some View { Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth) }
}

/// A row that opens a screen: its name, what it holds, and a chevron.
private struct OpenRow: View {
    let title: String
    let value: String
    let valueColor: Color

    var body: some View {
        HStack {
            Text(title).foregroundStyle(Theme.text)
            Spacer()
            Text(value).foregroundStyle(valueColor)
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.textMuted)
        }
        .font(.body)
        .frame(minHeight: TapTargetButtonStyle.minSide)
    }
}

/// Settings › My rules, in short: one line per rule, or "Off".
private struct RulesSummary: View {
    let rules: UserRules

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            line("Never plan on", rules.isOn ? rules.restDaysText : "Off")
            if rules.isOn {
                line("Days I go out", "No workout")
                line("Days I'm home all day", "Always plan one")
                line("Session length", rules.lengthText)
                line("Plan between", rules.windowText)
                line("Equipment", rules.equipmentText)
                line("Movements to avoid", "\(rules.avoid.count)")
            }
        }
    }

    private func line(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.text)
            Spacer()
            Text(value).foregroundStyle(Theme.textMuted)
        }
        .font(.body)
        .frame(minHeight: Theme.summaryRowHeight)
    }
}

/// What I use: each source, whether it is allowed, and what leaves the phone for it (README › What leaves your phone).
private struct SourcesBlock: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        SourceRow(title: "Apple Health", state: .from(!model.workouts.isEmpty, offWord: "Nothing read yet"),
                  hint: "Only a short table of facts goes to the AI, never raw readings.")
        SourceRow(title: "Calendar", state: .from(model.calendarAccess == .on),
                  hint: "Your events are read on this phone to find busy times and days out. With a home set, an event’s typed place goes to Apple’s geocoder to check whether it’s home, and each place found is kept on this phone. Event titles and places never go to the AI.")
        SourceRow(title: "Location", state: .from(model.locationAllowed),
                  hint: "Rounded to about a kilometre, it goes to Open-Meteo for the forecast and, when rain is due on an outdoor workout, to Apple Maps to find gyms nearby. Home and how far you are from it stay on this phone. It never goes to the AI.")
        SourceRow(title: "Notifications", state: .from(model.notificationAccess == .on),
                  hint: "Made on this phone. Nothing leaves it.")
    }
}

/// One source: its state, a way to iOS Settings when it is off, and what leaves the phone for it.
private struct SourceRow: View {
    enum Standing {
        case allowed
        /// Off, in these words ("Off", "Nothing read yet").
        case off(String)

        static func from(_ on: Bool, offWord: String = "Off") -> Standing { on ? .allowed : .off(offWord) }
    }

    let title: String
    let state: Standing
    let hint: String

    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xxs) {
            HStack {
                Text(title).font(.body).foregroundStyle(Theme.text)
                Spacer()
                stateView
            }
            .frame(minHeight: TapTargetButtonStyle.minSide)
            Text(hint)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, Theme.sm)
            SettingsRule()
        }
    }

    @ViewBuilder private var stateView: some View {
        switch state {
        case .allowed:
            Text("Allowed").font(.footnote.weight(.semibold)).foregroundStyle(Theme.success)
        case .off(let word):
            Text(word).font(.footnote).foregroundStyle(Theme.textMuted)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.text)
            .frame(minHeight: TapTargetButtonStyle.minSide)
            .accessibilityLabel("Open iOS Settings for \(title)")
            .accessibilityIdentifier("settings.openSettings.\(title)")
        }
    }
}

/// Status: when memory last updated, today's AI use, how often the rules stepped in, and the last few things that happened.
private struct StatusBlock: View {
    let usage: AIUsage.Day

    @Environment(AppModel.self) private var model

    var body: some View {
        line("Last memory update", model.lastMemoryUpdate?.formatted(date: .abbreviated, time: .shortened) ?? "Not yet")
        line("AI calls today", "\(usage.calls)")
        line("Tokens today", "\(usage.input) in, \(usage.output) out, \(usage.thinking) thinking")
        line("Times my own rules stepped in", "\(model.fallbackCount)")
        ForEach(model.activity, id: \.self) { activityLine($0) }
        if model.activity.isEmpty { activityLine("Nothing has happened yet.") }
        SettingsRule()
    }

    @ViewBuilder private func line(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.text)
            Spacer()
            Text(value).foregroundStyle(Theme.textMuted)
        }
        .font(.body)
        .frame(minHeight: TapTargetButtonStyle.minSide)
        .accessibilityElement(children: .combine)
        SettingsRule()
    }

    private func activityLine(_ words: String) -> some View {
        Text(words)
            .font(.footnote)
            .foregroundStyle(Theme.textMuted)
            .frame(maxWidth: .infinity, minHeight: Theme.readRowHeight, alignment: .leading)
    }
}
