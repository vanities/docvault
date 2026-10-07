import Foundation

enum NativeTimesheetReportDemo {
    static var seed: VaultValue {
        .object([
            "version": .number(1),
            "clients": .array([
                .object(["id": .string("acme-client"), "name": .string("Acme Client"), "currency": .string("USD"), "archived": .bool(false)]),
                .object(["id": .string("other-client"), "name": .string("Acme Other Client"), "currency": .string("USD"), "archived": .bool(false)]),
            ]),
            "projects": .array([
                .object(["id": .string("acme-project"), "clientId": .string("acme-client"), "name": .string("Acme Project"), "hourlyRate": .number(100), "archived": .bool(false), "subClients": .array([.object(["id": .string("acme-division"), "name": .string("Acme Studio"), "archived": .bool(false)])])]),
                .object(["id": .string("other-project"), "clientId": .string("other-client"), "name": .string("Other Acme Project"), "hourlyRate": .number(150), "archived": .bool(false)]),
            ]),
            "entries": .array([
                entry("demo-entry", date: "2026-10-06", minutes: 45, amount: 75, description: "Demo project work"),
                entry("demo-studio", date: "2026-10-06", minutes: 60, amount: 100, description: "Research and design\nReview recorded scope", subClient: "acme-division", timed: true),
                entry("demo-plan", date: "2026-10-05", minutes: 30, amount: 0, description: "Unbilled planning", billable: false),
                entry("demo-build", date: "2026-10-07", minutes: 75, amount: 125, description: "Implementation, \"review\" and delivery"),
                entry("demo-other", date: "2026-10-04", minutes: 60, amount: 150, description: "Other client's invented work", project: "other-project", rate: 150),
                entry("demo-zero", date: "2026-10-03", minutes: 15, amount: 0, description: "Zero-rated consultation", rate: 0),
            ]),
            "invoices": .array([]), "templates": .array([]),
            "weeklyReport": NativeTimesheetReport.normalized(.object(["to": .string("reader@example.com"), "categories": .array([.object(["name": .string("Development"), "keywords": .array([.string("implementation"), .string("design")])]), .object(["name": .string("Research"), "keywords": .array([.string("research")])])])])),
        ])
    }

    private static func entry(_ id: String, date: String, minutes: Double, amount: Double, description: String, project: String = "acme-project", rate: Double = 100, subClient: String? = nil, timed: Bool = false, billable: Bool = true) -> VaultValue {
        var value: VaultValue = .object(["id": .string(id), "projectId": .string(project), "date": .string(date), "durationMinutes": .number(minutes), "amount": .number(amount), "hourlyRate": .number(rate), "description": .string(description), "billable": .bool(billable), "invoiced": .bool(false)])
        if let subClient {
            value.set("subClientId", .string(subClient))
        }
        if timed {
            value.set("start", .string("09:00")); value.set("end", .string("10:00"))
        }
        return value
    }

    static func window(end: String, days: Int) throws -> VaultValue {
        guard let day = NativeTimesheetReport.date(end), (1 ... 90).contains(days) else { throw VaultError.server("Choose a valid report window.") }
        return .object(["start": .string(NativeQuant.day(day.addingTimeInterval(-Double(days - 1) * 86400))), "end": .string(end)])
    }

    static func category(description: String, project: String, rules: [VaultValue], subClient: String) -> String {
        if !subClient.isEmpty {
            return subClient
        }
        let text = (description + "\n" + project).lowercased()
        for rule in rules where rule["keywords"].array.contains(where: { text.contains($0.string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) }) {
            return rule["name"].string
        }
        return project.isEmpty ? "Uncategorized" : project
    }

    static func rows(store: VaultValue, config: VaultValue, window: VaultValue) -> [VaultValue] {
        let clients = config["clientIds"].array.map(\.string), projects = config["projectIds"].array.map(\.string)
        let selected = store["entries"].array.filter { entry in
            guard entry["date"].string >= window["start"].string, entry["date"].string <= window["end"].string,
                  projects.isEmpty || projects.contains(entry["projectId"].string) else { return false }
            if clients.isEmpty {
                return true
            }
            guard let project = store["projects"].array.first(where: { $0["id"] == entry["projectId"] }) else { return false }
            return clients.contains(project["clientId"].string)
        }.sorted { a, b in
            if a["date"] != b["date"] {
                return a["date"].string < b["date"].string
            }
            let aTime = a["start"] == .null ? "99:99" : a["start"].string, bTime = b["start"] == .null ? "99:99" : b["start"].string
            return aTime < bTime
        }
        return selected.map { entry in
            let project = store["projects"].array.first { $0["id"] == entry["projectId"] } ?? .null
            let client = store["clients"].array.first { $0["id"] == project["clientId"] } ?? .null
            let sub = project["subClients"].array.first { $0["id"] == entry["subClientId"] }?["name"].string ?? ""
            let description = entry["description"].string.components(separatedBy: "\n").map { $0.replacingOccurrences(of: "[ \\t]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }.joined(separator: "\n").replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
            return .object(["date": entry["date"], "category": .string(category(description: entry["description"].string, project: project["name"].string, rules: config["categories"].array, subClient: sub)), "client": .string(client["name"].string), "project": .string(project["name"].string), "subClient": .string(sub), "description": .string(description), "minutes": entry["durationMinutes"], "hourlyRate": entry["hourlyRate"], "amount": entry["amount"], "billable": entry["billable"]])
        }
    }

    static func csv(_ rows: [VaultValue]) -> String {
        func quoted(_ text: String) -> String {
            text.contains(where: { ["\"", ",", "\n", "\r"].contains($0) }) ? "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : text
        }
        func decimal(_ value: Double) -> String {
            String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), value)
        }
        return (["Date,Category,Client,Project,Sub-client,Description,Hours,Rate,Amount,Billable"] + rows.map { row in
            [row["date"].string, quoted(row["category"].string), quoted(row["client"].string), quoted(row["project"].string), quoted(row["subClient"].string), quoted(row["description"].string), decimal((row["minutes"].number ?? 0) / 60), decimal(row["hourlyRate"].number ?? 0), decimal(row["amount"].number ?? 0), row["billable"].boolean ? "yes" : "no"].joined(separator: ",")
        }).joined(separator: "\n")
    }

