import SwiftUI

/// A calendar preview in Today's hero: what the calendar engine proposes,
/// block by block, and at most one question. Nothing is on the calendar
/// until "Confirm".
struct PlacementCard: View {
    let placement: Placement

    @Environment(AppModel.self) private var model
    @State private var busy = false

    private var result: CalendarResult { placement.result }
    /// The first block, as the headline, when there is no question.
    private var lead: PreviewBlock? { result.question == nil ? result.proposed.first : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sm) {
            // One headline: the question when there is one, else the first block itself.
            Text(result.question?.text ?? lead.map(PlacementWords.line) ?? result.message)
                .agentFont(Theme.questionTitleSize, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
            if let lead { leadReason(lead) }
            ForEach(result.otherProposals(than: lead)) { block in blockRow(block) }
            if let note = placement.note {
                Text(note).font(.footnote).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
            }
            if let question = result.question { answers(question) } else { confirm }
        }
        .disabled(busy)
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
    }

    private func leadReason(_ lead: PreviewBlock) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
            Text(lead.reason)
                .font(.body)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Theme.sm)
            if let badge = PlacementWords.badge(lead) { Badge(text: badge) }
        }
    }

    /// Another block that moves or is added: what, why, and its badge.
    private func blockRow(_ block: PreviewBlock) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
            VStack(alignment: .leading, spacing: Theme.xxs) {
                Text(PlacementWords.line(block))
                    .font(.body)
                    .foregroundStyle(Theme.text)
                    .strikethrough(block.status == "cancelled")
                Text(block.reason)
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Theme.sm)
            if let badge = PlacementWords.badge(block) { Badge(text: badge) }
        }
        .accessibilityElement(children: .combine)
    }

    /// The question's answers, then "Not now".
    @ViewBuilder private func answers(_ question: CalendarResult.Question) -> some View {
        ForEach(question.answers, id: \.id) { answer in
            Button(answer.label) { run { await model.answerPlacement(answer.id) } }
                .buttonStyle(GhostButtonStyle())
                .accessibilityIdentifier("placement.answer.\(answer.id)")
        }
        Button("Not now", action: model.cancelPlacement)
            .font(.body)
            .foregroundStyle(Theme.textMuted)
            .frame(maxWidth: .infinity, minHeight: TapTargetButtonStyle.minSide)
            .accessibilityIdentifier("placement.notNow")
    }

    /// "Confirm" and "Not now", and that nothing is on the calendar before Confirm.
    @ViewBuilder private var confirm: some View {
        HStack(spacing: Theme.sm) {
            Button("Confirm") { run { await model.confirmPlacement() } }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityHint("Puts this on your plan and calendar")
                .accessibilityIdentifier("placement.confirm")
            Button("Not now", action: model.cancelPlacement)
                .buttonStyle(GhostButtonStyle())
                .accessibilityIdentifier("placement.notNow")
        }
        .padding(.top, Theme.sm)
        Text("Not on your calendar until you confirm. Drag the dashed block to change its time.")
            .font(.footnote)
            .foregroundStyle(Theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func run(_ work: @escaping () async -> Void) {
        busy = true
        Task {
            await work()
            busy = false
        }
    }
}
