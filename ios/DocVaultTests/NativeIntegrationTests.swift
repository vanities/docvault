@testable import DocVault
import Foundation
import Testing

@Suite(
    "Native API against isolated real handler", .serialized,
    .enabled(
        if: ProcessInfo.processInfo.environment["DOCVAULT_UI_TEST_SERVER"]
            == "http://127.0.0.1:31305"
    )
)
@MainActor struct NativeIntegrationTests {
    @Test func brainAndSkillEditsPreserveExactTextAndRejectInvalidRecords() async throws {
        try await resetFixture("administration")
        let api = try await client()
        let memory = "# Acme memory 🧪\n\nKeep this exact quotation and spacing.\n"
        let saved = try await api.request(VaultRequest("api/brain", scope: .init()), method: "PUT", body: .object(["content": .string(memory)]))
        #expect(saved["content"].string == memory && saved["bytes"].number == Double(memory.utf8.count))
        let appended = try await call(api, "api/brain/append", "POST", #"{"text":"An invented preference.","tag":"preference"}"#)
        #expect(appended["content"].string.hasPrefix(memory) && appended["appended"].string.contains("preference"))
        let skill = try await call(api, "api/skills/acme-new", "PUT", ##"{"description":"An invented source review.","instructions":"# Review 🧪\n\nKeep all cited evidence."}"##)
        #expect(skill["name"].string == "acme-new" && skill["instructions"].string.contains("🧪"))
        let summaries = try await call(api, "api/skills")["skills"].array
        #expect(summaries.count == 3 && summaries.allSatisfy { $0["instructions"] == .null })
        let edited = try await call(api, "api/skills/acme-new", "PUT", ##"{"description":"Revised fictional review.","instructions":"# Revised review\n\nRead the source."}"##)
        #expect(edited["description"].string == "Revised fictional review.")
        for path in ["api/skills/Upper", "api/skills/new-empty"] {
            do { _ = try await call(api, path, "PUT", #"{"description":"","instructions":""}"#); Issue.record("Invalid or empty skills must be rejected") } catch {}
        }
        _ = try await call(api, "api/skills/acme-new", "DELETE")
        #expect(try await call(api, "api/skills")["skills"].array.count == 2)
        _ = try await call(api, "api/brain", "DELETE")
        #expect(try await call(api, "api/brain")["content"].string.isEmpty)
        try await resetFixture("administration")
    }

    @Test func externalSourcesBrowseProtectedTextTruncationTokenAndSyncFailure() async throws {
        try await resetFixture("administration")
        let api = try await client()
        let index = try await call(api, "api/external-sources/acme-library/files")["files"].array.map(\.string)
        #expect(index.count == 6 && index.contains("Guides/Planning/Checklist.md"))
        let page = try await call(api, "api/external-sources/acme-library/file?path=Guides/Planning/Checklist.md")
        #expect(page["content"].string.contains("| Step | Status |") && page["truncated"] == .bool(false))
        let large = try await call(api, "api/external-sources/acme-library/file?path=Large.md")
        #expect(large["truncated"].boolean && large["content"].string.count == 256 * 1024)
        do { _ = try await call(api, "api/external-sources/acme-library/file?path=../../.docvault-settings.json"); Issue.record("Source reads must remain inside the Markdown repository") } catch {}
        let token = try await call(api, "api/external-sources/token", "PUT", #"{"token":"synthetic-token-only"}"#)
        #expect(token["tokenConfigured"].boolean)
        let list = try await call(api, "api/external-sources")
        #expect(list["tokenConfigured"].boolean && list["githubToken"] == .null && list["token"] == .null)
        let failed = try await call(api, "api/external-sources/acme-library/sync", "POST")
        #expect(!failed["lastError"].string.isEmpty && failed["lastSyncedAt"].string == "2026-10-01T12:00:00Z")
        #expect(NativeAdministration.sourceOutcome(failed) == "Sync failed")
        #expect(try await call(api, "api/external-sources/acme-library/files")["files"].array.count == 6)
        let added = try await call(api, "api/external-sources", "POST", #"{"url":"https://example.com/acme/new-library.git","name":"Acme New Library"}"#)
        _ = try await call(api, "api/external-sources/" + added["id"].string, "DELETE")
        #expect(try await call(api, "api/external-sources")["repos"].array.count == 1)
        _ = try await call(api, "api/external-sources/token", "PUT", #"{"token":""}"#)
        #expect(try await call(api, "api/external-sources")["tokenConfigured"] == .bool(false))
        try await resetFixture("administration")
    }

    private func resetFixture(_ domain: String) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:31305/__test/reset-\(domain)")!)
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
    }

    @Test func administrativeJobsRetainPartialRunsDryRunsRetriesAndScriptEdits() async throws {
        try await resetFixture("operations")
        let api = try await client()
        let initial = try await call(api, "api/jobs")
        let report = NativeJobs(value: initial)
        #expect(report.jobs.count == 9 && report.invalid.count == 1 && report.attention == 3)
        let collector = try #require(report.jobs.first { $0.value["id"].string == "acme-collector" })
        #expect(NativeOperations.outcome(collector.status) == "Some items failed" && collector.status["consecutiveFailures"].number == 2)
        let builtIn = try await call(api, "api/jobs/snapshot/runs?kind=built-in")["runs"].array
        #expect(builtIn.count == 3 && builtIn.contains { $0["outcome"].string == "partial" })
        let before = try await call(api, "api/jobs/acme-collector/runs?kind=custom")["runs"].array
        #expect(before.count == 3 && before.contains { $0["dryRun"].boolean })
        let dry = try await call(api, "api/jobs/acme-collector/run?dryRun=true", "POST")["result"]
        #expect(dry["outcome"].string == "partial" && dry["exitCode"].number == 0 && dry["collection"]["failed"].number == 1)
        let unchanged = try await call(api, "api/jobs")["customJobStatuses"]["acme-collector"]
        #expect(unchanged["lastRanAt"] == collector.status["lastRanAt"] && unchanged["consecutiveFailures"].number == 2)
        let normal = try await call(api, "api/jobs/acme-collector/run", "POST")["result"]
        #expect(normal["outcome"].string == "partial" && !normal["stderr"].string.isEmpty)
        let retried = try await call(api, "api/jobs")["customJobStatuses"]["acme-collector"]
        #expect(retried["consecutiveFailures"].number == 3 && !retried["nextRetryAt"].string.isEmpty && retried["lastSuccessAt"] == collector.status["lastSuccessAt"])
        var edit = NativeOperations.manifest(collector.value); edit.set("label", .string("Acme edited collector"))
        let saved = try await api.request(VaultRequest("api/jobs?overwrite=true", scope: .init()), method: "POST", body: edit)
        #expect(saved["scriptStatus"]["runnable"].boolean)
        let afterEdit = try await call(api, "api/jobs/acme-collector/run", "POST")["result"]
        #expect(afterEdit["outcome"].string == "partial") // Blank replacement content keeps the existing script.
        let missing = try await call(api, "api/jobs", "POST", #"{"id":"acme-missing","label":"Acme missing script","schedule":"daily","script":"scripts/missing.local.sh","enabled":false,"tags":[]}"#)
        #expect(missing["ok"].boolean && missing["scriptStatus"]["runnable"] == .bool(false))
        do { _ = try await call(api, "api/jobs/snapshot/run", "POST"); Issue.record("Built-in jobs are not executable through the custom runner") }
        catch { #expect(error.localizedDescription.contains("not found")) }
    }

    @Test func usageAndHistoricalDiagnosticsReadPersistedRecordsThroughAuthenticatedHandler() async throws {
        try await resetFixture("operations")
        let api = try await client()
        let report = NativeUsage(value: try await call(api, "api/ai-usage?limit=1000&summary=1"))
        #expect(report.summary["totalCalls"].number == 3 && report.summary["failedCalls"].number == 1 && report.summary["totalInputTokens"].number == 1310)
        #expect(report.unpriced == 1 && report.medianLatency == 500)
        #expect(abs(try #require(report.pricedSubtotal) - 0.0092685) < 0.0000001)
        #expect(report.dailyCosts.map(\.label) == ["2026-10-01", "2026-10-03"])
        #expect(try await call(api, "api/logs?dates=1")["dates"].array.contains(.string("2026-10-01")))
        let logs = try await call(api, "api/logs?date=2026-10-01&limit=1000")
        #expect(logs["source"].string == "disk" && logs["entries"].array.count == 4)
        let errors = try await call(api, "api/logs?date=2026-10-01&level=error")
        #expect(errors["entries"].array.count == 1 && errors["entries"].array[0]["message"].string.contains("one item"))
        #expect(try await call(api, "api/status")["authenticated"].boolean)
    }

    @Test func salesEditsPreserveHistoricalPricesAndNativeEntityYearScopes() async throws {
        try await resetFixture("business")
        let api = try await client()
        var data = try await call(api, "api/sales")
        var report = NativeBusiness(value: data, kind: "sales", scope: .init(entity: "acme", year: 2026))
        #expect(report.knownTotal == 85 && report.allTimeTotal == 115 && report.records.count == 4)
        #expect(report.categoryGroups.contains { $0.title == "Unavailable product · retired-product" && $0.amount == 15 })
        _ = try await call(api, "api/sales/products/business-box", "PUT", #"{"price":20}"#)
        let renamed = try await call(api, "api/sales/business-sale1", "PUT", #"{"person":"Acme Renamed Customer"}"#)["sale"]
        #expect(renamed["total"].number == 20)
        let changed = try await call(api, "api/sales/business-sale1", "PUT", #"{"quantity":3}"#)["sale"]
        #expect(changed["total"].number == 60)
        let created = try await call(api, "api/sales", "POST", #"{"person":"Acme New Customer","productId":"business-box","quantity":2,"date":"2026-10-01","entity":"acme"}"#)["sale"]
        #expect(created["total"].number == 40)
        data = try await call(api, "api/sales")
        report = .init(value: data, kind: "sales", scope: .init(entity: "acme", year: 2026))
        #expect(report.knownTotal == 165)
        #expect(NativeBusiness(value: data, kind: "sales", scope: .init(entity: "tax-other", year: 2026)).knownTotal == 100)
        #expect(NativeBusiness(value: data, kind: "sales", scope: .init(entity: "all", year: 2026)).knownTotal == 272)
        _ = try await call(api, "api/sales/" + created["id"].string, "DELETE")
        let product = try await call(api, "api/sales/products", "POST", #"{"name":"Acme Added Product","price":0}"#)["product"]
        _ = try await call(api, "api/sales/products/" + product["id"].string, "PUT", #"{"name":"Acme Updated Product","price":5}"#)
        _ = try await call(api, "api/sales/products/" + product["id"].string, "DELETE")
        #expect(try await call(api, "api/sales")["products"].array.count == 2)
        try await resetFixture("business-empty")
    }

    @Test func mileageClearsRouteSearchAndVehicleAddressMutationsUseRealHandlers() async throws {
        try await resetFixture("business")
        let api = try await client()
        let original = try await call(api, "api/mileage")
        let report = NativeBusiness(value: original, kind: "mileage", scope: .init(entity: "acme", year: 2026))
        #expect(report.knownTotal == 130 && report.averageMPG == 22.5 && report.deduction == 65 && report.missingCount == 1)
        let entry = try await call(api, "api/mileage", "POST", #"{"vehicleId":"business-car","date":"2026-10-01","odometerStart":2000,"odometerEnd":2060,"entity":"acme"}"#)["entry"]
        #expect(entry["tripMiles"].number == 60)
        let patch = NativeBusiness.mileagePatch(.object(["tripMiles": .null, "odometerStart": .null, "odometerEnd": .null, "totalCost": .number(0)]))
        let cleared = try await api.request(VaultRequest("api/mileage/{id}", scope: .init(), record: entry), method: "PUT", body: patch)["entry"]
        #expect(cleared["tripMiles"] == .null && cleared["odometerStart"] == .null && cleared["totalCost"].number == 0)
        let addresses = original["savedAddresses"].array.map { NativeRouteAddress(value: $0) }
        #expect(try await call(api, "api/geocode/enabled")["enabled"] == .bool(true))
        let route = try await call(api, NativeRouteAddress.routePath(from: addresses[0], to: addresses[1]))
        #expect(route["miles"].number == 5 && route["meters"].number == 8046.7)
        let search = try await call(api, "api/geocode/autocomplete?text=Acme")
        #expect(search["results"].array.first?["formatted"].string == "Acme Search Location")
        #expect(try await call(api, "api/geocode/autocomplete?text=empty")["results"].array.isEmpty)
        do { _ = try await call(api, "api/geocode/autocomplete?text=failure"); Issue.record("Synthetic provider failure must stay visible") }
        catch { #expect(error.localizedDescription.contains("Failed to fetch autocomplete")) }
        let vehicle = try await call(api, "api/mileage/vehicles", "POST", #"{"name":"Acme Added Vehicle","year":2020}"#)["vehicle"]
        let noYear = try await call(api, "api/mileage/vehicles/" + vehicle["id"].string, "PUT", #"{"year":""}"#)["vehicle"]
        #expect(noYear["year"] == .null)
        _ = try await call(api, "api/mileage/vehicles/" + vehicle["id"].string, "DELETE")
        let address = try await call(api, "api/mileage/addresses", "POST", #"{"label":"Acme Added Address","formatted":"Acme Fabricated Place","lat":0,"lon":0}"#)["address"]
        _ = try await call(api, "api/mileage/addresses/" + address["id"].string, "PUT", #"{"label":"Acme Updated Address"}"#)
        _ = try await call(api, "api/mileage/addresses/" + address["id"].string, "DELETE")
        _ = try await call(api, "api/mileage/" + entry["id"].string, "DELETE")
        _ = try await call(api, "api/mileage/settings", "PUT", #"{"irsRate":0.6}"#)
        #expect(try await call(api, "api/mileage")["irsRate"].number == 0.6)
        try await resetFixture("business-empty")
        #expect(try await call(api, "api/geocode/enabled")["enabled"] == .bool(false))
    }

    @Test func consolidatedSnapshotPreservesFixedValuesCurrenciesYearActivityAndSourceCoverage() async throws {
        try await resetFixture("snapshot")
        let api = try await client()
        let data = try await call(api, "api/financial-snapshot/2026?format=json")
        let report = NativeFinancialSnapshot(value: data, sources: try await call(api, "api/tax-summary/2026"), history: try await call(api, "api/portfolio/snapshots?year=2026"), year: 2026)
        #expect(report.brokerage == 1000 && report.excludedBanks == 2 && report.unavailableComponents == 0)
        // 1234.56 USD cash - 200 card + 1000 brokerage - 300 manual loan.
        #expect(abs(try #require(report.knownNetWorth) - 1734.56) < 0.001)
        #expect(report.number("sales.totalRevenue") == 500 && report.number("mileage.totalMiles") == 100 && report.number("mileage.totalDeduction") == 50)
        #expect(report.retirementTotal == 300 && report.retirementRows.count == 2)
        #expect(report.number("portfolioSummary.monthlyDebtService") == 55 && report.dti == 1.375)
        #expect(report.number("taxSummary.niit") == 0)
        #expect(report.deposits(entity: "tax-demo").map(\.revenue) == [2200, 0, nil])
        #expect(report.depositMix(entity: "tax-demo").isEmpty)
        #expect(data["reminders"].array.map { $0["title"].string } == ["Review synthetic tax records"])
        #expect(!report.historyRows.isEmpty && report.historyRows.allSatisfy { $0["date"].string.hasPrefix("2026-") })
        let old = NativeFinancialSnapshot(value: try await call(api, "api/financial-snapshot/2025?format=json"), sources: .null, history: .null, year: 2025)
        #expect(old.retirementTotal == 50 && old.number("sales.totalRevenue") == 900 && old.retirementRows.count == 1)
        try await resetFixture("snapshot-empty")
    }

    @Test func taxYearKeepsGainsDeductionsHiddenRecordsAndEntitiesConsistent() async throws {
        try await resetFixture("tax")
        let api = try await client()
        let summary = try await call(api, "api/tax-summary/2026")
        let stats = try await call(api, "api/analytics/quick-stats/tax-demo/2026")
        let report = NativeTaxYear(statistics: stats, summary: summary, entity: "tax-demo")
        #expect(report.number("income.totalIncome") == 49975)
        #expect(report.number("income.capitalGainsTotal") == -200 && report.recordedNet == 48725)
        #expect(report.number("expenses.totalExpenses") == 1300 && report.number("expenses.totalDeductible") == 1250)
        #expect(report.number("invoices.invoiceTotal") == 6000 && report.number("retirement.totalContributions") == 3000)
        #expect(report.documents.count == 11 && report.parsedCount == 10)
        #expect(!report.documents.contains { $0.name == "Untracked_Receipt.pdf" })
        #expect(report.deposits.map(\.revenue) == [2200, 0, nil])
        #expect(report.parsedDepositTotal("deposits", entity: "tax-demo") == 2500 && report.parsedDepositTotal("ownerContributions", entity: "tax-demo") == 300)
        #expect(report.parsedDepositTotal("deposits", entity: "tax-other") == nil)
        let other = try await call(api, "api/analytics/quick-stats/tax-other/2026")
        #expect(other["income"]["totalIncome"].number == 10000 && other["expenses"]["totalDeductible"].number == 0)
        let all = NativeTaxYear(statistics: try await call(api, "api/analytics/quick-stats/all/2026"), summary: summary, entity: "all")
        #expect(all.sources("2026/income/w2/AcmeEmployer_W2_2026.pdf").map(\.entity) == ["tax-demo", "tax-other"])
        let empty = NativeTaxYear(statistics: try await call(api, "api/analytics/quick-stats/tax-demo/2025"), summary: try await call(api, "api/tax-summary/2025"), entity: "tax-demo")
        #expect(empty.documents.isEmpty && empty.number("income.totalIncome") == 0 && empty.statistics["retirement"].isEmpty)
    }

    @Test func taxSourcePreviewAndCPAOrFilteredZIPUseRealAuthenticatedContracts() async throws {
        try await resetFixture("tax")
        let api = try await client()
        let files = try await api.files(entity: "tax-demo")
        let source = try #require(files.first { $0.name == "AcmeEmployer_W2_2026.pdf" })
        #expect(source.entity == "tax-demo" && source.size > 0 && source.lastModified > 0)
        #expect(try await api.document(source, entity: "tax-demo").starts(with: Data("%PDF".utf8)))
        let body: VaultValue = .object(["entity": .string("tax-demo"), "year": .number(2026), "filter": .string("expenses")])
        for path in ["api/download/zip", "api/download/cpa-package"] {
            let (bytes, filename) = try await api.download(VaultRequest(path, scope: .init()), method: "POST", body: body, fallback: "zip")
            #expect(bytes.starts(with: Data([0x50, 0x4B, 0x03, 0x04])) && filename.hasSuffix(".zip"))
            #expect(bytes.range(of: Data("Untracked_Receipt.pdf".utf8)) == nil)
        }
        let unauthenticated = try VaultAPI(address: ServerAddress("http://127.0.0.1:31305"))
        do { _ = try await unauthenticated.document(source, entity: "tax-demo"); Issue.record("Tax sources require authentication") }
        catch { #expect(error as? VaultError == .signedOut) }
    }

    @Test func nutritionEditsPreserveFullLabelsAndStayWithinTheSelectedPerson() async throws {
        try await resetFixture("nutrition")
        let api = try await client()
        let resource = try #require(NativeCatalog.resource("nutrition"))
        let collection = try #require(resource.collections.first)
        let scope = VaultScope(person: "demo-person")
        let data = try await api.request(VaultRequest(resource.path, scope: scope))
        #expect(NativeNutrition.products(data).count == 6)
        #expect(NativeNutrition.products(data).filter { $0.status == "active" }.count == 3)
        let other = try await call(api, "api/health/other-person/nutrition")
        #expect(NativeNutrition.products(other).map(\.name) == ["Other Person Product"])
        do {
            _ = try await call(api, "api/health/other-person/nutrition/demodaily")
            Issue.record("Products must not cross person boundaries")
        } catch { #expect(error.localizedDescription.contains("No nutrition entry")) }
        let original = try await call(api, "api/health/demo-person/nutrition/demodaily")["entry"]
        let fields = NativeNutritionFields.fields("Regimen & notes")
        var values = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, NativeForm.display(original.at($0.id), field: $0)) })
        values["dose.timeOfDay"] = "bedtime"; values["dose.frequency"] = "custom"
        values["dose.frequencyCustom"] = "Fictional custom schedule"
        let body = try NativeForm.body(fields: fields, values: values, original: original, patch: true)
        _ = try await call(api, "api/health/demo-person/nutrition/demodaily", "PATCH", #"{"research":"Another invented note"}"#)
        let current = try await call(api, "api/health/demo-person/nutrition/demodaily")["entry"]
        try NativeNutrition.validateRevision(patch: body, original: original, current: current)
        let saved = try await api.request(VaultRequest(collection.updatePath, scope: scope, record: original), method: "PATCH", body: body)["entry"]
        #expect(saved["parsed"] == original["parsed"] && saved["citations"] == original["citations"] && saved["research"].string == "Another invented note")
        #expect(saved["dose"]["amount"].number == 1 && saved["dose"]["timeOfDay"].string == "bedtime")
        let cleared = try await call(api, "api/health/demo-person/nutrition/demodaily", "PATCH", #"{"dose":null}"#)["entry"]
        #expect(cleared["dose"].isEmpty && cleared["parsed"] == original["parsed"])
        _ = try await api.request(VaultRequest(collection.updatePath, scope: scope, record: original), method: "PATCH", body: original)
    }

    @Test func nutritionImageImportsReplacementsAndParseFailuresRetainRecords() async throws {
        try await resetFixture("nutrition")
        let api = try await client()
        let imageRequest = try VaultRequest("api/health/demo-person/nutrition/demodaily/image?slot=primary", scope: .init())
        let bytes = try await api.bytes(imageRequest)
        #expect(bytes.starts(with: Data([0x89, 0x50, 0x4E, 0x47])))
        let unauthenticated = try VaultAPI(address: ServerAddress("http://127.0.0.1:31305"))
        do { _ = try await unauthenticated.bytes(imageRequest); Issue.record("Label images require authentication") }
        catch { #expect(error as? VaultError == .signedOut) }
        let imported = try await api.uploadBytes(VaultRequest("api/health/demo-person/nutrition/upload?filename=Synthetic.png", scope: .init()), data: bytes)["entry"]
        let id = imported["id"].string
        #expect(!id.isEmpty && imported["status"].string == "considering" && !imported["parseError"].isEmpty && imported["parsed"].isEmpty)
        _ = try await call(api, "api/health/demo-person/nutrition/\(id)", "PATCH", #"{"notes":"Synthetic retained note","dose":{"amount":1,"unit":"capsule","frequency":"weekly"},"research":"Invented research"}"#)
        let before = try await call(api, "api/health/demo-person/nutrition/\(id)")["entry"]
        let replaced = try await api.uploadBytes(VaultRequest("api/health/demo-person/nutrition/\(id)/replace-image?filename=Facts.png&slot=facts", scope: .init()), data: bytes, method: "PUT")["entry"]
        #expect(!replaced["factsImagePath"].isEmpty && replaced["dose"] == before["dose"] && replaced["notes"] == before["notes"] && replaced["research"] == before["research"])
        #expect(try await api.bytes(VaultRequest("api/health/demo-person/nutrition/\(id)/image?slot=facts", scope: .init())) == bytes)
        let reparsed = try await call(api, "api/health/demo-person/nutrition/\(id)/reparse", "POST")["entry"]
        #expect(!reparsed["parseError"].isEmpty && reparsed["notes"] == before["notes"] && reparsed["dose"] == before["dose"])
        _ = try await call(api, "api/health/demo-person/nutrition/\(id)", "DELETE")
        do { _ = try await call(api, "api/health/demo-person/nutrition/\(id)"); Issue.record("Deleted product must be absent") }
        catch { #expect(error.localizedDescription.contains("No nutrition entry")) }
    }

    @Test func nutritionLabelCorrectionsRetainNutrientsBlendsAndResearch() async throws {
        try await resetFixture("nutrition")
        let api = try await client()
        let path = "api/health/demo-person/nutrition/demodaily"
        let original = try await call(api, path)["entry"]
        let fields = NativeNutritionFields.fields("Product & serving")
        var values = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, NativeForm.display(original.at($0.id), field: $0)) })
        values["parsed.productName"] = "Corrected Demo"
        values["parsed.servingSize.amount"] = "3"
        let body = try NativeForm.body(fields: fields, values: values, original: original, patch: true)
        try NativeNutrition.validateRevision(patch: body, original: original, current: try await call(api, path)["entry"])
        let saved = try await api.request(VaultRequest(path, scope: .init()), method: "PATCH", body: body)["entry"]
        #expect(saved["parsed"]["productName"].string == "Corrected Demo" && saved["parsed"]["servingSize"]["amount"].number == 3)
        for key in ["vitamins", "minerals", "otherActive", "proprietaryBlends", "allergenInfo", "warnings", "parserVersion"] {
            #expect(saved["parsed"][key] == original["parsed"][key])
        }
        #expect(saved["research"] == original["research"] && saved["citations"] == original["citations"] && saved["dose"] == original["dose"])
        _ = try await api.request(VaultRequest(path, scope: .init()), method: "PATCH", body: original)
    }

    @Test func cachedFinanceRetainsCurrenciesZeroBalancesAndHoldingPriceHistory() async throws {
        try await resetFixture("finance")
        let api = try await client()
        let banks = NativeFinance.accounts(try await call(api, "api/simplefin/balances?cached=1"))
        #expect(banks.count == 5)
        #expect(NativeFinance.totals(banks.filter { $0.currency == "USD" }.map(\.balance)).net == 1034.56)
        #expect(banks.first { $0.value["id"].string == "synthetic-zero" }?.balance == 0)
        #expect(!NativeFinance.totals(banks.filter { $0.currency == "EUR" }.map(\.balance)).complete)
        let portfolio = try await call(api, "api/brokers/portfolio?cached=1")
        #expect(portfolio["totalValue"].number == 1000)
        #expect(NativeFinance.positions(portfolio).count == 2)
        let quotes = try await call(api, "api/quant/tickers/prices?symbols=FDEMO")
        let quote = try #require(quotes["quotes"].array.first)
        #expect(NativeFinance.priceChange(quote, quantity: 4, period: "1D")?.amount == 8)
        #expect(NativeFinance.priceChange(quote, quantity: 4, period: "1M") == nil)
        let snapshots = NativeFinance.history(try await call(api, "api/portfolio/snapshots"))
        #expect(snapshots.count == 45 && snapshots.filter { $0["bankValue"] == .null }.count == 1)
    }

    @Test func nativeBankAnnotationsEditTheOverlayWithoutChangingBalances() async throws {
        let api = try await client()
        let resource = try #require(NativeCatalog.resource("annotations"))
        let collection = try #require(resource.collections.first)
        let merged = try await call(api, resource.path)
        let card = try #require(merged["accounts"].array.first { $0["id"].string == "synthetic-card" })
        #expect(card["annotation"]["type"].string == "credit-card")
        _ = try await api.request(VaultRequest(collection.updatePath, scope: .init(), record: card), method: collection.updateMethod, body: .object(["notes": .string("Synthetic updated account note.")]))
        let saved = try await call(api, resource.path)
        #expect(saved["accounts"].array.first { $0["id"] == card["id"] }?["annotation"]["notes"].string == "Synthetic updated account note.")
        let balances = try await call(api, "api/simplefin/balances?cached=1")
        #expect(balances["accounts"].array.first { $0["id"] == card["id"] }?["balance"].number == -200)
        _ = try await api.request(VaultRequest(collection.updatePath, scope: .init(), record: card), method: collection.updateMethod, body: .object(["notes": card["annotation"]["notes"]]))
    }

    @Test func politicalResearchUsesSavedClaimsAndActualCachedActivity() async throws {
        try await resetFixture("markets")
        let api = try await client()
        let data = try await call(api, "api/research/politics-links")
        #expect(data["ok"].boolean)
        #expect(NativePolitics.researchClaims(data).count == 2)
        let asset = try #require(NativePolitics.researchClaims(data, kind: "Assets").first)
        #expect(asset.value["claimText"].string == "Synthetic commentary links DEMO to semiconductor policy.")
        #expect(asset.value["matchedTrades"].array.count == 3)
        #expect(asset.value["matchedVotes"].array.first?["externalId"].string == "synthetic-chip-bill")
        let rates = try #require(NativePolitics.researchClaims(data, search: "rates").first)
        #expect(rates.value["matchedTrades"].array.isEmpty)
        #expect(rates.value["matchedVotes"].array.count == 1)
        let source = try await call(api, "api/research/syntheticpoliticsnote")
        #expect(source["entry"]["text"].string.contains("fictional commentary"))
        #expect(NativePolitics.researchSignals(data).count == 3)
    }

    @Test func politicalPortraitsUseAuthenticatedDownloadsAndMissingImagesReturn404() async throws {
        let api = try await client()
        let spenders = try await call(api, "api/politics/top-spenders")
        let member = try #require(spenders["spenders"].array.first { $0["politician"].string == "Demo Member A & B" })
        let request = try #require(NativePolitics.portraitRequest(member["imageUrl"].string))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("SyntheticPortrait-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let image = try await api.downloadFile(request, method: "GET", body: nil, fallback: "jpg", folder: folder)
        #expect(try Data(contentsOf: image).starts(with: Data([0xFF, 0xD8])))
        let unauthenticated = try VaultAPI(address: ServerAddress("http://127.0.0.1:31305"))
        do {
            _ = try await unauthenticated.bytes(request)
            Issue.record("A portrait must not bypass server authentication")
        } catch { #expect(error as? VaultError == .signedOut) }
        do {
            _ = try await api.bytes(try #require(NativePolitics.portraitRequest("/api/politics/headshot/DEMOC")))
            Issue.record("The missing fixture portrait must remain unavailable")
        } catch { #expect(error.localizedDescription.contains("404")) }
    }

    @Test func healthSnapshotsAndClinicalRecordsArePersonScopedAndUnitAware() async throws {
        let api = try await client()
        for segment in ["activity", "heart", "sleep", "workouts", "body"] {
            let response = try await api.request(VaultRequest("api/health/{person}/snapshot/" + segment, scope: VaultScope(person: "demo-person")))
            #expect(response["segment"].string == segment)
            #expect(!response["stale"].boolean)
            #expect(!NativeHealth.panels(response["data"], segment: segment).isEmpty)
        }
        let sleep = try await call(api, "api/health/demo-person/snapshot/sleep")
        #expect(NativeHealth.panels(sleep["data"], segment: "sleep").first?.lines.first?.points.last?.value == 8)
        #expect(sleep["data"]["daily"].array.last?["deepMinutes"] == .null)
        let body = try await call(api, "api/health/demo-person/snapshot/body")
        #expect(NativeHealth.panels(body["data"], segment: "body").first?.lines.first?.points.count == 3)
        let clinical = try await call(api, "api/health/demo-person/clinical")
        let data = clinical["clinical"]
        #expect(NativeHealth.clinicalRows(data, kind: "labsByTest", search: "", filter: "Out of range").map { $0["name"].string } == ["Demo glucose"])
        #expect(NativeHealth.labValue(try #require(data["vitals"].array.last)) == "120/80 mmHg")
        #expect(data["medications"].array.first?["dosageText"].string == "Synthetic instruction: one fictional tablet daily.")
        for path in ["snapshot/sleep", "clinical"] {
            do {
                _ = try await call(api, "api/health/other-person/" + path)
                Issue.record("A person with no export must not receive another person's health records")
            } catch {
                #expect(error.localizedDescription.localizedCaseInsensitiveContains("no "))
            }
        }
    }

    @Test func illnessNotesPersistWithoutChangingSnapshotsOrAnotherPerson() async throws {
        let api = try await client()
        let key = "2026-09-20-2026-09-21"
        let path = "api/health/demo-person/illness-notes/" + key
        _ = try await api.request(VaultRequest(path, scope: .init()), method: "PUT", body: .object(["note": .string("  Synthetic personal annotation.  "), "dismissed": .bool(true)]))
        let overview = try await call(api, "api/health/demo-person/snapshot/all")
        #expect(overview["illnessNotes"][key]["note"].string == "Synthetic personal annotation.")
        #expect(overview["illnessNotes"][key]["dismissed"].boolean)
        #expect(overview["snapshot"]["activity"]["daily"].array.count == 5)
        #expect(overview["snapshot"]["illnessPeriods"].array.count == 1)
        _ = try await api.request(VaultRequest(path, scope: .init()), method: "PUT", body: .object(["note": .string(""), "dismissed": .bool(false)]))
        let cleared = try await call(api, "api/health/demo-person/snapshot/all")
        #expect(cleared["illnessNotes"][key] == .null)
    }

    @Test func personManagementDistinguishesArchiveAndPermanentDeleteAndReadsRawExports() async throws {
        let api = try await client()
        let raw = try await call(api, "api/health/demo-person/summary/synthetic-export.zip")
        #expect(raw["summary"]["schemaVersion"].number == 1)
        let resource = try #require(NativeCatalog.features.first { $0.id == "health" }?.resources.first { $0.id == "health-people" })
        let collection = try #require(resource.collections.first)
        #expect(collection.deleteTitle == "Archive")
        let person = try await call(api, "api/health/people", "POST", #"{"name":"Synthetic archived person"}"#)["person"]
        _ = try await api.request(VaultRequest(collection.deletePath, scope: .init(), record: person), method: "DELETE")
        let active = try await call(api, "api/health/people")
        #expect(!active["people"].array.contains { $0["id"] == person["id"] })
        let all = try await call(api, "api/health/people?archived=true")
        #expect(all["people"].array.contains { $0["id"] == person["id"] && !$0["archivedAt"].string.isEmpty })
        let deletion = try #require(collection.actions.first { $0.id == "delete-person" })
        #expect(deletion.destructive && deletion.method == "DELETE")
        _ = try await api.request(VaultRequest(deletion.path, scope: .init(), record: person), method: deletion.method)
        let after = try await call(api, "api/health/people?archived=true")
        #expect(!after["people"].array.contains { $0["id"] == person["id"] })
        #expect(after["people"].array.contains { $0["id"].string == "demo-person" })
    }

    @Test func politicsExplorationReadsActualScopedDisclosuresAndSimulations() async throws {
        let api = try await client()
        let spenders = try await call(api, "api/politics/top-spenders?limit=200")
        let member = try #require(spenders["spenders"].array.first { $0["politician"].string == "Demo Member A & B" })
        let trades = try await api.request(VaultRequest("api/politics/trades?politician={politician}&limit=400", scope: .init(), record: member))
        #expect(trades["trades"].array.count == 3)
        #expect(trades["trades"].array.allSatisfy { $0["politicianName"].string == "Demo Member A & B" })
        #expect(NativePolitics.monthly(trades["trades"].array).map(\.month) == ["2026-07", "2026-08", "2026-09"])
        let clusters = try await call(api, "api/politics/clusters?direction=sell&windowDays=30")
        #expect(clusters["clusters"].array.count == 1)
        #expect(clusters["clusters"].array.first?["ticker"].string == "SYNTH")
        let backtest = try await api.request(VaultRequest("api/politics/backtest?politician={politician}", scope: .init(), record: member))
        #expect(backtest["performance"]["returnPct"].number == 0.25)
        #expect(backtest["trades"].array.compactMap(NativePolitics.displayedReturn) == [0.25, 0.05])
    }

    @Test func politicalArchiveServesLinkedTradesAndProtectedPdfAndText() async throws {
        let api = try await client()
        let archive = try await call(api, "api/politics/filings?limit=5000")
        let filing = try #require(archive["filings"].array.first)
        #expect(filing["docId"].string == "DEMO-001")
        let detail = try await api.request(VaultRequest("api/politics/filings/{source}/{docId}", scope: .init(), record: filing))
        #expect(detail["trades"].array.count == 5)
        let folder = VaultModel.previewRoot.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let text = try await api.downloadFile(VaultRequest("api/politics/filings/{source}/{docId}/text", scope: .init(), record: filing), method: "GET", body: nil, fallback: "txt", folder: folder)
        #expect(try String(contentsOf: text, encoding: .utf8).contains("Synthetic disclosure text"))
        let pdf = try await api.downloadFile(VaultRequest("api/politics/filings/{source}/{docId}/pdf", scope: .init(), record: filing), method: "GET", body: nil, fallback: "pdf", folder: folder)
        #expect(try Data(contentsOf: pdf).starts(with: Data("%PDF".utf8)))
    }

    @Test func cachedQuantResponsesProduceDateBasedSpecializedCharts() async throws {
        let api = try await client()
        let btc = try await call(api, "api/quant/btc/log-regression")
        #expect(btc["cached"].boolean)
        let panels = NativeQuant.panels(btc, resource: "quant-btc-log-regression")
        #expect(panels.first { $0.id == "risk" }?.lines.first?.points.last?.value == 0.66)
        #expect(panels.first { $0.id == "moving" }?.lines.last?.points.last?.value == 7128)
        #expect(panels.first?.lines.first?.points.last.map { NativeQuant.day($0.date) } == "2025-12-01")
        let macro = try await call(api, "api/quant/macro/dashboard")
        #expect(Array(NativeQuant.panels(macro, resource: "quant-macro-dashboard").prefix(2)).map(\.unit) == ["%", "index"])
        let special = Set(["quant-cycle-presidential", "quant-tradfi-sectors-rotation", "quant-tradfi-midterm-drawdowns", "quant-btc-altcoin-season", "quant-btc-dominance"])
        let excluded = Set(["quant-overview", "quant-snapshots", "quant-macro-calendar", "quant-predictions", "quant-btc-kronos", "quant-research", "quant-tickers"])
        let quant = try #require(NativeCatalog.features.first { $0.id == "quant" })
        for resource in quant.resources where !excluded.contains(resource.id) {
            let response = try await call(api, resource.path)
            #expect(response["cached"].boolean, "Expected cached synthetic response for \(resource.id)")
            if !special.contains(resource.id) {
                #expect(!NativeQuant.panels(response, resource: resource.id).isEmpty, "Missing native chart adapter for \(resource.id)")
            }
        }
        let cycle = try await call(api, "api/quant/cycle/presidential")
        #expect(cycle["matrix"].array.count == 4)
        #expect(cycle["matrix"].array.first?.array.count == 12)
    }

    @Test func overviewAndPredictionsRetainAllSignalsAndProviderFailures() async throws {
        let api = try await client()
        let quant = try #require(NativeCatalog.features.first { $0.id == "quant" })
        var sources: [String: VaultValue] = [:]
        for resource in quant.resources where NativeQuantOverview.sourceIDs.contains(resource.id) {
            sources[resource.id] = try await call(api, resource.path)
        }
        let signals = NativeQuantOverview.signals(sources)
        #expect(signals.allSatisfy { $0.value != nil }, "Unavailable synthetic signals: \(signals.filter { $0.value == nil }.map(\.id))")
        #expect(signals.first { $0.id == "sahm" }?.value == "0.00")
        #expect(signals.first { $0.id == "sp-ytd" }?.value == "8.00%")
        let predictions = try await call(api, "api/quant/predictions")
        #expect(predictions["cached"].boolean)
        #expect(!predictions["sources"]["polymarket"].boolean)
        #expect(predictions["errors"].array.first?.string == "Synthetic secondary source is unavailable.")
        #expect(NativePredictions.markets(predictions).count == 3)
        #expect(NativePredictions.movers(predictions).first?["change24h"].number == -4)
        let releases = try await call(api, "api/quant/macro/calendar")
        #expect(releases["cpi"]["display"].string == "+2.6% y/y")
        #expect(releases["nfp"] == .null)
    }

    @Test func selectedDocumentsCanBeTaggedMovedExportedAndDeleted() async throws {
        let api = try await client()
        let model = VaultModel(defaults: try #require(UserDefaults(suiteName: "DocVaultBatchIntegrationTest")))
        model.api = api
        model.connected = true
        model.entities = try await api.entities()
        for name in ["Batch One.txt", "Batch Two.txt"] {
            _ = try await api.upload(data: Data("Synthetic batch document".utf8), entity: "acme", folder: "batch-source", name: name, contentType: "text/plain")
        }
        let files = try await api.files(entity: "acme").filter { $0.folder == "batch-source" }
        #expect(files.count == 2)
        for file in files {
            try await model.saveMetadata(file: file, entity: "acme", notes: "Synthetic preserved note", tags: ["Reviewed"])
            try await model.addDocumentTags(file, entity: "acme", tags: ["Tax"])
            try await model.moveDocument(file, entity: "acme", toEntity: "acme", folder: "batch-destination")
        }
        let moved = try await api.files(entity: "acme").filter { $0.folder == "batch-destination" }
        #expect(moved.count == 2)
        #expect(moved.allSatisfy { $0.notes == "Synthetic preserved note" && $0.tags == ["Reviewed", "Tax"] })
        let archive = try await model.nativeDownload("api/download/files", scope: .init(), record: .null, method: "POST", body: .object(["entity": .string("acme"), "paths": .array(moved.map { .string($0.path) })]), suffix: "zip")
        defer { VaultModel.removePreview(archive) }
        #expect(try Data(contentsOf: archive).starts(with: Data([0x50, 0x4B, 0x03, 0x04])))
        for file in moved {
            try await model.deleteDocument(file, entity: "acme")
        }
        let remaining = try await api.files(entity: "acme")
        #expect(!remaining.contains(where: { $0.folder == "batch-source" || $0.folder == "batch-destination" }))
    }

    @Test func fileUploadStreamsDocumentsLargerThanTheOldLimit() async throws {
        let original = FileManager.default.temporaryDirectory.appendingPathComponent("Synthetic-\(UUID()).bin")
        defer { try? FileManager.default.removeItem(at: original) }
        try Data("Synthetic streamed document".utf8).write(to: original)
        let handle = try FileHandle(forWritingTo: original)
        try handle.truncate(atOffset: 101 * 1024 * 1024)
        try handle.close()
        let staged = try await Task.detached { try UploadDraft.stage(original) }.value
        defer { staged.removeStagedFiles() }
        let api = try await client()
        let path = try await api.upload(fileURL: #require(staged.fileURL), entity: "acme", folder: "integration", name: staged.name, contentType: staged.contentType)
        let files = try await api.files(entity: "acme")
        let uploaded = try #require(files.first(where: { $0.path == path }))
        #expect(uploaded.size == Int64(101 * 1024 * 1024))
        let folder = VaultModel.previewRoot.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        defer { try? FileManager.default.removeItem(at: folder) }
        let download = try await api.downloadFile(VaultRequest("api/file/acme/\(path)", scope: .init()), method: "GET", body: nil, fallback: "bin", folder: folder)
        let size = try download.resourceValues(forKeys: [.fileSizeKey]).fileSize
        #expect(size == 101 * 1024 * 1024)
        let downloaded = try FileHandle(forReadingFrom: download)
        defer { try? downloaded.close() }
        #expect(try downloaded.read(upToCount: 27) == Data("Synthetic streamed document".utf8))
        _ = try await call(api, "api/file/acme/\(path)", "DELETE")
    }

    @Test func domainReceiptImportsStreamLargeFilesAndKeepTheirQueryContract() async throws {
        let api = try await client()
        let entry = try await call(api, "api/gold", "POST", #"{"metal":"gold","productId":"synthetic-coin","size":"1 oz","weightOz":1,"purity":0.999,"purchasePrice":1234.56,"purchaseDate":"2026-01-01","quantity":1}"#)["entry"]
        let id = entry["id"].string
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("Synthetic-\(UUID()).pdf")
        defer { try? FileManager.default.removeItem(at: file) }
        try DemoVault.pdf(title: "Synthetic large receipt").write(to: file)
        let handle = try FileHandle(forWritingTo: file)
        try handle.truncate(atOffset: 101 * 1024 * 1024)
        try handle.close()
        let draft = try await UploadDraft.stageAsync(file, maximumSize: VaultAPI.maxImportBytes)
        defer { draft.removeStagedFiles() }
        let result = try await api.uploadFile(VaultRequest("api/gold/{id}/receipt?filename={filename}", scope: .init(), record: .object(["id": .string(id), "filename": .string("A & B.pdf")])), fileURL: #require(draft.fileURL))
        #expect(result["ok"].boolean)
        #expect(result["receiptPath"].string == "\(id).pdf")
        let folder = VaultModel.previewRoot.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let downloaded = try await api.downloadFile(VaultRequest("api/gold/\(id)/receipt", scope: .init()), method: "GET", body: nil, fallback: "pdf", folder: folder)
        let size = try downloaded.resourceValues(forKeys: [.fileSizeKey]).fileSize
        #expect(size == 101 * 1024 * 1024)
        _ = try await call(api, "api/gold/\(id)/receipt", "DELETE")
        _ = try await call(api, "api/gold/\(id)", "DELETE")
    }

    @Test func calendarOverlaysRespectClientTimezoneAndSavedDisplay() async throws {
        let api = try await client()
        let result = try await call(api, "api/calendar/almanac?start=2026-11-01&end=2026-11-30&timeZone=America/New_York")
        #expect(result["days"].array.count == 30)
        #expect(result["days"].array.first?["marks"].array.contains { $0["layer"].string == "showDst" } == true)
        _ = try await call(api, "api/settings", "POST", #"{"calendar":{"showMoon":false}}"#)
        let saved = try await call(api, "api/calendar/almanac?start=2026-11-01&end=2026-11-01&timeZone=UTC")
        #expect(saved["display"]["showMoon"] == .bool(false))
        _ = try await call(api, "api/settings", "POST", #"{"calendar":{"showMoon":true}}"#)
    }

    @Test func streamsDeliverEventsAndRejectTruncatedOrMalformedReplies() async throws {
        let api = try await client()
        var events: [VaultValue] = []
        try await api.stream(VaultRequest("__test/stream", scope: .init()), method: "GET") { events.append($0) }
        #expect(events.map { $0["type"].string } == ["text", "done"])
        #expect(events.first?["text"].string == "Synthetic reply")
        for mode in ["truncated", "invalid"] {
            await #expect(throws: (any Error).self) {
                try await api.stream(VaultRequest("__test/stream?end=\(mode)", scope: .init()), method: "GET") { _ in }
            }
        }
    }

    private func client() async throws -> VaultAPI {
        let api = try VaultAPI(address: ServerAddress("http://127.0.0.1:31305"))
        try await api.login(username: "admin", password: "synthetic-password")
        return api
    }

    @Test func researchNativeDomainImportsMetadataAndSourceFilesUseRealContracts() async throws {
        try await resetFixture("research")
        let api = try await client()
        let health = try await call(api, "api/research?domain=health")
        #expect(health["entries"].array.count == 1 && health["entries"].array.allSatisfy { $0["domain"].string == "health" })
        let finance = try await call(api, "api/research?domain=finance")
        #expect(finance["entries"].array.count == 3)
        let savedText = try await api.bytes(VaultRequest("api/research/financesource/file", scope: .init()))
        #expect(String(data: savedText, encoding: .utf8)?.contains("A fictional observation 🧪") == true)
        let savedPDF = try await api.bytes(VaultRequest("api/research/financepdf/file", scope: .init()))
        #expect(savedPDF.starts(with: Data("%PDF".utf8)))
        let created = try await call(api, "api/research/text", "POST", #"{"domain":"tech","text":"A fabricated native source.","title":"Acme new source","tags":["synthetic"],"tickers":["DEMO"]}"#)["entry"]
        let id = created["id"].string
        #expect(!id.isEmpty && created["domain"].string == "tech")
        _ = try await call(api, "api/research/" + id, "PATCH", #"{"title":"Acme revised source","notes":"Native saved note","publisher":"Acme Lab"}"#)
        _ = try await call(api, "api/research/" + id, "PATCH", #"{"publisher":null}"#)
        let entry = try await call(api, "api/research/" + id)["entry"]
        #expect(entry["title"].string == "Acme revised source" && entry["notes"].string == "Native saved note" && entry["publisher"] == .null)
        #expect(entry["text"].string == "A fabricated native source." && entry["tags"].array == [.string("synthetic")] && entry["tickers"].array == [.string("DEMO")])
        let file = try await api.bytes(VaultRequest("api/research/" + id + "/file", scope: .init()))
        #expect(String(data: file, encoding: .utf8) == "A fabricated native source.")
        _ = try await call(api, "api/research/" + id, "DELETE")
        #expect(try await call(api, "api/research?domain=tech")["entries"].array.count == 1)
        let unauthenticated = try VaultAPI(address: ServerAddress("http://127.0.0.1:31305"))
        do { _ = try await unauthenticated.bytes(VaultRequest("api/research/financesource/file", scope: .init())); Issue.record("Source bytes were accessible without authentication") } catch VaultError.signedOut {} catch { Issue.record("Unexpected authentication error: \(error)") }
    }

    @Test func deepResearchJobsValidateInputPollCompletionAndRetainFailures() async throws {
        try await resetFixture("research")
        let api = try await client()
        do { _ = try await call(api, "api/deep-research/run", "POST", #"{"question":"","attachments":[]}"#); Issue.record("Empty research accepted") } catch {}
        let start = try await call(api, "api/deep-research/run", "POST", #"{"question":"Compare fictional native sources","maxSearches":100}"#)
        #expect(start["status"].string == "running")
        let run = try await completedJob(api, "api/deep-research/" + start["id"].string)
        #expect(run["status"].string == "done" && run["maxSearches"].number == 30 && run["searchCount"].number == 3)
        #expect(run["report"].string.contains("| Signal | Status |") && run["sources"].array.first?["url"].string == "https://example.com/research")
        let html = try await api.bytes(VaultRequest("api/deep-research/" + start["id"].string + "/report.html", scope: .init()))
        #expect(String(data: html, encoding: .utf8)?.contains("Acme Research Source") == true)
        let failure = try await call(api, "api/deep-research/run", "POST", #"{"question":"synthetic failure"}"#)
        let failed = try await completedJob(api, "api/deep-research/" + failure["id"].string)
        #expect(failed["status"].string == "error" && failed["error"].string == "Synthetic research provider failure")
        let image = try await call(api, "api/deep-research/run", "POST", #"{"attachments":[{"mimeType":"image/png","dataUrl":"data:image/png;base64,c3ludGhldGlj"}],"maxSearches":1}"#)
        let imageRun = try await completedJob(api, "api/deep-research/" + image["id"].string)
        #expect(imageRun["question"].string == "Identify what this image shows, then research it thoroughly." && imageRun["attachments"].array.count == 1 && imageRun["maxSearches"].number == 1)
        _ = try await call(api, "api/deep-research/" + start["id"].string, "DELETE")
        #expect(try await call(api, "api/deep-research")["runs"].array.allSatisfy { $0["id"] != start["id"] })
    }

    @Test func newsJobsRetainSourceWarningsWeatherNarrationAndHTML() async throws {
        try await resetFixture("research")
        let api = try await client()
        let edition = try await call(api, "api/daily-news/syntheticnews")
        #expect(edition["weather"]["units"].string == "F" && edition["weather"]["days"].array.count == 3)
        #expect(edition["digestMeta"]["sourceWarnings"].array.first?["message"].string == "Synthetic source unavailable; edition is partial.")
        let audio = try await api.bytes(VaultRequest("api/daily-news/syntheticnews/audio", scope: .init()))
        #expect(String(data: audio.prefix(4), encoding: .utf8) == "RIFF")
        let html = try await api.bytes(VaultRequest("api/daily-news/syntheticnews/edition.html", scope: .init()))
        #expect(String(data: html, encoding: .utf8)?.contains("Acme Gazette") == true)
        let initialMail = try await call(api, "api/email/log")
        let start = try await call(api, "api/daily-news/run", "POST", #"{"editionType":"weekly"}"#)
        #expect(start["status"].string == "running")
        let generated = try await completedJob(api, "api/daily-news/" + start["id"].string)
        #expect(generated["status"].string == "done" && generated["editionType"].string == "weekly" && generated["digestMeta"]["itemCount"].number == 3)
        #expect(try await call(api, "api/email/log") == initialMail)
    }

    @Test func nativeResearchFileUploadsKeepDomainBytesAndExtractionErrors() async throws {
        try await resetFixture("research")
        let api = try await client()
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("Acme Invalid Source.pdf")
        let bytes = Data("%PDF-1.4\nSynthetic malformed PDF with no readable objects".utf8); try bytes.write(to: file)
        let draft = try await UploadDraft.stageAsync(file, maximumSize: VaultAPI.maxImportBytes)
        defer { draft.removeStagedFiles() }
        let request = try VaultRequest("api/research/upload?filename={filename}&domain=local", scope: .init(), record: .object(["filename": .string(draft.name)]))
        let result = try await api.uploadFile(request, fileURL: #require(draft.fileURL), contentType: draft.contentType)
        let entry = result["entry"]
        #expect(!entry["id"].isEmpty && entry["domain"].string == "local" && !entry["extractError"].isEmpty)
        let saved = try await api.bytes(VaultRequest("api/research/{id}/file", scope: .init(), record: entry))
        #expect(saved == bytes)
        #expect(try await call(api, "api/research?domain=local")["entries"].array.count == 2)
        #expect(try await call(api, "api/research?domain=finance")["entries"].array.count == 3)
        try await resetFixture("research-empty-file")
        do {
            _ = try await api.bytes(VaultRequest("api/research/financepdf/file", scope: .init()))
            Issue.record("An empty saved source was served as a readable file")
        } catch let VaultError.server(message) {
            #expect(message == "The saved source file is empty. Re-import the original document to recover it.")
        }
    }

    private func completedJob(_ api: VaultAPI, _ path: String) async throws -> VaultValue {
        for _ in 0 ..< 30 {
            let row = try await call(api, path)
            if row["status"].string != "running" {
                return row
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        Issue.record("Synthetic background job did not complete")
        return try await call(api, path)
    }

    private func call(
        _ api: VaultAPI, _ path: String, _ method: String = "GET", _ json: String? = nil
    ) async throws -> VaultValue {
        try await api.request(
            VaultRequest(path, scope: .init(entity: "acme", person: "demo-person", year: 2026)),
            method: method,
            body: json.map { try JSONDecoder().decode(VaultValue.self, from: Data($0.utf8)) }
        )
    }

    @Test func nativeReportReviewSavesScopedSettingsAndExportsCompleteServerPreview() async throws {
        let api = try await client()
        let client = try await call(api, "api/timesheet/clients", "POST", #"{"name":"Acme Report Client","currency":"USD"}"#)["client"]
        let project = try await call(api, "api/timesheet/projects", "POST", "{\"name\":\"Acme Report Project\",\"clientId\":\"\(client["id"].string)\",\"hourlyRate\":0}")["project"]
        let entry = try await call(api, "api/timesheet/entries", "POST", "{\"projectId\":\"\(project["id"].string)\",\"date\":\"2026-10-06\",\"durationMinutes\":45,\"description\":\"Literal, \\\"review\\\"\\nSecond line\"}")["entry"]
        let original = try NativeTimesheetReport.configuration(try await call(api, "api/timesheet/weekly-report/config"))
        var draft = NativeReportDraft(original); draft.enabled = false; draft.to = "reader@example.com"; draft.windowDays = "7"
        draft.clientIds = [client["id"].string]; draft.projectIds = [project["id"].string]
        _ = try await NativeTimesheetReport.save(original: original, draft: draft, fetch: { try await call(api, "api/timesheet/weekly-report/config") }, write: { body in
            try await api.request(VaultRequest("api/timesheet/weekly-report/config", scope: .init()), method: "PUT", body: body)
        })
        let review = try await NativeTimesheetReport.review(end: "2026-10-06") { path in try await call(api, path) }
        #expect(review.preview.rows.count == 1 && review.preview.totalMinutes == 45 && review.preview.totalAmount == 0)
        #expect(review.preview.rows.first?.value["description"].string == "Literal, \"review\"\nSecond line")
        #expect(review.preview.value["csv"].string.contains("\"Literal, \"\"review\"\"\nSecond line\""))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("NativeReportIntegration-\(UUID())")
        defer { try? FileManager.default.removeItem(at: folder) }
        #expect(try String(contentsOf: review.preview.export("html", folder: folder), encoding: .utf8) == review.preview.value["html"].string)
        #expect(try String(contentsOf: review.preview.export("csv", folder: folder), encoding: .utf8) == review.preview.value["csv"].string)
        _ = try await call(api, "api/timesheet/entries/\(entry["id"].string)", "DELETE")
    }

    @Test func nativeInvoiceReviewCreatesRetainerWorkAndKeepsEmailDraftEditable() async throws {
        let api = try await client()
        let client = try await call(api, "api/timesheet/clients", "POST", #"{"name":"Acme Billing Client","currency":"EUR","email":"billing@example.com","dueDays":7}"#)["client"]
        let project = try await api.request(VaultRequest("api/timesheet/projects", scope: .init()), method: "POST", body: .object(["name": .string("Acme Billing Project"), "clientId": client["id"], "hourlyRate": .number(100), "minimumInvoice": .number(500), "emailSubject": .string("Invoice {{number}} for {{client}}"), "emailBody": .string("Literal message\n\n{{hours}} hours")]))
        let projectId = project["project"]["id"].string
        let entry = try await call(api, "api/timesheet/entries", "POST", "{\"projectId\":\"\(projectId)\",\"date\":\"2026-10-06\",\"durationMinutes\":45,\"description\":\"Acme invented work\"}")["entry"]
        var draft = NativeInvoiceDraft(); draft.clientId = client["id"].string; draft.projectId = projectId
        let store = try await call(api, "api/timesheet"), selection = try NativeInvoiceSelection(store: store, draft: draft)
        #expect(selection.entries.count == 1 && selection.amount == 75 && selection.deficit == 425)
        let invoice = try await NativeInvoices.create(selection: selection, draft: draft, fetch: { try await call(api, "api/timesheet") }, write: { body in try await api.request(VaultRequest("api/timesheet/invoices", scope: .init()), method: "POST", body: body) })
        #expect(invoice["total"].number == 500 && invoice["currency"].string == "EUR")
        var review = try await NativeInvoices.review(id: invoice["id"].string) { path in try await call(api, path) }
        #expect(review.draft.to == "billing@example.com" && review.draft.text == "Literal message\n\n0.75 hours")
        review.draft.cc = ""; review.draft.text = "Edited\n\nLiteral message"
        #expect(try review.draft.body(number: invoice["number"].string)["cc"] == .string(""))
        let pdf = try await api.bytes(VaultRequest("api/timesheet/invoices/\(invoice["id"].string)/pdf", scope: .init()))
        #expect(pdf.starts(with: Data("%PDF".utf8)))
        _ = try await NativeInvoices.update(original: invoice, body: nil, fetch: { try await call(api, "api/timesheet") }, write: { _ in try await call(api, "api/timesheet/invoices/\(invoice["id"].string)", "DELETE") })
        _ = try await call(api, "api/timesheet/entries/\(entry["id"].string)", "DELETE")
        // No provider call or email send is performed.
    }

    @Test func billingLocksAndSubClientScopesSurviveNativeRequests() async throws {
        let api = try await client()
        let client = try await call(
            api, "api/timesheet/clients", "POST",
            #"{"name":"Acme Integration Client","currency":"USD"}"#
        )["client"]
        let clientID = client["id"].string
        let project = try await call(
            api, "api/timesheet/projects", "POST",
            "{\"name\":\"Acme Integration Project\",\"clientId\":\"\(clientID)\",\"hourlyRate\":100}"
        )["project"]
        let projectID = project["id"].string
        let divisions = try await call(
            api, "api/timesheet/projects/\(projectID)", "PUT",
            #"{"subClients":[{"name":"Acme Division","archived":false}]}"#
        )["project"]["subClients"]
            .array
        let divisionID = try #require(divisions.first)["id"].string
        let entry = try await call(
            api, "api/timesheet/entries", "POST",
            "{\"projectId\":\"\(projectID)\",\"date\":\"2026-10-06\",\"durationMinutes\":45,\"subClientId\":\"\(divisionID)\",\"description\":\"Demo work\"}"
        )["entry"]
        #expect(entry["durationMinutes"].number == 45)
        #expect(entry["start"].isEmpty)
        #expect(entry["amount"].number == 75)
        let id = entry["id"].string
        _ = try await call(
            api, "api/timesheet/entries/\(id)", "PUT", #"{"start":"09:00","end":"10:00"}"#
        )
        let quick = try await call(
            api, "api/timesheet/entries/\(id)", "PUT",
            #"{"start":null,"end":null,"durationMinutes":90}"#
        )["entry"]
        #expect(quick["start"].isEmpty)
        #expect(quick["durationMinutes"].number == 90)
        let invoice = try await call(
            api, "api/timesheet/invoices", "POST",
            "{\"clientId\":\"\(clientID)\",\"entryIds\":[\"\(id)\"]}"
        )["invoice"]
        #expect(!invoice["id"].isEmpty)
        await #expect(throws: (any Error).self) {
            try await call(api, "api/timesheet/entries/\(id)", "PUT", #"{"durationMinutes":120}"#)
        }
        await #expect(throws: (any Error).self) {
            try await call(api, "api/timesheet/entries/\(id)", "DELETE")
        }
        _ = try await call(
            api, "api/timesheet/entries/\(id)", "PUT", #"{"description":"Reviewed demo work"}"#
        )
        await #expect(throws: (any Error).self) {
            try await call(api, "api/timesheet/projects/\(projectID)", "PUT", #"{"subClients":[]}"#)
        }
        _ = try await call(
            api, "api/timesheet/weekly-report/config", "PUT",
            "{\"enabled\":false,\"clientIds\":[\"\(clientID)\"],\"projectIds\":[\"\(projectID)\"],\"categories\":[{\"name\":\"Inferred\",\"keywords\":[\"demo\"]}]}"
        )
        let preview = try await call(api, "api/timesheet/weekly-report/preview?end=2026-10-06")
        #expect(preview["rows"].array.count == 1)
        #expect(preview["rows"].array.allSatisfy { $0["category"].string == "Acme Division" })
        let pdf = try await api.bytes(
            VaultRequest("api/timesheet/invoices/\(invoice["id"].string)/pdf", scope: .init())
        )
        #expect(pdf.starts(with: Data("%PDF".utf8)))
        _ = try await call(api, "api/timesheet/invoices/\(invoice["id"].string)", "DELETE")
        _ = try await call(api, "api/timesheet/entries/\(id)", "DELETE")
    }

    @Test func recurringTasksCanBeCompletedAndReopened() async throws {
        let api = try await client()
        let event = try await call(
            api, "api/calendar/events", "POST",
            #"{"kind":"task","title":"Acme recurring task","date":"2026-10-06","recurrence":{"interval":1,"unit":"month","anchor":"afterCompletion"}}"#
        )["event"]
        let id = event["id"].string
        _ = try await call(
            api, "api/calendar/events/\(id)/complete", "POST",
            #"{"occurrenceDate":"2026-10-06","completedOn":"2026-10-07"}"#
        )
        let completed = try await call(
            api, "api/calendar/occurrences?start=2026-10-01&end=2026-11-30&includeCompleted=true"
        )[
            "occurrences"
        ].array
        #expect(
            completed.contains { $0["eventId"].string == id && $0["date"].string == "2026-11-07" }
        )
        _ = try await call(
            api, "api/calendar/events/\(id)/uncomplete", "POST", #"{"occurrenceDate":"2026-10-06"}"#
        )
        _ = try await call(api, "api/calendar/events/\(id)", "DELETE")
    }

    @Test func healthProductsIllnessResearchAndChatPersist() async throws {
        let api = try await client()
        let product = try await call(
            api, "api/health/demo-person/nutrition", "POST",
            #"{"brandName":"Acme Nutrition","productName":"Demo Product","status":"considering","notes":"Synthetic only"}"#
        )["entry"]
        _ = try await call(
            api, "api/health/demo-person/nutrition/\(product["id"].string)", "PATCH",
            #"{"status":"active","dose":{"amount":1,"unit":"tablet","frequency":"daily"}}"#
        )
        let read = try await call(api, "api/health/demo-person/nutrition/\(product["id"].string)")
        #expect(read["entry"]["status"].string == "active")
        _ = try await call(
            api, "api/health/demo-person/nutrition/\(product["id"].string)", "DELETE"
        )
        let illness = try await call(
            api, "api/health/demo-person/sickness", "POST",
            #"{"title":"Synthetic illness","startDate":"2026-10-06","category":"other","severity":"mild","symptoms":["Synthetic symptom"]}"#
        )["log"]
        _ = try await call(
            api, "api/health/demo-person/sickness/\(illness["id"].string)", "PATCH",
            #"{"notes":"Reviewed"}"#
        )
        _ = try await call(api, "api/health/demo-person/sickness/\(illness["id"].string)", "DELETE")
        let research = try await call(
            api, "api/research/text", "POST",
            #"{"title":"Synthetic research","text":"An invented note for integration testing.","domain":"health"}"#
        )["entry"]
        _ = try await call(
            api, "api/research/\(research["id"].string)", "PATCH",
            #"{"notes":"Reviewed synthetic research"}"#
        )
        _ = try await call(api, "api/research/\(research["id"].string)", "DELETE")
        let threadID = UUID().uuidString.lowercased()
        _ = try await call(
            api, "api/chat/threads/\(threadID)", "PUT",
            #"{"title":"Synthetic chat","messages":[{"role":"user","content":"Demo message"},{"role":"assistant","content":"Demo answer"}]}"#
        )
        #expect(try await call(api, "api/chat/threads/\(threadID)")["messages"].array.count == 2)
        _ = try await call(api, "api/chat/threads/\(threadID)", "DELETE")
    }

    @Test func documentsFormsSchedulesAndEncryptedBackupsUseRealContracts() async throws {
        let api = try await client()
        let files = try await api.files(entity: "acme")
        let form = try #require(files.first { $0.name == "Synthetic Form.pdf" })
        let bytes = try await api.document(form, entity: "acme")
        let decoded = try await api.uploadBytes(
            VaultRequest("api/forms/decode", scope: .init()), data: bytes
        )
        #expect(decoded["fillable"].boolean)
        #expect(decoded["fields"].array.count == 2)
        let filled = try await api.bytes(
            VaultRequest("api/forms/fill", scope: .init()), method: "POST",
            body: .object([
                "pdfBase64": .string(bytes.base64EncodedString()),
                "values": .object(["DemoName": .string("John Doe"), "DemoConsent": .bool(true)]),
                "flatten": .bool(true),
            ])
        )
        #expect(filled.starts(with: Data("%PDF".utf8)))
        let path = try await api.upload(
            data: Data("Synthetic document".utf8), entity: "acme", folder: "integration",
            name: "Temporary.txt", contentType: "text/plain"
        )
        _ = try await call(
            api, "api/rename", "POST",
            "{\"entity\":\"acme\",\"filePath\":\"\(path)\",\"newFilename\":\"Renamed.txt\"}"
        )
        _ = try await call(
            api, "api/move", "POST",
            #"{"entity":"acme","from":"integration/Renamed.txt","to":"integration/Moved.txt"}"#
        )
        _ = try await call(api, "api/file/acme/integration/Moved.txt", "DELETE")
        var schedules = try await call(api, "api/schedules")
        for key in [
            "snapshotEnabled", "dropboxSyncEnabled", "quantRefreshEnabled",
            "politicsRefreshEnabled", "dailyNewsEnabled",
        ] {
            schedules.set(key, .bool(false))
        }
        _ = try await api.request(
            VaultRequest("api/schedules", scope: .init()), method: "PUT", body: schedules
        )
        let saved = try await call(api, "api/schedules")
        let fields = try #require(NativeCatalog.features.first { $0.id == "settings" }?.resources.first {
            $0.id == "schedules"
        }?.editFields)
        var values = Dictionary(
            uniqueKeysWithValues: fields.map {
                ($0.id, NativeForm.display(saved.at($0.id), field: $0))
            }
        )
        values["timezone"] = "UTC"
        let body = try NativeForm.body(fields: fields, values: values, original: saved)
        _ = try await api.request(
            VaultRequest("api/schedules", scope: .init()), method: "PUT", body: body
        )
        #expect(try await call(api, "api/schedules")["snapshotEnabled"] == .bool(false))
        let backup = try await api.bytes(
            VaultRequest("api/backup", scope: .init()), method: "POST",
            body: .object(["password": .string("synthetic-backup-password")])
        )
        let backupFile = FileManager.default.temporaryDirectory.appendingPathComponent("Synthetic-\(UUID()).enc")
        try backup.write(to: backupFile, options: .completeFileProtection)
        defer { try? FileManager.default.removeItem(at: backupFile) }
        let restored = try await api.restoreBackup(fileURL: backupFile, password: "synthetic-backup-password")
        #expect(restored["ok"].boolean)
    }
}
