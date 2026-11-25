import Foundation

/// What Today says after a "Not now" that stopped a usual time, and the answer its Undo takes back.
struct StopNote: Equatable, Sendable {
    var text: String
    var answerKey: String
}
