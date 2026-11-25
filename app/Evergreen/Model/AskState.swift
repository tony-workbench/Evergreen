import Foundation

/// Where "Ask Evergreen" stands, for the card at the top of Today.
enum AskState: Equatable {
    case idle
    /// Working on it; which agent, once the sentence is sorted.
    case working(AgentKind?)
    /// An agent's answer.
    case answer(agent: AgentKind, text: String)
    /// It couldn't be done just now, in plain words.
    case problem(String)
}
