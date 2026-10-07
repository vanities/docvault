@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeInvoicesTests {
    private func json(_ value: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(value.utf8))
    }

    private func draft() -> NativeInvoiceDraft {
        var value = NativeInvoiceDraft(); value.clientId = "acme-client"; return value
    }

    private func store() throws -> VaultValue {
        var value = NativeTimesheetReportDemo.seed
        value.set("clients", try json(#"[{"id":"acme-client","name":"Acme Client","currency":"USD","email":"billing@example.com","defaultTemplateId":"archived","dueDays":7,"archived":false},{"id":"other-client","name":"Other Acme","currency":"EUR","archived":false}]"#))
        var projects = value["projects"].array; projects[0].set("minimumInvoice", .number(500)); projects[0].set("emailSubject", .string("Invoice {{ number }} · {{month}}")); projects[0].set("emailBody", .string("Literal\n\n{{hours}} hours for {{client}} · {{unknown}}")); value.set("projects", .array(projects))
        value.set("templates", try json(#"[{"id":"active","name":"Active","company":"Acme Studio","title":"Invoice","address":[],"contact":[],"paymentTerms":"Pay within terms","paymentDetails":[],"vat":0,"dueDays":14,"archived":false},{"id":"archived","name":"Archived default","company":"Acme Archives","title":"Invoice","address":[],"contact":[],"paymentTerms":"Pay within terms","paymentDetails":[],"vat":10,"dueDays":30,"archived":true}]"#))
        let invoice = try json(#"{"id":"early","number":"2026/001","clientId":"acme-client","clientName":"Acme Client","issueDate":"2026-10-02","dueDate":"2026-10-09","status":"paid","currency":"USD","totalMinutes":60,"subtotal":100,"tax":0,"vat":0,"total":100,"lines":[{"date":"2026-09-29","minutes":60,"amount":100},{"date":"2026-10-02","minutes":0,"amount":50}],"entryIds":["billed"],"projectIds":["acme-project"],"createdAt":"2026-10-02T00:00:00Z"}"#)
        value.set("invoices", .array([invoice]))
        var billed = value["entries"].array[0]; billed.set("id", .string("billed")); billed.set("date", .string("2026-10-02")); billed.set("invoiced", .bool(true)); billed.set("invoiceId", .string("early")); value.set("entries", .array(value["entries"].array + [billed]))
        return value
    }

    private func selection() throws -> NativeInvoiceSelection {
        try .init(store: store(), draft: draft())
    }

    @Test func selectionExcludesOtherClientsNonBillableAndBilledEntriesAndAppliesRetainerTax() throws {
        let value = try selection()
        #expect(value.entries.count == 4 && value.minutes == 195 && value.amount == 300)
        #expect(value.deficit == 200 && value.subtotal == 500 && value.tax == 50 && value.total == 550)
        #expect(value.template["id"].string == "archived")
        #expect(value.period["from"].string == "2026-10-01" && value.period["to"].string == "2026-10-31")
        #expect(value.billed.count == 1 && value.billed[0]["number"].string == "2026/001" && value.billed[0]["count"].number == 1)
        #expect(Set(value.body["entryIds"].array) == Set(value.entries.map { $0["id"] }))
        #expect(!value.body["entryIds"].array.contains(.string("billed")))
    }

    @Test func explicitWindowsTemplateSelectionAndMissingLegacyInvoiceGroupsMatchBillingScope() throws {
        var store = try store(), draft = draft(); draft.from = "2026-10-01"; draft.to = "2026-10-03"; draft.templateId = "active"
        var entries = store["entries"].array; var legacy = try #require(entries.last); legacy.set("id", .string("legacy")); legacy.remove("invoiceId"); entries.append(legacy); store.set("entries", .array(entries))
        let value = try NativeInvoiceSelection(store: store, draft: draft)
        #expect(value.entries.count == 1 && value.amount == 0 && value.subtotal == 500 && value.tax == 0)
        #expect(value.billed.count == 2 && value.billed.contains { $0["invoiceId"] == .null && $0["count"].number == 1 })
        draft.from = "2026-11-01"; draft.to = "2026-11-30"
        #expect(try NativeInvoiceSelection(store: store, draft: draft).entries.isEmpty)
        draft.from = ""; draft.to = ""; draft.clientId = "other-client"; draft.projectId = "other-project"
        let other = try NativeInvoiceSelection(store: store, draft: draft)
        #expect(other.entries.count == 1 && other.total == 150 && other.client["currency"].string == "EUR")
    }

    @Test func dateBoundsDraftFieldsAndMalformedBillingValuesAreRejected() throws {
        let store = try store(); var draft = draft()
        for day in ["2026-02-29", "2026-04-31", "2026-10-03T00:00:00Z"] {
            draft.from = day; #expect(throws: VaultError.self) { try draft.body(store: store) }
        }
        draft.from = "2026-10-05"; draft.to = "2026-10-04"; #expect(throws: VaultError.self) { try draft.body(store: store) }
        draft = self.draft(); draft.projectId = "other-project"; #expect(throws: VaultError.self) { try draft.body(store: store) }
        draft.projectId = ""; draft.templateId = "missing"; #expect(throws: VaultError.self) { try draft.body(store: store) }
        draft.templateId = ""; draft.number = " 2026/custom "; draft.comment = " \nLiteral, details\nSecond line "
        let body = try draft.body(store: store)
        #expect(body["number"].string == "2026/custom" && body["comment"].string == "Literal, details\nSecond line")
        for key in ["durationMinutes", "amount", "hourlyRate"] {
            var broken = store, entries = store["entries"].array; entries[0].set(key, .null); broken.set("entries", .array(entries))
            #expect(throws: VaultError.self) { try NativeInvoiceSelection(store: broken, draft: draft) }
        }
        var broken = store, entries = store["entries"].array; entries[0].set("invoiceId", .string("early")); broken.set("entries", .array(entries))
        #expect(throws: VaultError.self) { try NativeInvoiceSelection(store: broken, draft: draft) }
        #expect(NativeInvoices.monthEnd("2028-02-10") == "2028-02-29" && NativeInvoices.monthEnd("2100-02-10") == "2100-02-28")
        entries = store["entries"].array; entries[0].set("amount", .number(1e308)); broken.set("entries", .array(entries))
        #expect(throws: VaultError.self) { try NativeInvoiceSelection(store: broken, draft: draft) }
    }

    @Test func historyPreservesDuplicateRowsCurrencyZerosNegativeAndUnknownAmounts() throws {
        var store = try store(), invoices = store["invoices"].array
        var zero = invoices[0]; zero.set("id", .string("zero")); zero.set("status", .string("new")); zero.set("total", .number(0)); invoices.append(zero)
        var euro = zero; euro.set("id", .string("eur")); euro.set("currency", .string("EUR")); euro.set("total", .number(-20)); invoices.append(euro)
        var void = invoices[0]; void.set("status", .string("canceled")); void.set("total", .number(10000)); invoices.append(void)
        store.set("invoices", .array(invoices)); let history = try NativeInvoiceHistory(store)
        #expect(history.rows.count == 4 && Set(history.rows.map(\.id)).count == 4)
        let totals = NativeInvoiceHistory.totals(history.rows)
        #expect(totals.count == 2 && totals.first?["currency"].string == "EUR" && totals.first?["total"].number == -20)
        #expect(totals.last?["total"].number == 100 && totals.last?["open"].number == 0 && totals.last?["canceled"].number == 1)
        #expect(history.rows[0].workPeriod["from"].string == "2026-09-29" && history.rows[0].workPeriod["to"].string == "2026-09-29")
        #expect(NativeInvoiceHistory.monthly(history.rows, currency: "USD").first?.amount == 100)
        invoices[0].set("total", .null); store.set("invoices", .array(invoices)); let missing = try NativeInvoiceHistory(store)
        #expect(NativeInvoiceHistory.totals(missing.rows).last?["total"] == .null)
        #expect(NativeInvoiceHistory.monthly(missing.rows, currency: "USD").isEmpty)
        #expect(throws: VaultError.self) { try NativeInvoices.invoice(store, id: "early") }
    }

    @Test func historySearchFiltersAndSortKeepSavedProjectAndYearScope() throws {
        let history = try NativeInvoiceHistory(store())
        #expect(history.filtered(year: "2026", client: "acme-client", project: "acme-project", status: "paid", query: "2026/001", sort: "total", descending: true).count == 1)
        #expect(history.filtered(year: "2025", client: "", project: "", status: "", query: "", sort: "date", descending: false).isEmpty)
        #expect(history.filtered(year: "", client: "", project: "missing", status: "", query: "", sort: "number", descending: false).isEmpty)
        #expect(throws: VaultError.self) { try NativeInvoiceHistory(.object([:])) }
    }

    @Test func createRejectsChangedEntriesRatesDefaultsAndAlreadyBilledStatusBeforeWriting() async throws {
        let original = try store(), selection = try selection(); var writes = 0
        for key in ["amount", "description", "invoiced"] {
            var changed = original, entries = original["entries"].array; entries[0].set(key, key == "invoiced" ? .bool(true) : key == "amount" ? .number(12) : .string("Changed")); changed.set("entries", .array(entries))
            await #expect(throws: VaultError.self) { try await NativeInvoices.create(selection: selection, draft: draft(), fetch: { changed }, write: { _ in writes += 1; return .null }) }
        }
        var changed = original, clients = original["clients"].array; clients[0].set("dueDays", .number(3)); changed.set("clients", .array(clients))
        await #expect(throws: VaultError.self) { try await NativeInvoices.create(selection: selection, draft: draft(), fetch: { changed }, write: { _ in writes += 1; return .null }) }
        #expect(writes == 0)
        let invoice = try await NativeInvoices.create(selection: selection, draft: draft(), fetch: { original }, write: { body in writes += 1; #expect(body == selection.body); return .object(["ok": .bool(true), "invoice": try NativeInvoicesDemo.assembled(store: original, body: body, now: NativeTimesheetReport.date("2026-10-07")!)]) })
        #expect(writes == 1 && invoice["total"].number == 550 && invoice["entryIds"].array.count == 4)
        await #expect(throws: VaultError.self) { try await NativeInvoices.create(selection: selection, draft: draft(), fetch: { original }, write: { _ in .object(["ok": .bool(true), "invoice": .object([:])]) }) }
    }

    @Test func demoCreatePreviewStatusDeleteAndEntryLocksShareOneStore() throws {
        var stores = ["api/timesheet": try store()]; let day = try #require(NativeTimesheetReport.date("2026-10-07")), selection = try selection()
        let preview = try #require(try NativeInvoicesDemo.pdfInvoice(VaultRequest("api/timesheet/invoices/preview", scope: .init()), method: "POST", body: selection.body, stores: stores))
        #expect(preview["total"].number == 550 && stores["api/timesheet"]?["invoices"].array.count == 1)
        let created = try #require(NativeInvoicesDemo.request(VaultRequest("api/timesheet/invoices", scope: .init()), method: "POST", body: selection.body, stores: &stores, now: day))["invoice"]
        #expect(created["number"].string == "2026/002" && created["dueDate"].string == "2026-10-14")
        #expect(created["lines"].array.last?["minutes"].number == 0 && created["lines"].array.last?["amount"].number == 200)
        #expect(stores["api/timesheet"]?["entries"].array.filter { $0["invoiceId"] == created["id"] }.count == 4)
        let lockedEntry = "api/timesheet/entries/" + selection.entries[0]["id"].string
        #expect(throws: VaultError.self) { try NativeInvoicesDemo.request(VaultRequest(lockedEntry, scope: .init()), method: "DELETE", body: nil, stores: &stores) }
        #expect(throws: VaultError.self) { try NativeInvoicesDemo.request(VaultRequest(lockedEntry, scope: .init()), method: "PUT", body: .object(["durationMinutes": .number(999)]), stores: &stores) }
        #expect(try NativeInvoicesDemo.request(VaultRequest(lockedEntry, scope: .init()), method: "PUT", body: .object(["description": .string("Reviewed"), "durationMinutes": selection.entries[0]["durationMinutes"]]), stores: &stores) == nil)
        let path = "api/timesheet/invoices/" + created["id"].string
        _ = try NativeInvoicesDemo.request(VaultRequest(path, scope: .init()), method: "PUT", body: .object(["status": .string("canceled")]), stores: &stores)
        #expect(try NativeInvoiceSelection(store: try #require(stores["api/timesheet"]), draft: draft()).entries.isEmpty)
        let deleted = try #require(NativeInvoicesDemo.request(VaultRequest(path, scope: .init()), method: "DELETE", body: nil, stores: &stores))
        #expect(deleted["released"].number == 4 && stores["api/timesheet"]!["entries"].array.filter { $0["invoiced"].boolean }.count == 1)
        #expect(try NativeInvoiceSelection(store: try #require(stores["api/timesheet"]), draft: draft()).entries.count == 4)
    }

    @Test func emailDraftPreservesLiteralBodyUnknownVariablesAndExplicitBlankCc() throws {
        let store = try store(), invoice = try NativeInvoicesDemo.assembled(store: store, body: selection().body, now: try #require(NativeTimesheetReport.date("2026-10-07")))
        let value = NativeInvoicesDemo.emailDraft(store: store, invoice: invoice, settings: NativeProviderDemo.settings)
        var draft = try NativeInvoiceEmailDraft(value); #expect(draft.to == "billing@example.com" && draft.subject == "Invoice 2026/002 · October 2026")
        #expect(draft.text == "Literal\n\n3.25 hours for Acme Client · {{unknown}}")
        draft.cc = ""; draft.from = " sender@example.com "; draft.subject = " "
        let body = try draft.body(number: invoice["number"].string)
        #expect(body["cc"] == .string("") && body["from"].string == "sender@example.com" && body["subject"].string == "Invoice 2026/002" && body["body"].string == draft.text)
        draft.to = " "; #expect(throws: VaultError.self) { try draft.body(number: "x") }
        #expect(throws: VaultError.self) { try NativeInvoiceEmailDraft(.object([:])) }
    }

    @Test func emailReviewAndSendingRejectChangedInvoiceTemplateMailDefaultsAndSendStatus() async throws {
        var stores = ["api/timesheet": try store(), "api/settings": NativeProviderDemo.settings]
        let invoice = try #require(NativeInvoicesDemo.request(VaultRequest("api/timesheet/invoices", scope: .init()), method: "POST", body: selection().body, stores: &stores))["invoice"], id = invoice["id"].string
        let review = try await NativeInvoices.review(id: id) {
            path in if let saved = stores[path] {
                return saved
            }; return try #require(NativeInvoicesDemo.request(VaultRequest(path, scope: .init()), method: "GET", body: nil, stores: &stores))
        }
        var edited = review; edited.draft.to = "reviewed@example.com"; edited.draft.cc = ""; edited.draft.text = "Exact\n\nEdited message"; var writes = 0
        for key in ["invoice", "template", "defaults", "mail"] {
            var invoice = review.invoice, template = review.pdfTemplate, defaults = review.defaults, mail = review.mail
            if key == "invoice" {
                invoice.set("sentAt", .string("2026-10-07T13:00:00Z"))
            }; if key == "template" {
                template.set("company", .string("Changed"))
            }; if key == "defaults" {
                defaults.set("cc", .string("changed@example.com"))
            }; if key == "mail" {
                mail.set("fromEmail", .string("changed@example.com"))
            }
            let changed = NativeInvoiceEmailReview(invoice: invoice, pdfTemplate: template, defaults: defaults, mail: mail, draft: review.draft)
            await #expect(throws: VaultError.self) { try await NativeInvoices.send(review: edited, fetch: { changed }, write: { _ in writes += 1; return .null }) }
        }
        #expect(writes == 0)
        let result = try await NativeInvoices.send(review: edited, fetch: { review }, write: { body in writes += 1; #expect(body["cc"] == .string("") && body["body"].string == "Exact\n\nEdited message"); return try #require(NativeInvoicesDemo.request(VaultRequest("api/timesheet/invoices/\(id)/send", scope: .init()), method: "POST", body: body, stores: &stores)) })
        #expect(result["demo"].boolean && result["sentTo"].string == "reviewed@example.com" && writes == 1)
    }

    @Test func statusDateAndConcurrentUpdatesUseConfirmedResponsesAndRetainLocks() async throws {
        #expect(throws: VaultError.self) { try NativeInvoices.updateBody(status: "paid", paymentDate: "2026-02-29", comment: "") }
        #expect(try NativeInvoices.updateBody(status: "new", paymentDate: "", comment: " ")["comment"] == .string(""))
        var imported: VaultValue = .object(["status": .string("paid")])
        #expect(try NativeInvoices.editBody(original: imported, status: "paid", paymentDate: "2026-10-07", initialPaymentDay: "2026-10-07", comment: "Reviewed") == .object(["comment": .string("Reviewed")]))
        imported.set("paymentDate", .string("2026-10-05"))
        #expect(try NativeInvoices.editBody(original: imported, status: "paid", paymentDate: "2026-10-05", initialPaymentDay: "2026-10-05", comment: "Reviewed")["paymentDate"] == .null)
        #expect(try NativeInvoices.editBody(original: imported, status: "paid", paymentDate: "2026-10-06", initialPaymentDay: "2026-10-05", comment: "Reviewed")["paymentDate"].string == "2026-10-06")
        let store = try store(), original = store["invoices"].array[0]; var changed = store, invoices = store["invoices"].array; invoices[0].set("comment", .string("Other edit")); changed.set("invoices", .array(invoices)); var writes = 0
        await #expect(throws: VaultError.self) { try await NativeInvoices.update(original: original, body: .object(["status": .string("new")]), fetch: { changed }, write: { _ in writes += 1; return .null }) }
        #expect(writes == 0)
        await #expect(throws: VaultError.self) { try await NativeInvoices.update(original: original, body: nil, fetch: { store }, write: { _ in .object(["ok": .bool(true)]) }) }
    }

    @Test func filingRetryRetainsTheCollisionPathAndNeverUploadsAnotherPdf() async throws {
        var state = NativeInvoiceFiling(entity: "acme", year: "2026"), uploads = 0, parses = 0
        await state.run(parse: true, upload: { uploads += 1; return "2026/income/other/Acme_Invoice_2026-10-07_2.pdf" }, extract: { _ in parses += 1; throw VaultError.server("Synthetic parse failed") })
        #expect(state.path?.hasSuffix("_2.pdf") == true && state.error != nil && !state.parsed && uploads == 1 && parses == 1)
        await state.run(parse: true, upload: { uploads += 1; return "duplicate" }, extract: { path in parses += 1; #expect(path.hasSuffix("_2.pdf")); return .object(["amount": .number(0)]) })
        #expect(state.complete && state.parsed && uploads == 1 && parses == 2)
        await state.run(parse: true, upload: { uploads += 1; return "duplicate" }, extract: { _ in parses += 1; return .null })
        #expect(uploads == 1 && parses == 2)
        #expect(NativeInvoices.filingName(try store()["invoices"].array[0]) == "AcmeClient_Invoice_2026-10-02.pdf")
    }
}
