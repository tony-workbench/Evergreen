import Foundation

/// The memory bundle's brief (plain bullets, at most 120 words) and the fact
/// lines behind it, each with its kind. What the person stopped is in neither.
struct PhoneMemory: Encodable, Equatable, Sendable {
    struct Fact: Encodable, Equatable, Sendable {
        var text: String
        var kind: String? = nil
    }

    var plannerText: String
    var facts: [Fact]

    /// How long the text is, counted the way the bundle counts it.
    var words: Int { plannerText.split(whereSeparator: \.isWhitespace).count }
}
