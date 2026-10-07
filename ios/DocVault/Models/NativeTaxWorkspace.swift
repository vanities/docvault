import Foundation

struct VaultUploadDestination: Hashable, Sendable {
    let entity: String
    let folder: String
    var organizeByType = false
}

enum NativeTaxWorkspace {
    static let folders: [(String, String)] = [("W-2", "income/w2"), ("1099", "income/1099"), ("Schedule K-1", "income/k-1"), ("Other income & invoices", "income/other"), ("Business receipts", "expenses/business"), ("Mortgage interest", "expenses/1098"), ("Childcare", "expenses/childcare"), ("Medical", "expenses/medical"), ("Home improvement", "expenses/home-improvement"), ("Retirement", "retirement"), ("Bank statements", "statements/bank"), ("Credit-card statements", "statements/credit-card"), ("Crypto", "crypto"), ("Filed returns", "returns"), ("Tax software", "turbotax")]

    static func destination(entity: String, year: String, folder: String) throws -> VaultUploadDestination {
        guard !entity.isEmpty, entity != "all", !entity.contains("/"), entity != ".", entity != "..", year.range(of: "^[0-9]{4}$", options: .regularExpression) != nil, Int(year) != 0, folders.contains(where: { $0.1 == folder }) else { throw VaultError.invalidPath }
        return .init(entity: entity, folder: year + "/" + folder)
    }

    static func uploadFolder(destination: VaultUploadDestination?, entity: VaultEntity, currentYear: Int) -> String {
        guard let destination else { return entity.isTax ? "\(currentYear)/inbox" : "inbox" }
        if entity.id == destination.entity {
            return destination.folder
        }
        return entity.isTax && destination.folder.range(of: "^[0-9]{4}/", options: .regularExpression) != nil ? destination.folder : entity.isTax ? "\(currentYear)/inbox" : "inbox"
    }
}

enum NativeEntityDetails {
    static let sensitive: Set<String> = ["ssn", "ein", "bankAccount", "routingNumber"]
    static let labels = ["ein": "EIN", "ssn": "SSN", "sosControlNumber": "SOS Control #", "dateFormed": "Date formed", "naicsCodes": "NAICS codes", "dob": "Date of birth"]
    static let identityFields = ["name", "description", "color", "icon"]

    static func editable(_ value: VaultValue) -> [String: VaultValue] {
        value.object.filter { _, item in
            if case .string = item {
                return true
            }
            if case let .array(items) = item {
                return items.allSatisfy {
                    if case .string = $0 {
                        return true
                    }; return false
                }
            }
            return false
        }
    }

    static func label(_ key: String) -> String {
        labels[key] ?? VaultValue.label(key)
    }

    static func text(_ value: VaultValue) -> String {
        if case .array = value {
            return value.array.map(\.string).joined(separator: "\n")
        }; return value.string
    }

    static func masked(_ value: VaultValue) -> String {
        value.isEmpty || text(value).isEmpty ? "Empty" : "••••••••"
    }

    static func edited(_ text: String, template: VaultValue) -> VaultValue {
        if case .array = template {
            return .array(text.components(separatedBy: "\n").map(VaultValue.string))
        }; return .string(text)
    }

    static func newKey(_ text: String) throws -> String {
        let words = text.split(whereSeparator: \.isWhitespace)
        guard let first = words.first else { throw VaultError.server("Enter a field name.") }
        let key = words.count == 1 ? String(first) : first.lowercased() + words.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }.joined()
        guard !["__proto__", "prototype", "constructor"].contains(key), !key.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else { throw VaultError.server("Choose a different field name.") }
        return key
    }

    static func patch(original: VaultValue, current: VaultValue, identity: [String: String], metadata: [String: VaultValue]) throws -> VaultValue {
        guard original["id"] == current["id"], !original["id"].string.isEmpty else { throw VaultError.server("This entity is no longer available. Reload before editing.") }
        var patch: [String: VaultValue] = [:]
        for key in identityFields {
            let next = identity[key] ?? original[key].string
            guard next != original[key].string else { continue }
            guard original[key] == current[key] else { throw VaultError.server("\(label(key)) changed on the server. Reload before saving.") }
            let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !["name", "color"].contains(key) || !trimmed.isEmpty else { throw VaultError.server("\(label(key)) cannot be empty.") }
            patch[key] = .string(trimmed)
        }
        let existing = editable(original["metadata"])
        var changes: [String: VaultValue] = [:]
        for key in Set(existing.keys).union(metadata.keys) {
            let next = metadata[key] ?? .null
            guard next != (existing[key] ?? .null) else { continue }
            _ = try newKey(key)
            guard original["metadata"][key] == current["metadata"][key] else { throw VaultError.server("\(label(key)) changed on the server. Reload before saving.") }
            guard original["metadata"][key] == .null || existing[key] != nil else { throw VaultError.server("This field contains structured data and cannot be replaced in this editor.") }
            guard next == .null || editable(.object([key: next]))[key] != nil else { throw VaultError.server("Metadata fields must contain text or a list of text values.") }
            changes[key] = next
        }
        if !changes.isEmpty {
            patch["metadata"] = .object(changes)
        }
        return .object(patch)
    }
}

