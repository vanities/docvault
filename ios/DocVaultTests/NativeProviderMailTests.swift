@testable import DocVault
import Foundation
import Testing

struct NativeProviderMailTests {
    @Test func focusedGroupsCoverEverySettingsFieldExactlyOnce() throws {
        let resources = try #require(NativeCatalog.features.first { $0.id == "settings" }).resources.filter { NativeProviderSettings.resourceIDs.contains($0.id) }
        #expect(resources.count == 5)
        for resource in resources {
            let ids = NativeProviderSettings.groups(resource).flatMap { $0.fields.map(\.id) } + NativeProviderSettings.credentials(resource).map(\.id)
            #expect(Set(ids) == Set(resource.editFields.map(\.id)))
            #expect(ids.count == Set(ids).count)
        }
    }

    @Test func partialNestedSavesPreserveUnrelatedChangesAndMissingDefaults() throws {
        let fields = [NativeField("weather.latitude", "Latitude", .number), NativeField("weather.enabled", "Enabled", .boolean)]
        let old: VaultValue = .object(["weather": .object(["latitude": .number(10), "label": .string("Acme location")])])
        var current = old; current.set("weather.label", .string("Revised fictional location"))
        var draft = NativeProviderSettings.initial(fields, old); draft["weather.latitude"] = "0"
        let patch = try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: current)
        #expect(patch == .object(["weather": .object(["latitude": .number(0)])]))
        #expect(patch["weather"]["enabled"] == .null && patch["weather"]["label"] == .null)
        current.set("weather.latitude", .number(20))
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: current) }
    }

    @Test func modelChangesKeepTheProviderModelPairAndClearThroughTheActualContract() throws {
        let fields = [NativeField("chat.apiModel.provider", "Provider", .choices(["anthropic", "openai"])), NativeField("chat.apiModel.model", "Model")]
        let old: VaultValue = .object(["chat": .object(["mode": .string("api"), "apiModel": .object(["provider": .string("openai"), "model": .string("demo-model")])])])
        var draft = NativeProviderSettings.initial(fields, old); draft["chat.apiModel.provider"] = "anthropic"
        let patch = try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old)
        #expect(patch == .object(["chat": .object(["apiModel": .object(["provider": .string("anthropic"), "model": .string("demo-model")])])]))
        draft["chat.apiModel.model"] = ""
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old) }
        draft["chat.apiModel.provider"] = ""
        #expect(try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old) == .object(["chat": .object(["apiModel": .null])]))
        var fresh = old; fresh.set("chat.apiModel.model", .string("newer-demo-model"))
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: fresh) }
    }

    @Test func secretInputsStayEmptyAndStatusChangesRequireReloading() throws {
        let field = NativeField("openaiApiKey", "OpenAI API key", .secret)
        let old: VaultValue = .object(["hasOpenaiKey": .bool(true), "openaiKeyHint": .string("demo"), "openaiApiKey": .string("invented-response-value")])
        #expect(NativeProviderSettings.initial([field], old)[field.id] == "")
        #expect(try NativeProviderSettings.patch(fields: [field], values: [field.id: ""], original: old, current: old).isEmpty)
        #expect(try NativeProviderSettings.patch(fields: [field], values: [field.id: "synthetic-new-key"], original: old, current: old) == .object([field.id: .string("synthetic-new-key")]))
        var changed = old; changed.set("openaiKeyHint", .string("new1"))
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: [field], values: [field.id: "synthetic-new-key"], original: old, current: changed) }
        #expect(NativeProviderSettings.credentials.first { $0.id == "email.resendApiKey" }?.clearBody == .object(["email": .object(["clearResendApiKey": .bool(true)])]))
        #expect(NativeProviderSettings.credentials.first { $0.id == "fredApiKey" }?.clearBody == .object(["fredApiKey": .string("")]))
    }

    @Test func modelEffortSurvivesFocusedChangesAndClearsAsPartOfTheReference() throws {
        let fields = [NativeField("chat.apiModel.provider", "Provider", .choices(["anthropic", "openai"])), NativeField("chat.apiModel.model", "Model"), NativeField("chat.apiModel.effort", "Effort", .choices(["minimal", "low", "medium", "high", "xhigh", "max"]))]
        let old = NativeProviderDemo.settings
        var draft = NativeProviderSettings.initial(fields, old); draft["chat.apiModel.model"] = "custom-demo-chat"
        let preserved = try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old)
        #expect(preserved["chat"]["apiModel"]["effort"] == .string("high"))
        #expect(preserved["chat"]["mode"] == .null && preserved["chat"]["backend"] == .null)
        draft["chat.apiModel.effort"] = ""
        let cleared = try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old)
        #expect(cleared["chat"]["apiModel"] == .object(["provider": .string("openai"), "model": .string("custom-demo-chat")]))
        var current = old; current.set("chat.apiModel.effort", .string("medium"))
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: current) }
        draft["chat.apiModel.effort"] = "max"
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old) }
        draft["chat.apiModel.provider"] = "anthropic"
        #expect(try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old)["chat"]["apiModel"]["effort"] == .string("max"))
        for component in NativeProviderSettings.modelComponents {
            draft["chat.apiModel." + component] = ""
        }
        #expect(try NativeProviderSettings.patch(fields: fields, values: draft, original: old, current: old)["chat"]["apiModel"] == .null)
        draft["chat.apiModel.effort"] = "high"
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: fields, values: draft, original: .null, current: .null) }
    }

    @Test func discoveredChoicesRetainTheirSourceAndDemoModelReplacementMatchesTheServer() throws {
        let list: VaultValue = .object(["models": .array([.string(" custom-demo "), .string("custom-demo"), .string(""), .number(3), .string("another-demo")]), "imageModels": .array([.string("demo-image")]), "source": .string("cache")])
        #expect(NativeProviderSettings.modelOptions(list) == ["custom-demo", "another-demo"])
        #expect(NativeProviderSettings.modelOptions(list, images: true) == ["demo-image"])
        #expect(NativeProviderSettings.modelSource(list) == "Saved server cache")
        #expect(NativeProviderSettings.modelSource(.object(["source": .string("fallback")])) == "Server fallback list")
        #expect(NativeProviderSettings.modelSource(.object(["source": .string("live")])) == "Live provider list")
        #expect(NativeProviderSettings.modelSource(.null) == "Unreported source")
        let themes: VaultValue = .object(["cycle": .object(["id": .string("cycle"), "label": .string("Rotate")]), "themes": .array([.object(["id": .string("cycle")]), .object(["id": .string("demo-theme"), "label": .string("Acme style")]), .object([:])])])
        #expect(NativeProviderSettings.themes(themes) == [.init(id: "cycle", title: "Rotate"), .init(id: "demo-theme", title: "Acme style")])
        #expect(NativeProviderSettings.efforts("anthropic").contains("max") && !NativeProviderSettings.efforts("openai").contains("max"))
        #expect(NativeProviderSettings.efforts("openai").contains("minimal") && NativeProviderSettings.efforts("").isEmpty)
        var stores: [String: VaultValue] = [:]
        let demoList = try #require(NativeProviderDemo.request(VaultRequest("api/models?provider=openai&refresh=1", scope: .init()), method: "GET", body: nil, stores: &stores))
        #expect(NativeProviderSettings.modelOptions(demoList).contains("demo-chat") && NativeProviderSettings.modelOptions(demoList, images: true) == ["demo-image"])
        _ = try NativeProviderDemo.request(VaultRequest("api/settings", scope: .init()), method: "POST", body: .object(["chat": .object(["apiModel": .object(["provider": .string("openai"), "model": .string("custom-demo")])])]), stores: &stores)
        let saved = try #require(NativeProviderDemo.request(VaultRequest("api/settings", scope: .init()), method: "GET", body: nil, stores: &stores))
        #expect(saved["chat"]["apiModel"]["effort"] == .null && saved["chat"]["apiModel"]["model"] == .string("custom-demo"))
        #expect(saved["chat"]["mode"] == .string("api") && saved["chat"]["backend"] == .string("codex"))
        try NativeProviderSettings.requireSaved(.object(["ok": .bool(true)]))
        #expect(throws: VaultError.self) { try NativeProviderSettings.requireSaved(.object(["ok": .bool(false), "error": .string("Invented save rejection")])) }
        #expect(throws: VaultError.self) { try NativeProviderSettings.requireSaved(.null) }
    }

    @Test func serviceSettingsRejectInvalidRangesAndUnsupportedClearing() throws {
        for (field, value) in [(NativeField("weather.latitude", "Latitude", .number), "91"), (NativeField("dailyNews.narration.defaultSpeed", "Speed", .number), "0.1"), (NativeField("weather.timezone"), "Not/AZone"), (NativeField("ttsUrl"), "file:///tmp/demo")] {
            #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: [field], values: [field.id: value], original: .null, current: .null) }
        }
        let field = NativeField("weather.latitude", "Latitude", .number)
        let old: VaultValue = .object(["weather": .object(["latitude": .number(0)])])
        #expect(throws: VaultError.self) { try NativeProviderSettings.patch(fields: [field], values: [field.id: ""], original: old, current: old) }
        let optional = NativeField("dailyNews.narration.cfgWeight", "Weight", .number)
        let settings: VaultValue = .object(["dailyNews": .object(["narration": .object(["cfgWeight": .number(0.5)])])])
        #expect(try NativeProviderSettings.patch(fields: [optional], values: [optional.id: ""], original: settings, current: settings).at(optional.id) == .null)
    }

    @Test func mailOutcomesUseTheRecordedBooleanAndPreserveUnknownResults() {
        #expect(NativeMailOutcome.of(.object(["ok": .bool(false), "providerId": .string("invented-id")])) == .failed)
        #expect(NativeMailOutcome.of(.object(["ok": .bool(true)])) == .accepted)
        #expect(NativeMailOutcome.of(.object(["ok": .string("true")])) == .unreported)
        #expect(NativeMail.description(NativeProviderDemo.mail[0]).contains("does not verify inbox delivery"))
        #expect(NativeMail.description(NativeProviderDemo.mail[1]).contains("Acme_Invoice_Demo.pdf"))
    }

    @Test func mailSearchFiltersDatesAndDailyCountsKeepEveryValidAttempt() throws {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let rows: [VaultValue] = [
            .object(["id": .string("before-midnight"), "at": .string("2026-11-01T03:30:00Z"), "purpose": .string("news"), "ok": .bool(false)]),
            .object(["id": .string("after-midnight"), "at": .string("2026-11-01T04:30:00.000Z"), "purpose": .string("client"), "ok": .bool(true), "to": .array([.string("acme@example.com")])]),
            .object(["id": .string("invalid"), "at": .string("invalid"), "purpose": .string("news")]),
        ]
        let now = try #require(NativeMail.instant(.object(["at": .string("2026-11-01T18:00:00Z")])))
        #expect(NativeMail.filtered(rows, days: 1, now: now, calendar: calendar).map { $0["id"].string } == ["after-midnight"])
        #expect(NativeMail.filtered(rows, query: "  ACME@ ").count == 1)
        #expect(NativeMail.filtered(rows, purpose: "news", outcome: "Failed").count == 1)
        #expect(NativeMail.filtered(rows).count == 3)
        let chart = NativeMail.daily(rows, calendar: calendar)
        #expect(chart.reduce(0) { $0 + $1.count } == 2 && Set(chart.map(\.date)).count == 2)
    }

    @Test func mailLatencyPreservesZeroAndExcludesMissingOrInvalidValues() {
        let rows: [VaultValue] = [.object(["elapsedMs": .number(0)]), .object(["elapsedMs": .number(10)]), .object(["elapsedMs": .number(-1)]), .object(["elapsedMs": .number(.infinity)]), .object([:])]
        #expect(NativeMail.medianLatency(rows) == 5)
        #expect(NativeMail.medianLatency([.null]) == nil)
    }

    @Test func demoSettingsPreserveSeparateCcAndNeverReturnSubmittedSecrets() throws {
        var stores: [String: VaultValue] = [:]
        func call(_ path: String, _ method: String = "GET", _ body: VaultValue? = nil) throws -> VaultValue {
            try #require(NativeProviderDemo.request(VaultRequest(path, scope: .init()), method: method, body: body, stores: &stores))
        }
        _ = try call("api/settings", "POST", .object(["email": .object(["cc": .object(["news": .string("revised@example.com")]), "resendApiKey": .string("synthetic-private-key")])]))
        let fresh = try call("api/settings")
        #expect(fresh["email"]["cc"]["news"].string == "revised@example.com" && fresh["email"]["cc"]["client"].string == "billing@example.com")
        #expect(fresh["email"]["hasResendApiKey"].boolean && fresh["email"]["resendApiKey"] == .null)
        #expect(!fresh.stringSearch.contains("synthetic-private-key"))
        _ = try call("api/settings", "POST", .object(["email": .object(["clearResendApiKey": .bool(true)])]))
        #expect(try !call("api/settings")["email"]["hasResendApiKey"].boolean)
        #expect(try call("api/email/log?purpose=client&limit=1")["entries"].array.count == 1)
        #expect(try call("api/email/test", "POST")["demo"].boolean)
        let test = try #require(call("api/email/log?purpose=test&limit=1")["entries"].array.first)
        #expect(test["cc"].array.isEmpty)
    }
}
