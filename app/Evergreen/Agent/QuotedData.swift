import Foundation

/// Words the person typed or that came from Apple Health (a shoe's name, a
/// workout's label, a goal), made safe to put in front of the model: one
/// line, short, and without the marks that could close a quote or a block.
/// The model is told such text is a name and nothing more.
enum QuotedData {
    static let longest = 40

    static func name(_ text: String) -> String {
        let kept = text.unicodeScalars.map { scalar -> Character in
            if CharacterSet.controlCharacters.contains(scalar) || CharacterSet.newlines.contains(scalar) { return " " }
            return "\"`{}<>|\\".unicodeScalars.contains(scalar) ? " " : Character(scalar)
        }
        let words = String(kept).split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        return String(words.prefix(longest)).trimmingCharacters(in: .whitespaces)
    }
}
