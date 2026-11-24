import FamilyControls
import SwiftUI

/// Earned screen time, from Settings: how much is earned, each group's free time a day and rate, and the apps it locks.
struct EarnedTimeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var picking: FunGroup?
    @State private var selection = FamilyActivitySelection()
    @State private var turningOn = false
    /// "Turn on" and "Turn off" are asked once more, saying what they do, before they do it.
    @State private var confirmingOn = false
    @State private var confirmingOff = false

    private var earned: EarnedTimeModel { model.earnedTime }

    var body: some View {
        NavigationStack {
            Form {
                Section { statement }
                if !earned.isOn { Section { turnOn } }
                Section {
                    ForEach(FunGroup.allCases) { appsRow($0) }
                } header: {
                    Text("What it locks")
                } footer: {
                    Text("Social is for apps like X and Discord. An app goes in one group. A whole category can only be locked in one group.")
                }
                Section {
                    ForEach(FunGroup.allCases) { baseRow($0) }
                } header: {
                    Text("Free each day")
                } footer: {
                    Text(rulesNote)
                }
                Section("Earned for each workout minute") {
                    ForEach(FunGroup.allCases) { rateRow($0) }
                }
                if earned.isOn {
                    Section {
                        Button("Turn off", role: .destructive) { confirmingOff = true }
                            .frame(minHeight: 44)
                            .confirmationDialog("Turn off earned screen time?", isPresented: $confirmingOff, titleVisibility: .visible) {
                                Button("Turn off and unlock the apps", role: .destructive) { earned.turnOff() }
                            } message: {
                                Text("The apps unlock now. What you’ve earned stays, and you can turn it on again here.")
                            }
                    }
                }
            }
            .navigationTitle("Earned screen time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .familyActivityPicker(isPresented: Binding(get: { picking != nil }, set: { if !$0 { save() } }),
                                  selection: $selection)
            .sheet(isPresented: $confirmingOn) { LockConfirmation(earned: earned, turnOn: turnOnNow) }
            .onAppear { earned.refresh(workouts: model.workouts, now: model.now, calendar: model.calendar) }
        }
    }

    private func turnOnNow() {
        turningOn = true
        Task {
            await earned.turnOn(workouts: model.workouts, now: model.now, calendar: model.calendar)
            turningOn = false
        }
    }

    /// The one large thing on the screen: the minutes of social apps, with videos and games beside it.
    private var statement: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("\(usable(.social)) min")
                .agentFont(56, relativeTo: .largeTitle)
                .foregroundStyle(Theme.text)
            Text(earned.isOn ? "of social apps to use today, \(usable(.videos)) min of videos, \(usable(.games)) min of games"
                             : "of social apps earned this week, or \(usable(.videos)) min of videos, \(usable(.games)) min of games")
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    /// Once on: today's free time left plus what the credit buys. Before that: what this week earned.
    private func usable(_ group: FunGroup) -> Int {
        earned.minutes(group) + (earned.isOn ? earned.baseLeft[group] ?? 0 : 0)
    }

    private var rulesNote: String {
        let escape = earned.escapeLeft ? "is still there this week" : "is used this week and comes back on Monday"
        return "Free time is used first and starts again at midnight; what is left isn't carried over. Each unlock opens up to \(EarnRules.block) minutes. A workout after a missed day adds \(EarnRules.comebackMinutes) minutes to each that day. \"Unlock for \(EarnRules.escapeMinutes) minutes\" on the locked screen \(escape)."
    }

    private func baseRow(_ group: FunGroup) -> some View {
        LabeledContent(group.title, value: earned.isOn ? "\(earned.baseLeft[group] ?? 0) of \(group.baseMinutes) min left" : "\(group.baseMinutes) min")
            .frame(minHeight: 44)
    }

    private var turnOn: some View {
        VStack(alignment: .leading, spacing: Theme.md) {
            Text("The apps you pick get some free time each day and stay locked once it is used, until you earn more. Any workout counts, and you spend the minutes from the locked app itself.")
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Button(turningOn ? "Turning on" : "Turn on") { confirmingOn = true }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(nothingPicked || turningOn)
                .opacity(nothingPicked ? 0.4 : 1)
            if let problem = earned.problem {
                Text(problem).font(.footnote).foregroundStyle(Theme.warning)
            } else if nothingPicked {
                Text("Pick the apps below first.").font(.footnote).foregroundStyle(Theme.textMuted)
            }
        }
        .padding(.vertical, Theme.sm)
    }

    private var nothingPicked: Bool { FunGroup.allCases.allSatisfy { earned.picked($0) == 0 } }

    private func rateRow(_ group: FunGroup) -> some View {
        let rate = earned.rates[group] ?? group.defaultRate
        return Stepper(value: Binding(get: { rate }, set: { earned.setRate($0, for: group) }), in: Self.rates, step: Self.rateStep) {
            LabeledContent(group.title, value: "\(Self.number(rate)) min")
        }
        .frame(minHeight: 44)
    }

    /// What a workout minute can earn, and the step between.
    private static let rates = 0.25...3.0
    private static let rateStep = 0.25

    private func appsRow(_ group: FunGroup) -> some View {
        let count = earned.picked(group)
        return Button {
            selection = earned.selections[group] ?? FamilyActivitySelection()
            picking = group
        } label: {
            LabeledContent(group.title, value: count == 0 ? "Pick apps" : count == 1 ? "1 picked" : "\(count) picked")
                .frame(minHeight: 44)
                .contentShape(.rect)
        }
        .foregroundStyle(Theme.text)
    }

    private func save() {
        if let group = picking { earned.setSelection(selection, for: group) }
        picking = nil
    }

    /// 1, 0.5, 1.25: no trailing zeros.
    nonisolated static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }
}

/// "Lock these apps?" before turning on: each group with every app, category and site it locks, by name and icon
/// (the system draws them from its tokens), and its free time a day.
private struct LockConfirmation: View {
    let earned: EarnedTimeModel
    let turnOn: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(FunGroup.allCases.filter { earned.picked($0) > 0 }) { group in
                    let picked = earned.selections[group] ?? FamilyActivitySelection()
                    Section {
                        ForEach(Array(picked.applicationTokens), id: \.self) { Label($0) }
                        ForEach(Array(picked.categoryTokens), id: \.self) { Label($0) }
                        ForEach(Array(picked.webDomainTokens), id: \.self) { Label($0) }
                    } header: {
                        Text(group.title)
                    } footer: {
                        Text("Free for \(group.baseMinutes) min a day, then locked until you earn more with a workout.")
                    }
                }
                Section {
                    Text("The free time starts again at midnight. You can turn this off here at any time.")
                        .font(.footnote).foregroundStyle(Theme.textMuted)
                }
            }
            .navigationTitle("Lock these apps?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lock them") { turnOn(); dismiss() }
                }
            }
        }
    }
}
