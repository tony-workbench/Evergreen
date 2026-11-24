import FamilyControls
import SwiftUI

/// Earned screen time, from Settings: how much is earned, the rate for each group, and the apps it locks.
struct EarnedTimeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var picking: FunGroup?
    @State private var selection = FamilyActivitySelection()
    @State private var turningOn = false

    private var earned: EarnedTimeModel { model.earnedTime }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.xl) {
                    statement
                    if !earned.isOn { turnOn }
                    block("What it locks") {
                        ForEach(FunGroup.allCases) { appsRow($0) }
                        Text("An app goes in one group. A whole category can only be locked in one group.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, Theme.sm)
                    }
                    block("Earned for each workout minute") {
                        ForEach(FunGroup.allCases) { rateRow($0) }
                    }
                    if earned.isOn {
                        Button("Turn off") { earned.turnOff() }
                            .font(.body)
                            .foregroundStyle(Theme.warning)
                            .frame(minHeight: 44)
                    }
                }
                .padding(.horizontal, Theme.md)
                .padding(.vertical, Theme.lg)
            }
            .background(Theme.surface)
            .navigationTitle("Earned screen time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .familyActivityPicker(isPresented: Binding(get: { picking != nil }, set: { if !$0 { save() } }),
                                  selection: $selection)
            .onAppear { earned.refresh(workouts: model.workouts, now: model.now, calendar: model.calendar) }
        }
    }

    /// The one large thing on the screen: the minutes of videos, with games beside it.
    private var statement: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("\(earned.minutes(.videos)) min")
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(Theme.text)
            Text(earned.isOn ? "of videos to use, or \(earned.minutes(.games)) min of games"
                             : "of videos from this week's workouts, or \(earned.minutes(.games)) min of games")
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var turnOn: some View {
        VStack(alignment: .leading, spacing: Theme.md) {
            Text("The apps you pick stay locked until you earn time for them. Any workout counts, and you spend the minutes from the locked app itself.")
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Button(turningOn ? "Turning on" : "Turn on") {
                turningOn = true
                Task {
                    await earned.turnOn(workouts: model.workouts, now: model.now, calendar: model.calendar)
                    turningOn = false
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(nothingPicked || turningOn)
            .opacity(nothingPicked ? 0.4 : 1)
            if let problem = earned.problem {
                Text(problem).font(.footnote).foregroundStyle(Theme.warning)
            } else if nothingPicked {
                Text("Pick the apps below first.").font(.footnote).foregroundStyle(Theme.textMuted)
            }
        }
    }

    private var nothingPicked: Bool { FunGroup.allCases.allSatisfy { earned.picked($0) == 0 } }

    private func rateRow(_ group: FunGroup) -> some View {
        let rate = earned.rates[group] ?? group.defaultRate
        return VStack(spacing: 0) {
            Stepper(value: Binding(get: { rate }, set: { earned.setRate($0, for: group) }), in: 0.25...3, step: 0.25) {
                HStack {
                    Text(group.title).foregroundStyle(Theme.text)
                    Spacer()
                    Text("\(Self.number(rate)) min").foregroundStyle(Theme.textMuted)
                }
                .font(.body)
            }
            .frame(minHeight: 52)
            rule
        }
    }

    private func appsRow(_ group: FunGroup) -> some View {
        let count = earned.picked(group)
        return VStack(spacing: 0) {
            Button {
                selection = earned.selections[group] ?? FamilyActivitySelection()
                picking = group
            } label: {
                HStack {
                    Text(group.title).foregroundStyle(Theme.text)
                    Spacer()
                    Text(count == 0 ? "Pick apps" : count == 1 ? "1 picked" : "\(count) picked")
                        .foregroundStyle(count == 0 ? Theme.accent : Theme.textMuted)
                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.textMuted)
                }
                .font(.body)
                .frame(minHeight: 52)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            rule
        }
    }

    private func save() {
        if let group = picking { earned.setSelection(selection, for: group) }
        picking = nil
    }

    private var rule: some View { Rectangle().fill(Theme.rule).frame(height: 1) }

    private func block(_ title: String, @ViewBuilder content: () -> some View) -> some View {
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

    /// 1, 0.5, 1.25: no trailing zeros.
    static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }
}
