import SwiftUI

/// Forgetting a day or everything (memory-agent/docs/MEMORY-LOGIC.md, section
/// 6). Each asks first, then the screen shows memory without it. Single
/// facts are stopped from their own lines above.
struct MemoryForgetControls: View {
    @Environment(AppModel.self) private var model
    @State private var day = ""
    @State private var asking: MemoryEngine.Forget?
    @State private var confirming = false

    private var state: MemoryState { model.memoryState }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Forget")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, Theme.sm)
            rule
            if state.everythingForgotten {
                row("Everything is forgotten and stays off.", button: "Remember again") {
                    Task { await model.restore(.everything) }
                }
            } else {
                dayRow
                row("Everything", button: "Forget") { ask(.everything) }
            }
            if !state.forgottenDays.isEmpty {
                Text("\(state.forgottenDays.count) forgotten \(state.forgottenDays.count == 1 ? "day is" : "days are") left out of everything I work out.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .padding(.top, Theme.sm)
            }
        }
        .confirmationDialog(question, isPresented: $confirming, titleVisibility: .visible, presenting: asking) { what in
            Button("Forget", role: .destructive) { Task { await model.forget(what) } }
            Button("Keep", role: .cancel) {}
        } message: { _ in
            Text(consequence)
        }
    }

    private var rule: some View { Rectangle().fill(Theme.rule).frame(height: 1) }

    /// Only days memory has a line for can be picked; the row shows the picked one.
    @ViewBuilder
    private var dayRow: some View {
        if !state.days.isEmpty {
            HStack(spacing: Theme.md) {
                Text("A day")
                    .font(.body)
                    .foregroundStyle(Theme.text)
                Spacer(minLength: Theme.sm)
                Picker("Day to forget", selection: Binding(get: { pickedDay }, set: { day = $0 })) {
                    ForEach(state.days.reversed(), id: \.self) { Text(Self.dayTitle($0)).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(Theme.text)
                // "Sat, Nov 21" on one line.
                .lineLimit(1)
                .fixedSize()
                textButton("Forget") { ask(.day(pickedDay)) }
                    .accessibilityLabel("Forget \(Self.dayTitle(pickedDay))")
            }
            .frame(minHeight: TapTargetButtonStyle.minSide)
            rule
        }
    }

    /// The picked day, or the latest one until the person picks.
    private var pickedDay: String {
        state.days.contains(day) ? day : state.days.last ?? ""
    }

    private func row(_ title: String, button: String, action: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.md) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Theme.sm)
                textButton(button, action: action)
                    .accessibilityLabel("\(button): \(title)")
            }
            .frame(minHeight: TapTargetButtonStyle.minSide)
            rule
        }
    }

    private func textButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.body.weight(.medium))
            .foregroundStyle(Theme.text)
            .frame(minWidth: TapTargetButtonStyle.minSide, minHeight: TapTargetButtonStyle.minSide)
            .contentShape(.rect)
    }

    private func ask(_ what: MemoryEngine.Forget) {
        asking = what
        confirming = true
    }

    private var question: String {
        if case .day(let date) = asking { return "Forget \(Self.dayTitle(date))?" }
        return "Forget everything?"
    }

    private var consequence: String {
        if case .day = asking { return "The day is left out of everything I work out from then on. This can’t be undone." }
        return "I delete everything I worked out about your routine and your body, and write nothing again until you turn it back on."
    }

    /// "Tue, Nov 17" for "2026-11-17": short enough to stay on one line beside its button.
    /// "Saturday, November 21": the day in full, for the question that deletes it.
    nonisolated static func fullDayTitle(_ date: String) -> String {
        let parse = DateFormatter()
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.dateFormat = "yyyy-MM-dd"
        guard let day = parse.date(from: date) else { return date }
        return day.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    static func dayTitle(_ date: String) -> String {
        let parse = DateFormatter()
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.dateFormat = "yyyy-MM-dd"
        guard let day = parse.date(from: date) else { return date }
        return day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }
}
