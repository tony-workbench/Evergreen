import SwiftUI
import UniformTypeIdentifiers

/// Settings › My rules: the rules the person set, kept as they said them. The
/// planner never puts a session on a rest weekday or a day out, and puts one
/// on every day at home with time for it. Changes are saved on Done and plan the week again.
struct MyRulesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var rules = UserRules()
    @State private var importing = false
    @State private var importProblem: String?
    @State private var settingHome = false
    @State private var homeLine: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Plan by my rules", isOn: $rules.isOn)
                } footer: {
                    Text("Off, the week follows the days you usually train. On, every day at home with time gets one session, and rest days and days out get none.")
                }
                if rules.isOn {
                    Section("Never plan on") {
                        WeekdayChips(selected: $rules.restWeekdays)
                    }
                    Section {
                        LabeledContent("Days I go out", value: "No workout")
                        LabeledContent("Days I'm home all day", value: "Always plan one")
                    } footer: {
                        Text("A day with an event somewhere other than home is a day out. So is a day you mark with “I’m going out today”.")
                    }
                    Section("Session length") {
                        Stepper("Shortest \(rules.sessionMin) min", value: $rules.sessionMin, in: 10...rules.sessionMax, step: 5)
                        Stepper("Longest \(rules.sessionMax) min", value: $rules.sessionMax, in: rules.sessionMin...90, step: 5)
                    }
                    Section {
                        ClockPicker(title: "From", clock: $rules.windowFrom)
                        ClockPicker(title: "Latest start", clock: $rules.windowTo)
                        Toggle("Mornings too, from 06:00", isOn: $rules.mornings)
                    } header: {
                        Text("Plan between")
                    }
                    Section("Equipment") {
                        ForEach(UserRules.Equipment.allCases) { thing in
                            Toggle(thing.title, isOn: Binding(
                                get: { rules.equipment.contains(thing) },
                                set: { on in rules.equipment = UserRules.Equipment.allCases.filter { $0 == thing ? on : rules.equipment.contains($0) } }
                            ))
                        }
                    }
                    Section("Movements to avoid") {
                        LabeledContent("Avoided", value: rules.avoid.isEmpty ? "None" : "\(rules.avoid.count)")
                    }
                    Section {
                        Button(settingHome ? "Finding where you are…" : (rules.home == nil ? "Set my current location as home" : "Move home to where I am now")) {
                            Task { await setHome() }
                        }
                        .disabled(settingHome)
                        if let homeLine { Text(homeLine).font(.footnote).foregroundStyle(Theme.textMuted) }
                        Stepper("Far from home: \(Int(rules.farKilometres)) km", value: $rules.farKilometres, in: 5...100, step: 5)
                    } header: {
                        Text("Home")
                    } footer: {
                        Text("Within 200 m is home. Opening the app this far from home makes today a day out. Home stays on this phone.")
                    }
                }
                Section {
                    Button("Import a profile…") { importing = true }
                    if let importProblem { Text(importProblem).font(.footnote).foregroundStyle(Theme.warning) }
                } footer: {
                    Text("A file with your rules, made somewhere else and sent to this phone. It fills in these answers once.")
                }
            }
            .navigationTitle("My rules")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        let rules = rules
                        Task { await model.saveRules(rules) }
                        dismiss()
                    }
                    .disabled(!rules.isValid)
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in importProfile(result) }
            .onAppear { rules = model.userRules }
        }
    }

    private func importProfile(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else { return }
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        do {
            rules = try rules.importing(try Data(contentsOf: url))
            importProblem = nil
        } catch UserRules.ImportError.outOfRange {
            importProblem = "That profile has a value I can’t use, so nothing was changed."
        } catch {
            importProblem = "That file couldn’t be read as a profile, so nothing was changed."
        }
    }

    private func setHome() async {
        settingHome = true
        defer { settingHome = false }
        let location = DeviceLocation(accuracy: 100)
        guard await location.request(), let here = await location.current() else {
            homeLine = "Location is off for Evergreen, so home can’t be set."
            return
        }
        rules.home = HomePlace(place: here)
        homeLine = "Home is set to where you are now."
    }
}

/// Seven chips, Monday to Sunday, for the weekdays never planned.
struct WeekdayChips: View {
    @Binding var selected: [Int]

    var body: some View {
        HStack(spacing: Theme.xs) {
            ForEach(0..<7, id: \.self) { day in
                let on = selected.contains(day)
                Button {
                    selected = on ? selected.filter { $0 != day } : (selected + [day]).sorted()
                } label: {
                    Text(UserRules.weekdayShort[day])
                        .font(.footnote.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(on ? Theme.accent : Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
                        .foregroundStyle(on ? Theme.onAccent : Theme.text)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(DayDots.names[day])
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

/// An "HH:MM" text edited as a time.
struct ClockPicker: View {
    let title: String
    @Binding var clock: String

    var body: some View {
        DatePicker(title, selection: Binding(
            get: {
                let minutes = UserRules.minutes(clock) ?? 12 * 60
                return Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? Date()
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                clock = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
            }
        ), displayedComponents: .hourAndMinute)
    }
}
