@testable import DocVault
import Foundation
import Testing

@Suite("Native feature coverage", .serialized) @MainActor struct NativeFeatureTests {
    @Test func everyWebNavigationAreaHasANativeEntry() {
        let ids: Set = [
            "portfolio", "banks", "brokers", "crypto", "gold", "property", "income", "debts",
            "strategy", "quant", "tax-year", "business-docs", "all-files", "tn-tax", "solo-401k",
            "estimated-tax", "federal-tax", "sales", "mileage", "timesheet", "calendar", "health",
            "health-activity", "health-heart", "health-sleep", "health-workouts", "health-body",
            "health-records", "health-dna", "health-nutrition", "health-sickness",
            "health-analysis", "health-research", "deep-research", "daily-news", "tech",
            "local-news", "politics", "predictions", "chat", "chat-history", "external-sources",
            "settings",
        ]
        #expect(Set(NativeCatalog.features.map(\.id)) == ids)
        #expect(NativeCatalog.features.count == ids.count)
        for feature in NativeCatalog.features {
            #expect(!feature.resources.isEmpty)
            #expect(Set(feature.resources.map(\.id)).count == feature.resources.count)
        }
    }

    @Test func templatesKeepPathsQueriesAndIdentifiersSeparate() throws {
        let request = try VaultRequest(
            "api/file/{entity}/{filePath}?filename={filename}", scope: .init(entity: "acme"),
            record: .object([
                "filePath": .string("2026 taxes/Acme #1.pdf"), "filename": .string("A & B.pdf"),
            ])
        )
        let url = try ServerAddress("https://vault.example.com").endpoint(
            request.path, query: request.query.map { .init(name: $0.key, value: $0.value) }
        )
        #expect(url.path == "/api/file/acme/2026 taxes/Acme #1.pdf")
        #expect(
            URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value
                == "A & B.pdf"
        )
        #expect(throws: (any Error).self) {
            try VaultRequest("api/health/{person}/dna", scope: .init())
        }
        #expect(throws: VaultError.invalidPath) {
            try ServerAddress("https://vault.example.com").endpoint(
                VaultRequest(
                    "api/file/{entity}/{filePath}", scope: .init(entity: "acme"),
                    record: .object(["filePath": .string("../private")])
                ).path
            )
        }
    }

    @Test(arguments: ["NaN", "inf", "1,234", "abc"])
    func rejectsInvalidNumbers(_ raw: String) {
        #expect(throws: (any Error).self) {
            try NativeForm.value(field: .init("amount", nil, .number), text: raw)
        }
    }

    @Test func validatesDatesTimesAndWholeNumbers() throws {
        #expect(throws: (any Error).self) {
            try NativeForm.value(field: .init("date", nil, .date), text: "2026-02-30")
        }
        #expect(throws: (any Error).self) {
            try NativeForm.value(field: .init("start", nil, .time), text: "24:00")
        }
        #expect(throws: (any Error).self) {
            try NativeForm.value(field: .init("minutes", nil, .integer), text: "1.5")
        }
        #expect(
            try NativeForm.value(field: .init("date", nil, .date), text: "2024-02-29")
                == .string("2024-02-29")
        )
        #expect(
            NativeForm.display(.number(1234.56), field: .init("amount", nil, .number)) == "1234.56"
        )
    }

    @Test func patchPreservesSecretsAndDistinguishesClearingFromUnchanged() throws {
        let fields: [NativeField] = [
            .init("description"), .init("subClientId", nil, .reference("subClients")),
            .init("apiKey", nil, .secret), .init("start", nil, .time),
        ]
        let original: VaultValue = .object([
            "description": .string("Old"), "subClientId": .string("division"),
            "start": .string("09:00"),
        ])
        let body = try NativeForm.body(
            fields: fields,
            values: ["description": "", "subClientId": "", "apiKey": "", "start": "09:00"],
            original: original, patch: true
        )
        #expect(body == .object(["description": .string(""), "subClientId": .null]))
        #expect(VaultValue.isSecret("authToken"))
        #expect(!VaultValue.isSecret("hasApiKey"))
    }

    @Test func percentagesRoundTripAndNumericRouteValuesRemainUngrouped() throws {
        let field = NativeField("rate", "APR", .percentage)
        #expect(try NativeForm.value(field: field, text: "5.5") == .number(0.055))
        #expect(NativeForm.display(.number(0.055), field: field) == "5.5")
        #expect(
            try VaultRequest(
                "api/federal-tax/{year}", scope: .init(), record: .object(["year": .number(2026)])
            ).path.last == "2026"
        )
    }

    @Test func nestedSettingsChangesPreserveProviderAndSiblingFields() throws {
        let original: VaultValue = .object([
            "modelRouting": .object([
                "parsing": .object([
                    "provider": .string("anthropic"), "model": .string("synthetic-old"),
                    "effort": .string("high"),
                ]),
            ]),
        ])
        let field = NativeField("modelRouting.parsing.model")
        let body = try NativeForm.body(
            fields: [field], values: [field.id: "synthetic-new"], original: original, patch: true
        )
        #expect(body.at("modelRouting.parsing.provider") == .string("anthropic"))
        #expect(body.at("modelRouting.parsing.effort") == .string("high"))
        #expect(body.at("modelRouting.parsing.model") == .string("synthetic-new"))
    }

    @Test func structuredListsRetainServerIdsAndRejectInvalidRows() throws {
        let field = NativeField(
            "subClients", nil,
            .records([.init("name", required: true), .init("archived", nil, .boolean)])
        )
        let rows = try NativeForm.value(
            field: field, text: #"[{"id":"division","name":"Acme Division","archived":false}]"#
        )
        #expect(rows?.array.first?["id"] == .string("division"))
        #expect(throws: (any Error).self) {
            try NativeForm.value(field: field, text: #"[{"name":""}]"#)
        }
        #expect(throws: (any Error).self) { try NativeForm.value(field: field, text: #"["bad"]"#) }
    }

    @Test func unavailableHistoryDoesNotInventPerformance() throws {
        let date = try #require(ISO8601DateFormatter().date(from: "2026-03-31T12:00:00Z"))
        let rows: [VaultValue] = [
            .object(["date": .string("2026-02-28"), "totalValue": .number(100)]),
        ]
        #expect(
            NativePerformance.change(
                current: 125, date: date, months: 1, snapshots: rows, key: "totalValue"
            )
                == .init(dollars: 25, percent: 25)
        )
        #expect(
            NativePerformance.change(
                current: 125, date: date, days: 7, snapshots: rows, key: "totalValue"
            ) == nil
        )
        let zero: [VaultValue] = [
            .object(["date": .string("2026-03-30"), "totalValue": .number(0)]),
        ]
        #expect(
            NativePerformance.change(
                current: 125, date: date, days: 1, snapshots: zero, key: "totalValue"
            )?.percent
                == nil
        )
    }

    @Test func worksheetsMatchWebComputationAndHandleLimits() throws {
        let solo = try #require(NativeCalculators.solo(gross: 100_000, expenses: 20000, k1: 0, year: 2026))
        #expect(solo["employeeLimit"].number == 24500)
        #expect(solo["seTax"].number == 11304)
        #expect(solo["employerContribution"].number == 14870)
        #expect(NativeCalculators.solo(gross: 0, expenses: 0, k1: 0, year: 2030) == nil)
        #expect(
            NativeCalculators.solo(gross: 1_000_000, expenses: 0, k1: 0, year: 2026)?[
                "totalContribution"
            ].number == 72000
        )
        let tn = NativeCalculators.tennessee([
            "gross": 100_000, "expenses": 20000, "bankBalance": 600_000,
        ])
        #expect(tn["exciseTax"].number == 0)
        #expect(tn["franchiseTax"].number == 250)
        #expect(tn["balanceDue"].number == 550)
        let override = NativeCalculators.tennessee([
            "gross": 100_000, "expenses": 20000, "j2.8": 0, "e.1": 2500,
        ])
        #expect(override["exciseTax"].number == 1950)
        #expect(override["overpayment"].number == 150)
    }

    @Test func worksheetSourcesKeepBusinessExpensesSeparateAndDeduplicatePartnerships() throws {
        func jsonValue(_ text: String) throws -> VaultValue {
            try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
        }
        let all = try jsonValue(#"{"bankDeposits":{},"invoices":{"byEntity":{"acme":18000,"other-business":9000}},"income":{"items":[{"type":"K-1","source":"Demo Partnership","details":{"selfEmploymentEarnings":5000}},{"type":"K-1","source":"Demo Partnership","details":{"selfEmploymentEarnings":5000}},{"type":"K-1","source":"Second Demo Partnership","details":{"selfEmploymentEarnings":-1000}}]},"expenses":{"totalDeductible":99000}}"#)
        #expect(NativeWorksheet.soloEntity(all) == "acme")
        let selected = try jsonValue(#"{"bankDeposits":{"acme":{"totalRevenue":20000,"totalDeposits":25000}},"invoices":{"invoiceTotal":18000},"expenses":{"totalDeductible":2000}}"#)
        let defaults = NativeWorksheet.soloDefaults(all: all, selected: selected, entity: "acme", metadata: .object(["homeOfficeDeduction": .string("500")]))
        #expect(defaults == ["gross": 20000, "expenses": 2500, "k1": 4000])
        let solo = try #require(NativeCatalog.features.first { $0.id == "solo-401k" })
        let contributions = try #require(solo.resources.first { $0.id == "contributions" })
        #expect(contributions.path == "api/contributions/all/{year}")
        #expect(contributions.collections.first?.createPath == "api/contributions/all/{year}")
        #expect(NativeWorksheet.parse("$1,234.56") == 1234.56)
        #expect(NativeWorksheet.parse("not a number") == nil)
    }

    @Test func tennesseeDefaultsHonorTrackedExpensesAndYearEndStatements() throws {
        let files = try JSONDecoder().decode(VaultValue.self, from: Data(#"[{"name":"Acme_Invoice.pdf","path":"2026/income/Acme_Invoice.pdf","parsedData":{"amount":18000}},{"name":"AcmeBank_Statement_2026-12.pdf","path":"2026/statements/bank/AcmeBank_Statement_2026-12.pdf","parsedData":{"totalDeposits":25000,"endingBalance":6000}},{"name":"Acme_CreditCardStatement.pdf","path":"2026/statements/credit-card/Acme_CreditCardStatement.pdf","parsedData":{"endDate":"2026-12-31","newBalance":1000}},{"name":"Invoice.pdf","path":"2026/expenses/meals/Invoice.pdf","parsedData":{"amount":1000}},{"name":"Hidden_Receipt.pdf","path":"2026/expenses/software/Hidden_Receipt.pdf","tracked":false,"parsedData":{"amount":99000,"category":"software"}},{"name":"AcmeBank_Statement_2026-11.pdf","path":"2026/statements/bank/AcmeBank_Statement_2026-11.pdf","parsedData":{"endingBalance":99000}}]"#.utf8)).array
        let assets: VaultValue = .object(["assets": .array([.object(["value": .number(2000)])])])
        let defaults = NativeWorksheet.tennesseeDefaults(files: files, year: 2026, assets: assets)
        #expect(defaults == ["gross": 25000, "expenses": 500, "homeOffice": 1500, "bankBalance": 6000, "creditBalance": 1000, "assets": 2000])
        let schedules = NativeCalculators.tennesseeSchedules(["gross": 100_000, "j2.8": 0, "j.35": 50, "e.2a": 99999, "e.2b": 100])
        #expect(schedules["Schedule E"].object.first { $0.key.hasPrefix("Line 7 ") }?.value.number == 100)
        #expect(schedules["Schedule J"].object.first { $0.key.hasPrefix("Line 36 ") }?.value.number == 25000)
    }

    @Test func loanPayoffCapsFinalPaymentAndDetectsNegativeAmortization() {
        let free = NativeAmortization.calculate(balance: 1000, rate: 0, payment: 300)
        #expect(free.months == 4)
        #expect(free.rows.last?["payment"].number == 100)
        #expect(free.interest == 0)
        let base = NativeAmortization.calculate(balance: 10000, rate: 0.06, payment: 300)
        let extra = NativeAmortization.calculate(
            balance: 10000, rate: 0.06, payment: 300, extra: 100
        )
        #expect(extra.months < base.months)
        #expect(extra.interest < base.interest)
        #expect(NativeAmortization.calculate(balance: 10000, rate: 0.12, payment: 50).negative)
    }

    @Test func wholeListUpdatesPreserveOtherRowsAndDetectStaleEdits() async throws {
        let model = VaultModel()
        model.enterDemo()
        let resource = try #require(NativeCatalog.features.first { $0.id == "solo-401k" }?.resources.first {
            $0.id == "contributions"
        })
        let collection = resource.collections[0]
        let scope = VaultScope(entity: "personal", year: 2026)
        let data = try await model.nativeRequest(resource.path, scope: scope)
        let first = try #require(data["contributions"].array.first)
        try await model.nativeSaveList(
            collection: collection, resource: resource, scope: scope, original: .null,
            updated: .object([
                "date": .string("2026-10-06"), "amount": .number(100), "type": .string("employee"),
            ]), editing: false
        )
        var updated = first
        updated.set("amount", .number(200))
        try await model.nativeSaveList(
            collection: collection, resource: resource, scope: scope, original: first,
            updated: updated, editing: true
        )
        let after = try await model.nativeRequest(resource.path, scope: scope)
        #expect(after["contributions"].array.count == 2)
        await #expect(throws: (any Error).self) {
            try await model.nativeSaveList(
                collection: collection, resource: resource, scope: scope, original: first,
                updated: updated, editing: true
            )
        }
    }
}

