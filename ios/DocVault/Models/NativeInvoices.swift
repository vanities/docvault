import Foundation

struct NativeInvoiceRow: Identifiable, Hashable, Sendable {
    let id: Int
    let value: VaultValue
    var currency: String {
        value["currency"].string.isEmpty ? "Unspecified currency" : value["currency"].string
    }

    var status: String {
        value["status"].string
    }

    var total: Double? {
        NativeFinance.number(value["total"])
    }

    var workPeriod: VaultValue {
        let dates = value["lines"].array.filter { (NativeFinance.number($0["minutes"]) ?? 0) > 0 }.map { $0["date"].string }.filter { NativeTimesheetReport.date($0) != nil }.sorted()
        guard let first = dates.first, let last = dates.last else { return .null }
        return .object(["from": .string(first), "to": .string(last)])
    }
}

struct NativeInvoiceHistory: Sendable {
    let rows: [NativeInvoiceRow]
    init(_ store: VaultValue) throws {
        try NativeInvoices.validateStore(store)
        rows = store["invoices"].array.enumerated().map { .init(id: $0.offset, value: $0.element) }
    }

    func filtered(year: String, client: String, project: String, status: String, query: String, sort: String, descending: Bool) -> [NativeInvoiceRow] {
        rows.filter { row in
            (year.isEmpty || row.value["issueDate"].string.hasPrefix(year + "-")) && (client.isEmpty || row.value["clientId"].string == client) && (project.isEmpty || row.value["projectIds"].array.contains(.string(project))) && (status.isEmpty || row.status == status) && (query.isEmpty || row.value.stringSearch.localizedCaseInsensitiveContains(query))
        }.sorted { a, b in
            let order: Bool
            if sort == "total" {
                // Currency groups are ordered by code, never compared as equivalent money.
                if a.currency != b.currency {
                    return a.currency < b.currency
                }
                if a.total == nil || b.total == nil {
                    if a.total != b.total {
                        return a.total != nil
                    }
                } else if a.total != b.total {
                    return descending ? a.total! > b.total! : a.total! < b.total!
                }
                return a.id < b.id
            } else if sort == "number", a.value["number"] != b.value["number"] {
                order = a.value["number"].string < b.value["number"].string
            } else if a.value["issueDate"] != b.value["issueDate"] {
                order = a.value["issueDate"].string < b.value["issueDate"].string
            } else if a.value["createdAt"] != b.value["createdAt"] {
                order = a.value["createdAt"].string < b.value["createdAt"].string
            } else {
                return a.id < b.id
            }
            return descending ? !order : order
        }
    }

    static func totals(_ rows: [NativeInvoiceRow]) -> [VaultValue] {
        Dictionary(grouping: rows, by: \.currency).keys.sorted().map { currency in
            let selected = rows.filter { $0.currency == currency }, billed = selected.filter { $0.status != "canceled" }
            return .object(["currency": .string(currency), "count": .number(Double(selected.count)), "canceled": .number(Double(selected.count - billed.count)), "total": NativeTimesheetReport.sum(billed.map(\.total)).map(VaultValue.number) ?? .null, "open": NativeTimesheetReport.sum(billed.filter { $0.status == "new" }.map(\.total)).map(VaultValue.number) ?? .null, "minutes": NativeTimesheetReport.sum(billed.map { NativeTimesheetReport.nonnegative($0.value["totalMinutes"]) }).map(VaultValue.number) ?? .null])
        }
    }

    static func monthly(_ rows: [NativeInvoiceRow], currency: String) -> [TaxYearAmount] {
        let selected = rows.filter { $0.currency == currency && $0.status != "canceled" && NativeTimesheetReport.date($0.value["issueDate"].string) != nil }
        return Dictionary(grouping: selected, by: { String($0.value["issueDate"].string.prefix(7)) }).compactMap { month, items in
            NativeTimesheetReport.sum(items.map(\.total)).map { .init(label: month, amount: $0) }
        }.sorted { $0.label < $1.label }
    }
}

