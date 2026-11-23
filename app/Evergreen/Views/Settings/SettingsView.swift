import CoreLocation
import SwiftUI

/// Settings, from the gear on Today: your memory, the AI service, what
/// Evergreen uses and what leaves the phone for each, what it does by
/// itself, how it is going, and forgetting everything. Each section is a
/// small muted title over a ruled block.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showMemory = false
    @State private var confirmForget = false
    @State private var usage = AIUsage.Day()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.lg) {
                    section("Your memory") {
                        Button { showMemory = true } label: {
                            HStack {
                                Text("What I remember").foregroundStyle(Theme.text)
                                Spacer()
                                let waiting = model.reviewRows.count
                                Text(waiting == 0 ? "" : "\(waiting) to review").foregroundStyle(Theme.accent)
                                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.textMuted)
                            }
                            .font(.body)
                            .frame(minHeight: 44)
                        }
                        rule
                    }
                    section("AI service") { AIServiceBlock() }
                    section("What I use") {
                        source("Apple Health", on: !model.workouts.isEmpty, offWord: "Nothing read yet",
                               hint: "Only the daily table of facts goes to the AI, never raw readings.")
                        source("Calendar", on: model.calendarAccess == .on,
                               hint: "Only when you are busy is used, and only on this phone. What events are called never goes to the AI.")
                        source("Location", on: [.authorizedWhenInUse, .authorizedAlways].contains(CLLocationManager().authorizationStatus),
                               hint: "Used to fetch the forecast from Open-Meteo, rounded to about a kilometre. It never goes to the AI.")
                        source("Notifications", on: model.notificationAccess == .on,
                               hint: "Made on this phone. Nothing leaves it.")
                    }
                    section("Automatic") {
                        ForEach(Automatic.allCases) { AutomaticToggle(what: $0) }
                    }
                    section("Status") {
                        status("Last memory update", model.lastMemoryUpdate?.formatted(date: .abbreviated, time: .shortened) ?? "Not yet")
                        rule
                        status("AI calls today", "\(usage.calls)")
                        rule
                        status("Tokens today", "\(usage.input) in, \(usage.output) out, \(usage.thinking) thinking")
                        rule
                        status("Times my own rules stepped in", "\(model.fallbacks.values.reduce(0, +))")
                        rule
                        ForEach(model.activity, id: \.self) { line in
                            Text(line)
                                .font(.footnote)
                                .foregroundStyle(Theme.textMuted)
                                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                        }
                        if model.activity.isEmpty {
                            Text("Nothing has happened yet.")
                                .font(.footnote)
                                .foregroundStyle(Theme.textMuted)
                                .frame(minHeight: 32)
                        }
                        rule
                    }
                    section("Your data") {
                        Button("Forget everything") { confirmForget = true }
                            .font(.body)
                            .foregroundStyle(Theme.warning)
                            .frame(minHeight: 44)
                        rule
                    }
                }
                .padding(.horizontal, Theme.md)
                .padding(.vertical, Theme.lg)
            }
            .background(Theme.surface)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $showMemory) { MemoryView() }
            .confirmationDialog("Forget everything?", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Forget everything", role: .destructive) { Task { await model.forget(.everything) } }
                Button("Keep", role: .cancel) {}
            } message: {
                Text("Everything I worked out about your routine and your body is deleted from this phone. Your workouts in Apple Health stay.")
            }
            .task { usage = await model.aiUsage.day() }
        }
    }

    private var rule: some View { Rectangle().fill(Theme.rule).frame(height: 1) }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, Theme.sm)
            rule
            content()
        }
    }

    /// One source: its state, a way to iOS Settings when it is off, and what leaves the phone for it.
    private func source(_ title: String, on: Bool, offWord: String = "Off", hint: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title).font(.body).foregroundStyle(Theme.text)
                Spacer()
                if on {
                    Text("Allowed").font(.footnote.weight(.semibold)).foregroundStyle(Theme.success)
                } else {
                    Text(offWord).font(.footnote).foregroundStyle(Theme.textMuted)
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.text)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Open iOS Settings for \(title)")
                }
            }
            .frame(minHeight: 44)
            Text(hint)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, Theme.sm)
            rule
        }
    }

    private func status(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.text)
            Spacer()
            Text(value).foregroundStyle(Theme.textMuted)
        }
        .font(.body)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
