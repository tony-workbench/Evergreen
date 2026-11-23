import Foundation

/// Writes confirmed blocks to the person's plan and calendar. All of them or none.
protocol CalendarWriting: Sendable {
    /// False when nothing was written.
    func write(_ blocks: [PreviewBlock]) async -> Bool
}

/// A writer whose work is a closure on the app's own state.
struct ClosureWriter: CalendarWriting {
    let action: @MainActor @Sendable ([PreviewBlock]) async -> Bool

    func write(_ blocks: [PreviewBlock]) async -> Bool { await action(blocks) }
}
