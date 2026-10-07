@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeTimesheetReportTests {
    private func config() -> VaultValue {
        NativeTimesheetReportDemo.seed["weeklyReport"]
    }

    private func preview() throws -> NativeReportPreview {
        try .init(NativeTimesheetReportDemo.preview(store: NativeTimesheetReportDemo.seed, config: config(), end: "2026-10-07"))
    }

    private func review() throws -> NativeReportReview {
        try .init(config: config(), preview: preview(), mail: NativeTimesheetReport.mailReview(NativeProviderDemo.settings))
    }

    @Test func configNormalizationMatchesStrictTypesRangesAndServerOwnedWatermarks() throws {
        let value = NativeTimesheetReport.normalized(.object(["enabled": .string("true"), "to": .number(123), "day": .number(2.5), "hour": .number(1e308), "windowDays": .number(.nan), "cadence": .string("unsupported"), "clientIds": .array([.string("missing-client"), .number(123), .string("")]), "lastSentWeek": .string("2026-10-02"), "lastSentAt": .string("2026-10-02T15:00:00Z")]))
        #expect(value["enabled"] == .bool(false) && value["to"] == .string(""))
        #expect(value["day"].number == 3 && value["hour"].number == 23 && value["windowDays"].number == 7)
        #expect(value["cadence"].string == "weekly" && value["clientIds"].array == [.string("missing-client")])
        let body = try NativeReportDraft(value).body()
        #expect(body["lastSentWeek"] == .null && body["lastSentAt"] == .null)
        #expect(body.object.keys.sorted() == NativeTimesheetReport.fields.filter { $0 != "timezone" }.sorted())
        #expect(value["lastSentWeek"].string == "2026-10-02")
    }

    @Test func draftsKeepLiteralKeywordsRuleOrderAndUnavailableScopeSelections() throws {
        var value = config(); value.set("clientIds", .array([.string("archived-client"), .string("missing-client")]))
        value.set("categories", .array([.object(["name": .string("Literal"), "keywords": .array([.string("design, implementation"), .string("first\nsecond")])]), .object(["name": .string("Fallback"), "keywords": .array([.string("design")])])]))
        var draft = NativeReportDraft(value)
        #expect(try draft.body()["categories"] == value["categories"])
        #expect(try draft.body()["clientIds"] == value["clientIds"])
        #expect(NativeTimesheetReport.scope(value, store: NativeTimesheetReportDemo.seed, key: "clientIds").contains("missing-client"))
        draft.categories.swapAt(0, 1)
        #expect(try draft.body()["categories"].array.first?["name"].string == "Fallback")
        #expect(NativeTimesheetReportDemo.category(description: "design, implementation", project: "Acme", rules: try draft.body()["categories"].array, subClient: "") == "Fallback")
    }

    @Test func invalidScheduleRecipientAndNamingFieldsRemainErrors() throws {
        var draft = NativeReportDraft(config()); draft.enabled = true; draft.to = " "
        #expect(throws: VaultError.self) { try draft.body() }
        draft.enabled = false
        #expect(try draft.body()["to"] == .string(""))
        for value in ["0", "91", "7.5", "NaN", "1e308"] {
            draft.windowDays = value; #expect(throws: VaultError.self) { try draft.body() }
        }
        draft.windowDays = "7"; draft.timezone = "Invented/Timezone"
        #expect(throws: VaultError.self) { try draft.body() }
        draft.timezone = " UTC "; #expect(try draft.body()["timezone"].string == "UTC")
        draft.timezone = ""; #expect(try draft.body()["timezone"] == .null)
        draft.categories.append(.init(name: "", keywords: ["literal"])); #expect(throws: VaultError.self) { try draft.body() }
        #expect(throws: VaultError.self) { try NativeTimesheetReport.previewPath(end: "2026-02-29") }
        #expect(throws: VaultError.self) { try NativeTimesheetReport.previewPath(end: "2026-10-07T00:00:00Z") }
        #expect(try NativeTimesheetReport.previewPath(end: "") == "api/timesheet/weekly-report/preview")
    }

    @Test func clearingOrAddingToRestrictedScopesNeedsAnExplicitExpansionReview() {
        var original = config(); original.set("clientIds", .array([.string("a"), .string("b")])); original.set("projectIds", .array([.string("p")]))
        var draft = NativeReportDraft(original)
        #expect(!NativeTimesheetReport.expandsScope(original, draft: draft))
        draft.clientIds = ["a"]; #expect(!NativeTimesheetReport.expandsScope(original, draft: draft))
        draft.clientIds = []; #expect(NativeTimesheetReport.expandsScope(original, draft: draft))
        draft.clientIds = ["a", "c"]; #expect(NativeTimesheetReport.expandsScope(original, draft: draft))
        draft.clientIds = ["a"]; draft.projectIds = []; #expect(NativeTimesheetReport.expandsScope(original, draft: draft))
        #expect(!NativeTimesheetReport.expandsScope(config(), draft: draft))
    }

    @Test func savePreflightRejectsChangedScopesBeforeWritingAndIgnoresSendWatermarks() async throws {
        let original = config(); var draft = NativeReportDraft(original); draft.windowDays = "14"
        var changed = original; changed.set("clientIds", .array([.string("other-client")]))
        var writes = 0
        await #expect(throws: VaultError.self) {
            try await NativeTimesheetReport.save(original: original, draft: draft, fetch: { .object(["config": changed]) }, write: { _ in writes += 1; return .null })
        }
        #expect(writes == 0)
        changed = original; changed.set("lastSentWeek", .string("2026-10-07")); changed.set("lastSentAt", .string("2026-10-07T15:00:00Z"))
        let saved = try await NativeTimesheetReport.save(original: original, draft: draft, fetch: { .object(["config": changed]) }, write: { body in
            writes += 1; #expect(body["lastSentWeek"] == .null && body["windowDays"].number == 14)
            var response = body; response.set("lastSentWeek", changed["lastSentWeek"]); return .object(["ok": .bool(true), "config": response])
        })
        #expect(writes == 1 && saved["lastSentWeek"].string == "2026-10-07")
    }

    @Test func savingRequiresAConfirmedConfigurationResponse() async throws {
        for result: VaultValue in [.object(["ok": .bool(false)]), .object(["ok": .bool(true)]), .object(["ok": .bool(true), "config": .array([])])] {
            await #expect(throws: VaultError.self) { try await NativeTimesheetReport.save(original: config(), draft: NativeReportDraft(config()), fetch: { .object(["config": config()]) }, write: { _ in result }) }
        }
    }

    @Test func previewPreservesZerosSignedAmountsDuplicateRowsAndUnavailableNumbers() throws {
        var value = try preview().value
        let row: VaultValue = .object(["date": .string("2026-10-07"), "category": .string("Acme adjustments"), "minutes": .number(0), "amount": .number(-5), "description": .string("A duplicate preserved row")])
        value.set("rows", .array([row, row])); value.set("totalMinutes", .number(0)); value.set("totalAmount", .number(-10))
        var report = try NativeReportPreview(value)
        #expect(report.rows.count == 2 && Set(report.rows.map(\.id)).count == 2)
        #expect(report.totalMinutes == 0 && report.totalAmount == -10)
        #expect(report.groups.first?.minutes == 0 && report.groups.first?.amount == -10)
        #expect(report.daily.count == 1 && report.daily.first?.label == "2026-10-07" && report.daily.first?.amount == 0)
        var unknown = row; unknown.set("minutes", .string("0")); unknown.set("amount", .null); unknown.set("date", .string("invalid"))
        value.set("rows", .array([row, unknown])); report = try .init(value)
        #expect(report.groups.first?.minutes == nil && report.groups.first?.amount == nil)
        #expect(report.rows.last?.date == nil && report.daily.count == 1)
        #expect(report.filtered("duplicate", category: "Acme adjustments").count == 2)
        #expect(report.filtered("", category: "other").isEmpty)
    }

    @Test func emptyPreviewsDoNotInventRowsAndBadShapesCannotBecomeSuccessfulReports() throws {
        var value = try NativeTimesheetReportDemo.preview(store: NativeTimesheetReportDemo.seed, config: config(), end: "2024-01-01")
        let empty = try NativeReportPreview(value)
        #expect(empty.rows.isEmpty && empty.groups.isEmpty && empty.daily.isEmpty)
        #expect(empty.totalMinutes == 0 && empty.totalAmount == 0)
        value.set("window.start", .string("2024-01-02")); #expect(throws: VaultError.self) { try NativeReportPreview(value) }
        value.set("window.start", .string("2023-12-26")); value.set("csv", .null); #expect(throws: VaultError.self) { try NativeReportPreview(value) }
        #expect(throws: VaultError.self) { try NativeReportPreview(.object(["ok": .bool(true)])) }
    }

    @Test func fullExportsPreserveServerCsvHtmlMultilineDescriptionsAndZeroValues() throws {
        let report = try preview(), folder = FileManager.default.temporaryDirectory.appendingPathComponent("NativeReport-\(UUID())")
        defer { try? FileManager.default.removeItem(at: folder) }
        let csv = try report.export("csv", folder: folder), html = try report.export("html", folder: folder)
        #expect(try String(contentsOf: csv, encoding: .utf8) == report.value["csv"].string)
        #expect(try String(contentsOf: html, encoding: .utf8) == report.value["html"].string)
        #expect(csv.lastPathComponent == "timesheet-2026-10-01-to-2026-10-07.csv")
        #expect(report.value["csv"].string.contains("\"Implementation, \"\"review\"\" and delivery\""))
        #expect(report.value["csv"].string.contains("Research and design\nReview recorded scope"))
        #expect(report.value["csv"].string.contains("0.25,0.00,0.00,yes"))
        #expect(throws: VaultError.self) { try report.export("../pdf", folder: folder) }
    }

    @Test func reportScopesExcludeOtherClientsAndMissingProjectsWhileRecordedSubClientsWin() throws {
        var store = NativeTimesheetReportDemo.seed, scoped = config(); scoped.set("clientIds", .array([.string("acme-client")]))
        var orphan = try #require(store["entries"].array.first); orphan.set("id", .string("orphan")); orphan.set("projectId", .string("missing"))
        store.set("entries", .array(store["entries"].array + [orphan]))
        let report = try NativeReportPreview(NativeTimesheetReportDemo.preview(store: store, config: scoped, end: "2026-10-07"))
        #expect(report.rows.count == 5 && report.rows.allSatisfy { $0.value["client"].string == "Acme Client" })
        let studio = try #require(report.rows.first { $0.value["subClient"].string == "Acme Studio" })
        #expect(studio.category == "Acme Studio" && studio.minutes == 60)
        let sameDay = report.rows.filter { $0.value["date"].string == "2026-10-06" }
        #expect(sameDay.first?.value["subClient"].string == "Acme Studio" && sameDay.last?.minutes == 45)
        scoped.set("projectIds", .array([.string("other-project")]))
        #expect(try NativeReportPreview(NativeTimesheetReportDemo.preview(store: store, config: scoped, end: "2026-10-07")).rows.isEmpty)
        #expect(NativeTimesheetReportDemo.category(description: "research design", project: "Acme", rules: config()["categories"].array, subClient: "") == "Development")
        #expect(NativeTimesheetReportDemo.category(description: "", project: "", rules: [], subClient: "") == "Uncategorized")
    }

    @Test func demoWindowsUseInclusiveUtcDaysAndServerTimezoneTodayAndKeepWatermarks() throws {
        #expect(try NativeTimesheetReportDemo.window(end: "2024-03-01", days: 2)["start"].string == "2024-02-29")
        var stores: [String: VaultValue] = [:], cfg = config(); cfg.set("timezone", .string("America/Los_Angeles")); cfg.set("lastSentWeek", .string("2026-10-02"))
        var seeded = NativeTimesheetReportDemo.seed; seeded.set("weeklyReport", cfg); stores["api/timesheet"] = seeded
        let now = try #require(ISO8601DateFormatter().date(from: "2026-10-07T01:00:00Z"))
        let report = try #require(NativeTimesheetReportDemo.request(VaultRequest("api/timesheet/weekly-report/preview", scope: .init()), method: "GET", body: nil, stores: &stores, now: now))
        #expect(report["window"]["end"].string == "2026-10-06")
        var forged = cfg; forged.set("lastSentWeek", .string("1999-01-01"))
        let saved = try #require(NativeTimesheetReportDemo.request(VaultRequest("api/timesheet/weekly-report/config", scope: .init()), method: "PUT", body: forged, stores: &stores, now: now))
        #expect(saved["config"]["lastSentWeek"].string == "2026-10-02")
        let sent = try #require(NativeTimesheetReportDemo.request(VaultRequest("api/timesheet/weekly-report/send", scope: .init()), method: "POST", body: .object([:]), stores: &stores, now: now))
        #expect(sent["demo"] == .bool(true) && sent["weekEnd"].string == "2026-10-06")
        #expect(stores["api/timesheet"]?["weeklyReport"]["lastSentWeek"].string == "2026-10-06")
    }

    @Test func loadingAReviewRejectsMidLoadConfigurationChanges() async throws {
        var count = 0, changed = config(); changed.set("to", .string("changed@example.com"))
        await #expect(throws: VaultError.self) {
            try await NativeTimesheetReport.review(end: "2026-10-07") { path in
                if path.hasSuffix("config") {
                    count += 1; return .object(["config": count == 1 ? config() : changed])
                }
                if path == "api/settings" {
                    return NativeProviderDemo.settings
                }
                return try preview().value
            }
        }
        #expect(count == 2)
        count = 0; changed = config(); changed.set("lastSentWeek", .string("2026-10-07"))
        let loaded = try await NativeTimesheetReport.review(end: "2026-10-07") { path in
            if path.hasSuffix("config") {
                count += 1; return .object(["config": count == 1 ? config() : changed])
            }
            return path == "api/settings" ? NativeProviderDemo.settings : try preview().value
        }
        #expect(loaded.alreadySent && loaded.cc == "billing@example.com")
    }

    @Test func sendPreflightRejectsChangedRowsRecipientsCcAndScopeBeforeCallingSender() async throws {
        let original = try review(); var sends = 0
        for key in ["to", "clientIds", "projectIds"] {
            var cfg = original.config; cfg.set(key, key == "to" ? .string("changed@example.com") : .array([.string("other")]))
            let fresh = NativeReportReview(config: cfg, preview: original.preview, mail: original.mail)
            await #expect(throws: VaultError.self) { try await NativeTimesheetReport.send(review: original, fetch: { fresh }, send: { _ in sends += 1; return .null }) }
        }
        var mail = original.mail; mail.set("cc.client", .string("changed@example.com"))
        await #expect(throws: VaultError.self) { try await NativeTimesheetReport.send(review: original, fetch: { .init(config: original.config, preview: original.preview, mail: mail) }, send: { _ in sends += 1; return .null }) }
        var response = original.preview.value; response.set("csv", .string("Changed saved CSV"))
        let fresh = try NativeReportReview(config: original.config, preview: .init(response), mail: original.mail)
        await #expect(throws: VaultError.self) { try await NativeTimesheetReport.send(review: original, fetch: { fresh }, send: { _ in sends += 1; return .null }) }
        var alreadySent = original.config; alreadySent.set("lastSentWeek", .string(original.preview.end))
        await #expect(throws: VaultError.self) { try await NativeTimesheetReport.send(review: original, fetch: { .init(config: alreadySent, preview: original.preview, mail: original.mail) }, send: { _ in sends += 1; return .null }) }
        #expect(sends == 0)
        let result = try await NativeTimesheetReport.send(review: original, fetch: { original }, send: { body in
            sends += 1; #expect(body == .object(["end": .string("2026-10-07")]))
            return .object(["ok": .bool(true), "sentTo": .string("reader@example.com"), "weekEnd": .string("2026-10-07")])
        })
        #expect(sends == 1 && result["sentTo"].string == "reader@example.com")
        await #expect(throws: VaultError.self) { try await NativeTimesheetReport.send(review: original, fetch: { original }, send: { _ in .object(["ok": .bool(false)]) }) }
    }
}