struct NativeInvoiceDraft: Hashable, Sendable {
    var clientId = ""
    var projectId = ""
    var from = ""
    var to = ""
    var templateId = ""
    var number = ""
    var comment = ""
    func body(store: VaultValue) throws -> VaultValue {
        try NativeInvoices.validateStore(store)
        guard store["clients"].array.contains(where: { $0["id"].string == clientId }), !clientId.isEmpty else { throw VaultError.server("Choose an available client.") }
        guard projectId.isEmpty || store["projects"].array.contains(where: { $0["id"].string == projectId && $0["clientId"].string == clientId }) else { throw VaultError.server("Choose a project belonging to this client.") }
        guard from.isEmpty || NativeTimesheetReport.date(from) != nil, to.isEmpty || NativeTimesheetReport.date(to) != nil, from.isEmpty || to.isEmpty || from <= to else { throw VaultError.server("Choose a valid work window in YYYY-MM-DD order.") }
        guard templateId.isEmpty || store["templates"].array.contains(where: { $0["id"].string == templateId }) else { throw VaultError.server("The selected invoice template is unavailable.") }
        var body: VaultValue = .object(["clientId": .string(clientId)])
        for (key, value) in [("projectId", projectId), ("from", from), ("to", to), ("templateId", templateId), ("number", number.trimmingCharacters(in: .whitespacesAndNewlines)), ("comment", comment.trimmingCharacters(in: .whitespacesAndNewlines))] where !value.isEmpty {
            body.set(key, .string(value))
        }
        return body
    }
}

struct NativeInvoiceSelection: Hashable, Sendable {
    let body: VaultValue
    let client: VaultValue
    let template: VaultValue
    let entries: [VaultValue]
    let projects: [VaultValue]
    let billed: [VaultValue]
    let period: VaultValue
    let minutes: Double
    let amount: Double
    let deficit: Double
    let subtotal: Double
    let tax: Double
    var total: Double {
        NativeInvoices.round2(subtotal + tax)
    }

    var fingerprint: VaultValue {
        .object(["body": body, "client": client, "template": template, "entries": .array(entries), "projects": .array(projects), "billed": .array(billed), "period": period])
    }

