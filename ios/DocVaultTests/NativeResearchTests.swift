@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeResearchTests {
    @Test func allInboxEntryPointsUseTheServerDomainVocabulary() throws {
        for id in ["quant-research", "research-quant", "research-health", "research-politics", "research-tech", "research-local"] {
            let resource = try #require(NativeCatalog.resource(id))
            let domain = try #require(ResearchDomain.resource(resource))
            #expect(try VaultRequest(resource.path, scope: .init()).query["domain"] == domain.rawValue)
            #expect(resource.actions.count == 4 && resource.collections.first?.updateMethod == "PATCH")
            let text = try #require(resource.actions.first { $0.id == "text" })
            #expect(!text.fields.contains { $0.id == "notes" })
            #expect(text.fields.first { $0.id == "domain" }?.initial == domain.rawValue)
        }
        #expect(ResearchDomain.resource(.init(id: "quant-research", title: "Invalid", path: "api/research?domain=quant")) == nil)
        #expect(ResearchDomain.resource(.init(id: "arbitrary", title: "Unknown", path: "api/research?domain=health")) == nil)
    }

    @Test func domainIsolationAllowsLegacyFinanceButNeverUnknownOrOtherDomains() {
        let rows: [VaultValue] = [
            .object(["id": .string("legacy"), "title": .string("Old finance source")]),
            .object(["id": .string("finance"), "domain": .string("finance")]),
            .object(["id": .string("health"), "domain": .string("health")]),
            .object(["id": .string("invalid"), "domain": .string("quant")]),
        ]
        let data = VaultValue.object(["entries": .array(rows)])
        #expect(Set(NativeResearch(data: data, domain: .finance).entries.map { $0.value["id"].string }) == ["legacy", "finance"])
        #expect(NativeResearch(data: data, domain: .health).entries.map { $0.value["id"].string } == ["health"])
        #expect(NativeResearch(data: data, domain: .politics).entries.isEmpty)
    }

    @Test func savedStatsRespectStatusMediaFiltersAndMalformedDates() {
        let data = VaultValue.object(["entries": .array([
            .object(["id": .string("text"), "domain": .string("tech"), "title": .string("Acme signal"), "mediaType": .string("text/plain"), "text": .string("Saved text"), "publisher": .string("Acme"), "reportDate": .string("2026-02-01"), "tags": .array([.string("sample")]), "intelligence": .object(["claims": .array([.object(["stance": .string("watch")])])])]),
            .object(["id": .string("audio"), "domain": .string("tech"), "mediaType": .string("audio/wav"), "transcribeStatus": .string("running"), "reportDate": .string("2026-01-01")]),
            .object(["id": .string("error"), "domain": .string("tech"), "mediaType": .string("application/pdf"), "extractError": .string("Synthetic error"), "reportDate": .string("2026-02-30")]),
        ])])
        let report = NativeResearch(data: data, domain: .tech)
        #expect(report.entries.count == 3 && report.claims == 1 && report.summaries == 0)
        #expect(report.monthly.map(\.label) == ["Jan 2026", "Feb 2026"])
        #expect(report.filtered(search: "SAMPLE", media: "Text", status: "Text available").count == 1)
        #expect(report.filtered(media: "Audio", status: "Processing").count == 1)
        #expect(report.filtered(status: "Needs attention").count == 1)
        #expect(report.filtered(publisher: "Acme").count == 1)
        #expect(report.filtered(publisher: "").count == 2)
        #expect(report.publishers.map(\.amount).reduce(0, +) == 3)
    }

    @Test func exactQuotesUseJavaScriptUTF16OffsetsAndRejectStaleOrInvalidRanges() {
        let text = "Before 🧪 quoted text after"
        let quote = "🧪 quoted text"
        let range = (text as NSString).range(of: quote)
        var provenance = VaultValue.object(["quote": .string(quote), "charStart": .number(Double(range.location)), "charEnd": .number(Double(range.location + range.length))])
        #expect(NativeResearch.quoteMatches(provenance, text: text))
        #expect(!NativeResearch.quoteMatches(provenance, text: "Changed source"))
        provenance.set("charStart", .number(-1)); #expect(!NativeResearch.quoteMatches(provenance, text: text))
        provenance.set("charStart", .number(0.5)); #expect(!NativeResearch.quoteMatches(provenance, text: text))
        provenance.set("charStart", .number(0)); provenance.set("charEnd", .number(Double(Int.max))); #expect(!NativeResearch.quoteMatches(provenance, text: text))
    }

    @Test func sourceLinksRejectUnsafeSchemesCredentialsAndRelativePaths() {
        #expect(NativeResearch.sourceURL(.string("https://example.com/source?q=1")) != nil)
        for raw in ["javascript:alert(1)", "file:///private/source", "/relative", "https://name:secret@example.com", "data:text/html,example"] {
            #expect(NativeResearch.sourceURL(.string(raw)) == nil)
        }
        #expect(NativeResearch.sourceSuffix(.object(["mediaType": .string("audio/wav")])) == "wav")
        #expect(NativeResearch.sourceSuffix(.object(["mediaType": .string("video/quicktime")])) == "mov")
        #expect(NativeResearch.importMime(filename: "Acme.MKV", current: "application/octet-stream", media: true) == "video/x-matroska")
        #expect(NativeResearch.importMime(filename: "Acme.wav", current: "audio/x-wav", media: true) == "audio/wav")
        #expect(NativeResearch.importMime(filename: "Acme.heic", current: "image/heic", media: true) == nil)
        #expect(NativeResearch.importMime(filename: "Acme.pdf", current: "application/octet-stream", media: false) == "application/pdf")
    }

    @Test func reportTotalsExcludeSamplesRunningAndMissingObservationsWithoutInventingZero() {
        let done = VaultValue.object(["status": .string("done"), "itemCount": .number(3), "sourceCount": .number(2), "createdAt": .string("2026-01-01T12:00:00Z")])
        var sample = done; sample.set("sample", .bool(true)); sample.set("itemCount", .number(100))
        var running = done; running.set("status", .string("running")); running.set("itemCount", .number(100))
        #expect(KnowledgeKind.news.knownItems([done, sample, running]) == 3)
        #expect(KnowledgeKind.research.knownItems([done, running]) == 2)
        #expect(KnowledgeKind.news.knownItems([.object(["status": .string("done")])]) == nil)
        #expect(KnowledgeKind.news.knownItems([]) == 0)
        #expect(KnowledgeKind.news.itemCount(.object(["itemCount": .number(-1)])) == nil)
        #expect(KnowledgeKind.news.itemCount(.object(["itemCount": .number(1.5)])) == nil)
        #expect(KnowledgeKind.research.monthly([done]).first?.label == "Jan 2026")
    }

    @Test func normalizedStagedMimePreservesBytesAndCleanupOwnership() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("Acme.wav"); let bytes = Data("synthetic".utf8); try bytes.write(to: source)
        let original = try await UploadDraft.stageAsync(source, maximumSize: 100)
        let normalized = original.withContentType("audio/wav")
        #expect(normalized.fileURL == original.fileURL && normalized.size == Int64(bytes.count) && normalized.contentType == "audio/wav")
        #expect(try Data(contentsOf: #require(normalized.fileURL)) == bytes)
        normalized.removeStagedFiles()
        #expect(FileManager.default.fileExists(atPath: source.path))
        #expect(!FileManager.default.fileExists(atPath: try #require(original.fileURL).path))
    }

    @Test func editableDemoSourcesAndJobsKeepDomainsAndUseCorrectDownloadTypes() throws {
        let store = NativeDemoStore()
        let finance = try store.request(VaultRequest("api/research?domain=finance", scope: .init()), method: "GET", body: nil)
        #expect(finance["entries"].array.count == 1)
        let created = try store.request(VaultRequest("api/research/text", scope: .init()), method: "POST", body: .object(["domain": .string("health"), "title": .string("Acme test source"), "text": .string("Verbatim demo source.")]))["entry"]
        _ = try store.request(VaultRequest("api/research/{id}", scope: .init(), record: created), method: "PATCH", body: .object(["notes": .string("Demo note")]))
        let health = try store.request(VaultRequest("api/research?domain=health", scope: .init()), method: "GET", body: nil)
        #expect(health["entries"].array.count == 2 && health["entries"].array.allSatisfy { $0["domain"].string == "health" })
        let bytes = try #require(try store.researchDownload(VaultRequest("api/research/{id}/file", scope: .init(), record: created), suffix: "txt"))
        #expect(String(data: bytes, encoding: .utf8) == "Verbatim demo source.")
        let run = try store.request(VaultRequest("api/deep-research/run", scope: .init()), method: "POST", body: .object(["question": .string("Demo query"), "maxSearches": .number(4)]))
        let request = try VaultRequest("api/deep-research/{id}", scope: .init(), record: run)
        #expect(try store.request(request, method: "GET", body: nil)["status"].string == "running")
        #expect(try store.request(request, method: "GET", body: nil)["status"].string == "done")
        let html = try #require(try store.researchDownload(VaultRequest("api/deep-research/{id}/report.html", scope: .init(), record: run), suffix: "html"))
        #expect(String(data: html, encoding: .utf8)?.hasPrefix("<!doctype html>") == true)
        #expect(String(data: NativeResearchDemo.silentWAV().prefix(4), encoding: .utf8) == "RIFF")
    }
}
