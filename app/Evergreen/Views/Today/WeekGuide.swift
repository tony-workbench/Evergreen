import SwiftUI

/// The week as a strip with the pine buddy standing on today, and beside it
/// how the week is going in a sentence. The buddy waves when Today opens and
/// cheers when a workout is done or added. Tapping it opens "What I remember".
struct WeekGuide: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    /// When the buddy started waving; restarted when Today appears.
    @State private var start = Date()
    @State private var cheeredAt: Date?
    /// True once the buddy is standing and nothing is moving.
    @State private var settled = false
    @State private var onScreen = false
    @State private var showMemory = false
    @State private var addingAll = false

    static let buddyHeight: CGFloat = 104
    static let cheer = 2.2

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.xs) {
            // Today is the first column, so the buddy stands at the leading edge, right on the strip.
            HStack(alignment: .center, spacing: Theme.md) {
                TimelineView(.animation(minimumInterval: 1 / 30, paused: settled || !onScreen || scenePhase != .active)) { timeline in
                    Button { showMemory = true } label: {
                        buddy(at: timeline.date)
                            .frame(height: Self.buddyHeight)
                    }
                    .buttonStyle(RowPressStyle())
                    .accessibilityLabel("Pine buddy")
                    .accessibilityHint("Opens What I remember")
                }
                Text(weekLine)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // While a calendar preview waits, the week is the hour-by-hour calendar so its dashed block can be dragged; otherwise the picture.
            if model.placement != nil {
                WeekCalendar()
            } else {
                WeekPicture()
                if model.aiConnected, model.openSuggestions.count > 1 {
                    Button(addingAll ? "Adding…" : "Add all \(model.openSuggestions.count)") {
                        addingAll = true
                        Task {
                            await model.acceptAll()
                            addingAll = false
                        }
                    }
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
                    .disabled(addingAll)
                    .accessibilityHint("Adds every suggestion that fits your calendar as it is")
                }
            }
        }
        .padding(.top, Theme.sm)
        .sheet(isPresented: $showMemory) { MemoryView() }
        .onAppear {
            onScreen = true
            start = Date()
            settle(after: WavingBuddy.greeting)
        }
        .onDisappear { onScreen = false }
        .onChange(of: model.celebration) {
            cheeredAt = Date()
            settle(after: Self.cheer)
        }
    }

    // MARK: The week

    /// The next 7 days, with a block for each planned workout.
    var days: [WeekStrip.Day] {
        let letters = WeekStrip.letters(from: model.storyDay, calendar: model.calendar)
        return (0..<7).map { offset in
            let day = model.calendar.date(byAdding: .day, value: offset, to: model.storyDay) ?? model.storyDay
            let marks = model.plan
                .filter { model.calendar.isDate($0.slot.start, inSameDayAs: day) }
                .map { item in
                    WeekStrip.Mark(label: Activity.title(item.slot),
                                   state: model.completion(for: item) != nil ? .done : model.isMissed(item) ? .missed : .planned)
                }
            return WeekStrip.Day(id: offset, letter: letters[offset], marks: marks, isToday: offset == 0)
        }
    }

    // MARK: The buddy

    /// Waving, cheering or standing, by the time.
    @ViewBuilder
    private func buddy(at date: Date) -> some View {
        if reduceMotion || settled {
            PineBuddy(pose: .standing, filled: tiers)
        } else if let cheeredAt, date.timeIntervalSince(cheeredAt) < Self.cheer {
            let (hop, squash) = CelebratingBuddy.motion(at: date.timeIntervalSince(cheeredAt))
            PineBuddy(pose: .celebrating, filled: tiers, hop: hop, squash: squash)
        } else if date.timeIntervalSince(start) < WavingBuddy.greeting {
            let (raise, swing) = WavingBuddy.arm(at: date.timeIntervalSince(start))
            PineBuddy(pose: .waving, filled: tiers, raise: raise, wave: swing)
        } else {
            PineBuddy(pose: .standing, filled: tiers)
        }
    }

    /// Stops the clock once the current motion is over, so nothing runs while the buddy stands.
    private func settle(after seconds: Double) {
        settled = false
        Task {
            try? await Task.sleep(for: .seconds(seconds + 0.1))
            if cheeredAt.map({ Date().timeIntervalSince($0) >= Self.cheer }) ?? true { settled = true }
        }
    }

    private var doneCount: Int { model.plan.filter { model.completion(for: $0) != nil }.count }

    /// A tier fills for each workout done this week.
    private var tiers: Int {
        let total = max(model.plan.count, 1)
        return min(3, (doneCount * 3 + total - 1) / total)
    }

    /// "This week: 1 of 3 done. Growing nicely!" The pine grows a tier for each workout done.
    private var weekLine: String {
        let total = model.plan.count
        guard total > 0 else {
            return model.aiConnected ? "Nothing planned yet. Start with the suggestion above." : "Nothing planned yet."
        }
        let cheer = doneCount == 0 ? "Let’s grow." : doneCount < total ? "Growing nicely!" : "Fully grown. You did it!"
        return "This week: \(doneCount) of \(total) done. \(cheer)"
    }
}
