import Foundation

/// A change to what is remembered that the person asked for in words. It
/// is never carried out by the model, or straight from a sentence: it waits
/// on Today as a card, and only the person's tap on Confirm does it.
enum PendingMemory: Equatable, Sendable {
    /// Stop using these remembered lines (they can be restored).
    case stop(keys: [String], title: String)
    /// Forget one day, YYYY-MM-DD.
    case forgetDay(String)
    case forgetEverything
    /// The sentence asked to forget, but not clearly what: the person chooses, and then confirms.
    case forgetWhich

    /// The question on the card.
    var question: String {
        switch self {
        case .stop(_, let title): "Stop planning around \(title)?"
        case .forgetDay(let day): "Forget \(MemoryForgetControls.fullDayTitle(day))?"
        case .forgetEverything: "Forget everything I remember?"
        case .forgetWhich: "Forget one day, or everything?"
        }
    }

    /// What it means, in one line.
    var detail: String {
        switch self {
        case .stop: "I won’t use it until you restore it in What I remember."
        case .forgetDay(let day): "What I worked out from \(MemoryForgetControls.fullDayTitle(day)) is deleted, and that day alone. It is left out from now on."
        case .forgetEverything: "Everything I worked out about your routine and your body is deleted. This can’t be undone. Your workouts in Apple Health stay."
        case .forgetWhich: "Nothing is forgotten yet. Choose, and I’ll ask once more before deleting anything."
        }
    }

    var confirm: String {
        switch self {
        case .stop: "Stop"
        case .forgetDay, .forgetEverything, .forgetWhich: "Forget"
        }
    }
}
