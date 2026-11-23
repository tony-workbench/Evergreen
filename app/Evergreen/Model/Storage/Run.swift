import Foundation
import SwiftData

// What the phone saves. The contract structs stay the shapes the rules read;
// these models map to and from them.

/// The one saved run on this phone: whose week it is, the day it is on, and
/// everything the person added. A new day keeps all of that.
@Model
final class Run {
    var persona: String
    var onboarded: Bool
    var storyDay: Date
    /// A fixed clock as minutes after midnight on the story day, for the tour; nil means real time.
    var clockMinutes: Int?
    /// A column of the saved store that nothing reads, like the four after
    /// `lastResponse`. They stay, in this order, so a store already on a phone
    /// opens as it is, with its plan.
    var seenCompletionIds: String = ""
    /// The rules' last answer for the day, so a relaunch shows what is done before the first tick.
    var lastResponse: Data?
    var approvedPurchaseText: String = ""
    var demoData: Data?
    var visitsData: Data?
    var planMadeAt: Date?
    /// The person's answers to the planner's suggestions, JSON-encoded by suggestion id.
    var suggestionAnswersData: Data?

    @Relationship(deleteRule: .cascade, inverse: \ActionRecord.run)
    var actions: [ActionRecord] = []

    @Relationship(deleteRule: .cascade, inverse: \LoggedWorkout.run)
    var workouts: [LoggedWorkout] = []

    init(persona: PersonaKey, storyDay: Date) {
        self.persona = persona.rawValue
        self.onboarded = false
        self.storyDay = storyDay
        self.clockMinutes = nil
        self.lastResponse = nil
    }

    var personaKey: PersonaKey { PersonaKey(rawValue: persona) ?? .me }

    var suggestionAnswers: [String: SuggestionAnswer] {
        get { suggestionAnswersData.flatMap { try? JSONDecoder.contract.decode([String: SuggestionAnswer].self, from: $0) } ?? [:] }
        set { suggestionAnswersData = newValue.isEmpty ? nil : try? JSONEncoder.contract.encode(newValue) }
    }
}
