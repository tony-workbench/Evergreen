import SwiftUI

/// One group on "What I remember": its sentences under 1px rules, each with a
/// quiet "Stop using this".
struct MemoryGroupSection: View {
    let group: MemoryBrief.Group

    @Environment(AppModel.self) private var model

    /// Space above and below a pattern's sentence and the body's figures.
    private static let rowGap: CGFloat = 12

    var body: some View {
        // What the group shows is worked out in the model (`AppModel.memoryShown`).
        let shown = model.memoryShown(group)
        VStack(alignment: .leading, spacing: 0) {
            Text(group.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.text)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, Theme.sm)
            rule
            if shown.isEmpty { emptyLine }
            ForEach(shown.patterns) { patternRow($0) }
            if !shown.figures.isEmpty { figuresRow(shown.figures) }
            ForEach(shown.sentences) { sentenceRow($0) }
            if !shown.patterns.isEmpty {
                Text("Tap a day to stop planning around it.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .padding(.top, Theme.sm)
            }
        }
    }

    private var rule: some View { Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth) }

    @ViewBuilder private var emptyLine: some View {
        Text(model.memoryEmptyWords(group))
            .font(.body)
            .foregroundStyle(Theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide, alignment: .leading)
        rule
    }

    /// One line per pattern, with its days; tapping a day stops that day alone.
    @ViewBuilder private func patternRow(_ pattern: MemoryPattern) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(pattern.sentence)
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Self.rowGap)
            DayDots(marked: Set(pattern.days.keys)) { day in
                if let key = pattern.days[day]?.key { Task { await model.stop(key: key) } }
            }
        }
        rule
    }

    @ViewBuilder private func figuresRow(_ figures: [BodyFigure]) -> some View {
        HStack(alignment: .top, spacing: Theme.md) {
            ForEach(figures) { figure in
                VStack(alignment: .leading, spacing: Theme.xxs) {
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
        .padding(.vertical, Self.rowGap)
        rule
    }

    @ViewBuilder private func sentenceRow(_ line: MemorySentence) -> some View {
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
                    .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
                    .accessibilityLabel("Stop using this: \(line.text)")
                    .accessibilityIdentifier("memory.stop.\(key)")
            }
        }
        rule
    }
}
