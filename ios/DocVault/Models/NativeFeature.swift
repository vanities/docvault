import Foundation

enum NativeFieldKind: Hashable, Sendable {
    case text, multiline, number, integer, percentage, boolean, date, time, secret
    case choices([String])
    case reference(String)
    case references(String)
    case records([NativeField])
    case strings, images
}

struct NativeField: Identifiable, Hashable, Sendable {
    let id: String
    var label: String
    var kind: NativeFieldKind
    var required = false
    var initial = ""
    init(
        _ id: String, _ label: String? = nil, _ kind: NativeFieldKind = .text,
        required: Bool = false, initial: String = ""
    ) {
        self.id = id
        self.label = label ?? VaultValue.label(id.split(separator: ".").last.map(String.init) ?? id)
        self.kind = kind
        self.required = required
        self.initial = initial
    }
}

struct NativeCollection: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let path: String
    var fields: [NativeField] = []
    var createPath = ""
    var updatePath = ""
    var deletePath = ""
    var deleteTitle = "Delete"
    var updateMethod = "PUT"
    var wholeList = false
    var detailPath = ""
    var actions: [NativeAction] = []
}

struct NativeAction: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let path: String
    var method = "POST"
    var fields: [NativeField] = []
    var response = "data"
    var destructive = false
}

struct NativeResource: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let path: String
    var collections: [NativeCollection] = []
    var actions: [NativeAction] = []
    var editFields: [NativeField] = []
    var editPath = ""
    var editMethod = "PUT"
    var dataPath = ""
}

struct NativeFeature: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let symbol: String
    let group: String
    var resources: [NativeResource]
    var entityScoped = false
    var yearScoped = false
    var personScoped = false
}

enum NativeForm {
    static func value(field: NativeField, text: String) throws -> VaultValue? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            if field.required {
                throw VaultError.server("\(field.label) is required.")
            }
            return nil
        }
        switch field.kind {
        case .number, .integer, .percentage:
            guard let number = Double(value), number.isFinite else {
                throw VaultError.server("Enter a valid number for \(field.label).")
            }
            if field.kind == .integer, number.rounded() != number {
                throw VaultError.server("\(field.label) must be a whole number.")
            }
            return .number(field.kind == .percentage ? number / 100 : number)
        case .boolean: return .bool(value == "true" || value == "Yes")
        case .date:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.isLenient = false
            guard let date = formatter.date(from: value), formatter.string(from: date) == value
            else {
                throw VaultError.server("Use YYYY-MM-DD for \(field.label).")
            }
            return .string(value)
        case .time:
            guard
                value.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression)
                != nil
            else {
                throw VaultError.server("Use HH:MM for \(field.label).")
            }
            return .string(value)
        case let .choices(options):
            guard options.contains(value) else {
                throw VaultError.server("Choose a valid \(field.label).")
            }
            return .string(value)
        case .images:
            let items = try JSONDecoder().decode([VaultValue].self, from: Data(value.utf8))
            guard items.count <= 8,
                  items.allSatisfy({ item in
                      ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(
                          item["mimeType"].string
                      ) && item["dataUrl"].string.count <= 14 * 1024 * 1024
                  })
            else {
                throw VaultError.server(
                    "Choose up to eight supported images, each smaller than 10 MB."
                )
            }
            return .array(items)
        case let .records(fields):
            let rows = try JSONDecoder().decode([VaultValue].self, from: Data(value.utf8))
            guard rows.allSatisfy({
                if case .object = $0 {
                    true
                } else {
                    false
                }
            }) else {
                throw VaultError.invalidResponse
            }
            for row in rows {
                for item in fields {
                    _ = try Self.value(
                        field: item, text: Self.display(row.at(item.id), field: item)
                    )
                }
            }
            return .array(rows)
        case .strings, .references:
            return .array(value.split(separator: "\n").map { .string(String($0)) })
        default: return .string(value)
        }
    }

    static func body(
        fields: [NativeField], values: [String: String], original: VaultValue = .object([:]),
        patch: Bool = false
    ) throws -> VaultValue {
        var body: VaultValue = patch ? .object([:]) : original
        for field in fields {
            let text = values[field.id] ?? field.initial
            if patch, text == display(original.at(field.id), field: field) {
                continue
            }
            if patch, field.id.contains("."),
               let root = field.id.split(separator: ".").first.map(String.init), body[root].isEmpty
            {
                body.set(root, original[root])
            }
            if let value = try value(field: field, text: text) {
                body.set(field.id, value)
            } else if !original.at(field.id).isEmpty {
                switch field.kind {
                case .text, .multiline, .secret: body.set(field.id, .string(""))
                case .strings, .references, .records, .images: body.set(field.id, .array([]))
                default: body.set(field.id, .null)
                }
            }
        }
        return body
    }

    static func display(_ value: VaultValue, field: NativeField) -> String {
        if field.kind == .number || field.kind == .integer || field.kind == .percentage,
           let number = value.number
        {
            return String(field.kind == .percentage ? number * 100 : number)
        }
        if field.kind == .boolean {
            return value.isEmpty
                ? (field.initial.isEmpty ? "false" : field.initial)
                : (value.boolean ? "true" : "false")
        }
        switch field.kind {
        case .strings, .references: return value.array.map(\.string).joined(separator: "\n")
        case .records, .images:
            return String(
                data: (try? JSONEncoder().encode(value.isEmpty ? .array([]) : value)) ?? Data(),
                encoding: .utf8
            ) ?? "[]"
        default: break
        }
        return value.isEmpty ? field.initial : value.string
    }
}
