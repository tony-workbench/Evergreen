import SwiftUI

/// The home workout page: one movement per screen, in words only, with what to
/// do, where it should be felt and when a rep counts; a rest countdown between
/// sets; "Too hard", "Swap" and "Done with this set"; and, at the end, how
/// sore it is and how it went. What is done is kept as it goes, so leaving and
/// coming back the same day picks up where it stopped.
struct WorkoutSessionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var progress: WorkoutProgress?
    @State private var loading = true
    @State private var count = 0
    @State private var restUntil: Date?
    @State private var finishing = false
    @State private var pain: Int?
    @State private var feeling: WorkoutFeeling?
    @State private var swapping = false
    @State private var saving = false
    /// Goes up with each set done, for a light tap of feedback.
    @State private var setsLogged = 0

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if progress == nil {
                    Text("There’s no home workout today.")
                        .font(.body).foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if finishing {
                    finishPage
                } else if let restUntil {
                    RestCountdown(until: restUntil, next: nextLine) { self.restUntil = $0 } onDone: { self.restUntil = nil }
                } else {
                    movementPage
                }
            }
            .background(Theme.surface)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .accessibilityHint("What you’ve done is kept for today")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .sensoryFeedback(.success, trigger: setsLogged)
        .sensoryFeedback(.success, trigger: finishing) { _, now in now }
        .task {
            progress = await model.workoutToday()
            loading = false
            resetCount()
        }
    }

    // MARK: One movement

    private var index: Int { progress?.index ?? 0 }
    private var item: WorkoutContent.Item? { progress.flatMap { $0.content.items.indices.contains($0.index) ? $0.content.items[$0.index] : nil } }
    private var result: WorkoutResult? { progress.flatMap { $0.results.indices.contains($0.index) ? $0.results[$0.index] : nil } }
    private var setsDone: Int { result?.sets.count ?? 0 }

    @ViewBuilder private var movementPage: some View {
        if let progress, let item, let move = model.movement(item.movementId) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.md) {
                    Text("\(progress.index + 1) of \(progress.content.items.count)")
                        .font(.footnote).foregroundStyle(Theme.textMuted)
                    Text(move.name)
                        .agentFont(30, relativeTo: .title)
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text(targetLine(item, move))
                        .font(.headline).foregroundStyle(Theme.accent)
                    if item.isNew && setsDone == 0 && model.userRules.movements[move.id] == nil {
                        canYouDoOne(move)
                    } else {
                        howTo(move)
                        entry(item)
                    }
                }
                .padding(Theme.md)
            }
            .sheet(isPresented: $swapping) { swapList(for: move) }
        } else {
            Text("This movement couldn’t be read.").font(.body).foregroundStyle(Theme.textMuted)
                .onAppear { advance() }
        }
    }

    private func targetLine(_ item: WorkoutContent.Item, _ move: Movement) -> String {
        var line = "Set \(min(setsDone + 1, item.sets)) of \(item.sets) · \(item.target(sides: move.sides))"
        if let load = result?.load ?? item.load { line += " · " + BackpackWater.words(load) }
        return line
    }

    private func canYouDoOne(_ move: Movement) -> some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("This one is new. Try one rep first: can you do it?")
                .font(.body).foregroundStyle(Theme.text)
            howTo(move)
            Button("Yes, I can") { Task { await model.answerCanDo(move.id, can: true) } }
                .buttonStyle(PrimaryButtonStyle.tall)
            Button("Not yet") {
                Task {
                    await model.answerCanDo(move.id, can: false)
                    if let easier = move.easier.flatMap(model.movement) { swap(to: easier) }
                }
            }
            .buttonStyle(GhostButtonStyle())
        }
    }

    private func howTo(_ move: Movement) -> some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(move.setup).font(.body).foregroundStyle(Theme.text)
            ForEach(Array(move.steps.enumerated()), id: \.offset) { number, step in
                HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
                    Text("\(number + 1).").font(.body.monospacedDigit()).foregroundStyle(Theme.textMuted)
                    Text(step).font(.body).foregroundStyle(Theme.text)
                }
            }
            if let tempo = move.tempoLine { Text(tempo).font(.footnote).foregroundStyle(Theme.textMuted) }
            line("Where you should feel it", move.feel)
            line("It counts when", move.pass)
            line("Watch for", move.mistakes.joined(separator: " "))
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func line(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(Theme.textMuted)
            Text(text).font(.body).foregroundStyle(Theme.text)
        }
    }

    private func entry(_ item: WorkoutContent.Item) -> some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Stepper(item.isHold ? "Seconds held: \(count)" : "Reps done: \(count)", value: $count, in: 0...max(item.high * 2, 30))
                .font(.body)
                .frame(minHeight: 44)
            HStack(spacing: Theme.sm) {
                smallAction("Too hard") { tooHard() }
                smallAction("Swap") { swapping = true }
                smallAction("Skip") { advance() }
            }
            Button("Done with this set") { doneWithSet() }
                .buttonStyle(PrimaryButtonStyle.tall)
        }
    }

    /// A secondary action on the workout page: at least 44 by 44 points to tap, with 8 points between neighbours.
    private func smallAction(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.body)
            .foregroundStyle(Theme.accent)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            .background(RoundedRectangle(cornerRadius: Theme.radiusButton).strokeBorder(Theme.rule, lineWidth: 1))
    }

    // MARK: Changing what's on screen

    private func edit(_ change: (inout WorkoutProgress) -> Void) {
        guard var current = progress else { return }
        change(&current)
        progress = current
        model.saveProgress(current)
    }

    private func resetCount() {
        guard let item else { return }
        count = item.low
    }

    private func doneWithSet() {
        guard let item else { return }
        edit { $0.results[$0.index].sets.append(count) }
        setsLogged += 1
        if setsDone >= item.sets { advance() } else { restUntil = Date().addingTimeInterval(TimeInterval(item.rest)); resetCount() }
    }

    /// A backpack movement drops a kilogram; a bodyweight one goes to the easier one (or stays, marked, when there is none).
    private func tooHard() {
        guard let item, let move = model.movement(item.movementId) else { return }
        if move.usesBackpack, let load = result?.load ?? item.load {
            edit { $0.results[$0.index].load = max(1, load - 1); $0.results[$0.index].tooHard = true }
        } else if let easier = move.easier.flatMap(model.movement) {
            swap(to: easier)
        } else {
            edit { $0.results[$0.index].tooHard = true }
        }
    }

    /// Puts another movement in this one's place. Sets already done stay with the first movement.
    private func swap(to move: Movement) {
        guard let item else { return }
        let left = max(1, item.sets - setsDone)
        let load = move.usesBackpack ? (model.workoutLog.loads[move.id] ?? move.load ?? 2) : nil
        let next = WorkoutContent.Item(movementId: move.id, sets: left, reps: move.dose.reps, seconds: move.dose.seconds,
                                       load: load, rest: move.rest, isNew: false)
        let replaced = item.movementId
        edit { p in
            let fresh = WorkoutResult(movementId: move.id, load: load, swappedFrom: replaced)
            if setsDone == 0 {
                p.content.items[p.index] = next
                p.results[p.index] = fresh
            } else {
                p.content.items[p.index].sets = setsDone
                p.content.items.insert(next, at: p.index + 1)
                p.results.insert(fresh, at: p.index + 1)
                p.index += 1
            }
        }
        swapping = false
        resetCount()
    }

    private func advance() {
        guard let progress else { return }
        restUntil = nil
        if progress.index + 1 >= progress.content.items.count { finishing = true; return }
        edit { $0.index += 1 }
        resetCount()
    }

    private var nextLine: String {
        guard let item, let move = model.movement(item.movementId) else { return "" }
        return "Next: \(move.name), set \(setsDone + 1) of \(item.sets)."
    }

    /// Other movements that work the same thing, with what the person has and hasn't ruled out.
    private func swapList(for current: Movement) -> some View {
        let rules = model.userRules
        let owned = Set(rules.equipment.map(\.rawValue) + ["floor", "wall"])
        let choices = model.movements.filter { move in
            move.id != current.id && move.pattern == current.pattern && move.equipment.allSatisfy(owned.contains)
                && !rules.avoid.contains(move.id) && rules.movements[move.id] != .cannot && move.level <= current.level
        }
        return NavigationStack {
            List(choices) { move in
                Button { swap(to: move) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(move.name).font(.body).foregroundStyle(Theme.text)
                        Text(move.setup).font(.footnote).foregroundStyle(Theme.textMuted).lineLimit(2)
                    }
                    .frame(minHeight: 44)
                }
            }
            .overlay { if choices.isEmpty { Text("Nothing else here works the same way with what you have.").font(.body).foregroundStyle(Theme.textMuted).padding() } }
            .navigationTitle("Swap for")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { swapping = false } } }
        }
    }

    // MARK: The end

    private static let pains: [(value: Int, title: String)] = [(2, "0–3"), (4, "4"), (5, "5 or more")]

    private var finishPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.lg) {
                Text("That’s the workout.")
                    .agentFont(30, relativeTo: .title)
                    .foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: Theme.sm) {
                    Text("How sore is it now, 0 to 10?").font(.headline).foregroundStyle(Theme.text)
                    Picker("Soreness", selection: $pain) {
                        ForEach(Self.pains, id: \.value) { Text($0.title).tag(Optional($0.value)) }
                    }
                    .pickerStyle(.segmented)
                    if pain == 4 { Text("Next time has one set fewer.").font(.footnote).foregroundStyle(Theme.textMuted) }
                    if pain == 5 {
                        Text("That’s a lot. Rest today. If it’s sharp, or still there in a couple of days, ask a doctor or physio.")
                            .font(.footnote).foregroundStyle(Theme.warning)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                VStack(alignment: .leading, spacing: Theme.sm) {
                    Text("How was it?").font(.headline).foregroundStyle(Theme.text)
                    Picker("How it went", selection: $feeling) {
                        ForEach(WorkoutFeeling.allCases, id: \.self) { Text($0.title).tag(Optional($0)) }
                    }
                    .pickerStyle(.segmented)
                }
                Button(saving ? "Saving…" : "Finish") {
                    guard let progress, !saving else { return }
                    saving = true
                    Task {
                        await model.finishWorkout(progress, pain: pain, feeling: feeling)
                        dismiss()
                    }
                }
                .buttonStyle(PrimaryButtonStyle.tall)
                .disabled(saving)
                Text("Finishing saves a strength workout to Apple Health and takes off today’s other reminders.")
                    .font(.footnote).foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Theme.md)
        }
    }
}

/// The rest between sets: a countdown, 15 seconds more or less, and Skip.
private struct RestCountdown: View {
    let until: Date
    let next: String
    let change: (Date) -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: Theme.lg) {
            Text("Rest").font(.headline).foregroundStyle(Theme.textMuted)
            Text(timerInterval: Date()...max(until, Date()), countsDown: true)
                .font(.system(size: 64, weight: .semibold).monospacedDigit())
                .foregroundStyle(Theme.text)
            Text(next).font(.body).foregroundStyle(Theme.textMuted)
            HStack(spacing: Theme.lg) {
                Button("−15 s") { change(until.addingTimeInterval(-15)) }
                    .frame(minWidth: 64, minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityLabel("15 seconds less rest")
                Button("+15 s") { change(until.addingTimeInterval(15)) }
                    .frame(minWidth: 64, minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityLabel("15 seconds more rest")
            }
            .font(.body.weight(.medium))
            Button("Skip rest", action: onDone).buttonStyle(GhostButtonStyle())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Theme.md)
        .task(id: until) {
            let wait = until.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            if !Task.isCancelled { onDone() }
        }
    }
}
