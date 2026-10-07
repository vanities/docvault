import Foundation

struct NativeReportRule: Identifiable, Hashable, Sendable {
    let id = UUID()
    var name: String
    var keywords: [String]
}

struct NativeReportDraft: Hashable, Sendable {
    var enabled: Bool
    var to: String
    var day: Int
    var hour: Int
    var cadence: String
    var windowDays: String
    var timezone: String
    var clientIds: [String]
    var projectIds: [String]
    var categories: [NativeReportRule]

    init(_ config: VaultValue) {
        let value = NativeTimesheetReport.normalized(config)
        enabled = value["enabled"].boolean; to = value["to"].string
        day = Int(value["day"].number!); hour = Int(value["hour"].number!)
        cadence = value["cadence"].string; windowDays = String(Int(value["windowDays"].number!))
        timezone = value["timezone"].string
        clientIds = value["clientIds"].array.map(\.string); projectIds = value["projectIds"].array.map(\.string)
        categories = value["categories"].array.map { .init(name: $0["name"].string, keywords: $0["keywords"].array.map(\.string)) }
    }

    func body() throws -> VaultValue {
        guard (0 ... 6).contains(day), (0 ... 23).contains(hour), NativeTimesheetReport.cadences.contains(cadence),
              let days = Int(windowDays), (1 ... 90).contains(days) else { throw VaultError.server("Choose a valid day, hour and report window from 1 to 90 days.") }
        let zone = timezone.trimmingCharacters(in: .whitespacesAndNewlines), recipient = to.trimmingCharacters(in: .whitespacesAndNewlines)
        guard zone.isEmpty || TimeZone(identifier: zone) != nil else { throw VaultError.server("Enter a valid timezone, such as America/Chicago, or leave it empty for the server default.") }
        guard !enabled || !recipient.isEmpty else { throw VaultError.server("Add a recipient before enabling scheduled reports.") }
        for rule in categories where rule.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && rule.keywords.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            throw VaultError.server("Name each keyword rule or remove it.")
        }
        var result: VaultValue = .object([
            "enabled": .bool(enabled), "to": .string(recipient), "day": .number(Double(day)), "hour": .number(Double(hour)),
            "cadence": .string(cadence), "windowDays": .number(Double(days)),
            "clientIds": .array(clientIds.map(VaultValue.string)), "projectIds": .array(projectIds.map(VaultValue.string)),
            "categories": .array(categories.compactMap { rule in
                let name = rule.name.trimmingCharacters(in: .whitespacesAndNewlines)
                return name.isEmpty ? nil : .object(["name": .string(name), "keywords": .array(rule.keywords.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map(VaultValue.string))])
            }),
        ])
        if !zone.isEmpty {
            result.set("timezone", .string(zone))
        }
        return result
    }
}

struct NativeReportRow: Identifiable, Hashable, Sendable {
    let id: Int
    let value: VaultValue
    var category: String {
        value["category"].string.isEmpty ? "Uncategorized" : value["category"].string
    }

    var minutes: Double? {
        NativeTimesheetReport.nonnegative(value["minutes"])
    }

    var amount: Double? {
        NativeFinance.number(value["amount"])
    }

    var date: Date? {
        NativeTimesheetReport.date(value["date"].string)
    }
}

struct NativeReportGroup: Identifiable, Hashable, Sendable {
    let name: String
    let rows: [NativeReportRow]
    var id: String {
        name
    }

    var minutes: Double? {
        NativeTimesheetReport.sum(rows.map(\.minutes))
    }

    var amount: Double? {
        NativeTimesheetReport.sum(rows.map(\.amount))
    }
}

struct NativeReportPreview: Hashable, Sendable {
    let value: VaultValue
    let rows: [NativeReportRow]
    init(_ value: VaultValue) throws {
        guard NativeTimesheetReport.date(value["window"]["start"].string) != nil, NativeTimesheetReport.date(value["window"]["end"].string) != nil,
              value["window"]["start"].string <= value["window"]["end"].string,
              case let .array(rows) = value["rows"], case .string = value["csv"], case .string = value["html"] else { throw VaultError.invalidResponse }
        self.value = value; self.rows = rows.enumerated().map { .init(id: $0.offset, value: $0.element) }
    }

    var start: String {
        value["window"]["start"].string
    }

