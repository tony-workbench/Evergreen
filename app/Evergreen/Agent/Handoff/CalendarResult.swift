import Foundation

/// What the calendar engine answers: a preview, and sometimes one question.
struct CalendarResult: Codable, Equatable, Sendable {
    struct Question: Codable, Equatable, Sendable {
        struct Answer: Codable, Equatable, Sendable {
            var id: String
            var label: String
        }

        var text: String
        var answers: [Answer]
    }

    /// add, move, resize, cancel, race, question or none
    var kind: String
    var message: String
    var proposed: [PreviewBlock]
    var question: Question?
    var undoToken: String?
    var replaces: JSONValue?
    /// The engine's own state, handed back on the next call.
    var state: JSONValue?
    /// The answer exactly as the engine gave it, handed back as `plan` when the person changes something.
    var raw: JSONValue?

    private enum CodingKeys: String, CodingKey { case kind, message, proposed, question, undoToken, replaces, state }

    /// Nothing else has to move and nothing is asked: it can be added with one tap.
    var isSimpleAdd: Bool { question == nil && !proposed.isEmpty && proposed.allSatisfy { $0.status == "new" } }
}
