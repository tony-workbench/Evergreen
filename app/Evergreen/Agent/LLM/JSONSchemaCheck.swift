import Foundation

/// Checks a tool's input against its JSON schema before the tool runs: the
/// model's words are never trusted to have the right shape. Covers what the
/// app's tools use: objects with required fields and no extras, strings (with
/// `enum`), integers, numbers, booleans and arrays.
enum JSONSchemaCheck {
    /// Nil when the value fits; otherwise what's wrong, in a sentence the model can act on.
    static func problem(with value: JSONValue, schema: JSONValue, at path: String = "input") -> String? {
        guard let type = schema["type"]?.string else { return nil }
        switch (type, value) {
        case ("object", .object(let fields)):
            let properties = schema["properties"]?.object ?? [:]
            for name in schema["required"]?.array?.compactMap(\.string) ?? [] where fields[name] == nil {
                return "\(path).\(name) is required"
            }
            for (name, field) in fields.sorted(by: { $0.key < $1.key }) {
                guard let rule = properties[name] else {
                    if schema["additionalProperties"] == .bool(false) { return "\(path).\(name) is not a known field" }
                    continue
                }
                if let problem = problem(with: field, schema: rule, at: "\(path).\(name)") { return problem }
            }
            return nil
        case ("string", .string(let text)):
            if let allowed = schema["enum"]?.array, !allowed.contains(.string(text)) {
                return "\(path) must be one of \(allowed.compactMap(\.string).joined(separator: ", "))"
            }
            return nil
        case ("integer", .number(let number)):
            return number == number.rounded() ? nil : "\(path) must be a whole number"
        case ("number", .number), ("boolean", .bool):
            return nil
        case ("array", .array(let items)):
            guard let rule = schema["items"] else { return nil }
            for (index, item) in items.enumerated() {
                if let problem = problem(with: item, schema: rule, at: "\(path)[\(index)]") { return problem }
            }
            return nil
        default:
            return "\(path) must be \(type == "integer" || type == "object" || type == "array" ? "an" : "a") \(type)"
        }
    }
}