    init(store: VaultValue, draft: NativeInvoiceDraft) throws {
        var body = try draft.body(store: store)
        client = store["clients"].array.first { $0["id"].string == draft.clientId }!
        let allProjects = store["projects"].array
        func inScope(_ entry: VaultValue) -> Bool {
            allProjects.first { $0["id"] == entry["projectId"] }?["clientId"].string == draft.clientId && (draft.projectId.isEmpty || entry["projectId"].string == draft.projectId)
        }
        let candidates = store["entries"].array.filter { inScope($0) && !$0["invoiced"].boolean && $0["billable"].boolean && (draft.from.isEmpty || $0["date"].string >= draft.from) && (draft.to.isEmpty || $0["date"].string <= draft.to) }.sorted {
            if $0["date"] != $1["date"] {
                return $0["date"].string < $1["date"].string
            }
            return ($0["start"] == .null ? "99:99" : $0["start"].string) < ($1["start"] == .null ? "99:99" : $1["start"].string)
        }
        var ids = Set<String>()
        for entry in candidates {
            guard !entry["id"].string.isEmpty, ids.insert(entry["id"].string).inserted, NativeTimesheetReport.date(entry["date"].string) != nil, NativeTimesheetReport.nonnegative(entry["durationMinutes"]) != nil, NativeFinance.number(entry["amount"]) != nil, NativeFinance.number(entry["hourlyRate"]) != nil, !store["invoices"].array.contains(where: { $0["id"] == entry["invoiceId"] }) else { throw VaultError.server("A selected entry has incomplete billing values or an existing invoice link. Review it before billing.") }
        }
        entries = candidates
        body.set("entryIds", .array(entries.map { $0["id"] })); self.body = body
        template = NativeInvoices.template(store: store, body: body, client: client)
        var seen = Set<String>()
        projects = entries.map { $0["projectId"].string }.filter { seen.insert($0).inserted }.compactMap { id in allProjects.first { $0["id"].string == id } }
        minutes = entries.reduce(0) { $0 + $1["durationMinutes"].number! }
        amount = entries.reduce(0) { $0 + $1["amount"].number! }
        var rawDeficit = 0.0, runningSubtotal = NativeInvoices.round2(amount)
        for project in projects {
            let minimum = NativeFinance.number(project["minimumInvoice"]) ?? 0
            let amount = entries.filter { $0["projectId"] == project["id"] }.reduce(0) { $0 + $1["amount"].number! }
            if minimum > 0, amount < minimum {
                rawDeficit += minimum - amount; runningSubtotal = NativeInvoices.round2(runningSubtotal + NativeInvoices.round2(minimum - amount))
            }
        }
        deficit = rawDeficit; subtotal = runningSubtotal
        tax = NativeInvoices.round2(subtotal * ((NativeFinance.number(template["vat"]) ?? 0) / 100))
        guard minutes.isFinite, amount.isFinite, deficit.isFinite, subtotal.isFinite, tax.isFinite, NativeInvoices.round2(subtotal + tax).isFinite else { throw VaultError.server("The selected billing totals exceed the supported range. Review the source values.") }
        let first = entries.first?["date"].string ?? "", last = entries.last?["date"].string ?? ""
        let start = draft.from.isEmpty ? (first.isEmpty ? "" : String(first.prefix(7)) + "-01") : draft.from
        let end = draft.to.isEmpty ? NativeInvoices.monthEnd(last) : draft.to
        period = start.isEmpty || end.isEmpty ? .null : .object(["from": .string(start), "to": .string(end)])
        var groups: [String: VaultValue] = [:]
        if !period.isEmpty {
            for entry in store["entries"].array where entry["invoiced"].boolean && inScope(entry) && entry["date"].string >= start && entry["date"].string <= end {
                let invoice = store["invoices"].array.first { $0["id"] == entry["invoiceId"] }, key = invoice?["id"].string ?? ""
                var group = groups[key] ?? .object(["invoiceId": invoice?["id"] ?? .null, "number": invoice?["number"] ?? .null, "status": invoice?["status"] ?? .null, "count": .number(0), "minutes": .number(0), "firstDate": entry["date"], "lastDate": entry["date"]])
                group.set("count", .number((group["count"].number ?? 0) + 1))
                group.set("minutes", NativeTimesheetReport.sum([NativeFinance.number(group["minutes"]), NativeTimesheetReport.nonnegative(entry["durationMinutes"])]).map(VaultValue.number) ?? .null)
                group.set("firstDate", .string(min(group["firstDate"].string, entry["date"].string))); group.set("lastDate", .string(max(group["lastDate"].string, entry["date"].string))); groups[key] = group
            }
        }
        billed = groups.values.sorted { a, b in a["lastDate"] == b["lastDate"] ? a["invoiceId"].string < b["invoiceId"].string : a["lastDate"].string > b["lastDate"].string }
    }
}

struct NativeInvoiceEmailDraft: Hashable, Sendable {
    var to: String
    var from: String
    var cc: String
    var subject: String
    var text: String
    let attachment: String
    init(_ value: VaultValue) throws {
        for key in ["to", "from", "cc", "subject", "body", "attachment"] {
            guard case .string = value[key] else { throw VaultError.invalidResponse }
        }
        to = value["to"].string; from = value["from"].string; cc = value["cc"].string; subject = value["subject"].string; text = value["body"].string; attachment = value["attachment"].string
    }

    func body(number: String) throws -> VaultValue {
        let recipient = to.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !recipient.isEmpty else { throw VaultError.server("Add an invoice recipient.") }
        let title = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        return .object(["to": .string(recipient), "from": .string(from.trimmingCharacters(in: .whitespacesAndNewlines)), "cc": .string(cc.trimmingCharacters(in: .whitespacesAndNewlines)), "subject": .string(title.isEmpty ? "Invoice " + number : title), "body": .string(text)])
    }
}

