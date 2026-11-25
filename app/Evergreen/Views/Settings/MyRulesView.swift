import SwiftUI
import UniformTypeIdentifiers

/// Settings › My rules: the rules the person set, kept as they said them. The
/// planner never puts a session on a rest weekday or a day out, and puts one
/// on every day at home with time for it. Changes are saved on Done and plan the week again.
/// An answer that doesn't make sense is said beside it as soon as it is given, and Done waits until it does.
struct MyRulesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var rules = UserRules()
    @State private var importing = false
    @State private var importProblem: String?
    @State private var settingHome = false
    @State private var homeLine: String?

    /// "Far from home" goes from 5 to 100 kilometres, 5 at a time.
    private static let farRange: ClosedRange<Double> = 5...100
    private static let farStep: Double = 5

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Plan by my rules", isOn: $rules.isOn).accessibilityIdentifier("rules.on")
                } footer: {
                    // Headers and footers here use the app's muted text: the system grey only nearly holds 4.5:1 on the form.
                    Text("Off, the week follows the days you usually train. On, every day at home with time gets one session, and rest days and days out get none.")
                        .foregroundStyle(Theme.textMuted)
                }
                if rules.isOn { ruleSections }
                importSection
            }
            .navigationTitle("My rules")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in importProfile(result) }
            .onAppear { rules = model.userRules }
            .task { await model.loadMovements() }
        }
    }

    @ViewBuilder private var ruleSections: some View {
        restSection
        Section {
            LabeledContent("Days I go out", value: "No workout")
            LabeledContent("Days I'm home all day", value: "Always plan one")
        } footer: {
            Text("A day with an event somewhere other than home is a day out. So is a day you mark with “I’m going out today”.")
                .foregroundStyle(Theme.textMuted)
        }
        lengthSection
        hoursSection
        equipmentSection
        movementsSection
        homeSection
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.accessibilityIdentifier("rules.cancel") }
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") {
                let rules = rules
                Task { await model.saveRules(rules) }
                dismiss()
            }
            .disabled(!rules.isValid)
            .accessibilityHint(rules.isValid ? "Saves your rules and plans the week again" : "Put right what’s marked first")
            .accessibilityIdentifier("rules.done")
        }
    }

    // MARK: Sections

    private var restSection: some View {
        Section {
            WeekdayChips(selected: $rules.restWeekdays)
        } header: {
            Text("Never plan on")
                .foregroundStyle(Theme.textMuted)
        } footer: {
            ProblemLines(problems: rules.shownProblems([.restDays]))
        }
    }

    private var lengthSection: some View {
        Section {
            Stepper("Shortest \(rules.sessionMin) min", value: $rules.sessionMin,
                    in: rules.shortestRange, step: UserRules.sessionStep)
                .accessibilityIdentifier("rules.shortest")
            Stepper("Longest \(rules.sessionMax) min", value: $rules.sessionMax,
                    in: rules.longestRange, step: UserRules.sessionStep)
                .accessibilityIdentifier("rules.longest")
        } header: {
            Text("Session length")
                .foregroundStyle(Theme.textMuted)
        } footer: {
            ProblemLines(problems: rules.shownProblems([.shortest, .lengths, .longest]))
        }
    }

    private var hoursSection: some View {
        Section {
            ClockPicker(title: "From", clock: $rules.windowFrom).accessibilityIdentifier("rules.from")
            ClockPicker(title: "Latest start", clock: $rules.windowTo).accessibilityIdentifier("rules.latestStart")
            Toggle("Mornings too, from 06:00", isOn: $rules.mornings).accessibilityIdentifier("rules.mornings")
        } header: {
            Text("Plan between")
                .foregroundStyle(Theme.textMuted)
        } footer: {
            ProblemLines(problems: rules.shownProblems([.clock, .window]))
        }
    }

    private var equipmentSection: some View {
        Section {
            ForEach(UserRules.Equipment.allCases) { thing in
                Toggle(thing.title, isOn: Binding(get: { rules.has(thing) }, set: { rules.setEquipment(thing, on: $0) }))
                    .accessibilityIdentifier("rules.equipment.\(thing.rawValue)")
            }
        } header: {
            Text("Equipment").foregroundStyle(Theme.textMuted)
        }
    }

    private var movementsSection: some View {
        Section {
            NavigationLink {
                AvoidMovementsView(rules: $rules)
            } label: {
                LabeledContent("Movements", value: rules.movementsSummary)
            }
            .accessibilityIdentifier("rules.movements")
        } footer: {
            VStack(alignment: .leading, spacing: Theme.xs) {
                Text("Each movement is not tried yet, one you can do, or one you can’t do yet. One you can’t do never comes; the easier one comes instead. “Too hard” on the workout page marks it, and you can change it here.")
                    .foregroundStyle(Theme.textMuted)
                ProblemLines(problems: rules.shownProblems([.movements]))
            }
        }
    }

    private var homeSection: some View {
        Section {
            Button(settingHome ? "Finding where you are…" : (rules.home == nil ? "Set my current location as home" : "Move home to where I am now")) {
                Task { await setHome() }
            }
            .disabled(settingHome)
            .accessibilityIdentifier("rules.setHome")
            if let homeLine { Text(homeLine).font(.footnote).foregroundStyle(Theme.textMuted) }
            Stepper("Far from home: \(Int(rules.farKilometres)) km", value: $rules.farKilometres, in: Self.farRange, step: Self.farStep)
                .accessibilityIdentifier("rules.far")
        } header: {
            Text("Home")
                .foregroundStyle(Theme.textMuted)
        } footer: {
            Text("Within 200 m is home. Opening the app this far from home makes today a day out. Home stays on this phone.")
                .foregroundStyle(Theme.textMuted)
        }
    }

    private var importSection: some View {
        Section {
            Button("Import a profile…") { importing = true }
                .accessibilityIdentifier("rules.import")
            if let importProblem { Text(importProblem).font(.footnote).foregroundStyle(Theme.warning) }
        } footer: {
            Text("A file with your rules, made somewhere else and sent to this phone. It fills in these answers once.")
                .foregroundStyle(Theme.textMuted)
        }
    }

    // MARK: Doing

    /// What reading and checking the file gave (`AppModel.importProfile`): the new answers, or what to say.
    private func importProfile(_ result: Result<URL, Error>) {
        switch model.importProfile(from: result, onto: rules) {
        case .imported(let imported)?:
            rules = imported
            importProblem = nil
        case .problem(let words)?:
            importProblem = words
        case nil:
            break
        }
    }

    private func setHome() async {
        settingHome = true
        defer { settingHome = false }
        guard let home = await model.locateHome() else {
            homeLine = "Location is off for Evergreen, so home can’t be set."
            return
        }
        rules.home = home
        homeLine = "Home is set to where you are now."
    }
}