    static func preview(store: VaultValue, config: VaultValue, end: String) throws -> VaultValue {
        let window = try window(end: end, days: Int(config["windowDays"].number ?? 7)), rows = rows(store: store, config: config, window: window)
        var result: VaultValue = .object(["window": window, "rows": .array(rows), "totalMinutes": .number(rows.reduce(0) { $0 + ($1["minutes"].number ?? 0) }), "totalAmount": .number(rows.reduce(0) { $0 + ($1["amount"].number ?? 0) }), "csv": .string(csv(rows)), "html": .string("")])
        let report = try NativeReportPreview(result)
        result.set("categories", .array(report.groups.map { .object(["category": .string($0.name), "minutes": $0.minutes.map(VaultValue.number) ?? .null, "amount": $0.amount.map(VaultValue.number) ?? .null]) }))
        func escaped(_ value: String) -> String {
            value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }
        let detail = rows.map { row in "<tr><td>\(escaped(row["date"].string))</td><td>\(escaped(row["category"].string))</td><td>\(escaped(row["description"].string).replacingOccurrences(of: "\n", with: "<br>"))</td><td>\(NativeTimesheetReport.hours(row["minutes"].number))</td></tr>" }.joined()
        result.set("html", .string("<!doctype html><html><body style=\"font-family:system-ui;padding:24px\"><h1>Timesheet</h1><p>\(report.start) to \(report.end)</p><p>Invented demo report. No email is sent.</p><table>\(detail)</table></body></html>"))
        return result
    }

    static func request(_ request: VaultRequest, method: String, body: VaultValue?, stores: inout [String: VaultValue], now: Date = .now) throws -> VaultValue? {
        let path = request.path.joined(separator: "/")
        guard path.hasPrefix("api/timesheet/weekly-report/") else { return nil }
        var store = stores["api/timesheet"] ?? seed
        let existing = NativeTimesheetReport.normalized(store["weeklyReport"])
        if path == "api/timesheet/weekly-report/config" {
            if method == "PUT" {
                var next = NativeTimesheetReport.normalized(body ?? .null)
                for key in ["lastSentWeek", "lastSentAt"] where existing[key] != .null {
                    next.set(key, existing[key])
                }
                store.set("weeklyReport", next); stores["api/timesheet"] = store
                return .object(["ok": .bool(true), "config": next])
            }
            if method == "GET" {
                stores["api/timesheet"] = store; return .object(["config": existing])
            }
        }
        let supplied = method == "GET" ? request.query["end"].flatMap { $0.isEmpty ? nil : $0 } : body.flatMap { $0.object.keys.contains("end") ? $0["end"].string : nil }
        let end: String
        if let supplied {
            guard NativeTimesheetReport.date(supplied) != nil else { throw VaultError.server("end must be YYYY-MM-DD") }; end = supplied
        } else {
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
            let settings = stores["api/settings"] ?? NativeProviderDemo.settings
            formatter.timeZone = TimeZone(identifier: existing["timezone"].string.isEmpty ? settings["weather"]["timezone"].string : existing["timezone"].string) ?? TimeZone(secondsFromGMT: 0)
            end = formatter.string(from: now)
        }
        let report = try preview(store: store, config: existing, end: end)
        if path == "api/timesheet/weekly-report/preview", method == "GET" {
            return report
        }
        if path == "api/timesheet/weekly-report/send", method == "POST" {
            guard !existing["to"].string.isEmpty else { throw VaultError.server("No recipient configured") }
            var config = existing; config.set("lastSentWeek", .string(end)); config.set("lastSentAt", .string(now.ISO8601Format()))
            store.set("weeklyReport", config); stores["api/timesheet"] = store
            return .object(["ok": .bool(true), "weekEnd": .string(end), "rowCount": .number(Double(report["rows"].array.count)), "totalMinutes": report["totalMinutes"], "sentTo": existing["to"], "demo": .bool(true)])
        }
        return nil
    }
}