struct NativeInvoiceEmailReview: Identifiable, Hashable, Sendable {
    let id = UUID()
    let invoice: VaultValue
    let pdfTemplate: VaultValue
    let defaults: VaultValue
    let mail: VaultValue
    var draft: NativeInvoiceEmailDraft
    var sender: String {
        if !draft.from.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return draft.from.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let email = mail["fromEmail"].string, name = mail["fromName"].string
        return email.isEmpty ? "Configured server sender (not exposed)" : name.isEmpty ? email : name + " <" + email + ">"
    }

    var fingerprint: VaultValue {
        .object(["invoice": invoice, "pdfTemplate": pdfTemplate, "defaults": defaults, "mail": mail])
    }
}

enum NativeInvoices {
    static func validateStore(_ store: VaultValue) throws {
        for key in ["clients", "projects", "entries", "invoices", "templates"] {
            guard case .array = store[key] else { throw VaultError.invalidResponse }
        }
    }

    static func round2(_ number: Double) -> Double {
        floor(number * 100 + 0.5) / 100
    }

    static func monthEnd(_ value: String) -> String {
        guard let date = NativeTimesheetReport.date(value) else { return "" }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return String(value.prefix(7)) + "-" + String(format: "%02d", calendar.range(of: .day, in: .month, for: date)!.count)
    }

    static func template(store: VaultValue, body: VaultValue, client: VaultValue) -> VaultValue {
        let templates = store["templates"].array
        return templates.first { $0["id"] == body["templateId"] } ?? templates.first { $0["id"] == client["defaultTemplateId"] } ?? templates.first { !$0["archived"].boolean } ?? .null
    }

    static func storedTemplate(store: VaultValue, invoice: VaultValue) -> VaultValue {
        invoice["templateId"].string.isEmpty ? store["templates"].array.first { !$0["archived"].boolean } ?? .null : store["templates"].array.first { $0["id"] == invoice["templateId"] } ?? .null
    }

    static func invoice(_ store: VaultValue, id: String) throws -> VaultValue {
        try validateStore(store)
        let rows = store["invoices"].array.filter { $0["id"].string == id }
        guard !id.isEmpty, rows.count == 1 else { throw VaultError.server("This invoice is unavailable or ambiguous. Reload history.") }
        return rows[0]
    }

    @MainActor static func create(selection: NativeInvoiceSelection, draft: NativeInvoiceDraft, fetch: () async throws -> VaultValue, write: (VaultValue) async throws -> VaultValue) async throws -> VaultValue {
        guard !selection.entries.isEmpty else { throw VaultError.server("There are no open billable entries in this selection.") }
        let fresh = try NativeInvoiceSelection(store: await fetch(), draft: draft)
        guard fresh.fingerprint == selection.fingerprint else { throw VaultError.server("The selected work, billing defaults or prior invoices changed. Reload and review before creating.") }
        let result = try await write(selection.body); try NativeProviderSettings.requireSaved(result)
        let invoice = result["invoice"]
        guard !invoice["id"].string.isEmpty, invoice["clientId"] == selection.client["id"], Set(invoice["entryIds"].array) == Set(selection.entries.map { $0["id"] }), invoice["entryIds"].array.count == selection.entries.count else { throw VaultError.invalidResponse }
        return invoice
    }

    @MainActor static func review(id: String, request: (String) async throws -> VaultValue) async throws -> NativeInvoiceEmailReview {
        let store = try await request("api/timesheet"), invoice = try invoice(store, id: id), template = storedTemplate(store: store, invoice: invoice)
        let defaults = try await request("api/timesheet/invoices/\(id)/email-draft"), draft = try NativeInvoiceEmailDraft(defaults), mail = NativeTimesheetReport.mailReview(try await request("api/settings"))
        let fresh = try await request("api/timesheet")
        guard try self.invoice(fresh, id: id) == invoice, storedTemplate(store: fresh, invoice: invoice) == template else { throw VaultError.server("The invoice changed while preparing email. Reload the draft.") }
        return .init(invoice: invoice, pdfTemplate: template, defaults: defaults, mail: mail, draft: draft)
    }

