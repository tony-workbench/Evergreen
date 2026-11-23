import SwiftUI

/// A calendar preview in Today's hero: what the calendar engine proposes,
/// block by block, and at most one question. Nothing is on the calendar
/// until "Confirm".
struct PlacementCard: View {
    let placement: Placement

    @Environment(AppModel.self) private var model
    @State private var busy = false

    var body: some View {
        let result = placement.result
        VStack(alignment: .leading, spacing: Theme.sm) {
            // One headline: the question when there is one, else the first block itself.
            let lead = result.question == nil ? result.proposed.first : nil
            Text(result.question?.text ?? lead.map(PlacementWords.line) ?? result.message)
                .agentFont(22, relativeTo: .title2)
                .foregroundStyle(Theme.accent)
                .fixedSize(horizontal: false, vertical: true)
            if let lead {
                HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
                    Text(lead.reason)
                        .font(.body)
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Theme.sm)
                    if let badge = PlacementWords.badge(lead) { Badge(text: badge) }
                }
            }
            ForEach(result.proposed.filter { $0.id != lead?.id }) { block in
                HStack(alignment: .firstTextBaseline, spacing: Theme.sm) {
                    VStack(alignment: .leading, spacing: 2) {
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
            if let note = placement.note {
                Text(note).font(.footnote).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
            }
            if let question = result.question {
                ForEach(question.answers, id: \.id) { answer in
                    Button(answer.label) { run { await model.answerPlacement(answer.id) } }
                        .buttonStyle(GhostButtonStyle())
                }
                Button("Not now", action: model.cancelPlacement)
                    .font(.body)
                    .foregroundStyle(Theme.textMuted)
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                HStack(spacing: Theme.sm) {
                    Button("Confirm") { run { await model.confirmPlacement() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityHint("Puts this on your plan and calendar")
                    Button("Not now", action: model.cancelPlacement)
                        .buttonStyle(GhostButtonStyle())
                }
                .padding(.top, Theme.sm)
                Text("Not on your calendar until you confirm. Drag the dashed block to change its time.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .disabled(busy)
        .padding(Theme.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .agentCardBackground()
    }

    private func run(_ work: @escaping () async -> Void) {
        busy = true
        Task {
            await work()
            busy = false
        }
    }
}
