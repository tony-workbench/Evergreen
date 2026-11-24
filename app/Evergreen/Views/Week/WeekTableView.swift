import SwiftUI

/// The week the rules make, as one table: each day's kind in words (never only
/// a colour), the first time, what it works and the later times. Today's row
/// opens the workout page; another day's row shows what it will hold. Under a day
/// still to train, one of its times (the first included) can be picked ahead: only it
/// reminds then, and nothing moves by itself.
struct WeekTableView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var state: LoadState = .loading
    @State private var workout = false
    @State private var preview: HomeWeek.Day?
    /// The time picked ahead for each day, read from the model on load (it lives in settings, which the view doesn't watch).
    @State private var picks: [String: String] = [:]

    enum LoadState: Equatable { case loading, failed, ready }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("This week")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .background(Theme.surface)
        }
        .task { await load() }
        .fullScreenCover(isPresented: $workout) { WorkoutSessionView() }
        .sheet(item: $preview) { day in DayPreview(day: day) }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            ProgressView("Working out the week…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed:
            VStack(spacing: Theme.md) {
                Text("The week couldn’t be worked out just now.").font(.body).foregroundStyle(Theme.text)
                Button("Try again") { Task { await load() } }.buttonStyle(PrimaryButtonStyle())
            }
            .padding(Theme.md)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready:
            if let week = model.homeWeek { table(week) }
        }
    }

    private func load() async {
        state = .loading
        if model.homeWeek == nil || model.homeWeek?.madeOn != model.todayISO { await model.refreshHomeWeek() }
        if model.homeWeekContent.isEmpty { await model.fillHomeWeek() }
        picks = model.pickedTimes
        state = model.homeWeek == nil ? .failed : .ready
    }

    private func table(_ week: HomeWeek) -> some View {
        List {
            Section {
                Text(summary(week)).font(.body).foregroundStyle(Theme.text)
                if let note = week.note ?? model.homeWeekNote {
                    Text(note).font(.footnote).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
                }
                if week.trainingDays == 0 {
                    Button("I’m home today") { Task { await model.setGoingOut(false); await load() } }
                        .buttonStyle(TapTargetButtonStyle())
                }
            }
            let earlier = model.earlierThisWeek
            if !earlier.isEmpty {
                Section("Earlier this week") {
                    ForEach(earlier) { day in
                        EarlierLine(day: day)
                        if day.outcome == .skipped { takeBackSkip(day.day, label: "Take back the skip") }
                    }
                }
            }
            Section {
                ForEach(week.days) { day in
                    row(day)
                    timePicker(day)
                    rainLine(day)
                    homeAfterAll(day)
                    if day.kind != .out, model.workoutLog.didSkip(day.day) {
                        takeBackSkip(day.day, label: day.day == model.todayISO ? "Train today after all" : "Train that day after all")
                    }
                }
            }
        }
        .refreshable { await model.refreshHomeWeek(); await load() }
    }

    /// Counts the whole Monday-to-Sunday week: the days already past and the days to come.
    private func summary(_ week: HomeWeek) -> String {
        // A day at home counts once done, also today when it was too late for a time to be left on it.
        let ahead = week.days.filter { ($0.trains || $0.kind == .home) && (model.workoutLog.didHomeSession(on: $0.day) || model.trainedStrength(on: $0.day)) }.count
        let earlier = model.earlierThisWeek
        let done = ahead + earlier.filter { $0.outcome == .done }.count
        let home = week.homeDays == 1 ? "1 day at home" : "\(week.homeDays) days at home"
        let planned = week.trainingDays + earlier.count
        return earlier.isEmpty ? "\(home) ahead, \(planned) planned, \(done) done." : "This week: \(planned) planned, \(done) done. \(home) ahead."
    }

    /// Picks one time ahead for a day still to train, the first included; then only it reminds. "At every time" keeps them
    /// all, or with "Always ask me to pick one time" on, the first time only until one is picked.
    @ViewBuilder private func timePicker(_ day: HomeWeek.Day) -> some View {
        let done = model.workoutLog.didHomeSession(on: day.day) || model.trainedStrength(on: day.day)
        let clocks = WorkoutReminders.times(of: day).map(\.clock)
        if day.trains, clocks.count > 1, !done, !model.workoutLog.didSkip(day.day) {
            let picked = picks[day.day]
            Picker("Remind me", selection: Binding(
                get: { picked },
                set: { clock in
                    picks[day.day] = clock
                    Task { await model.pickTime(clock, day: day.day) }
                }
            )) {
                Text(Automatic.pickEachDay.isOn(model.settings) ? "Not picked yet: only at \(clocks[0])" : "At every time").tag(String?.none)
                ForEach(clocks + (picked.map { clocks.contains($0) ? [] : [$0] } ?? []), id: \.self) { clock in
                    Text("Only at \(clock)").tag(Optional(clock))
                }
            }
            .pickerStyle(.menu)
            .frame(minHeight: 44)
            .accessibilityHint("Picks the one time this day reminds you at. Nothing moves by itself.")
        }
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
                .frame(minHeight: 44, alignment: .leading)
        }
    }

    /// A skip, from Today or from a reminder (also one tapped after midnight, for the day before), taken back here.
    private func takeBackSkip(_ day: String, label: String) -> some View {
        Button(label) { Task { await model.unskipDay(day); await load() } }
            .buttonStyle(TapTargetButtonStyle())
            .accessibilityHint("Takes back the skip on this day")
    }

    @ViewBuilder private func row(_ day: HomeWeek.Day) -> some View {
        let isToday = day.day == model.todayISO
        let line = DayLine(day: day, picked: picks[day.day], isToday: isToday,
                           movements: model.movementLine(day.day), aiPicked: model.homeWeekReasons[day.day] != nil,
                           skipped: model.workoutLog.didSkip(day.day),
                           done: model.workoutLog.didHomeSession(on: day.day) || model.trainedStrength(on: day.day))
        if day.trains {
            Button { if isToday { workout = true } else { preview = day } } label: { line }
                .buttonStyle(.plain)
                .accessibilityHint(isToday ? "Opens today’s workout" : "Shows what this day holds")
        } else {
            line
        }
    }
}