/// What is wrong with the answers just above (`UserRules.shownProblems`), said where they are, in the warning colour and
/// with a sign so it isn't told by colour alone. Nothing when they make sense.
struct ProblemLines: View {
    let problems: [UserRules.Problem]

    var body: some View {
        ForEach(problems, id: \.words) { problem in
            Label(problem.words, systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("rules.problem")
        }
    }
}

/// Every movement, by what it works: whether the person can do it (not tried yet, can, can't do yet) and whether to
/// leave it out for good.
struct AvoidMovementsView: View {
    @Binding var rules: UserRules
    @Environment(AppModel.self) private var model

    private static let groups: [(pattern: String, title: String)] = [
        ("lower_push", "Legs"), ("lower_pull", "Hips and the back of the legs"), ("upper_push", "Pushing"),
        ("upper_pull", "Pulling"), ("core", "The middle"), ("snack", "Short pieces"),
    ]

    var body: some View {
        List {
            if model.movements.isEmpty { Text("Reading the movements…").foregroundStyle(Theme.textMuted) }
            ForEach(Self.groups, id: \.pattern) { group in
                let moves = model.movements(working: group.pattern)
                if !moves.isEmpty {
                    Section {
                        ForEach(moves) { move in MovementRuleRow(move: move, rules: $rules) }
                    } header: {
                        Text(group.title).foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
        .navigationTitle("Movements")
        .task { await model.loadMovements() }
    }
}

/// One movement in My rules: its state, which the person can change, and "Leave out".
private struct MovementRuleRow: View {
    let move: Movement
    @Binding var rules: UserRules

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xs) {
            Picker(move.name, selection: Binding(
                get: { rules.state(of: move.id) },
                set: { rules.setState($0, of: move.id) }
            )) {
                ForEach(UserRules.MovementState.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.menu)
            .frame(minHeight: TapTargetButtonStyle.minSide)
            .accessibilityIdentifier("rules.movement.\(move.id)")
            Toggle("Leave out", isOn: Binding(get: { rules.isLeftOut(move.id) }, set: { rules.setLeftOut(move.id, $0) }))
                .accessibilityLabel("Leave out \(move.name)")
                .frame(minHeight: TapTargetButtonStyle.minSide)
                .accessibilityIdentifier("rules.leaveOut.\(move.id)")
        }
    }
}

/// Seven chips, Monday to Sunday, for the weekdays never planned.
struct WeekdayChips: View {
    @Binding var selected: [Int]

    var body: some View {
        HStack(spacing: Theme.sm) {
            ForEach(UserRules.weekdays, id: \.self) { day in
                let on = selected.contains(day)
                Button {
                    selected = UserRules.toggling(day, in: selected)
                } label: {
                    Text(UserRules.weekdayShort[day])
                        .font(.footnote.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide)
                        .background(on ? Theme.accent : Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall))
                        .foregroundStyle(on ? Theme.onAccent : Theme.text)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(DayDots.names[day])
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("rules.restDay.\(day)")
            }
        }
    }
}

/// An "HH:MM" text edited as a time.
struct ClockPicker: View {
    let title: String
    @Binding var clock: String
    @Environment(AppModel.self) private var model

    var body: some View {
        DatePicker(title, selection: Binding(
            get: { UserRules.date(ofClock: clock, on: model.now, calendar: model.calendar) },
            set: { clock = UserRules.clock(of: $0, calendar: model.calendar) }
        ), displayedComponents: .hourAndMinute)
    }
}
