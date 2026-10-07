import Foundation

enum NativeInvoicesDemo {
    static func pdfInvoice(_ request: VaultRequest, method: String, body: VaultValue?, stores: [String: VaultValue]) throws -> VaultValue? {
        guard request.path.prefix(3) == ["api", "timesheet", "invoices"] else { return nil }
        let store = stores["api/timesheet"] ?? NativeTimesheetReportDemo.seed
        if request.path == ["api", "timesheet", "invoices", "preview"], method == "POST" {
            return try assembled(store: store, body: body ?? .null)
        }
        if request.path.count == 5, request.path[4] == "pdf", method == "GET" {
            return try NativeInvoices.invoice(store, id: request.path[3])
        }
        return nil
    }

    static func assembled(store: VaultValue, body: VaultValue, now: Date = .now) throws -> VaultValue {
        var draft = NativeInvoiceDraft(); draft.clientId = body["clientId"].string; draft.projectId = body["projectId"].string; draft.from = body["from"].string; draft.to = body["to"].string; draft.templateId = body["templateId"].string; draft.number = body["number"].string; draft.comment = body["comment"].string
        var scoped = store
        if case let .array(wanted) = body["entryIds"] {
            // Match the native reviewed create contract, including rejection of billed work.
            let selected = store["entries"].array.filter { wanted.contains($0["id"]) }
            guard selected.allSatisfy({ !$0["invoiced"].boolean && $0["billable"].boolean }), Set(selected.map { $0["id"] }) == Set(wanted) else { throw VaultError.server("Selected entries are unavailable or already billed.") }
            scoped.set("entries", .array(selected))
        }
        let selection = try NativeInvoiceSelection(store: scoped, draft: draft)
        guard !selection.entries.isEmpty else { throw VaultError.server("No entries to invoice") }
        let day = NativeQuant.day(now), year = String(day.prefix(4))
        let numbers = store["invoices"].array.compactMap { invoice -> Int? in
            let pieces = invoice["number"].string.split(separator: "/")
            guard pieces.count == 2, String(pieces[0]) == year else { return nil }; return Int(pieces[1])
        }
        let number = draft.number.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? year + "/" + String(format: "%03d", (numbers.max() ?? 0) + 1) : draft.number.trimmingCharacters(in: .whitespacesAndNewlines)
        let dueDays = selection.client["dueDays"].number ?? selection.template["dueDays"].number ?? 14
        var lines = selection.entries.map { entry in
            .object(["date": entry["date"], "description": entry["description"], "projectName": .string(selection.projects.first { $0["id"] == entry["projectId"] }?["name"].string ?? entry["projectId"].string), "minutes": entry["durationMinutes"], "hourlyRate": entry["hourlyRate"], "amount": entry["amount"]]) as VaultValue
        }
        for project in selection.projects {
            let amount = selection.entries.filter { $0["projectId"] == project["id"] }.reduce(0) { $0 + ($1["amount"].number ?? 0) }, minimum = project["minimumInvoice"].number ?? 0
            if minimum > 0, amount < minimum {
                lines.append(.object(["date": .string(day), "description": .string("Monthly minimum adjustment — " + project["name"].string), "projectName": .string(""), "minutes": .number(0), "hourlyRate": .number(0), "amount": .number(NativeInvoices.round2(minimum - amount))]))
            }
        }
        var invoice: VaultValue = .object(["id": .string(UUID().uuidString), "number": .string(number), "clientId": selection.client["id"], "clientName": selection.client["name"], "issueDate": .string(day), "dueDate": .string(NativeQuant.day(now.addingTimeInterval(dueDays * 86400))), "status": .string("new"), "currency": .string(selection.client["currency"].string.isEmpty ? "USD" : selection.client["currency"].string), "totalMinutes": .number(selection.minutes), "subtotal": .number(selection.subtotal), "vat": .number(selection.template["vat"].number ?? 0), "tax": .number(selection.tax), "total": .number(selection.total), "lines": .array(lines), "entryIds": .array(selection.entries.map { $0["id"] }), "projectIds": .array(selection.projects.map { $0["id"] }), "createdAt": .string(now.ISO8601Format())])
        if !selection.template.isEmpty {
            invoice.set("templateId", selection.template["id"])
        }
        if !draft.comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            invoice.set("comment", .string(draft.comment.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        return invoice
    }

    static func emailDraft(store: VaultValue, invoice: VaultValue, settings: VaultValue) -> VaultValue {
        let client = store["clients"].array.first { $0["id"] == invoice["clientId"] } ?? .null, template = NativeInvoices.storedTemplate(store: store, invoice: invoice)
        let projects = invoice["projectIds"].array.compactMap { id in store["projects"].array.first { $0["id"] == id } }
        let project = projects.first { project in
            ["emailTo", "emailFrom", "emailSubject", "emailBody"].contains { !project[$0].string.isEmpty }
        }
        let defaults = project ?? .null
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "MMMM yyyy"
        let issue = NativeTimesheetReport.date(invoice["issueDate"].string) ?? .now
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let monthDate = invoice["lines"].array.first.flatMap { NativeTimesheetReport.date($0["date"].string) } ?? calendar.date(byAdding: .month, value: -1, to: issue)!
        let money = NumberFormatter(); money.locale = Locale(identifier: "en_US"); money.numberStyle = .decimal; money.minimumFractionDigits = 2; money.maximumFractionDigits = 2
        let values = ["number": invoice["number"].string, "client": client["name"].string.isEmpty ? invoice["clientName"].string : client["name"].string, "project": projects.first?["name"].string ?? "", "company": template["company"].string, "total": "$" + (money.string(from: NSNumber(value: invoice["total"].number ?? 0)) ?? "0.00"), "hours": String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), (invoice["totalMinutes"].number ?? 0) / 60), "month": formatter.string(from: monthDate), "dueDate": invoice["dueDate"].string, "issueDate": invoice["issueDate"].string]
        func apply(_ value: String) -> String {
            let expression = try! NSRegularExpression(pattern: #"\{\{\s*(\w+)\s*\}\}"#)
            var result = value
            for match in expression.matches(in: value, range: NSRange(value.startIndex..., in: value)).reversed() {
                guard let range = Range(match.range, in: result), let keyRange = Range(match.range(at: 1), in: value), let replacement = values[String(value[keyRange])] else { continue }
                result.replaceSubrange(range, with: replacement)
            }
            return result
        }
        let to = apply(defaults["emailTo"].string)
        return .object(["to": .string(to.isEmpty ? client["email"].string : to), "from": .string(apply(defaults["emailFrom"].string)), "cc": .string(settings["email"]["cc"]["client"].string), "subject": .string(apply(defaults.object.keys.contains("emailSubject") ? defaults["emailSubject"].string : "Invoice {{number}} from {{company}}")), "body": .string(apply(defaults.object.keys.contains("emailBody") ? defaults["emailBody"].string : "Hi,\n\nPlease find attached invoice {{number}} for {{total}}, due {{dueDate}}.\n\nThank you!")), "attachment": .string("Invoice_" + invoice["number"].string.replacingOccurrences(of: "[^A-Za-z0-9_-]+", with: "-", options: .regularExpression) + ".pdf"), "sentAt": invoice["sentAt"], "sentTo": invoice["sentTo"], "placeholders": .array(["number", "client", "project", "total", "dueDate", "issueDate", "month", "hours", "company"].map(VaultValue.string))])
    }

    static func request(_ request: VaultRequest, method: String, body: VaultValue?, stores: inout [String: VaultValue], now: Date = .now) throws -> VaultValue? {
        if request.path.count == 4, request.path.prefix(3) == ["api", "timesheet", "entries"], ["PUT", "DELETE"].contains(method) {
            let store = stores["api/timesheet"] ?? NativeTimesheetReportDemo.seed
            if let entry = store["entries"].array.first(where: { $0["id"].string == request.path[3] }), let invoice = store["invoices"].array.first(where: { $0["id"] == entry["invoiceId"] }) {
                let keys = ["projectId", "date", "start", "end", "durationMinutes", "hourlyRate", "billable", "invoiced", "invoiceId"]
                guard method != "DELETE", !keys.contains(where: { body?.object.keys.contains($0) == true && body?[$0] != entry[$0] }) else { throw VaultError.server("Entry is locked by invoice " + invoice["number"].string) }
            }
            return nil
        }
        guard request.path.count >= 3, request.path.prefix(3) == ["api", "timesheet", "invoices"] else { return nil }
        var store = stores["api/timesheet"] ?? NativeTimesheetReportDemo.seed
        if request.path.count == 3, method == "POST" {
            let invoice = try assembled(store: store, body: body ?? .null, now: now)
            guard !store["invoices"].array.contains(where: { $0["number"] == invoice["number"] }) else { throw VaultError.server("This invoice number already exists.") }
            store.set("invoices", .array(store["invoices"].array + [invoice]))
            store.set("entries", .array(store["entries"].array.map { row in
                var entry = row
                if invoice["entryIds"].array.contains(entry["id"]) {
                    entry.set("invoiced", .bool(true)); entry.set("invoiceId", invoice["id"]); entry.set("invoicedAt", .string(now.ISO8601Format()))
                }
                return entry
            }))
            stores["api/timesheet"] = store; return .object(["ok": .bool(true), "invoice": invoice])
        }
        guard request.path.count >= 4 else { return nil }
        let invoice = try NativeInvoices.invoice(store, id: request.path[3])
        if request.path.count == 5, request.path[4] == "email-draft", method == "GET" {
            return emailDraft(store: store, invoice: invoice, settings: stores["api/settings"] ?? NativeProviderDemo.settings)
        }
        var updated = invoice
        if request.path.count == 5, request.path[4] == "send", method == "POST" {
            guard let body, !body["to"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw VaultError.server("Missing recipient") }
            updated.set("sentAt", .string(now.ISO8601Format())); updated.set("sentTo", .string(body["to"].string.trimmingCharacters(in: .whitespacesAndNewlines)))
        } else if request.path.count == 4, method == "PUT" {
            if let body, body["status"] != .null {
                guard ["new", "paid", "canceled"].contains(body["status"].string) else { throw VaultError.server("Invalid status") }; updated.set("status", body["status"])
                if body["status"].string == "paid" {
                    updated.set("paymentDate", .string(body["paymentDate"].string.isEmpty ? NativeQuant.day(now) : body["paymentDate"].string))
                } else {
                    updated.remove("paymentDate")
                }
            }
            if let body, body["comment"] != .null {
                if body["comment"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    updated.remove("comment")
                } else {
                    updated.set("comment", .string(body["comment"].string.trimmingCharacters(in: .whitespacesAndNewlines)))
                }
            }
        } else if request.path.count == 4, method == "DELETE" {
            let released = store["entries"].array.filter { $0["invoiceId"] == invoice["id"] }.count
            store.set("entries", .array(store["entries"].array.map {
                row in var entry = row; if entry["invoiceId"] == invoice["id"] {
                    entry.set("invoiced", .bool(false)); entry.remove("invoiceId"); entry.remove("invoicedAt")
                }; return entry
            }))
            store.set("invoices", .array(store["invoices"].array.filter { $0["id"] != invoice["id"] })); stores["api/timesheet"] = store
            return .object(["ok": .bool(true), "released": .number(Double(released))])
        } else {
            return nil
        }
        store.set("invoices", .array(store["invoices"].array.map { $0["id"] == invoice["id"] ? updated : $0 })); stores["api/timesheet"] = store
        return request.path.count == 5 ? .object(["ok": .bool(true), "sentTo": updated["sentTo"], "sentAt": updated["sentAt"], "demo": .bool(true)]) : .object(["ok": .bool(true), "invoice": updated])
    }
}
