import Foundation

/// What Evergreen says once the running shoes are due for replacing: a
/// short recommendation, and the pages it comes from. A link is only ever
/// one the search itself returned as a source; none is built from the model's words.
struct ShoeAdvice: Codable, Equatable, Sendable {
    struct Link: Codable, Equatable, Identifiable, Sendable {
        var title: String
        var url: URL
        var id: String { url.absoluteString }
    }

    var text: String
    var links: [Link]

    static let mostLinks = 4

    /// Without a search: what to look for, and no store button.
    static func general(_ status: ShoeStatus) -> ShoeAdvice {
        ShoeAdvice(text: "\(status.line ?? "Your running shoes have gone a long way.") Look for a daily trainer with the fit and cushioning you already like; a running shop can check the wear on your old pair.", links: [])
    }
}