extension VaultAPITests {
    @Test func downloadsRespectServerFilenameAndMediaType() async throws {
        let api = try client([
            json("synthetic", headers: ["Content-Disposition": "attachment; filename=\"../../Voice.m4a\"", "Content-Type": "audio/mp4"]),
            json("synthetic", headers: ["Content-Type": "image/png"]),
            json("synthetic", headers: ["Content-Disposition": "attachment; filename=", "Content-Type": "application/octet-stream"]),
        ], token: "synthetic-session")
        let request = try VaultRequest("api/download/demo", scope: .init())
        let (_, voice) = try await api.download(request, method: "GET", body: nil, fallback: "pdf")
        #expect(voice == "Voice.m4a")
        let (_, image) = try await api.download(request, method: "GET", body: nil, fallback: "pdf")
        #expect(image == "DocVault.png")
        let (_, unknown) = try await api.download(request, method: "GET", body: nil, fallback: "enc")
        #expect(unknown == "DocVault.enc")
    }

    @Test func batchParsingReadsEveryProgressEventAndFinalResult() throws {
        let result = try VaultAPI.decodeData(
            Data(
                "{\"type\":\"progress\",\"current\":1}\n{\"type\":\"complete\",\"parsed\":1,\"failed\":1}\n"
                    .utf8
            )
        )
        #expect(result["events"].array.count == 2)
        #expect(result["result"]["failed"].number == 1)
        #expect(throws: (any Error).self) { try VaultAPI.decodeData(Data("{}\ninvalid\n".utf8)) }
    }

