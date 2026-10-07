@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeAdministrationTests {
    @Test func markdownStatsUseUTF8AndIgnoreFencedHeadings() {
        let text = "# Overview\n\nUnicode 🧪\n\n```md\n# Not a heading\n```\n\n## Decisions\n\nKeep evidence."
        let stats = NativeMarkdownStats(text)
        #expect(stats.bytes == text.utf8.count && stats.bytes > text.count)
        #expect(stats.headings == 2 && stats.sections.count == 2)
        #expect(stats.sections.reduce(0) { $0 + Int($1.amount) } == stats.words)
        #expect(NativeMarkdownStats("").words == 0 && NativeMarkdownStats("").lines == 0)
    }

    @Test func skillValidationSearchAndSortRespectServerNames() {
        for name in ["a", "1-review", String(repeating: "a", count: 64)] {
            #expect(NativeAdministration.validSkillName(name))
        }
        for name in ["", "../skill", "Upper", "-skill", "with space", String(repeating: "a", count: 65)] {
            #expect(!NativeAdministration.validSkillName(name))
        }
        #expect(NativeAdministration.skillError(name: "review", description: " ", instructions: "# Instructions") != nil)
        #expect(NativeAdministration.skillError(name: "review", description: "Source review", instructions: "\n") != nil)
        let rows: [VaultValue] = [.object(["name": .string("zebra"), "description": .string("Saved source"), "updatedAt": .string("2026-10-01")]), .object(["name": .string("alpha"), "description": .string("Other"), "updatedAt": .null])]
        #expect(NativeAdministration.skills(rows, query: "  SOURCE ", recent: false).map { $0["name"].string } == ["zebra"])
        #expect(NativeAdministration.skills(rows, query: "", recent: false)[0]["name"].string == "alpha")
        #expect(NativeAdministration.skills(rows, query: "", recent: true)[0]["name"].string == "zebra")
    }

    @Test func sourceStatusAndURLPreserveFailuresAndKeepTokensOutOfCloneURLs() {
        #expect(NativeAdministration.sourceOutcome(.object(["lastSyncedAt": .string("2026-10-01"), "lastError": .string("Failed")])) == "Sync failed")
        #expect(NativeAdministration.sourceOutcome(.null) == "Not synced yet")
        #expect(NativeAdministration.repositoryURL("https://user:secret@example.com/acme.git") == "https://example.com/acme.git")
        #expect(NativeAdministration.repositoryURL("http://example.com/repo") == nil)
        #expect(NativeAdministration.repositoryURL("file:///private/repo") == nil)
    }

    @Test func sourceBrowserCountsDescendantsAndSearchesAcrossFolders() {
        let files = NativeAdministrationDemo.files + ["../escape.md", "/outside.md", "Guides/../escape.md", "README.md"]
        let root = NativeSourceFiles.browse(files, folder: "", query: "")
        #expect(root.folders.map(\.name) == ["Archive", "Guides"] && root.folders.last?.count == 3 && root.files == ["README.md"])
        let guides = NativeSourceFiles.browse(files, folder: "Guides", query: "")
        #expect(guides.folders.first?.path == "Guides/Planning" && guides.files == ["Guides/Overview.md"])
        #expect(NativeSourceFiles.browse(files, folder: "Guides", query: "  ARCHIVE ").files == ["Archive/Notes.md"])
        #expect(NativeSourceFiles.browse(files, folder: "Guide", query: "").files.isEmpty)
    }

    @Test func pageLinksResolveRelativeWikiAndAmbiguityWithoutEscapingTheRepository() {
        let files = NativeAdministrationDemo.files
        #expect(NativeSourceFiles.resolve("Overview", current: "README.md", files: files, wiki: true) == "Guides/Overview.md")
        #expect(NativeSourceFiles.resolve("Overview.md", current: "README.md", files: files, wiki: true) == "Guides/Overview.md")
        #expect(NativeSourceFiles.resolve("../README.md", current: "Guides/Overview.md", files: files, wiki: false) == "README.md")
        #expect(NativeSourceFiles.resolve("Guides/Planning/Checklist#review", current: "README.md", files: files, wiki: true) == "Guides/Planning/Checklist.md")
        #expect(NativeSourceFiles.resolve("Notes", current: "README.md", files: files, wiki: true) == nil)
        #expect(NativeSourceFiles.resolve("../../README.md", current: "README.md", files: files, wiki: false) == nil)
        #expect(NativeSourceFiles.resolve("%2e%2e/private.md", current: "README.md", files: files, wiki: false) == nil)
        #expect(NativeSourceFiles.linkifyWiki("Before 🧪 [[Overview|Read page]] after").contains("docvault-source://wiki?target=Overview"))
        #expect(NativeSourceFiles.linkifyWiki("![[image.png]]") == "![[image.png]]")
        #expect(NativeSourceFiles.linkifyWiki("`[[Overview]]`\n\n```md\n[[Overview]]\n```") == "`[[Overview]]`\n\n```md\n[[Overview]]\n```")
    }

    @Test func demoMemorySkillsAndSourcesRemainEditableWithoutRealServerActions() throws {
        let store = NativeDemoStore()
        func call(_ path: String, _ method: String = "GET", _ body: VaultValue? = nil) throws -> VaultValue {
            try store.request(VaultRequest(path, scope: .init()), method: method, body: body)
        }
        _ = try call("api/brain", "PUT", .object(["content": .string("# Saved demo 🧪")]))
        #expect(try call("api/brain")["bytes"].number == Double("# Saved demo 🧪".utf8.count))
        _ = try call("api/brain/append", "POST", .object(["text": .string("Keep exact quotes"), "tag": .string("preference")]))
        #expect(try call("api/brain")["content"].string.contains("preference"))
        _ = try call("api/skills/acme-new", "PUT", .object(["description": .string("Fake skill"), "instructions": .string("# Read the source")]))
        #expect(try call("api/skills")["skills"].array.count == 3)
        #expect(try call("api/skills/acme-new")["instructions"].string == "# Read the source")
        _ = try call("api/skills/acme-new", "DELETE")
        #expect(try call("api/skills")["skills"].array.count == 2)
        #expect(try call("api/external-sources/acme-library/files")["files"].array.count == 5)
        #expect(try call("api/external-sources/acme-library/file?path=Guides/Overview.md")["content"].string.contains("Overview"))
        _ = try call("api/external-sources/token", "PUT", .object(["token": .string("synthetic-token")]))
        let sources = try call("api/external-sources")
        #expect(sources["tokenConfigured"].boolean && sources["token"] == .null)
    }
}
