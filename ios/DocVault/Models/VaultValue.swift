import Foundation

indirect enum VaultValue: Codable, Hashable, Sendable {
    case object([String: VaultValue])
    case array([VaultValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    init(from decoder: Decoder) throws {
        let box = try decoder.singleValueContainer()
        if box.decodeNil() {
            self = .null
        } else if let value = try? box.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? box.decode(Double.self) {
            self = .number(value)
        } else if let value = try? box.decode(String.self) {
            self = .string(value)
        } else if let value = try? box.decode([VaultValue].self) {
            self = .array(value)
        } else {
            self = try .object(box.decode([String: VaultValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case let .object(v): try box.encode(v)
        case let .array(v): try box.encode(v)
        case let .string(v): try box.encode(v)
        case let .number(v): try box.encode(v)
        case let .bool(v): try box.encode(v)
        case .null: try box.encodeNil()
        }
    }

    subscript(_ key: String) -> VaultValue {
        guard case let .object(values) = self else { return .null }
        return values[key] ?? .null
    }

    var object: [String: VaultValue] {
        if case let .object(v) = self {
            v
        } else {
            [:]
        }
    }

    var array: [VaultValue] {
        if case let .array(v) = self {
            v
        } else {
            []
        }
    }

    var string: String {
        switch self {
        case let .string(v): v
        case let .number(v): v.formatted(.number.precision(.fractionLength(0 ... 4)))
        case let .bool(v): v ? "Yes" : "No"
        default: ""
        }
    }

    var number: Double? {
        if case let .number(v) = self {
            v
        } else {
            Double(string)
        }
    }

    var boolean: Bool {
        if case let .bool(v) = self {
            v
        } else {
            false
        }
    }

    var stringSearch: String {
        switch self {
        case let .object(values): values.values.map(\.stringSearch).joined(separator: " ")
        case let .array(values): values.map(\.stringSearch).joined(separator: " ")
        default: string
        }
    }

    var isEmpty: Bool {
        self == .null || self == .object([:]) || self == .array([])
    }

    func at(_ path: String) -> VaultValue {
        path.isEmpty ? self : path.split(separator: ".").reduce(self) { $0[String($1)] }
    }

    mutating func set(_ path: String, _ value: VaultValue) {
        let parts = path.split(separator: ".").map(String.init)
        guard let first = parts.first else {
            self = value
            return
        }
        var values = object
        if parts.count == 1 {
            values[first] = value
        } else {
            var nested = values[first] ?? .object([:])
            nested.set(parts.dropFirst().joined(separator: "."), value)
            values[first] = nested
        }
        self = .object(values)
    }

    mutating func remove(_ key: String) {
        var values = object
        values.removeValue(forKey: key)
        self = .object(values)
    }

    var title: String {
        for key in [
            "title", "name", "label", "parsed.productName", "filename", "productName",
            "description", "person", "symbol", "ticker", "asset", "number", "date", "address", "id",
        ] {
            if !at(key).string.isEmpty {
                return at(key).string
            }
        }
        return string.isEmpty ? "Details" : string
    }

    static func label(_ key: String) -> String {
        let spaced = key.replacingOccurrences(
            of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression
        )
        return spaced.replacingOccurrences(of: "_", with: " ").replacingOccurrences(
            of: "-", with: " "
        ).capitalized
    }

    static func isSecret(_ key: String) -> Bool {
        let value = key.lowercased()
        return ["password", "secret", "token", "apikey", "accesskey", "privatekey"].contains {
            value.contains($0)
        }
            && !value.hasPrefix("has") && !value.hasSuffix("hint")
    }
}

struct VaultScope: Hashable, Sendable {
    var entity = ""
    var person = ""
    var year = Calendar.current.component(.year, from: Date())
    var query = ""
    var start = ""
    var end = ""
    var values: [String: String] {
        [
            "entity": entity, "person": person, "year": String(year), "query": query,
            "start": start, "end": end,
        ]
    }
}

struct VaultRequest: Hashable, Sendable {
    let path: [String]
    let query: [String: String]
    init(_ template: String, scope: VaultScope, record: VaultValue = .null) throws {
        let chunks = template.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        func expand(_ value: String) throws -> String {
            if value.hasPrefix("{"), value.hasSuffix("}") {
                let key = String(value.dropFirst().dropLast())
                let supplied: String = if case let .number(number) = record.at(key) {
                    number.rounded() == number ? String(format: "%.0f", number) : String(number)
                } else {
                    record.at(key).string
                }
                let result = supplied.isEmpty ? (scope.values[key] ?? "") : supplied
                guard !result.isEmpty else {
                    throw VaultError.server("Choose a \(VaultValue.label(key)) first.")
                }
                return result
            }
            return value
        }
        path = try chunks[0].split(separator: "/").flatMap { chunk -> [String] in
            let value = try expand(String(chunk))
            // Document paths are sequences of independently escaped path components.
            return chunk == "{filePath}" ? value.split(separator: "/").map(String.init) : [value]
        }
        var items: [String: String] = [:]
        if chunks.count > 1 {
            for item in chunks[1].split(separator: "&") {
                let pair = item.split(
                    separator: "=", maxSplits: 1, omittingEmptySubsequences: false
                )
                if pair.count == 2 {
                    items[String(pair[0])] = try expand(String(pair[1]))
                }
            }
        }
        query = items
    }
}
