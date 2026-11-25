import Foundation

/// Keeps a reason honest about "longest", "shortest", "easiest" and
/// "hardest": such a sentence stays only when the numbers of the week bear
/// it out. A 40-minute run among 40-minute runs is not the longest.
enum Superlatives {
    /// The reason without any sentence whose superlative isn't true of this session among the week's others.
    static func checked(_ reason: String, minutes: Int, others: [Int]) -> String {
        let longest = others.allSatisfy { minutes > $0 } && !others.isEmpty
        let shortest = others.allSatisfy { minutes < $0 } && !others.isEmpty
        let sentences = reason.split(separator: ". ", omittingEmptySubsequences: true).map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: ". ")) }
        let kept = sentences.filter { sentence in
            let said = sentence.lowercased()
            if said.contains("longest") || said.contains("hardest") || said.contains("biggest") { return longest }
            if said.contains("shortest") || said.contains("easiest") || said.contains("lightest") { return shortest }
            return true
        }
        return kept.isEmpty ? "" : kept.joined(separator: ". ") + "."
    }
}