struct NativeReminderPayment: Hashable, Sendable {
    let id: String
    let year: Int
    let quarter: Int
    let amount: Double
    let date: String
    var path: String {
        "api/estimated-taxes/personal/\(year)"
    }
}

enum NativeFilingTasks {
    static func date(_ text: String) -> Date? {
        guard text.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return nil }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let value = formatter.date(from: text), formatter.string(from: value) == text else { return nil }; return value
    }

    static func days(_ from: String, _ to: String) -> Int? {
        guard let first = date(from), let last = date(to) else { return nil }; return Int((last.timeIntervalSince(first) / 86400).rounded())
    }

    static func pending(_ response: VaultValue, entity: String) -> [VaultValue] {
        response["occurrences"].array.filter { row in
            row["completable"] == .bool(true) && row["completed"] == .bool(false) && !row["eventId"].string.isEmpty && (entity == "all" || row["entityId"].string == entity) && days(response["today"].string, row["date"].string).map { $0 <= 60 } == true
        }.sorted { $0["date"] == $1["date"] ? id($0) < id($1) : $0["date"].string < $1["date"].string }
    }

    static func id(_ row: VaultValue) -> String {
        row["eventId"].string + ":" + row["date"].string
    }

    static func urgency(_ row: VaultValue, today: String) -> String {
        let end = date(row["endDate"].string) != nil ? row["endDate"].string : row["date"].string
        guard let distance = days(today, end) else { return "Unreported" }
        return distance < 0 ? "Overdue" : distance <= 7 ? "Within 7 days" : distance <= 30 ? "Within 30 days" : "Later"
    }

    static func reminder(title: String, date: String, entity: String, recurrence: String, notes: String) throws -> VaultValue {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw VaultError.server("Enter a reminder title.") }
        guard Self.date(date) != nil else { throw VaultError.server("Use a valid YYYY-MM-DD due date.") }
        guard !entity.isEmpty, entity != "all" else { throw VaultError.server("Choose one entity for this reminder.") }
        let intervals = ["monthly": 1, "quarterly": 3, "yearly": 1]
        guard recurrence.isEmpty || intervals[recurrence] != nil else { throw VaultError.server("Choose a supported recurrence.") }
        return .object(["kind": .string("task"), "title": .string(title), "date": .string(date), "entityId": .string(entity), "notes": notes.isEmpty ? .null : .string(notes), "recurrence": recurrence.isEmpty ? .null : .object(["interval": .number(Double(intervals[recurrence]!)), "unit": .string(recurrence == "yearly" ? "year" : "month"), "anchor": .string("fixed")])])
    }

    static func resolution(_ row: VaultValue, current: VaultValue, skipped: Bool) throws -> VaultValue {
        guard let fresh = current["occurrences"].array.first(where: { id($0) == id(row) }), fresh["completable"] == .bool(true), fresh["completed"] == .bool(false), fresh == row, date(current["today"].string) != nil else { throw VaultError.server("This reminder changed or was already resolved. Refresh before continuing.") }
        return .object(["occurrenceDate": row["date"], "completedOn": current["today"], "skipped": .bool(skipped)])
    }

    static func paymentPeriod(_ occurrence: VaultValue) -> (year: Int, quarter: Int)? {
        guard occurrence["title"].string.contains("Estimated Tax Payment"), date(occurrence["date"].string) != nil else { return nil }
        let parts = occurrence["date"].string.split(separator: "-").compactMap { Int($0) }; let year = parts[0], month = parts[1]
        let period = month == 1 ? (year - 1, 4) : (year, month <= 4 ? 1 : month <= 6 ? 2 : 3)
        return period.0 > 0 ? period : nil
    }

    static func payment(_ occurrence: VaultValue, saved: VaultValue, today: String) -> NativeReminderPayment? {
        guard let period = paymentPeriod(occurrence), let target = NativeFinance.number(saved["config"]["annualTarget"]), target > 0, date(today) != nil else { return nil }
        return .init(id: "native-reminder:" + id(occurrence), year: period.year, quarter: period.quarter, amount: target / 4, date: today)
    }

    static func paymentPatch(_ payment: NativeReminderPayment, current: VaultValue) throws -> VaultValue? {
        guard case let .array(payments) = current["payments"], case .object = current["config"], let target = NativeFinance.number(current["config"]["annualTarget"]), target / 4 == payment.amount else { throw VaultError.server("The estimated-tax configuration changed. Review the payment in Estimated Tax.") }
        if let existing = payments.first(where: { $0["id"].string == payment.id }) {
            guard existing["date"].string == payment.date, existing["quarter"].number == Double(payment.quarter), existing["amount"].number == payment.amount else { throw VaultError.server("A payment linked to this reminder has different recorded values. Review Estimated Tax.") }
            return nil
        }
        return .object(["payments": .array(payments + [.object(["id": .string(payment.id), "date": .string(payment.date), "quarter": .number(Double(payment.quarter)), "amount": .number(payment.amount)])]), "config": current["config"]])
    }
}
