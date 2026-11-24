import SwiftUI

/// The week the rules make, as one table: each day's kind in words (never only
/// a colour), the first time, what it works and the later times. Today's row
/// opens the workout page; another day's row shows what it will hold. Under a day
/// still to train, one of its times (the first included) can be picked ahead: only it
/// reminds then, and nothing moves by itself. What the table counts and offers is
/// worked out in the model (AppModel+WorkoutPage.swift).
struct WeekTableView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var workout = false
    @State private var preview: HomeWeek.Day?
    /// The time picked ahead for each day, read from the model on load (it lives in settings, which the view doesn't watch).
    @State private var picks: [String: String] = [:]
    @Environment(\.networkStatus) private var network
    /// Whether the phone was online when the table last looked, to tell when it comes back.
    @State private var seenOnline: Bool?
    /// The day a reminder's "Start" asked for (YYYY-MM-DD): its preview opens once the week is worked out.
    var openDay: String? = nil

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("This week")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("week.done") } }
                .background(Theme.surface)
        }
        .task { await load() }
        // Back online: the week is worked out again with what couldn't be checked offline (`AppModel.reloadsWeek`).
        .task(id: network.isOnline) {
            let back = model.reloadsWeek(wasOnline: seenOnline, online: network.isOnline)
            seenOnline = network.isOnline
            if back { await load() }
        }
        .fullScreenCover(isPresented: $workout) { WorkoutSessionView() }
        .sheet(item: $preview) { day in DayPreview(day: day) }
    }

    @ViewBuilder private var content: some View {
        switch model.homeWeekLoad {
        case .loading:
            ProgressView("Working out the week…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed:
            failedState
        case .ready, .offline:
            if let week = model.homeWeek { table(week) } else { failedState }
        }
    }

    /// The week couldn't be worked out: said, why when offline, and Try again.
    private var failedState: some View {
        VStack(spacing: Theme.md) {
            if offline { OfflineLine(words: Self.offlineWords) }
            Text("The week couldn’t be worked out just now.").font(.body).foregroundStyle(Theme.text)
            Button("Try again") { Task { await load() } }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("week.retry")
        }
        .padding(Theme.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    static let offlineWords = "You’re offline. The week is worked out on this phone from what it already knows, and checked again when you’re back online."

    /// Offline: the model's load stood on the rules' content because the AI couldn't be reached, or the phone has no network.
    private var offline: Bool { model.weekIsOffline(online: network.isOnline) }

    private func load() async {
        await model.loadHomeWeek()
        picks = model.pickedTimes
        if let openDay, preview == nil, openDay != model.todayISO { preview = model.homeWeek?.days.first { $0.day == openDay } }
    }

    private func table(_ week: HomeWeek) -> some View {
        List {
            Section { summary(week) }
            earlierSection
            Section {
                ForEach(week.days) { day in dayRows(day) }
            }
        }
        .refreshable { await model.refreshHomeWeek(); await load() }
        .accessibilityIdentifier("week.table")
    }

    @ViewBuilder private func summary(_ week: HomeWeek) -> some View {
        if offline { OfflineLine(words: Self.offlineWords) }
        Text(model.weekSummary(week)).font(.body).foregroundStyle(Theme.text)
        if let note = week.note ?? model.homeWeekNote {
            Text(note).font(.footnote).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
        }
        if week.trainingDays == 0 {
            // No day at home this week: say so, and offer the one thing that changes it.
            Button("I’m home today") { Task { await model.setGoingOut(false); await load() } }
                .buttonStyle(TapTargetButtonStyle())
                .accessibilityIdentifier("week.homeToday")
        }
    }

    @ViewBuilder private var earlierSection: some View {
        let earlier = model.earlierThisWeek
        if !earlier.isEmpty {
            Section("Earlier this week") {
                ForEach(earlier) { day in
                    EarlierLine(day: day)
                    if day.outcome == .skipped { takeBackSkip(day.day, label: "Take back the skip") }
                    undoOtherWay(day.day)
                }
            }
        }
    }

    @ViewBuilder private func dayRows(_ day: HomeWeek.Day) -> some View {
        row(day)
        timePicker(day)
        rainLine(day)
        homeAfterAll(day)
        if day.kind != .out, model.workoutLog.didSkip(day.day) {
            takeBackSkip(day.day, label: day.day == model.todayISO ? "Train today after all" : "Train that day after all")
        }
        undoOtherWay(day.day)
    }

    /// Picks one time ahead for a day still to train, the first included; then only it reminds. "At every time" keeps them
    /// all, or with "Always ask me to pick one time" on, the first time only until one is picked.
    @ViewBuilder private func timePicker(_ day: HomeWeek.Day) -> some View {
        let picked: String? = picks[day.day]
        let choices: [String] = model.pickableTimes(day, picked: picked)
        if let first = choices.first {
            Picker("Remind me", selection: pickBinding(day.day)) {
                Text(model.unpickedLabel(first: first)).tag(String?.none)
                ForEach(choices, id: \.self) { clock in
                    Text("Only at \(clock)").tag(Optional(clock))
                }
            }
            .pickerStyle(.menu)
            .frame(minHeight: TapTargetButtonStyle.minSide)
            .accessibilityHint("Picks the one time this day reminds you at. Nothing moves by itself.")
            .accessibilityIdentifier("week.pick.\(day.day)")
        }
    }

    private func pickBinding(_ day: String) -> Binding<String?> {
        Binding(
            get: { picks[day] },
            set: { clock in
                picks[day] = clock
                Task { await model.pickTime(clock, day: day) }
            }
        )
    }

    /// A day out, from an event or "I'm going out tomorrow", can be put right ahead: the day is at home after all, with
    /// its session and reminders.
    @ViewBuilder private func homeAfterAll(_ day: HomeWeek.Day) -> some View {
        if day.kind == .out {
            Button(day.day == model.todayISO ? "I’m home today" : "I’m home that day") {
                Task { await model.setGoingOut(false, day: day.day); await load() }
            }
            .buttonStyle(TapTargetButtonStyle())
            .accessibilityHint("Makes \(day.weekday) a day at home again")
        }
    }

    /// The day's short breaks for rain: on the plan, or offered on Today and still to answer there.
    @ViewBuilder private func rainLine(_ day: HomeWeek.Day) -> some View {
        if let rain = model.rainBreaks(on: day.day) {
            let times = rain.clocks.joined(separator: ", ")
            Label(rain.added ? "Rain: short breaks at \(times)" : "Rain: short breaks offered at \(times), on Today",
                  systemImage: "cloud.rain")
                .font(.footnote).foregroundStyle(Theme.textMuted)
                .frame(minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
        }
    }

    /// A skip, from Today or from a reminder (also one tapped after midnight, for the day before), taken back here.
    private func takeBackSkip(_ day: String, label: String) -> some View {
        Button(label) { Task { await model.unskipDay(day); await load() } }
            .buttonStyle(TapTargetButtonStyle())
            .accessibilityHint("Takes back the skip on this day")
            .accessibilityIdentifier("week.unskip.\(day)")
    }

    /// "I did it another way" or "Already done" on a reminder, for any day (also one tapped after midnight), taken back here.
    @ViewBuilder private func undoOtherWay(_ day: String) -> some View {
        if model.workoutLog.didOtherWay(day) {
            Button("Undo “already done”: I haven’t trained") { Task { await model.undoDoneAnotherWay(day: day); await load() } }
                .buttonStyle(TapTargetButtonStyle())
                .accessibilityHint("Brings back this day’s workout and its reminders")
                .accessibilityIdentifier("week.undoDone.\(day)")
        }
    }

    @ViewBuilder private func row(_ day: HomeWeek.Day) -> some View {
        let isToday = day.day == model.todayISO
        let line = DayLine(day: day, picked: picks[day.day], isToday: isToday, movements: model.movementLine(day.day),
                           aiPicked: model.homeWeekReasons[day.day] != nil,
                           status: DayLine.Status(done: model.homeDone(on: day.day), skipped: model.workoutLog.didSkip(day.day)))
        if day.trains {
            Button { if isToday { workout = true } else { preview = day } } label: { line }
                .buttonStyle(.plain)
                .accessibilityHint(isToday ? "Opens today’s workout" : "Shows what this day holds")
                .accessibilityIdentifier(isToday ? "week.today" : "week.day.\(day.day)")
        } else {
            line
        }
    }
}

/// One day of the table, read the same way aloud: "Tuesday 1 December, at home, 16:40, full-body: …, later 19:30".
private struct DayLine: View {
    struct Status { var done: Bool; var skipped: Bool }

    let day: HomeWeek.Day
    /// The one time picked ahead, which is then the only one shown.
    let picked: String?
    let isToday: Bool
    let movements: String?
    /// The AI chose this day's movements; the day's own page says why.
    let aiPicked: Bool
    let status: Status

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(isToday ? "Today" : day.title).font(.headline).foregroundStyle(Theme.text)
                Spacer()
                Text(kindWord).font(.footnote.weight(.semibold)).foregroundStyle(Theme.textMuted)
            }
            if let first = day.first, day.trains {
                training(first)
            } else if status.done {
                Text("Done").font(.body).foregroundStyle(Theme.success)
            } else {
                Text(day.kind == .home ? "No free half hour in your hours" : "No workout").font(.body).foregroundStyle(Theme.textMuted)
            }
        }
        .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func training(_ first: LocalTime) -> some View {
        Text(status.done ? "Done" : status.skipped ? "Skipped" : picked.map { "Only at \($0)" } ?? "At \(first.clock)")
            .font(.body).foregroundStyle(status.done ? Theme.success : status.skipped ? Theme.textMuted : Theme.accent)
        if let movements { Text(movements).font(.body).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true) }
        if movements != nil, aiPicked {
            Label("Movements picked by AI", systemImage: "sparkles").font(.footnote).foregroundStyle(Theme.textMuted)
        }
        if picked == nil, !day.fallbacks.isEmpty, !status.done, !status.skipped {
            Text("Later: " + day.fallbacks.map(\.clock).joined(separator: ", "))
                .font(.footnote).foregroundStyle(Theme.textMuted)
        }
    }

    private var kindWord: String {
        switch day.kind {
        case .home: "At home"
        case .out: "Out"
        case .rest: "Rest"
        }
    }
}