    var end: String {
        value["window"]["end"].string
    }

    var totalMinutes: Double? {
        NativeTimesheetReport.nonnegative(value["totalMinutes"])
    }

    var totalAmount: Double? {
        NativeFinance.number(value["totalAmount"])
    }

    var groups: [NativeReportGroup] {
        var seen = Set<String>()
        let names = rows.map(\.category).filter { seen.insert($0).inserted }
        return names.map { name in NativeReportGroup(name: name, rows: rows.filter { $0.category == name }) }
            .sorted { ($0.minutes ?? -1) > ($1.minutes ?? -1) }
    }

    var daily: [TaxYearAmount] {
        let dated = rows.filter { $0.date != nil }
        return Dictionary(grouping: dated, by: { $0.value["date"].string }).compactMap { day, rows in
            NativeTimesheetReport.sum(rows.map(\.minutes)).map { .init(label: day, amount: $0 / 60) }
        }.sorted { $0.label < $1.label }
    }

    func filtered(_ query: String, category: String) -> [NativeReportRow] {
        rows.filter { (category.isEmpty || $0.category == category) && (query.isEmpty || $0.value.stringSearch.localizedCaseInsensitiveContains(query)) }
    }

    func export(_ suffix: String, folder: URL) throws -> URL {
        guard ["csv", "html"].contains(suffix) else { throw VaultError.invalidPath }
        try Task.checkCancellation()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        let url = folder.appendingPathComponent("timesheet-\(start)-to-\(end)." + suffix)
        do {
            try Data(value[suffix].string.utf8).write(to: url, options: [.atomic, .completeFileProtection])
            try Task.checkCancellation(); return url
        } catch { try? FileManager.default.removeItem(at: folder); throw error }
    }
}

struct NativeReportReview: Identifiable, Hashable, Sendable {
    let id = UUID()
    let config: VaultValue
    let preview: NativeReportPreview
    let mail: VaultValue
    var recipient: String {
        config["to"].string
    }

    var cc: String {
        mail["cc"]["client"].string
    }

    var from: String {
        [mail["fromName"].string, mail["fromEmail"].string].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var alreadySent: Bool {
        config["lastSentWeek"].string == preview.end
    }
}

enum NativeTimesheetReport {
    static let cadences = ["weekly", "biweekly", "monthly"]
    static let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static let fields = ["enabled", "to", "day", "hour", "cadence", "windowDays", "timezone", "clientIds", "projectIds", "categories"]

    static func nonnegative(_ value: VaultValue) -> Double? {
        NativeFinance.number(value).flatMap { $0 >= 0 ? $0 : nil }
    }

    static func date(_ value: String) -> Date? {
        value.count == 10 ? NativeQuant.date(value) : nil
    }

    static func sum(_ values: [Double?]) -> Double? {
        values.allSatisfy { $0 != nil } ? NativeBusiness.sum(values) : nil
    }

    static func hours(_ minutes: Double?) -> String {
        minutes.map { NativeBusiness.number($0 / 60, suffix: "hours") } ?? "Unavailable"
    }

    static func normalized(_ raw: VaultValue) -> VaultValue {
        func int(_ key: String, low: Double, high: Double, fallback: Double) -> VaultValue {
            let value: Double = if case let .number(n) = raw[key], n.isFinite {
                n.rounded()
            } else {
                fallback
            }
            return .number(min(high, max(low, value)))
        }
        func string(_ value: VaultValue) -> String {
            if case let .string(v) = value {
                v
            } else {
                ""
            }
        }
        func list(_ value: VaultValue) -> [VaultValue] {
            value.array.filter {
                if case let .string(v) = $0 {
                    !v.isEmpty
                } else {
                    false
                }
            }
        }
        var config: VaultValue = .object([
            "enabled": .bool(raw["enabled"] == .bool(true)), "to": .string(string(raw["to"]).trimmingCharacters(in: .whitespacesAndNewlines)),
            "day": int("day", low: 0, high: 6, fallback: 5), "hour": int("hour", low: 0, high: 23, fallback: 15),
            "windowDays": int("windowDays", low: 1, high: 90, fallback: 7), "cadence": .string(cadences.contains(string(raw["cadence"])) ? string(raw["cadence"]) : "weekly"),
            "clientIds": .array(list(raw["clientIds"])), "projectIds": .array(list(raw["projectIds"])),
            "categories": .array(raw["categories"].array.compactMap { rule in
                let name = string(rule["name"]).trimmingCharacters(in: .whitespacesAndNewlines)
                return name.isEmpty ? nil : .object(["name": .string(name), "keywords": .array(list(rule["keywords"]).filter { !$0.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })])
            }),
        ])
        let zone = string(raw["timezone"]).trimmingCharacters(in: .whitespacesAndNewlines)
        if !zone.isEmpty {
            config.set("timezone", .string(zone))
        }
        for key in ["lastSentWeek", "lastSentAt"] {
            if case .string = raw[key] {
                config.set(key, raw[key])
            }
        }
        return config
    }

