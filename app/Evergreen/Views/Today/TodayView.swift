import SwiftUI

/// Home, top to bottom: the hero, "More for your week", "On your
/// calendar", and "Ask Evergreen" pinned at the bottom. The hero is the top
/// suggestion with what it rests on, unless something comes first: the
/// answer to what was asked, or what the agent did or asks (then the top
/// suggestion moves down into the list). Until an AI key is connected the
/// hero asks for one, and asking and suggestions are off; the week and what
/// is remembered stay. On a quiet day the hero is the next workout.
struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var showMemory = false
    @State private var showConnect = false
    @State private var showSettings = false
    @State private var showWeek = false
    /// The workout page, opened by "Start" here or on a reminder.
    @State private var showWorkout = false
    /// Asked for while a sheet was open: opened once that sheet has gone.
    @State private var workoutWaiting = false
    /// A reminder's "Start" for another day: the week table opens on that day (YYYY-MM-DD).
    @State private var weekDay: String?
    /// The week table asked for while another sheet was open: opened once that sheet has gone.
    @State private var weekWaiting = false

    var body: some View {
        ScrollView { content }
            .scrollDismissesKeyboard(.interactively)
            // Pulling down plans the week again.
            .refreshable { _ = await model.planIfPossible(fresh: true) }
            .background(Theme.surface)
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
            .sheet(isPresented: $showSettings, onDismiss: openWaitingWorkout) { SettingsView() }
            .sheet(isPresented: $showWeek, onDismiss: openWaitingWorkout) { WeekTableView(openDay: weekDay) }
            .sheet(isPresented: $showConnect, onDismiss: openWaitingWorkout) { ConnectAIView { showConnect = false } }
            .sheet(isPresented: $showMemory, onDismiss: openWaitingWorkout) { MemoryView() }
            .fullScreenCover(isPresented: $showWorkout) { WorkoutSessionView() }
            // "Start" on a reminder: the workout page opens over whatever was open (AppModel+Reminders.swift).
            .onAppear { takeWorkoutRoute() }
            .onChange(of: model.workoutRoute) { takeWorkoutRoute() }
            .onChange(of: model.memorySheetAsked) { _, asked in if asked { openAskedMemory() } }
            // Asks for the week's suggestions once, and again after the run is cleared.
            .task(id: [model.weekPlan == nil, model.aiConnected]) {
                if model.aiConnected { await model.loadSuggestionsIfNeeded() }
            }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            topBar
            if model.startedFreshNotice { FreshStartLine { model.dismissFreshStartNotice() } }
            hero
            dayRows
            weekSections
            memoryLink
        }
        .padding(.horizontal, Theme.md)
        .padding(.top, Theme.lg)
        .padding(.bottom, Theme.lg)
    }

    /// The main button of the day, in reach of the thumb, and Ask Evergreen.
    private var bottomBar: some View {
        VStack(spacing: 0) {
            if model.homeStartableToday { StartWorkoutBar { openWorkout() } }
            if model.aiConnected { AskBar() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.bottomBar")
    }

    private var topBar: some View {
        HStack {
            Text(dateLine)
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
            Spacer()
            if model.userRules.isOn { thisWeekButton }
            Button { showSettings = true } label: {
                Image(systemName: "gearshape")
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
                    .frame(width: TapTargetButtonStyle.minSide, height: TapTargetButtonStyle.minSide, alignment: .trailing)
            }
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("today.settings")
        }
    }

    private var thisWeekButton: some View {
        Button { showWeek = true } label: {
            // The frame is inside the label so the whole 44-point square takes the tap, not only the words.
            Text("This week")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.accent)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Each day of the week: at home, out or rest, and what it holds")
        .accessibilityIdentifier("today.thisWeek")
    }

    // MARK: The hero

    /// What was asked or is waiting for an answer comes first; then what the triggers found; then the plan.
    @ViewBuilder private var hero: some View {
        if !model.aiConnected {
            ConnectCard { showConnect = true }
        } else if let pending = model.pendingMemory {
            MemoryConfirmCard(pending: pending)
        } else if let placement = model.placement {
            PlacementCard(placement: placement)
        } else if model.ask != .idle {
            AskCard()
        } else {
            triggerHero
        }
    }

    @ViewBuilder private var triggerHero: some View {
        if let rain = model.triggers.rainAsks.first {
            rainHero(rain)
        } else if let snacks = model.triggers.rainSnacks.first {
            RainSnackCard(snacks: snacks, onAdd: { model.addRainSnacks(snacks) }, onNotNow: { model.triggers.dismiss(snacks) })
        } else if let shoes = model.shoesDue {
            shoeHero(shoes)
        } else {
            planHero
        }
    }

    @ViewBuilder private var planHero: some View {
        if let action = model.heroAction {
            AgentCard(action: action)
                .onAppear { model.noteSeen(action) }
            if action.kind == .move || action.kind == .shrink { FirstTimeLine(kind: .movedWorkout) }
        } else if let top = model.topSuggestion {
            if model.historyDepth.isThin { ThinHistoryLine(days: model.historyDepth.days) }
            TopSuggestionCard(session: top)
        } else if model.planning {
            PlanningCard()
        } else {
            quietHero
        }
    }

    @ViewBuilder private func rainHero(_ rain: RainAsk) -> some View {
        RainCard(ask: rain, now: model.now, onMove: { Task { await model.moveForRain(rain) } }, onKeep: { model.triggers.dismiss(rain) },
                 onSnacks: rain.snacks.map { snacks -> () -> Void in { model.addRainSnacks(snacks); model.triggers.dismiss(rain) } })
        FirstTimeLine(kind: .rain)
    }

    @ViewBuilder private func shoeHero(_ shoes: ShoeStatus) -> some View {
        ShoeCard(status: shoes, advice: model.shoeAdvice,
                 onNewPair: { model.shoeAdvice = nil; model.gotNewShoes() }, onLater: { model.shoeCardPutOff = true })
            .task { await model.loadShoeAdvice() }
        FirstTimeLine(kind: .shoes)
    }

    /// Not planning: the real state, whatever it is (weekly suggestions off, or the week couldn't be planned).
    @ViewBuilder private var quietHero: some View {
        NextWorkoutCard()
        if model.weekPlan == nil, model.aiConnected {
            Button(Automatic.week.isOn(model.settings) ? "Plan my week" : "Weekly suggestions are off. Plan my week once") {
                Task { _ = await model.planIfPossible(fresh: true) }
            }
            .font(.body)
            .foregroundStyle(Theme.accent)
            .frame(minHeight: TapTargetButtonStyle.minSide)
            .accessibilityIdentifier("today.planWeek")
        }
    }

    // MARK: Below the hero

    /// Today's own rows, and what was just said no to, with its undo.
    @ViewBuilder private var dayRows: some View {
        GoingOutRow()
        HomeWorkoutRow()
        SnacksTodayRow()
        if let problem = model.planProblem, model.aiConnected { WarningLine(words: problem) }
        if let shoes = model.triggers.shoes, shoes.line != nil, model.shoesDue == nil {
            ShoeHeadsUpLine(status: shoes, onNewPair: model.gotNewShoes)
        }
        // What the last "Not now" stopped, with Undo: it stays whatever the week planned afterwards holds.
        if let note = model.lastDecline, model.aiConnected {
            StopNoteRow(text: note.text, answerKey: note.answerKey)
        }
        if let key = model.rejectedBasis, model.aiConnected { BasisUndoRow(key: key) }
    }

    /// The week, the suggestions, what was added, and what is missing for them.
    @ViewBuilder private var weekSections: some View {
        // With no key and nothing planned the week has nothing to show: say what a key gives instead.
        if !model.aiConnected, model.plan.isEmpty { ConnectGivesSection() } else { WeekGuide() }
        if model.aiConnected { TodaySuggestions(except: suggestionInHero ? model.topSuggestion : nil) }
        TodayPlanSection()
        if model.calendarAccess != .on { CalendarOffNotice() }
        // Asked here only once the person has a run on their plan; before that it waits in What I remember.
        if model.shouldAskAboutShoes, model.hasRunOnPlan {
            ShoeQuestionView(onAnswer: model.answerShoeQuestion, onSkip: model.triggers.skipShoeQuestion)
        }
    }

    private var memoryLink: some View {
        Button("What I remember") { showMemory = true }
            .accessibilityHint("What I know about your routine, and how to make me forget")
            .accessibilityIdentifier("today.memory")
            .font(.footnote)
            .foregroundStyle(Theme.textMuted)
            .frame(minHeight: TapTargetButtonStyle.minSide)
    }

    // MARK: Opening the workout page

    /// "What I remember" asked for from elsewhere (a notification, a memory line).
    private func openAskedMemory() {
        model.memorySheetAsked = false
        showMemory = true
    }

    private var sheetOpen: Bool { showSettings || showWeek || showConnect || showMemory }

    /// A reminder's "Start": today's opens the workout page (done already, nothing opens: Today says it is done);
    /// another day's opens the week table on that day.
    private func takeWorkoutRoute() {
        guard let route = model.workoutRoute else { return }
        model.workoutRoute = nil
        switch route {
        case .session: if !model.homeDoneToday { openWorkout() }
        case .week(let day): openWeek(on: day)
        }
    }

    /// Opens the week table on one day; another open sheet goes first, as for the workout page.
    private func openWeek(on day: String) {
        weekDay = day
        guard sheetOpen, !showWeek else { showWeek = true; return }
        weekWaiting = true
        showSettings = false
        showConnect = false
        showMemory = false
    }

    /// Opens the workout page; with a sheet open, that sheet (and anything it opened) goes first, since only one thing can
    /// be presented from here, and the page opens once it has gone.
    private func openWorkout() {
        guard sheetOpen else { showWorkout = true; return }
        workoutWaiting = true
        showSettings = false
        showWeek = false
        showConnect = false
        showMemory = false
    }

    private func openWaitingWorkout() {
        if weekWaiting { weekWaiting = false; showWeek = true; return }
        if !showWeek { weekDay = nil }
        guard workoutWaiting else { return }
        workoutWaiting = false
        showWorkout = true
    }

    /// Whether the top suggestion has the hero slot (nothing asked, no agent action).
    private var suggestionInHero: Bool {
        model.aiConnected && model.pendingMemory == nil && model.placement == nil && model.ask == .idle && model.triggers.rainAsks.isEmpty && model.shoesDue == nil && model.heroAction == nil
    }

    /// "Friday, Nov 20", plus the time when the tour's fixed clock is set ("· 4:00 PM"),
    /// since the status bar keeps showing the real time.
    private var dateLine: String {
        let day = model.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        return model.clockMinutes == nil ? day : "\(day) · \(model.now.clock)"
    }
}

/// Said once, plainly: the saved plan couldn't be read, so a fresh one began. "OK" puts it away for good.
private struct FreshStartLine: View {
    let onOK: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("I couldn’t read your saved plan, so I started a fresh one. What I remember and your Apple Health data are untouched.")
                .font(.footnote)
                .foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Theme.sm)
            Button("OK", action: onOK)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.text)
                .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                .accessibilityIdentifier("today.freshStart.ok")
        }
    }
}

/// While there are under two weeks of workouts: how many days there are so far.
private struct ThinHistoryLine: View {
    let days: Int

    var body: some View {
        Text("I need about two weeks of your workouts to learn your routine. I have \(days) \(days == 1 ? "day" : "days") so far.")
            .font(.footnote)
            .foregroundStyle(Theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Why the week couldn't be planned, in the warning colour.
private struct WarningLine: View {
    let words: String

    var body: some View {
        Text(words)
            .font(.footnote)
            .foregroundStyle(Theme.warning)
            .fixedSize(horizontal: false, vertical: true)
    }
}
