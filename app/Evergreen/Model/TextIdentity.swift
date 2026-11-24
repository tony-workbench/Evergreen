import Foundation

/// Identities for a list of lines told apart by their words: a line's
/// identity is its words, and when the same words came before, how many times
/// they did ("Breathe out.#1"). A line keeps its identity when another line
/// is added or removed, unlike its place in the list.
enum TextIdentity {
    static func ids(_ texts: [String]) -> [String] {
        texts.enumerated().map { place, text in
            let before = texts[..<place].filter { $0 == text }.count
            return before == 0 ? text : "\(text)#\(before)"
        }
    }
}
