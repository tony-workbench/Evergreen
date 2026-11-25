import SwiftUI

/// "What I remember": what Evergreen knows, as sentences in two groups (your
/// routine, your body), each line with a quiet "Stop using this"; what was
/// stopped, with Restore; forgetting a day or everything; and, behind a
/// disclosure, exactly what is sent. A sheet, like Your data.
struct MemoryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var showExact = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.lg) {
                        MemoryReviewSection()
                        ForEach(MemoryBrief.Group.allCases) { group in
                            MemoryGroupSection(group: group)
                        }
                        if model.historyDepth.isThin, !model.memoryRows.contains(where: \.isUsable) { MemoryComingSection() }
                        // A question of its own, after what is remembered.
                        if model.shouldAskAboutShoes {
                            ShoeQuestionView(onAnswer: model.answerShoeQuestion, onSkip: model.triggers.skipShoeQuestion)
                        }
                        MemoryStoppedSection()
                        MemoryForgetControls()
                        exact
                            .id("exact")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.md)
                    .padding(.vertical, Theme.lg)
                }
                #if DEBUG
                // `-debug_memory_bottom YES` shows the lower half (DebugLaunch).
                .task {
                    guard UserDefaults.standard.bool(forKey: "debug_memory_bottom") else { return }
                    try? await Task.sleep(for: .seconds(1))
                    scroll.scrollTo("exact", anchor: .bottom)
                }
                #endif
            }
            .background(Theme.surface)
            .navigationTitle("What I remember")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await model.refreshMemory() }
        }
    }

    /// What the planning agent is sent about the person, word for word.
    @ViewBuilder
    private var exact: some View {
        DisclosureGroup("See exactly what is sent", isExpanded: $showExact) {
            VStack(alignment: .leading, spacing: Theme.sm) {
                Text(model.sentToAI.isEmpty ? "Nothing has been sent yet." : model.sentToAI)
                    .font(.footnote)
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                Text("Sent to Google’s Gemini API with your key when planning. Averages and counts, never a single reading, and never what your calendar events are called.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, Theme.sm)
        }
        .font(.body)
        .tint(Theme.textMuted)
        .foregroundStyle(Theme.text)
    }
}
