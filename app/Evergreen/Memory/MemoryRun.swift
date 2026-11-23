import Foundation

/// How one daily memory update went, for the status line and for measuring how often the fallback is needed.
struct MemoryRun: Equatable, Sendable {
    enum Source: Equatable, Sendable {
        /// Nothing was due.
        case none
        /// The model's proposals were applied.
        case model
        /// The model couldn't be asked or kept getting it wrong: the engine's own rules made the proposals.
        case rules
    }

    var source = Source.none
    /// How many proposals were handed to the engine, and what it refused, each as "code: text".
    var proposals = 0
    var refused: [String] = []
    /// How many times the answer went back to the model before it was applied.
    var repairs = 0
    /// Why the rules made the proposals instead of the model, when they did.
    var fallback: String?

    /// Numbers in a proposal's sentence that its cited evidence doesn't hold: the
    /// one mistake worth sending back before the engine sees the answer. The
    /// same allowance as the engine's own check: any number anywhere in the
    /// cited evidence, also rounded to 0, 1 or 2 places; "7 AM" and "6 PM"
    /// as hours of the day; dates left alone.
    static func strayNumbers(in answer: JSONValue, evidence: [JSONValue]) -> [String] {
        let byId = Dictionary(evidence.compactMap { item in item["id"]?.string.map { ($0, item) } }) { first, _ in first }
        return (answer["proposals"]?.array ?? []).enumerated().compactMap { index, proposal in
            guard let statement = proposal["statement"]?.string else { return nil }
            let cited = (proposal["evidenceIds"]?.array ?? []).compactMap(\.string).compactMap { byId[$0] }
            var allowed = Set<String>()
            cited.forEach { collect($0, into: &allowed) }
            var rest = statement.replacing(date, with: " ")
            var stray: [String] = []
            // "7 AM" is hour 7, "6 PM" hour 18.
            for found in rest.matches(of: /\b(\d{1,2}) ?(AM|PM)\b/) {
                let hour = (Int(found.1) ?? 0) % 12 + (found.2 == "PM" ? 12 : 0)
                if !allowed.contains(String(hour)) { stray.append(String(found.0)) }
            }
            rest = rest.replacing(/\b(\d{1,2}) ?(AM|PM)\b/, with: " ")
            stray += rest.matches(of: /\d+(?:\.\d+)?/).map { String($0.0) }.filter { !allowed.contains(canon($0)) }
            return stray.isEmpty ? nil
                : "Proposal \(index + 1): \(stray.joined(separator: ", ")) in \"\(statement)\" \(stray.count == 1 ? "is" : "are") not in the evidence it cites. Use only numbers from the cited evidence, exactly as written or rounded."
        }
    }

    private static var date: Regex<Substring> { /\d{4}-\d{2}-\d{2}/ }

    /// A number without trailing zeros: "40.0" and "40" are the same.
    static func canon(_ text: String) -> String {
        guard let value = Double(text) else { return text }
        return value == value.rounded() ? String(Int(value)) : String(value)
    }

    /// Every number anywhere in a piece of evidence, as written and rounded to 0, 1 and 2 places.
    private static func collect(_ value: JSONValue, into allowed: inout Set<String>) {
        func add(_ number: Double) {
            guard number.isFinite, number >= 0 else { return }
            allowed.insert(canon(String(number)))
            for places in [0.0, 1.0, 2.0] {
                let scale = pow(10, places)
                allowed.insert(canon(String((number * scale).rounded() / scale)))
            }
        }
        switch value {
        case .number(let number): add(number)
        case .string(let text): text.replacing(date, with: " ").matches(of: /\d+(?:\.\d+)?/).compactMap { Double($0.0) }.forEach(add)
        case .array(let items): items.forEach { collect($0, into: &allowed) }
        case .object(let fields): fields.values.forEach { collect($0, into: &allowed) }
        default: break
        }
    }
}
