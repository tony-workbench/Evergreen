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
    /// The session couldn't be worked out (not the same as no session today).
    @State private var failed = false
    /// What "Too hard" just did, said on the page.
    @State private var swappedNote: String?
    /// The full steps of a movement done twice before, opened from its short version.
    @State private var showAllSteps = false

    /// Steps are read mid-workout: at least 1.4 times the body size from line to line.
    private static let stepLineSpacing: CGFloat = 7
    /// From the third time a movement is done, its steps come as three short lines.
    private static let shortAfter = 2
    /// The count can go up to twice the top of the range, and to 30 at least.
    private static let countRoom = 2
    private static let leastCount = 30

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView("Getting today’s workout…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if failed {
                    problem("Today’s workout couldn’t be worked out just now.", action: "Try again") { Task { await load() } }
                } else if progress == nil {
                    problem("There’s no home workout today. Today is a day out or a rest day, or it’s already done.",
                            action: "Back to Today") { dismiss() }
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
        .sensoryFeedback(.error, trigger: failed) { _, now in now }
        .task { await load() }
    }

    private func load() async {
        loading = true
        let today = await model.workoutToday()
        progress = today.progress
        failed = today.failed
        loading = false
        resetCount()
    }

    /// An empty or failed page: what happened and one thing to do.
    private func problem(_ words: String, action: String, perform: @escaping () -> Void) -> some View {
        VStack(spacing: Theme.md) {
            Text(words).font(.body).foregroundStyle(Theme.text).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button(action, action: perform).buttonStyle(PrimaryButtonStyle.tall)
        }
        .padding(Theme.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                    if progress.index == 0, let reason = progress.reason { AIPickedNote(reason: reason) }
                    Text("\(progress.index + 1) of \(progress.content.items.count)")
                        .font(.footnote).foregroundStyle(Theme.textMuted)
                    Text(move.name)
                        .agentFont(30, relativeTo: .title)
                        .foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                    Text(targetLine(item, move))
                        .font(.headline).foregroundStyle(Theme.accent)
                    if let slow = slowLine(item, move) {
                        Label(slow, systemImage: "tortoise")
                            .font(.body).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                    }
                    if let swappedNote {
                        Text(swappedNote).font(.footnote).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
                    }
                    if asksFirst(item, move) {
                        canYouDoOne(move)
                    } else {
                        if model.timesDone(move.id) >= Self.shortAfter && !showAllSteps { shortHowTo(move) } else { howTo(move) }
                        entry(item)
                    }
                }
                .padding(Theme.md)
            }
            .safeAreaInset(edge: .bottom) {
                // The main button stays at the bottom, in reach of the thumb, while the steps scroll.
                if !asksFirst(item, move) {
                    Button("Done with this set") { doneWithSet() }
                        .buttonStyle(PrimaryButtonStyle.tall)
                        .padding(.horizontal, Theme.md)
                        .padding(.vertical, Theme.sm)
                        .background(Theme.surface)
                }
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

    /// The slow step: the same movement, every rep lowered two seconds slower, before any weight or harder movement.
    private func slowLine(_ item: WorkoutContent.Item, _ move: Movement) -> String? {
        guard item.slow == true, let tempo = move.tempo else { return nil }
        return "Slower this time: lower in \(tempo.down + WorkoutContent.slowExtraSeconds) seconds instead of \(tempo.down)."
    }

    private func asksFirst(_ item: WorkoutContent.Item, _ move: Movement) -> Bool {
        item.isNew && setsDone == 0 && model.userRules.movements[move.id] == nil
    }

    /// From the third time: three lines, and the rest a tap away.
    private func shortHowTo(_ move: Movement) -> some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text(move.setup).font(.body).foregroundStyle(Theme.text)
            Text("It counts when: " + move.pass).font(.body).foregroundStyle(Theme.text)
            Text("Watch for: " + (move.mistakes.first ?? move.feel)).font(.body).foregroundStyle(Theme.text)
            Button("Show all the steps") { showAllSteps = true }.buttonStyle(TapTargetButtonStyle())
        }
        .lineSpacing(Self.stepLineSpacing)
        .fixedSize(horizontal: false, vertical: true)
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
            if let tempo = move.tempoLine { Text(tempo).font(.body).foregroundStyle(Theme.text) }
            line("Where you should feel it", move.feel)
            line("It counts when", move.pass)
            line("Watch for", move.mistakes.joined(separator: " "))
        }
        .lineSpacing(Self.stepLineSpacing)
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
            Stepper(item.isHold ? "Seconds held: \(count)" : "Reps done: \(count)", value: $count, in: 0...max(item.high * Self.countRoom, Self.leastCount))
                .font(.body)
                .frame(minHeight: 44)
            HStack(spacing: Theme.sm) {
                smallAction("Too hard") { tooHard() }
                if model.movement(item.movementId)?.usesBackpack == true { smallAction("Too easy") { tooEasy() } }
                smallAction("Swap") { swapping = true }
                smallAction("Skip") { advance() }
            }
        }
    }

    /// A secondary action on the workout page: its whole box, at least 44 by 44 points, takes the tap, 8 points from the next.
    private func smallAction(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(TapTargetButtonStyle(fills: true))
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
        swappedNote = nil
        if setsDone >= item.sets { advance() } else { restUntil = Date().addingTimeInterval(TimeInterval(item.rest)); resetCount() }
    }

    /// A backpack movement drops a kilogram. Another goes to the easier one on its chain, which stands in from now on: the
    /// harder one goes on the avoid list, and the page says so. With no easier one it stays, marked.
    private func tooHard() {
        guard let item, let move = model.movement(item.movementId) else { return }
        if move.usesBackpack, progress?.backpackLoad != nil {
            var lighter: Double?
            edit { lighter = $0.backpackTooHard() }
            swappedNote = lighter.map { "One litre less: " + BackpackWater.words($0) + "." }
        } else if let easier = move.easier.flatMap(model.movement) {
            swap(to: easier)
            swappedNote = "Swapped to \(easier.name). \(move.name) is left out from now on; you can bring it back in My rules, Leave out."
            Task { await model.leaveOut(move.id) }
        } else {
            edit { $0.results[$0.index].tooHard = true }
            swappedNote = "There’s nothing easier for this one. Do what you can; the next session goes lighter."
        }
    }

    /// A backpack movement that is too easy goes up two kilograms now, for the sets left and for next time.
    private func tooEasy() {
        guard progress?.backpackLoad != nil else { return }
        var heavier: Double?
        edit { heavier = $0.backpackTooEasy() }
        swappedNote = heavier.map { "Two litres more: " + BackpackWater.words($0) + "." } ?? "That’s as much as a backpack holds."
    }

    /// Puts another movement in this one's place. Sets already done stay with the first movement.
    private func swap(to move: Movement) {
        guard let item else { return }
        let left = max(1, item.sets - setsDone)
        let load = move.usesBackpack ? (model.workoutLog.loads[move.id] ?? move.load ?? BackpackWater.startKg) : nil
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
        showAllSteps = false
        resetCount()
    }

    private func advance() {
        guard let progress else { return }
        restUntil = nil
        if progress.index + 1 >= progress.content.items.count { finishing = true; return }
        edit { $0.index += 1 }
        swappedNote = nil
        showAllSteps = false
        resetCount()
    }

    private var nextLine: String {
        guard let item, let move = model.movement(item.movementId) else { return "" }
        return "Next: \(move.name), set \(setsDone + 1) of \(item.sets)."
    }

    /// The movements next to this one on its chain, one easier and one harder, that the rules leave open.
    private func swapList(for current: Movement) -> some View {
        let choices = model.swapChoices(for: current)
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
            .overlay { if choices.isEmpty { Text("There’s no easier or harder one next to this movement with what you have.").font(.body).foregroundStyle(Theme.textMuted).padding() } }
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
                if let progress, model.workoutLog.didOtherWay(progress.day) {
                    Text("You marked today as trained from a reminder. Finishing saves this session instead, once.")
                        .font(.footnote).foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
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
    /// What "−15 s" and "+15 s" change.
    static let step: TimeInterval = 15
    let until: Date
    let next: String
    let change: (Date) -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: Theme.lg) {
            Text("Rest").font(.headline).foregroundStyle(Theme.textMuted)
            Text(timerInterval: Date()...max(until, Date()), countsDown: true)
                .agentFont(64, relativeTo: .largeTitle)
                .monospacedDigit()
                .foregroundStyle(Theme.text)
                .accessibilityLabel("Rest left")
            Text(next).font(.body).foregroundStyle(Theme.textMuted)
            HStack(spacing: Theme.lg) {
                Button("−15 s") { change(until.addingTimeInterval(-Self.step)) }
                    .buttonStyle(TapTargetButtonStyle(color: Theme.text, weight: .medium))
                    .accessibilityLabel("15 seconds less rest")
                Button("+15 s") { change(until.addingTimeInterval(Self.step)) }
                    .buttonStyle(TapTargetButtonStyle(color: Theme.text, weight: .medium))
                    .accessibilityLabel("15 seconds more rest")
            }
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

/// Says that the AI chose these movements, and why in its own sentence, so its work is never shown as the app's own.
/// Code checked the choice against every rule before it got here.
struct AIPickedNote: View {
    let reason: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("Movements picked by AI", systemImage: "sparkles")
                .font(.footnote.weight(.semibold)).foregroundStyle(Theme.textMuted)
            Text(reason).font(.footnote).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
