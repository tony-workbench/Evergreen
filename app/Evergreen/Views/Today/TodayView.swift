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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.sm) {
                HStack {
                    Text(dateLine)
                        .font(.footnote)
                        .foregroundStyle(Theme.textMuted)
                    Spacer()
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                            .font(.body)
                            .foregroundStyle(Theme.textMuted)
                            .frame(width: 44, height: 44, alignment: .trailing)
                    }
                    .accessibilityLabel("Settings")
                }
                if model.startedFreshNotice {
                    // Said once, plainly: the saved plan couldn't be read.
                    HStack(alignment: .firstTextBaseline) {
                        Text("I couldn’t read your saved plan, so I started a fresh one. What I remember and your Apple Health data are untouched.")
                            .font(.footnote)
                            .foregroundStyle(Theme.warning)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: Theme.sm)
                        Button("OK") {
                            model.startedFreshNotice = false
                            UserDefaults.standard.set(true, forKey: "fresh_start_said")
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.text)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                }
                if !model.aiConnected {
                    ConnectCard { showConnect = true }
                } else if let pending = model.pendingMemory {
                    MemoryConfirmCard(pending: pending)
                } else if let placement = model.placement {
                    PlacementCard(placement: placement)
                } else if model.ask != .idle {
                    AskCard()
                } else if let rain = model.triggers.rainAsks.first {
                    RainCard(ask: rain, now: model.now, onMove: { Task { await model.moveForRain(rain) } }, onKeep: { model.triggers.dismiss(rain) })
                    FirstTimeLine(kind: .rain)
                } else if let shoes = model.shoesDue {
                    ShoeCard(status: shoes, advice: model.shoeAdvice,
                             onNewPair: { model.shoeAdvice = nil; model.gotNewShoes() }, onLater: { model.shoeCardPutOff = true })
                        .task { await model.loadShoeAdvice() }
                    FirstTimeLine(kind: .shoes)
                } else if let action = model.heroAction {
                    AgentCard(action: action)
                        .onAppear { model.noteSeen(action) }
                    if action.kind == .move || action.kind == .shrink { FirstTimeLine(kind: .movedWorkout) }
                } else if let top = model.topSuggestion {
                    if model.historyDepth.isThin {
                        let days = model.historyDepth.days
                        Text("I need about two weeks of your workouts to learn your routine. I have \(days) \(days == 1 ? "day" : "days") so far.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    TopSuggestionCard(session: top)
                } else if model.planning {
                    PlanningCard()
                } else {
                    // Not planning: the real state, whatever it is (weekly suggestions off, or the week couldn't be planned).
                    NextWorkoutCard()
                    if model.weekPlan == nil, model.aiConnected {
                        Button(Automatic.week.isOn(model.settings) ? "Plan my week" : "Weekly suggestions are off. Plan my week once") {
                            Task { _ = try? await model.loadWeekPlan(fresh: true) }
                        }
                        .font(.body)
                        .foregroundStyle(Theme.accent)
                        .frame(minHeight: 44)
                    }
                }
                if let problem = model.planProblem, model.aiConnected {
                    Text(problem)
                        .font(.footnote)
                        .foregroundStyle(Theme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let shoes = model.triggers.shoes, shoes.line != nil, model.shoesDue == nil {
                    ShoeHeadsUpLine(status: shoes, onNewPair: model.gotNewShoes)
                }
                // What the last "Not now" stopped, with Undo: it stays whatever the week planned afterwards holds.
                if let note = model.lastDecline, model.aiConnected {
                    StopNoteRow(text: note.text, answerKey: note.answerKey)
                }
                if let key = model.rejectedBasis, model.aiConnected {
                    BasisUndoRow(key: key)
                }
                // With no key and nothing planned the week has nothing to show: say what a key gives instead.
                if !model.aiConnected, model.plan.isEmpty { ConnectGivesSection() } else { WeekGuide() }
                if model.aiConnected {
                    TodaySuggestions(except: suggestionInHero ? model.topSuggestion : nil)
                }
                TodayPlanSection()
                if model.calendarAccess != .on {
                    CalendarOffNotice()
                }
                // Asked here only once the person has a run on their plan; before that it waits in What I remember.
                if model.shouldAskAboutShoes, model.plan.contains(where: { $0.slot.activityType == "Running" }) {
                    ShoeQuestionView(onAnswer: model.answerShoeQuestion, onSkip: model.triggers.skipShoeQuestion)
                }
                HStack(spacing: Theme.lg) {
                    Button("What I remember") { showMemory = true }
                        .accessibilityHint("What I know about your routine, and how to make me forget")
                }
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .frame(minHeight: 44)
            }
            .padding(.horizontal, Theme.md)
            .padding(.top, Theme.lg)
            .padding(.bottom, Theme.lg)
        }
        .scrollDismissesKeyboard(.interactively)
        // Pulling down plans the week again.
        .refreshable { _ = try? await model.loadWeekPlan(fresh: true) }
        .background(Theme.surface)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if model.aiConnected { AskBar() }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showConnect) {
            ConnectAIView { showConnect = false }
        }
        .sheet(isPresented: $showMemory) { MemoryView() }
        .onChange(of: model.memorySheetAsked) { _, asked in
            guard asked else { return }
            model.memorySheetAsked = false
            showMemory = true
        }
        // Asks for the week's suggestions once, and again after the run is cleared.
        .task(id: [model.weekPlan == nil, model.aiConnected]) {
            if model.aiConnected { await model.loadSuggestionsIfNeeded() }
        }
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