    static func editable(_ config: VaultValue) -> VaultValue {
        var result = normalized(config); result.remove("lastSentWeek"); result.remove("lastSentAt"); return result
    }

    static func expandsScope(_ original: VaultValue, draft: NativeReportDraft) -> Bool {
        for (key, next) in [("clientIds", draft.clientIds), ("projectIds", draft.projectIds)] {
            let old = Set(original[key].array.map(\.string))
            if !old.isEmpty, next.isEmpty || !Set(next).isSubset(of: old) {
                return true
            }
        }
        return false
    }

    static func scope(_ config: VaultValue, store: VaultValue, key: String) -> String {
        let ids = config[key].array.map(\.string), collection = key == "clientIds" ? "clients" : "projects"
        guard !ids.isEmpty else { return "All " + collection }
        return ids.map { id in store[collection].array.first { $0["id"].string == id }?["name"].string ?? "Unavailable saved \(collection == "clients" ? "client" : "project") · \(id)" }.joined(separator: ", ")
    }

    static func previewPath(end: String) throws -> String {
        guard end.isEmpty || date(end) != nil else { throw VaultError.server("Choose a valid report end date.") }
        return "api/timesheet/weekly-report/preview" + (end.isEmpty ? "" : "?end=" + end)
    }

    static func configuration(_ response: VaultValue) throws -> VaultValue {
        guard case .object = response["config"] else { throw VaultError.invalidResponse }; return normalized(response["config"])
    }

    @MainActor static func save(original: VaultValue, draft: NativeReportDraft, fetch: () async throws -> VaultValue, write: (VaultValue) async throws -> VaultValue) async throws -> VaultValue {
        let body = try draft.body(), fresh = try configuration(try await fetch())
        guard editable(fresh) == editable(original) else { throw VaultError.server("The report settings changed on the server. Reload before saving.") }
        let response = try await write(body); try NativeProviderSettings.requireSaved(response); return try configuration(response)
    }

    static func mailReview(_ settings: VaultValue) -> VaultValue {
        let mail = settings["email"]
        return .object(["enabled": mail["enabled"], "provider": mail["provider"], "fromName": mail["fromName"], "fromEmail": mail["fromEmail"], "cc": .object(["client": mail["cc"]["client"]])])
    }

    @MainActor static func review(end: String, request: (String) async throws -> VaultValue) async throws -> NativeReportReview {
        let path = try previewPath(end: end), config = try configuration(try await request("api/timesheet/weekly-report/config"))
        let preview = try NativeReportPreview(try await request(path)), mail = mailReview(try await request("api/settings"))
        let fresh = try configuration(try await request("api/timesheet/weekly-report/config"))
        guard editable(config) == editable(fresh) else { throw VaultError.server("The report settings changed while loading. Reload the preview.") }
        return .init(config: fresh, preview: preview, mail: mail)
    }

    @MainActor static func send(review: NativeReportReview, fetch: () async throws -> NativeReportReview, send: (VaultValue) async throws -> VaultValue) async throws -> VaultValue {
        guard !review.recipient.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw VaultError.server("Save a report recipient first.") }
        let fresh = try await fetch()
        guard editable(fresh.config) == editable(review.config), fresh.preview == review.preview, fresh.mail == review.mail,
              fresh.alreadySent == review.alreadySent else { throw VaultError.server("The report, recipients or send status changed. Refresh this review before sending.") }
        let result = try await send(.object(["end": .string(review.preview.end)]))
        try NativeProviderSettings.requireSaved(result)
        return result
    }
}
