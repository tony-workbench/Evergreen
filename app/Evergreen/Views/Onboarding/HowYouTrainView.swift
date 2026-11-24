import SwiftUI

/// Onboarding, after the permissions: "How you train", five short questions
/// whose answers become the person's rules; the fifth opens the list of movements to leave out. Every one can be skipped; skipping
/// the screen turns on the usual defaults (home, no gym equipment, Wednesday,
/// Saturday and Sunday off, 20–25 minutes), which Settings › My rules can change.
/// "Somewhere else" keeps the usual week, built from the days they already train.
/// What Continue and Skip keep lives in the model (AppModel+ViewLogic.swift).
struct HowYouTrainView: View {
    let onContinue: () -> Void

    @Environment(AppModel.self) private var model
    @State private var rules = UserRules()
    @State private var atHome = true
    @State private var pickingAvoid = false
    @State private var settingHome = false
    @State private var homeLine: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            title
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.lg) {
                    whereQuestion
                    if atHome { homeQuestions } else { elsewhereLine }
                }
                .padding(.vertical, Theme.lg)
            }
            continueButton
            skipButton
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Theme.surface)
        .onAppear { rules = model.userRules }
        .sheet(isPresented: $pickingAvoid) { avoidSheet }
    }

    private var title: some View {
        Text("How you train")
            .agentFont(Theme.pageTitleSize, relativeTo: .title)
            .foregroundStyle(Theme.text)
            .accessibilityAddTraits(.isHeader)
            .padding(.top, Theme.xl)
    }

    // MARK: Questions

    private var whereQuestion: some View {
        question("Where do you train?") {
            Picker("Where", selection: $atHome) {
                Text("At home").tag(true)
                Text("Somewhere else").tag(false)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("howYouTrain.where")
        }
    }

    @ViewBuilder private var homeQuestions: some View {
        homeQuestion
        equipmentQuestion
        question("Which days never?") { WeekdayChips(selected: $rules.restWeekdays) }
        lengthQuestion
        avoidQuestion
    }

    private var homeQuestion: some View {
        question("Where is home?") {
            Button(homeButtonTitle) { Task { await setHome() } }
                .buttonStyle(TapTargetButtonStyle())
                .disabled(settingHome)
                .accessibilityIdentifier("howYouTrain.home")
            note(homeLine ?? "A day with an event somewhere else is a day out, with no workout. Your location stays on this phone.")
        }
    }

    private var homeButtonTitle: String {
        settingHome ? "Finding where you are…" : rules.home == nil ? "I’m home now: use this place" : "Home is set. Move it here"
    }

    private var equipmentQuestion: some View {
        question("What do you have?") {
            note("No gym equipment needed. Floor and wall are always there.")
            ForEach(UserRules.Equipment.allCases) { thing in
                Toggle(thing.title, isOn: Binding(get: { rules.has(thing) }, set: { rules.setEquipment(thing, on: $0) }))
                    .frame(minHeight: TapTargetButtonStyle.minSide)
                    .accessibilityIdentifier("howYouTrain.equipment.\(thing.rawValue)")
            }
        }
    }

    private var lengthQuestion: some View {
        question("How long is a session?") {
            Picker("Length", selection: $rules.lengthChoice) {
                ForEach(Array(UserRules.lengthChoices.enumerated()), id: \.element.words) { index, choice in
                    Text(choice.words).tag(index)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("howYouTrain.length")
        }
    }

    private var avoidQuestion: some View {
        question("Anything to avoid?") {
            Button(rules.avoid.isEmpty ? "Pick movements to leave out" : "\(rules.avoid.count) left out. Change") { pickingAvoid = true }
                .buttonStyle(TapTargetButtonStyle())
                .accessibilityIdentifier("howYouTrain.avoid")
            note("None is fine. You can change it later in Settings › My rules.")
        }
    }

    private var elsewhereLine: some View {
        Text("Then I’ll plan from the days you already train. You can set your own rules later in Settings › My rules.")
            .font(.body).foregroundStyle(Theme.textMuted)
    }

    // MARK: Leaving

    private var continueButton: some View {
        Button("Continue") {
            model.answerHowYouTrain(rules, atHome: atHome)
            onContinue()
        }
        .buttonStyle(PrimaryButtonStyle())
        .accessibilityIdentifier("howYouTrain.continue")
    }

    private var skipButton: some View {
        Button("Skip") {
            model.skipHowYouTrain()
            onContinue()
        }
        .accessibilityHint("Uses the usual rules, which you can change in Settings")
        .font(.body)
        .foregroundStyle(Theme.textMuted)
        .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide)
        .accessibilityIdentifier("howYouTrain.skip")
    }

    private var avoidSheet: some View {
        NavigationStack {
            AvoidMovementsView(rules: $rules)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { pickingAvoid = false } } }
        }
    }

    // MARK: Parts

    private func setHome() async {
        settingHome = true
        defer { settingHome = false }
        guard let home = await model.locateHome() else {
            homeLine = "Location is off for Evergreen, so home isn’t set. You can set it later in Settings › My rules."
            return
        }
        rules.home = home
        homeLine = "Home is set to where you are now."
    }

    private func question(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(title).font(.headline).foregroundStyle(Theme.text)
            content()
        }
    }

    private func note(_ words: String) -> some View {
        Text(words).font(.footnote).foregroundStyle(Theme.textMuted)
    }
}
