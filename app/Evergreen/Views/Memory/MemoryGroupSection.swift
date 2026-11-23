import SwiftUI

/// One group on "What I remember": its sentences under 1px rules, each with a
/// quiet "Stop using this".
struct MemoryGroupSection: View {
    let group: MemoryBrief.Group

    @Environment(AppModel.self) private var model

    /// The same count of days as Today gives.
    private var thin: String {
        let days = model.historyDepth.days
        return "I have \(days) \(days == 1 ? "day" : "days") of your workouts so far. Two weeks in, this fills up."
    }

    var body: some View {
        // Sleep, resting heart rate and load are the body's, whatever group their row carries.
        let bodyKinds = ["sleep", "resting_hr", "load"]
        let usable = model.memoryRows.filter(\.isUsable)
        let rows = usable.filter { (bodyKinds.contains($0.kind) || $0.group == "body") == (group == .body) }
        let split = MemoryPattern.split(rows)
        let figures = group == .body ? BodyFigure.figures(rows) : []
        // Before there is a table at all, the facts' own lines stand in.
        let sentences = usable.isEmpty
            ? model.memoryBrief.lines(group).map { (key: $0.key, text: $0.id == "thin" ? thin : $0.sentence) }
            : split.others.filter { row in !figures.contains { $0.key == row.key } }.map { (key: Optional($0.key), text: RowWords.sentence($0)) }
        VStack(alignment: .leading, spacing: 0) {
            Text(group.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, Theme.sm)
            Rectangle().fill(Theme.rule).frame(height: 1)
            if split.patterns.isEmpty, figures.isEmpty, sentences.isEmpty {
                Text(empty)
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                Rectangle().fill(Theme.rule).frame(height: 1)
            }
            // One line per pattern, with its days; tapping a day stops that day alone.
            ForEach(split.patterns) { pattern in
                VStack(alignment: .leading, spacing: 0) {
                    Text(pattern.sentence)
                        .font(.body)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                    DayDots(marked: Set(pattern.days.keys)) { day in
                        if let key = pattern.days[day]?.key { Task { await model.stop(key: key) } }
                    }
                }
                Rectangle().fill(Theme.rule).frame(height: 1)
            }
            if !figures.isEmpty {
                HStack(alignment: .top, spacing: Theme.md) {
                    ForEach(figures) { figure in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(figure.value).font(.title3.weight(.semibold)).foregroundStyle(Theme.text)
                            Text(figure.title).font(.footnote).foregroundStyle(Theme.text)
                            Text(figure.usual).font(.footnote).foregroundStyle(Theme.textMuted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contextMenu { Button("Stop using this") { Task { await model.stop(key: figure.key) } } }
                        .accessibilityElement(children: .combine)
                        .accessibilityHint("Press and hold to stop using this")
                    }
                }
                .padding(.vertical, 12)
                Rectangle().fill(Theme.rule).frame(height: 1)
            }
            ForEach(sentences, id: \.text) { line in
                HStack(alignment: .firstTextBaseline, spacing: Theme.md) {
                    Text(line.text)
                        .font(.body)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Theme.sm)
                    if let key = line.key {
                        Button("Stop") { Task { await model.stop(key: key) } }
                            .font(.footnote)
                            .foregroundStyle(Theme.textMuted)
                            .frame(minWidth: 44, minHeight: 44)
                            .accessibilityLabel("Stop using this: \(line.text)")
                    }
                }
                Rectangle().fill(Theme.rule).frame(height: 1)
            }
            if !split.patterns.isEmpty {
                Text("Tap a day to stop planning around it.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .padding(.top, Theme.sm)
            }
        }
    }

    private var empty: String {
        if model.memoryState.everythingForgotten { return "I’m not remembering this." }
        return group == .routine
            ? "Nothing here. I learn this from your workouts."
            : "Nothing here. I need a few nights of sleep and resting heart rate."
    }
}