/// One day of the table, read the same way aloud: "Tuesday 1 December, at home, 16:40, full-body: …, later 19:30".
private struct DayLine: View {
    let day: HomeWeek.Day
    /// The one time picked ahead, which is then the only one shown.
    let picked: String?
    let isToday: Bool
    let movements: String?
    /// The AI chose this day's movements; the day's own page says why.
    let aiPicked: Bool
    let skipped: Bool
    let done: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(isToday ? "Today" : "\(day.weekday) \(String(day.day.suffix(5)))").font(.headline).foregroundStyle(Theme.text)
                Spacer()
                Text(kindWord).font(.footnote.weight(.semibold)).foregroundStyle(Theme.textMuted)
            }
            if let first = day.first, day.trains {
                Text(done ? "Done" : skipped ? "Skipped" : picked.map { "Only at \($0)" } ?? "At \(first.clock)")
                    .font(.body).foregroundStyle(done ? Theme.success : skipped ? Theme.textMuted : Theme.accent)
                if let movements { Text(movements).font(.body).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true) }
                if movements != nil, aiPicked {
                    Label("Movements picked by AI", systemImage: "sparkles").font(.footnote).foregroundStyle(Theme.textMuted)
                }
                if picked == nil, !day.fallbacks.isEmpty, !done, !skipped {
                    Text("Later: " + day.fallbacks.map(\.clock).joined(separator: ", "))
                        .font(.footnote).foregroundStyle(Theme.textMuted)
                }
            } else if done {
                Text("Done").font(.body).foregroundStyle(Theme.success)
            } else {
                Text(day.kind == .home ? "No free half hour in your hours" : "No workout").font(.body).foregroundStyle(Theme.textMuted)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
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
                Text(Self.title(day.day)).font(.headline).foregroundStyle(Theme.text)
                if let focus = day.focus { Text(HomeWorkoutRow.words[focus] ?? focus).font(.footnote).foregroundStyle(Theme.textMuted) }
            }
            Spacer()
            Text(outcomeWord).font(.body).foregroundStyle(day.outcome == .done ? Theme.success : Theme.textMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var outcomeWord: String {
        switch day.outcome {
        case .done: "Done"
        case .skipped: "Skipped"
        case .missed: "Not done"
        }
    }

    /// "Monday 11-30", the way the rows below name a day.
    private static func title(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return iso }
        return calendar.weekdaySymbols[calendar.component(.weekday, from: date) - 1] + " " + String(iso.suffix(5))
    }
}

/// Another day's session, to look at before it comes.
private struct DayPreview: View {
    let day: HomeWeek.Day
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let content = model.homeWeekContent[day.day] {
                    if let reason = model.homeWeekReasons[day.day] { Section { AIPickedNote(reason: reason) } }
                    Section("About \(content.minutes) minutes") {
                        ForEach(content.items) { item in
                            if let move = model.movement(item.movementId) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(move.name).font(.body).foregroundStyle(Theme.text)
                                    Text("\(item.sets) sets of \(item.target(sides: move.sides))" + (item.load.map { ", " + BackpackWater.words($0) } ?? "")
                                         + (item.slow == true ? ", lowered slower" : ""))
                                        .font(.footnote).foregroundStyle(Theme.textMuted)
                                }
                                .frame(minHeight: 44, alignment: .leading)
                            }
                        }
                    }
                } else {
                    Text("What this day holds is worked out once the days before it are done.").foregroundStyle(Theme.textMuted)
                }
            }
            .navigationTitle(day.weekday)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
