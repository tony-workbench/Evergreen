import SwiftUI

/// The week as one picture: seven days side by side, today first. A session
/// the person added is a solid block; a suggested one is a dashed outline,
/// and tapping it adds it (press and hold for "Not now" and "Why"). This is
/// the one drawn thing on Today; everything around it is type.
struct WeekPicture: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var why: WeekPlan.Session?
    /// Show only the first few blocks in time order (the tour drops them in one by one).
    var limit: Int? = nil
    @State private var adding: Set<String> = []

    static let blockHeight: CGFloat = 48

    struct Block: Identifiable, Equatable {
        enum Kind: Equatable { case added, done, missed, suggested }

        var id: String
        var kind: Kind
        /// "Run"
        var title: String
        /// "7", "7:30", "6 PM"
        var time: String
        var start: Date
    }

    /// Each of the seven days from today with its blocks in time order.
    static func days(plan: [PlanItem], suggestions: [WeekPlan.Session], state: (PlanItem) -> Block.Kind, now: Date, calendar: Calendar) -> [[Block]] {
        let today = calendar.startOfDay(for: now)
        return (0..<7).map { offset in
            let day = calendar.date(byAdding: .day, value: offset, to: today) ?? today
            func time(_ date: Date) -> String { SuggestionWords.at(date, calendar).replacing("at ", with: "") }
            let added = plan.filter { calendar.isDate($0.slot.start, inSameDayAs: day) }.map {
                Block(id: $0.id, kind: state($0), title: Activity.title($0.slot), time: time($0.slot.start), start: $0.slot.start)
            }
            let suggested = suggestions.compactMap { session -> Block? in
                guard let slot = session.after, calendar.isDate(slot.start, inSameDayAs: day) else { return nil }
                return Block(id: session.id, kind: .suggested, title: Activity.title(slot), time: time(slot.start), start: slot.start)
            }
            return (added + suggested).sorted { $0.start < $1.start }
        }
    }

    var body: some View {
        let days = Self.days(plan: model.plan, suggestions: model.openSuggestions,
                             state: { model.completion(for: $0) != nil ? .done : model.isMissed($0) ? .missed : .added },
                             now: model.now, calendar: model.calendar)
        let letters = WeekStrip.letters(from: model.storyDay, calendar: model.calendar)
        let shown = Set(days.flatMap(\.self).sorted { $0.start < $1.start }.prefix(limit ?? .max).map(\.id))
        let common = Self.commonTime(days)
        let rows = max(1, days.map(\.count).max() ?? 1)
        HStack(alignment: .top, spacing: 4) {
            ForEach(Array(days.enumerated()), id: \.offset) { offset, blocks in
                VStack(spacing: 4) {
                    ForEach(blocks) { block in view(block, common: common).opacity(shown.contains(block.id) ? 1 : 0).offset(y: shown.contains(block.id) ? 0 : -12) }
                    // Every column is as tall as the fullest, so the baseline is one line.
                    if blocks.count < rows { Spacer(minLength: 0).frame(height: CGFloat(rows - blocks.count) * (Self.blockHeight + 4) - 4) }
                    Rectangle().fill(offset == 0 ? Theme.text : Theme.rule).frame(height: offset == 0 ? 2 : 1)
                    Text(letters[offset])
                        .font(.footnote.weight(offset == 0 ? .semibold : .regular))
                        .foregroundStyle(offset == 0 ? Theme.text : Theme.textMuted)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: days)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: limit)
        .overlay(alignment: .bottomLeading) {
            // The time most blocks share is said once, here; a block says its time only when it differs.
            if let common, limit == nil {
                Text("\(days.flatMap(\.self).allSatisfy { $0.time == common } ? "All" : "Most") at \(PlainTime.withHalf(common))")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .offset(y: 28)
            }
        }
        .padding(.bottom, common != nil && limit == nil ? 28 : 0)
        .sheet(item: $why) { BasesSheet(session: $0) }
    }

    /// The time most of the week's blocks share, when at least two do.
    static func commonTime(_ days: [[Block]]) -> String? {
        let counts = Dictionary(grouping: days.flatMap(\.self), by: \.time).mapValues(\.count)
        guard let most = counts.max(by: { ($0.value, $1.key) < ($1.value, $0.key) }), most.value >= 2 else { return nil }
        return most.key
    }

    @ViewBuilder
    private func view(_ block: Block, common: String?) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.radiusSmall)
        let label = VStack(spacing: 1) {
            Text(block.title).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
            if block.time != common { Text(block.time).font(.caption2).lineLimit(1).minimumScaleFactor(0.7) }
        }
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, minHeight: Self.blockHeight)
        if block.kind == .suggested, let session = model.openSuggestions.first(where: { $0.id == block.id }) {
            Button {
                adding.insert(block.id)
                Task {
                    await model.accept(session)
                    adding.remove(block.id)
                }
            } label: {
                label
                    .foregroundStyle(Theme.accent)
                    .background(Theme.card, in: shape)
                    .overlay { shape.strokeBorder(Theme.accent, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) }
                    .opacity(adding.contains(block.id) ? 0.4 : 1)
            }
            .buttonStyle(RowPressStyle())
            .contextMenu {
                Button("Not now") { Task { await model.decline(session) } }
                Button("Why") { why = session }
            }
            .accessibilityLabel("Suggested: \(SuggestionWords.headline(session))")
            .accessibilityHint("Adds it to your plan. Press and hold for Not now and Why")
        } else {
            label
                .foregroundStyle(block.kind == .missed ? Theme.textMuted : Theme.onAccent)
                .background(block.kind == .missed ? Theme.rule : Theme.accent, in: shape)
                .overlay(alignment: .topTrailing) {
                    if block.kind == .done { Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.onAccent).padding(4) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(block.title) at \(block.time), \(block.kind == .done ? "done" : block.kind == .missed ? "missed" : "on your plan")")
        }
    }
}
