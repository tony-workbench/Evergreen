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

    var body: some View {
        let open = model.openSuggestions.filter { $0.id != except?.id && ($0.after?.start ?? .distantPast) > model.now }
        // When every open suggestion is the same thing on different days, the picture and "Add all" already say it:
        // lines are shown only when the week holds two or more different things.
        let kinds = SuggestionGroup.groups(model.openSuggestions, calendar: model.calendar).count
        let groups = kinds > 1 ? SuggestionGroup.groups(open, calendar: model.calendar) : []
        // The last "Not now" has its own line on Today; older ones whose session is still in the week are listed here.
        let notes = (model.weekPlan?.sessions ?? []).compactMap { model.stopNote(for: $0) }.filter { $0.answerKey != model.lastDecline?.answerKey }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(groups) { group in
                HStack(alignment: .firstTextBaseline, spacing: Theme.md) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.sentence(model.calendar))
                            .font(.body)
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                        if group.sessions.count > 1 { DayDots(marked: group.weekdays(model.calendar)) }
                    }
                    Spacer(minLength: Theme.sm)
                    Button(group.sessions.count > 1 ? "Add \(group.sessions.count)" : "Add") { add(group) }
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.accent)
                        .frame(minWidth: 44, minHeight: 44)
                        .disabled(busy)
                        .accessibilityHint("Adds \(group.sessions.count == 1 ? "it" : "them") to your plan and calendar")
                }
                .padding(.vertical, Theme.sm)
                .contextMenu {
                    Button(group.sessions.count > 1 ? "Not now, all \(group.sessions.count)" : "Not now") {
                        Task { await model.decline(all: group.sessions) }
                    }
                }
                Rectangle().fill(Theme.rule).frame(height: 1)
            }
            ForEach(Array(Set(notes.map(\.answerKey))).sorted(), id: \.self) { key in
                if let note = notes.first(where: { $0.answerKey == key }) {
                    StopNoteRow(text: note.text, answerKey: note.answerKey)
                    Rectangle().fill(Theme.rule).frame(height: 1)
                }
            }
        }
    }

    private func add(_ group: SuggestionGroup) {
        busy = true
        Task {
            for session in group.sessions { await model.accept(session) }
            busy = false
        }
    }
}
