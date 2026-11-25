import SwiftUI

/// The week as a calendar under the buddy: seven day columns over the
/// hours that hold something this week (an hour either side, six at least).
/// What is on the person's other calendars is grey, planned workouts are
/// accent ("Run 7:00"), today's column is tinted, and blocks a preview
/// proposes are dashed. Dragging a dashed block, or a planned workout, up or
/// down asks the calendar engine for that time; nothing is written until the
/// preview is confirmed.
struct WeekCalendar: View {
    @Environment(AppModel.self) private var model
    /// The block being dragged and how far, in points.
    @State private var drag: (id: String, offset: CGFloat)?

    static let hourHeight: CGFloat = 44
    static let minimumHours = 6
    static let minimumBlock: CGFloat = 24
    static let gutter: CGFloat = 38

    private var days: [Date] { Self.days(from: model.now, calendar: model.calendar) }

    static func days(from now: Date, calendar: Calendar) -> [Date] {
        let start = calendar.startOfDay(for: now)
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    /// The hours to show: from an hour before the first thing to an hour after the last, six at least.
    static func hours(for spans: [(start: Date, end: Date)], calendar: Calendar) -> ClosedRange<Int> {
        func hour(_ date: Date, up: Bool) -> Int {
            let parts = calendar.dateComponents([.hour, .minute], from: date)
            return (parts.hour ?? 0) + (up && (parts.minute ?? 0) > 0 ? 1 : 0)
        }
        guard let first = spans.map({ hour($0.start, up: false) }).min(),
              let last = spans.map({ calendar.isDate($0.end, inSameDayAs: $0.start) ? hour($0.end, up: true) : 24 }).max()
        else { return 6...12 }
        var from = max(0, first - 1), to = min(24, last + 1)
        // Widen to six hours, later first, then earlier.
        to = min(24, max(to, from + minimumHours))
        from = max(0, min(from, to - minimumHours))
        return from...to
    }

    var body: some View {
        let blocks = blocks()
        let hours = Self.hours(for: blocks.filter { $0.kind != .busy }.map { ($0.start, $0.end) }, calendar: model.calendar)
        // All of it stays on screen under the preview card: the hours share at most 300pt.
        let hourHeight = min(Self.hourHeight, 300 / CGFloat(max(1, hours.count - 1)))
        let height = CGFloat(hours.count - 1) * hourHeight
        VStack(spacing: Theme.xs) {
            GeometryReader { geometry in
                let columns = columns(in: geometry.size.width, blocks: blocks)
                ForEach(Array(days.enumerated()), id: \.offset) { index, day in
                    Text(day.formatted(.dateTime.weekday(columns[index].width > 60 ? .wide : .narrow)))
                        .font(.caption.weight(model.calendar.isDate(day, inSameDayAs: model.now) ? .bold : .regular))
                        .foregroundStyle(model.calendar.isDate(day, inSameDayAs: model.now) ? Theme.text : Theme.textMuted)
                        .frame(width: columns[index].width)
                        .offset(x: columns[index].x)
                }
            }
            .frame(height: 16)
            .accessibilityHidden(true)
            GeometryReader { geometry in
                let columns = columns(in: geometry.size.width, blocks: blocks)
                ZStack(alignment: .topLeading) {
                    // Today's column, tinted.
                    Rectangle().fill(Theme.accent.opacity(0.06))
                        .frame(width: columns[0].width, height: height)
                        .offset(x: columns[0].x)
                        .accessibilityHidden(true)
                    grid(hours, hourHeight: hourHeight)
                    ForEach(blocks, id: \.id) { block in
                        view(block, columns: columns, hours: hours, height: height, hourHeight: hourHeight)
                    }
                }
            }
            .frame(height: height)
            .clipped()
        }
        .padding(.bottom, Theme.md)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your week, \(PlainWords.clock(hours.lowerBound)) to \(PlainWords.clock(hours.upperBound % 24))")
    }

    /// Where each day's column sits. With a preview on screen, the day it is about takes
    /// 60% of the width so its block can be read and dragged; the other days share the rest.
    private func columns(in width: CGFloat, blocks: [Block]) -> [(x: CGFloat, width: CGFloat)] {
        let room = width - Self.gutter
        let focus = blocks.first { $0.kind == .proposed }.flatMap { block in days.firstIndex { model.calendar.isDate($0, inSameDayAs: block.start) } }
        var x = Self.gutter
        return (0..<7).map { index in
            let wide = focus.map { $0 == index ? room * 0.6 : room * 0.4 / 6 } ?? room / 7
            defer { x += wide }
            return (x, wide)
        }
    }

    // MARK: Blocks

    struct Block: Identifiable {
        /// `ghost` is where a moved workout is now, shown faintly behind its proposed place.
        enum Kind { case busy, workout, proposed, ghost }

        var id: String
        var kind: Kind
        var label: String
        var start: Date
        var end: Date
        var moved = false
        var item: PlanItem?
    }

    private func blocks() -> [Block] {
        let proposed = (model.placement?.result.proposed ?? []).filter { $0.status != "cancelled" && $0.allDay != true }
        let replaced = Set(proposed.compactMap(\.sessionId) + proposed.map(\.id))
        let busy = model.busyForBases.enumerated().map { Block(id: "busy-\($0.offset)", kind: .busy, label: "", start: $0.element.start, end: $0.element.end) }
        let workouts = model.plan.map {
            Block(id: replaced.contains($0.id) ? "ghost-\($0.id)" : $0.id, kind: replaced.contains($0.id) ? .ghost : .workout,
                  label: Activity.title($0.slot), start: $0.slot.start, end: $0.slot.end, item: $0)
        }
        let dashed = proposed.compactMap { block -> Block? in
            guard let start = block.start.date, let end = block.end.date else { return nil }
            return Block(id: block.id, kind: .proposed, label: block.title, start: start, end: end, moved: block.status == "moved")
        }
        return busy + workouts + dashed
    }

    private func frame(_ block: Block, columns: [(x: CGFloat, width: CGFloat)], hours: ClosedRange<Int>, height: CGFloat, hourHeight: CGFloat) -> CGRect? {
        guard let day = days.firstIndex(where: { model.calendar.isDate($0, inSameDayAs: block.start) }) else { return nil }
        func hour(_ date: Date) -> CGFloat {
            let parts = model.calendar.dateComponents([.hour, .minute], from: date)
            return CGFloat(parts.hour ?? 0) + CGFloat(parts.minute ?? 0) / 60
        }
        let top = max(0, hour(block.start) - CGFloat(hours.lowerBound)) * hourHeight
        let sameDay = model.calendar.isDate(block.end, inSameDayAs: block.start)
        let bottom = min(height, ((sameDay ? hour(block.end) : 24) - CGFloat(hours.lowerBound)) * hourHeight)
        guard bottom > top else { return nil }
        // As tall as its minutes; a short one still has room for its name.
        let tall = block.kind == .busy ? bottom - top : max(Self.minimumBlock, bottom - top)
        return CGRect(x: columns[day].x + 1, y: min(top, height - tall), width: columns[day].width - 2, height: tall)
    }

    @ViewBuilder
    private func view(_ block: Block, columns: [(x: CGFloat, width: CGFloat)], hours: ClosedRange<Int>, height: CGFloat, hourHeight: CGFloat) -> some View {
        if let frame = frame(block, columns: columns, hours: hours, height: height, hourHeight: hourHeight) {
            let offset = drag?.id == block.id ? drag?.offset ?? 0 : 0
            let shape = RoundedRectangle(cornerRadius: 4)
            Group {
                switch block.kind {
                case .busy:
                    shape.fill(Theme.rule)
                        .accessibilityHidden(true)
                case .ghost:
                    // Where it is now, until the move is confirmed.
                    shape.strokeBorder(Theme.textMuted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                        .overlay(alignment: .topLeading) { if frame.width >= Self.narrowest { label(block, color: Theme.textMuted) } }
                        .accessibilityLabel("Now: \(block.label), \(block.start.clock)")
                case .workout:
                    shape.fill(Theme.accent)
                        .overlay(alignment: .topLeading) { if frame.width >= Self.narrowest { label(block, color: Theme.onAccent) } }
                        .gesture(dragging(block, hourHeight: hourHeight))
                        .accessibilityLabel("\(block.label), \(block.start.formatted(.dateTime.weekday(.wide))) \(block.start.clock)")
                        .accessibilityHint("Drag up or down to move it")
                case .proposed:
                    shape.fill(Theme.card)
                        .overlay { shape.strokeBorder(Theme.accent, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) }
                        .overlay(alignment: .topLeading) { if frame.width >= Self.narrowest { label(block, color: Theme.accent) } }
                        .gesture(dragging(block, hourHeight: hourHeight))
                        .accessibilityLabel("Proposed: \(block.label), \(block.start.formatted(.dateTime.weekday(.wide))) \(block.start.clock)")
                        .accessibilityHint("Not on your calendar yet. Drag up or down to change its time")
                }
            }
            .frame(width: frame.width, height: frame.height)
            .clipShape(shape)
            .offset(x: frame.minX, y: frame.minY + offset)
            .zIndex(block.kind == .busy ? 0 : block.kind == .proposed ? 2 : 1)
        }
    }

    /// Under this width a block carries no words: its colour and place say it, and the wide day says the rest.
    static let narrowest: CGFloat = 48

    /// "Run 7:00"; on the wide day of a preview, "Run 1:00–1:40 PM".
    private func label(_ block: Block, color: Color) -> some View {
        let time = block.start.formatted(.dateTime.hour(.defaultDigits(amPM: .omitted)).minute())
        let roomy = block.kind == .proposed || block.kind == .ghost
        return VStack(alignment: .leading, spacing: 0) {
            Text(roomy ? "\(block.label) \(Basis.span(block.start, block.end, calendar: model.calendar))" : "\(block.label) \(time)")
            // On a preview the card above already says "Moved"; the block keeps its room for the time.
            if block.moved, !roomy { Text("Moved") }
        }
        .font(.system(size: roomy ? 13 : 9, weight: .semibold))
        .foregroundStyle(color)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.horizontal, 3)
        .padding(.top, 2)
    }

    /// A vertical drag, snapped to 15 minutes when it ends.
    private func dragging(_ block: Block, hourHeight: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { drag = (block.id, $0.translation.height) }
            .onEnded { value in
                drag = nil
                let minutes = (Double(value.translation.height / hourHeight) * 4).rounded() * 15
                guard minutes != 0 else { return }
                let start = block.start.addingTimeInterval(minutes * 60)
                Task {
                    if block.kind == .proposed {
                        await model.dragPlacement(block.id, to: start)
                    } else if let item = block.item {
                        await model.dragWorkout(item, to: start)
                    }
                }
            }
    }

    // MARK: Grid

    private func grid(_ hours: ClosedRange<Int>, hourHeight: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(hours), id: \.self) { hour in
                let y = CGFloat(hour - hours.lowerBound) * hourHeight
                Rectangle().fill(Theme.rule).frame(height: 1).offset(y: y)
                // With little room per hour, every other hour is labelled.
                if hour < hours.upperBound, hourHeight >= 30 || (hour - hours.lowerBound) % 2 == 0 {
                    Text(PlainWords.clock(hour % 24))
                        .font(.system(size: 9))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(1)
                        .fixedSize()
                        .frame(width: Self.gutter - 4, alignment: .trailing)
                        .offset(y: y + 2)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityHidden(true)
    }
}