    @MainActor static func send(review: NativeInvoiceEmailReview, fetch: () async throws -> NativeInvoiceEmailReview, write: (VaultValue) async throws -> VaultValue) async throws -> VaultValue {
        let body = try review.draft.body(number: review.invoice["number"].string), fresh = try await fetch()
        guard fresh.fingerprint == review.fingerprint else { throw VaultError.server("The invoice, email defaults or send status changed. Refresh the draft before sending.") }
        let result = try await write(body); try NativeProviderSettings.requireSaved(result)
        guard result["sentTo"] == body["to"], !result["sentAt"].string.isEmpty else { throw VaultError.invalidResponse }
        return result
    }

    static func updateBody(status: String, paymentDate: String, comment: String) throws -> VaultValue {
        guard ["new", "paid", "canceled"].contains(status), status != "paid" || NativeTimesheetReport.date(paymentDate) != nil else { throw VaultError.server("Choose a valid invoice status and payment date.") }
        var body: VaultValue = .object(["status": .string(status), "comment": .string(comment.trimmingCharacters(in: .whitespacesAndNewlines))])
        if status == "paid" {
            body.set("paymentDate", .string(paymentDate))
        }
        return body
    }

    static func editBody(original: VaultValue, status: String, paymentDate: String, initialPaymentDay: String, comment: String) throws -> VaultValue {
        guard ["new", "paid", "canceled"].contains(status) else { throw VaultError.server("Choose a valid invoice status.") }
        if status != original["status"].string || (status == "paid" && paymentDate != initialPaymentDay) {
            return try updateBody(status: status, paymentDate: paymentDate, comment: comment)
        }
        // Comment-only edits must not manufacture a payment date on imported paid records.
        return .object(["comment": .string(comment.trimmingCharacters(in: .whitespacesAndNewlines))])
    }

    @MainActor static func update(original: VaultValue, body: VaultValue?, fetch: () async throws -> VaultValue, write: (VaultValue?) async throws -> VaultValue) async throws -> VaultValue {
        let fresh = try invoice(await fetch(), id: original["id"].string)
        guard fresh == original else { throw VaultError.server("This invoice changed on the server. Reload before changing it.") }
        let result = try await write(body); try NativeProviderSettings.requireSaved(result)
        if body != nil {
            guard result["invoice"]["id"] == original["id"] else { throw VaultError.invalidResponse }
        } else {
            guard NativeTimesheetReport.nonnegative(result["released"]) != nil else { throw VaultError.invalidResponse }
        }
        return result
    }

    static func filingName(_ invoice: VaultValue) -> String {
        let source = invoice["clientName"].string.replacingOccurrences(of: "[^A-Za-z0-9_-]+", with: "", options: .regularExpression)
        return (source.isEmpty ? "Invoice" : source) + "_Invoice_" + invoice["issueDate"].string + ".pdf"
    }
}

struct NativeInvoiceFiling: Hashable, Sendable {
    let entity: String
    let year: String
    var path: String?
    var parsed = false
    var error: String?
    var complete: Bool {
        path != nil && error == nil
    }

    @MainActor mutating func run(parse: Bool, upload: () async throws -> String, extract: (String) async throws -> VaultValue) async {
        error = nil
        do {
            guard year.range(of: "^[0-9]{4}$", options: .regularExpression) != nil, !entity.isEmpty else { throw VaultError.server("Choose an entity and a four-digit year.") }
            if path == nil {
                path = try await upload()
            }
            guard let path, path.hasPrefix(year + "/"), !path.split(separator: "/").contains("..") else { throw VaultError.invalidResponse }
            try NativeDocumentOrganization.validatePath(path)
            if parse, !parsed {
                let response = try await extract(path)
                _ = try NativeDocumentImport.extracted(response)
                parsed = true
            }
        } catch { self.error = error.localizedDescription }
    }
}
