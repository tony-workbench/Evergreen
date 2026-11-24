import SwiftUI

/// The week the rules make, as one table: each day's kind in words (never only
/// a colour), the first time, what it works and the later times. Today's row
/// opens the workout page; another day's row shows what it will hold.
struct WeekTableView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var state: LoadState = .loading
    @State private var workout = false
    @State private var preview: HomeWeek.Day?

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
                        .frame(minHeight: 44)
                }
            }
            Section {
                ForEach(week.days) { day in row(day) }
            }
        }
        .refreshable { await model.refreshHomeWeek(); await load() }
    }

    private func summary(_ week: HomeWeek) -> String {
        let done = week.days.filter { $0.trains && (model.workoutLog.didHomeSession(on: $0.day) || model.trainedStrength(on: $0.day)) }.count
        let home = week.homeDays == 1 ? "1 day at home" : "\(week.homeDays) days at home"
        return "\(home), \(week.trainingDays) planned, \(done) done."
    }

    @ViewBuilder private func row(_ day: HomeWeek.Day) -> some View {
        let isToday = day.day == model.todayISO
        let line = DayLine(day: day, isToday: isToday, movements: model.movementLine(day.day),
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
    let isToday: Bool
    let movements: String?
    let done: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(isToday ? "Today" : "\(day.weekday) \(String(day.day.suffix(5)))").font(.headline).foregroundStyle(Theme.text)
                Spacer()
                Text(kindWord).font(.footnote.weight(.semibold)).foregroundStyle(Theme.textMuted)
            }
            if let first = day.first, day.trains {
                Text(done ? "Done" : "At \(first.clock)")
                    .font(.body).foregroundStyle(done ? Theme.success : Theme.accent)
                if let movements { Text(movements).font(.body).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true) }
                if !day.fallbacks.isEmpty, !done {
                    Text("Later: " + day.fallbacks.map(\.clock).joined(separator: ", "))
                        .font(.footnote).foregroundStyle(Theme.textMuted)
                }
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

/// Another day's session, to look at before it comes.
private struct DayPreview: View {
    let day: HomeWeek.Day
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let content = model.homeWeekContent[day.day] {
                    Section("About \(content.minutes) minutes") {
                        ForEach(content.items) { item in
                            if let move = model.movement(item.movementId) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(move.name).font(.body).foregroundStyle(Theme.text)
                                    Text("\(item.sets) sets of \(item.target(sides: move.sides))" + (item.load.map { ", \($0.formatted()) kg" } ?? ""))
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