/// A day already past this week, with how it went: "Monday 30 November, lower-body, done".
private struct EarlierLine: View {
    let day: AppModel.EarlierDay

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: Theme.xs) {
                Text(day.title).font(.headline).foregroundStyle(Theme.text)
                if let focus = day.focus { Text(HomeWorkoutRow.words[focus] ?? focus).font(.footnote).foregroundStyle(Theme.textMuted) }
            }
            Spacer()
            Text(outcomeWord).font(.body).foregroundStyle(day.outcome == .done ? Theme.success : Theme.textMuted)
        }
        .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var outcomeWord: String {
        switch day.outcome {
        case .done: "Done"
        case .skipped: "Skipped"
        case .missed: "Not done"
        }
    }
}

/// Another day's session, to look at before it comes. When it isn't worked out yet, it can be worked out now.
private struct DayPreview: View {
    let day: HomeWeek.Day
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var working = false

    var body: some View {
        NavigationStack {
            List {
                if let content = model.homeWeekContent[day.day] {
                    if let reason = model.homeWeekReasons[day.day] { Section { AIPickedNote(reason: reason) } }
                    Section("About \(content.minutes) minutes") {
                        ForEach(content.items) { item in itemLine(item) }
                    }
                } else {
                    empty
                }
            }
            .navigationTitle(day.weekday)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("week.preview.done") } }
            .accessibilityIdentifier("week.preview.\(day.day)")
        }
    }

    @ViewBuilder private func itemLine(_ item: WorkoutContent.Item) -> some View {
        if let move = model.movement(item.movementId) {
            VStack(alignment: .leading, spacing: Theme.xxs) {
                Text(move.name).font(.body).foregroundStyle(Theme.text)
                Text("\(item.sets) sets of \(item.target(sides: move.sides))" + (item.load.map { ", " + BackpackWater.words($0) } ?? "")
                     + (item.slow == true ? ", lowered slower" : ""))
                    .font(.footnote).foregroundStyle(Theme.textMuted)
            }
            .frame(minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
        }
    }

    /// Nothing worked out for the day yet: why, and a button that works it out now.
    private var empty: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            Text("What this day holds isn’t worked out yet. It’s worked out from what you do on the days before it.")
                .font(.body).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
            Button(working ? "Working it out…" : "Work it out now") {
                working = true
                Task { await model.fillHomeWeek(); working = false }
            }
            .buttonStyle(TapTargetButtonStyle())
            .disabled(working)
            .accessibilityIdentifier("week.preview.workOut")
        }
    }
}
