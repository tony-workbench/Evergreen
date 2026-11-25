import SwiftUI

/// What is suggested beyond the statement at the top, as sentences: like
/// sessions on different days are one line with their days and one "Add",
/// and only a session that really differs has a line of its own. A "not
/// now" that stopped a usual time leaves one quiet line with Undo.
struct TodaySuggestions: View {
    /// The suggestion already said at the top, left out here.
    var except: WeekPlan.Session?

    @Environment(AppModel.self) private var model
    @State private var busy = false

    /// The space between a group's sentence and its day dots.
    private static let dotsGap: CGFloat = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(model.otherSuggestionGroups(except: except)) { group in
                groupRow(group)
                Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
            }
            ForEach(model.olderStopNotes, id: \.answerKey) { note in
                StopNoteRow(text: note.text, answerKey: note.answerKey)
                Rectangle().fill(Theme.rule).frame(height: Theme.borderWidth)
            }
        }
    }

    /// One group: its sentence and days, "Add", and "Not now" in its menu.
    private func groupRow(_ group: SuggestionGroup) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.md) {
            VStack(alignment: .leading, spacing: Self.dotsGap) {
                Text(group.sentence(model.calendar))
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                if group.isSeveral { DayDots(marked: group.weekdays(model.calendar)) }
            }
            Spacer(minLength: Theme.sm)
            addButton(group)
        }
        .padding(.vertical, Theme.sm)
        .contextMenu {
            Button(group.notNowLabel) {
                Task { await model.decline(all: group.sessions) }
            }
        }
    }

    private func addButton(_ group: SuggestionGroup) -> some View {
        Button(group.addLabel) { add(group) }
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.accent)
            .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
            .disabled(busy)
            .accessibilityHint(group.addHint)
            .accessibilityIdentifier("suggestions.add.\(group.id)")
    }

    private func add(_ group: SuggestionGroup) {
        busy = true
        Task {
            for session in group.sessions { await model.accept(session) }
            busy = false
        }
    }
}