    @Test func nativeMutationsUseAuthenticatedJSONAndReturnConflictErrors() async throws {
        let api = try client(
            [
                json(#"{"ok":true,"entry":{"id":"entry-1"}}"#),
                json(#"{"error":"Entry is locked by invoice"}"#, status: 409),
            ], token: "synthetic-session"
        )
        let request = try VaultRequest(
            "api/timesheet/entries/{id}", scope: .init(),
            record: .object(["id": .string("entry-1")])
        )
        _ = try await api.request(
            request, method: "PUT", body: .object(["description": .string("Reviewed")])
        )
        #expect(
            MockURLProtocol.recorded.last?.value(forHTTPHeaderField: "Cookie")
                == "docvault_session=synthetic-session"
        )
        await #expect(throws: VaultError.server("Entry is locked by invoice")) {
            try await api.request(request, method: "DELETE")
        }
    }

    @Test func backupRestoreUsesPasswordAndFileMultipart() async throws {
        let api = try client([json(#"{"ok":true}"#)])
        _ = try await api.restoreBackup(
            data: Data("synthetic-backup".utf8), password: "fake-password"
        )
        let req = try #require(MockURLProtocol.recorded.last)
        #expect(req.url?.path == "/docvault/api/restore")
        #expect(
            req.value(forHTTPHeaderField: "Content-Type")?.hasPrefix(
                "multipart/form-data; boundary="
            ) == true
        )
        let body = String(data: req.httpBody ?? Data(), encoding: .utf8) ?? ""
        #expect(body.contains("name=\"password\""))
        #expect(body.contains("name=\"file\""))
        #expect(body.contains("synthetic-backup"))
    }

    @Test func largeBackupEnvelopeStaysOnDiskAndRemovesOnlyOwnedFiles() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("Synthetic-\(UUID()).enc")
        defer { try? FileManager.default.removeItem(at: source) }
        try Data("synthetic-backup".utf8).write(to: source)
        let file = try FileHandle(forWritingTo: source)
        try file.truncate(atOffset: 101 * 1024 * 1024)
        try file.close()
        let payload = try await Task.detached { try BackupMultipart.stage(fileURL: source, password: "synthetic-password") }.value
        let handle = try FileHandle(forReadingFrom: payload.url)
        let prefix = String(decoding: try handle.read(upToCount: 512) ?? Data(), as: UTF8.self)
        #expect(prefix.contains("name=\"password\"\r\n\r\nsynthetic-password"))
        #expect(prefix.contains("synthetic-backup"))
        let size = try #require(payload.url.resourceValues(forKeys: [.fileSizeKey]).fileSize)
        #expect(size > 101 * 1024 * 1024)
        try handle.seek(toOffset: UInt64(size - 48))
        let tail = String(decoding: try handle.readToEnd() ?? Data(), as: UTF8.self)
        #expect(tail.hasSuffix("--\r\n"))
        try handle.close()
        payload.remove()
        #expect(!FileManager.default.fileExists(atPath: payload.url.path))
        #expect(FileManager.default.fileExists(atPath: source.path))
        await #expect(throws: (any Error).self) { try await UploadDraft.stageAsync(source, maximumSize: 50 * 1024 * 1024) }
        let cancelled = Task { () throws -> UploadDraft in
            try Task.checkCancellation()
            return try await UploadDraft.stageAsync(source, maximumSize: VaultAPI.maxImportBytes)
        }
        cancelled.cancel()
        await #expect(throws: CancellationError.self) { try await cancelled.value }
    }
}
