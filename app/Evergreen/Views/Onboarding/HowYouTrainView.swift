import SwiftUI

/// Onboarding, after the permissions: "How you train", five short questions
/// whose answers become the person's rules. Every one can be skipped; skipping
/// the screen keeps the usual week, built from the days they already train.
struct HowYouTrainView: View {
    let onContinue: () -> Void

    @Environment(AppModel.self) private var model
    @State private var rules = UserRules()
    @State private var atHome = true

    private static let lengths: [(min: Int, max: Int)] = [(15, 20), (20, 25), (30, 40)]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("How you train")
                .agentFont(30, relativeTo: .title)
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, Theme.xl)
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.lg) {
                    question("Where do you train?") {
                        Picker("Where", selection: $atHome) {
                            Text("At home").tag(true)
                            Text("Somewhere else").tag(false)
                        }
                        .pickerStyle(.segmented)
                    }
                    if atHome {
                        question("What do you have?") {
                            Text("No gym equipment needed. Floor and wall are always there.")
                                .font(.footnote).foregroundStyle(Theme.textMuted)
                            ForEach(UserRules.Equipment.allCases) { thing in
                                Toggle(thing.title, isOn: Binding(
                                    get: { rules.equipment.contains(thing) },
                                    set: { on in rules.equipment = UserRules.Equipment.allCases.filter { $0 == thing ? on : rules.equipment.contains($0) } }
                                ))
                                .frame(minHeight: 44)
                            }
                        }
                        question("Which days never?") {
                            WeekdayChips(selected: $rules.restWeekdays)
                        }
                        question("How long is a session?") {
                            Picker("Length", selection: Binding(
                                get: { Self.lengths.firstIndex { $0.min == rules.sessionMin && $0.max == rules.sessionMax } ?? 1 },
                                set: { rules.sessionMin = Self.lengths[$0].min; rules.sessionMax = Self.lengths[$0].max }
                            )) {
                                ForEach(Self.lengths.indices, id: \.self) { i in Text("\(Self.lengths[i].min)–\(Self.lengths[i].max) min").tag(i) }
                            }
                            .pickerStyle(.segmented)
                        }
                        question("Anything to avoid?") {
                            Text("You can pick movements to leave out in Settings › My rules, once you’ve seen them.")
                                .font(.footnote).foregroundStyle(Theme.textMuted)
                        }
                    } else {
                        Text("Then I’ll plan from the days you already train. You can set your own rules later in Settings › My rules.")
                            .font(.body).foregroundStyle(Theme.textMuted)
                    }
                }
                .padding(.vertical, Theme.lg)
            }
            Button("Continue") {
                if atHome {
                    var answered = rules
                    answered.isOn = true
                    model.userRules = answered
                    answered.save(to: model.settings)
                }
                onContinue()
            }
            .buttonStyle(PrimaryButtonStyle())
            Button("Skip", action: onContinue)
                .font(.body)
                .foregroundStyle(Theme.textMuted)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .padding(.horizontal, Theme.md)
        .padding(.bottom, Theme.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Theme.surface)
        .onAppear { rules = model.userRules }
    }

    private func question(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(title).font(.headline).foregroundStyle(Theme.text)
            content()
        }
    }
}
