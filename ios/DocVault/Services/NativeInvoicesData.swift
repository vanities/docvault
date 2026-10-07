import Foundation

extension VaultModel {
    func createNativeInvoice(selection: NativeInvoiceSelection, draft: NativeInvoiceDraft) async throws -> VaultValue {
        let client = api, wasDemo = demo
        let invoice = try await NativeInvoices.create(selection: selection, draft: draft, fetch: {
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.nativeRequest("api/timesheet", scope: .init())
        }, write: { body in
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.nativeRequest("api/timesheet/invoices", scope: .init(), method: "POST", body: body)
        })
        guard connected, api === client, demo == wasDemo else { throw CancellationError() }
        revision += 1; return invoice
    }

    func nativeInvoiceEmailReview(id: String) async throws -> NativeInvoiceEmailReview {
        let client = api, wasDemo = demo
        return try await NativeInvoices.review(id: id) { path in
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            let result = try await self.nativeRequest(path, scope: .init())
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return result
        }
    }

    func sendNativeInvoice(_ review: NativeInvoiceEmailReview) async throws -> VaultValue {
        let client = api, wasDemo = demo
        let result = try await NativeInvoices.send(review: review, fetch: {
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.nativeInvoiceEmailReview(id: review.invoice["id"].string)
        }, write: { body in
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.nativeRequest("api/timesheet/invoices/{id}/send", scope: .init(), record: review.invoice, method: "POST", body: body)
        })
        guard connected, api === client, demo == wasDemo else { throw CancellationError() }
        revision += 1; return result
    }

    func changeNativeInvoice(_ invoice: VaultValue, body: VaultValue?) async throws -> VaultValue {
        let client = api, wasDemo = demo
        let result = try await NativeInvoices.update(original: invoice, body: body, fetch: {
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.nativeRequest("api/timesheet", scope: .init())
        }, write: { value in
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            return try await self.nativeRequest("api/timesheet/invoices/{id}", scope: .init(), record: invoice, method: value == nil ? "DELETE" : "PUT", body: value)
        })
        guard connected, api === client, demo == wasDemo else { throw CancellationError() }
        revision += 1; return result
    }

    func fileNativeInvoice(_ invoice: VaultValue, filing: NativeInvoiceFiling, parse: Bool) async -> NativeInvoiceFiling {
        let client = api, wasDemo = demo
        var outcome = filing
        await outcome.run(parse: parse, upload: {
            guard NativeTimesheetReport.date(invoice["issueDate"].string) != nil else { throw VaultError.server("This invoice has no valid issue date. Review the record before filing.") }
            guard self.connected, self.api === client, self.demo == wasDemo, self.entities.contains(where: { $0.id == filing.entity && $0.isTax }) else { throw CancellationError() }
            let store = try await self.nativeRequest("api/timesheet", scope: .init())
            guard try NativeInvoices.invoice(store, id: invoice["id"].string) == invoice else { throw VaultError.server("This invoice changed. Reload before filing.") }
            let url = try await self.nativeDownload("api/timesheet/invoices/{id}/pdf", scope: .init(), record: invoice, method: "GET", body: nil, suffix: "pdf")
            defer { Self.removePreview(url) }
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            let draft = try UploadDraft.stage(url).withContentType("application/pdf")
            defer { draft.removeStagedFiles() }
            return try await self.upload(draft, entity: filing.entity, folder: filing.year + "/income/other", name: NativeInvoices.filingName(invoice))
        }, extract: { path in
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            let parsed = try await self.extractImportedDocument(entity: filing.entity, path: path, year: Int(filing.year) ?? 0)
            guard self.connected, self.api === client, self.demo == wasDemo else { throw CancellationError() }
            if wasDemo {
                try await self.saveImportedParse(entity: filing.entity, path: path, parsed: parsed)
            }
            return parsed
        })
        return outcome
    }
}
