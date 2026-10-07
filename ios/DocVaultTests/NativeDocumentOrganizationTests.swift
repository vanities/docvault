@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeDocumentOrganizationTests {
    private func file(_ path: String = "2024/expenses/business/Acme_Receipt.pdf", parsed: VaultValue? = .object(["_documentType": .string("receipt"), "vendor": .string("Acme Supplies"), "amount": .number(0), "category": .string("equipment")])) -> VaultFile {
        .init(name: (path as NSString).lastPathComponent, path: path, size: 1234, lastModified: 1_704_067_200_000, type: "application/pdf", tags: ["Reviewed"], notes: "Invented reviewed note", entity: "acme", parsedData: parsed, tracked: false)
    }

    @Test func fileDecodingPreservesExcludedDefaultAndExplicitIncludedStates() throws {
        let base = #"{"name":"Sample.pdf","path":"Sample.pdf","size":1234,"lastModified":0,"type":"application/pdf"}"#
        let defaultFile = try JSONDecoder().decode(VaultFile.self, from: Data(base.utf8))
        #expect(defaultFile.tracked == nil && defaultFile.isTracked)
        for flag in [true, false] {
            let value = base.dropLast() + ",\"tracked\":\(flag)}"
            let file = try JSONDecoder().decode(VaultFile.self, from: Data(value.utf8))
            #expect(file.isTracked == flag)
            let encoded = try JSONDecoder().decode(VaultValue.self, from: JSONEncoder().encode(file))
            #expect(encoded["tracked"] == .bool(flag))
        }
    }

    @Test func trackingPatchesNeverResendNotesTagsOrParsedFields() throws {
        let patch = try NativeDocumentOrganization.metadataBody(file: file(), entity: "acme", tracked: false)
        #expect(patch.object.keys.sorted() == ["entity", "filePath", "tracked"])
        #expect(patch["tracked"] == .bool(false))
        let clearing = try NativeDocumentOrganization.metadataBody(file: file(), entity: "acme", notes: "", tags: [])
        #expect(clearing["notes"] == .string("") && clearing["tags"] == .array([]))
        #expect(clearing["tracked"] == .null && clearing["parsedData"] == .null)
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.metadataBody(file: file(), entity: "acme") }
    }

    @Test func sourceMetadataKeepsFolderYearParsedTypeDatesAndMissingAmounts() {
        let parsed: VaultValue = .object(["_documentType": .string("bank-statement"), "taxYear": .number(2025), "institution": .string("Acme Bank"), "date": .string("2024-02-29")])
        let value = NativeDocumentOrganization.metadata(file("2024/inbox/Statement.pdf", parsed: parsed), fallbackYear: 2026)
        #expect(value.type == "bank-statement" && value.year == "2024")
        #expect(value.month == "2" && value.day == "29" && value.source == "Acme Bank")
        #expect(value.parsedData?["amount"] == .null)
        let unknown = NativeDocumentOrganization.metadata(file("inbox/Sample.pdf", parsed: .object(["taxYear": .number(1e308)])), fallbackYear: 2026)
        #expect(unknown.year == "2026" && unknown.month.isEmpty && unknown.day.isEmpty)
        let business = file("business-docs/agreements/Operating_Agreement.pdf", parsed: nil)
        #expect(NativeDocumentOrganization.type(business) == "operating-agreement")
    }

    @Test func savedExtractionSuggestionsRetainManualChangesAndSourcePrecedence() throws {
        var value = NativeDocumentOrganization.metadata(file(), fallbackYear: 2024)
        value.source = "Manual Acme"; value.customName = "Literal_Name.pdf"; value.standardName = false
        value.edited = ["source", "month", "day", "filename"]
        let parsed: VaultValue = .object(["employerName": .string("Acme Employer"), "vendor": .string("Acme Vendor"), "date": .string("2024-02-29"), "amount": .number(0)])
        try NativeDocumentOrganization.suggest(parsed, metadata: &value)
        #expect(value.source == "Manual Acme" && value.customName == "Literal_Name.pdf" && !value.standardName)
        #expect(value.month.isEmpty && value.day.isEmpty)
        #expect(value.parsedData?["amount"] == .number(0))
        #expect(NativeDocumentOrganization.parsedSource(parsed) == "Acme Employer")
        #expect(NativeDocumentOrganization.parsedSource(.object(["vendor": .number(123)])) == nil)
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.suggest(.object(["amount": .number(0)]), metadata: &value) }
    }

    @Test func organizedPlansCoverAllTypesAndCanonicalExpenseFolders() throws {
        let original = file()
        for (type, _) in NativeDocumentImport.types {
            var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024)
            metadata.type = type; metadata.year = "2025"
            let plan = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "other", metadata: metadata, organize: true)
            let folder = try NativeDocumentImport.directory(type: type, category: metadata.category, year: 2025, filename: original.name)
            #expect(plan.destination == .init(entity: "other", path: folder + "/" + original.name))
            #expect(plan.source == .init(entity: "acme", path: original.path))
            #expect(plan.sourceSize == original.size && plan.sourceModified == original.lastModified)
        }
        for category in ["medical", "childcare", "home-improvement"] {
            var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.category = category
            let plan = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: true)
            #expect(plan.destination.path == "2024/expenses/\(category)/Acme_Receipt.pdf")
            #expect(plan.classification["category"] == .string(category))
        }
    }

    @Test func renameUsesTheRenameEndpointAndRetainsTheLiteralExtensionAndRoot() throws {
        let original = file("Sample.PDF", parsed: nil)
        var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.customName = "Acme #1 + 50%.PDF"
        let plan = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: false)
        #expect(plan.destination.path == "Acme #1 + 50%.PDF" && plan.renamesFile)
        #expect(plan.mutationPath == "api/rename")
        #expect(plan.mutationBody == .object(["entity": .string("acme"), "filePath": .string("Sample.PDF"), "newFilename": .string("Acme #1 + 50%.PDF")]))
        #expect(plan.classification.isEmpty)
        metadata.customName = "Sample.txt"
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: false) }
    }

    @Test func invalidPathsTypesYearsAndAmbiguousUnparsedClassificationCannotBeSaved() throws {
        for path in ["/root.pdf", "../Sample.pdf", "folder//Sample.pdf", "folder/./Sample.pdf", "folder\\Sample.pdf", "folder/Sample\n.pdf"] {
            #expect(throws: VaultError.self) { try NativeDocumentOrganization.validatePath(path) }
        }
        for name in ["..", ".", "a/b.pdf", "a\\b.pdf", "a\0.pdf", String(repeating: "é", count: 130) + ".pdf"] {
            #expect(throws: VaultError.self) { try NativeDocumentOrganization.validateName(name) }
        }
        let original = file("2024/income/1099/Acme_1099-NEC.pdf", parsed: nil)
        var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.type = "1099-r"
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: true) }
        metadata.standardName = true; metadata.source = "Acme"
        #expect(try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: true).destination.path == "2024/income/1099/Acme_1099-r_2024.pdf")
        metadata.year = "24"
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: true) }
    }

    @Test func classificationChangesPreserveFreshUnknownFieldsAndExactZero() throws {
        let original = file()
        var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.category = "medical"
        let plan = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: true)
        var fresh = try #require(original.parsedData); fresh.set("items", .array([.object(["description": .string("Fresh invented item")])]))
        let updated = try #require(try NativeDocumentOrganization.classified(plan, current: fresh))
        #expect(updated["amount"] == .number(0) && updated["category"].string == "medical")
        #expect(updated["items"] == fresh["items"] && updated["vendor"] == fresh["vendor"])
        fresh.set("category", .string("travel"))
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.classified(plan, current: fresh) }
        fresh.set("category", .string("medical"))
        #expect(try NativeDocumentOrganization.classified(plan, current: fresh)?["category"].string == "medical")
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.classified(plan, current: .null) }
        #expect(throws: VaultError.self) { try NativeDocumentOrganization.classified(plan, current: .object(["parsed": .bool(true)])) }
    }

    @Test func movingAnUnparsedDocumentNeverFabricatesExtraction() throws {
        let original = file("2024/inbox/Medical_Record.pdf", parsed: nil)
        var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.type = "receipt"; metadata.category = "medical"
        let plan = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "other", metadata: metadata, organize: true)
        #expect(plan.destination.path == "2024/expenses/medical/Medical_Record.pdf")
        #expect(plan.mutationPath == "api/move-between" && plan.moveBody["toEntity"].string == "other")
        #expect(try NativeDocumentOrganization.classified(plan, current: .null) == nil)
        #expect(try NativeDocumentOrganization.classified(plan, current: .object(["parsed": .bool(true)])) == nil)
    }

    @Test func classificationFailureKeepsTheConfirmedMoveAndRetryUsesItsFrozenPlan() async throws {
        let original = file()
        var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.category = "medical"
        let plan = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "other", metadata: metadata, organize: true)
        var moves = 0, saves = 0
        let first = await NativeDocumentOrganization.perform(existing: nil, plan: plan, move: { _ in moves += 1 }, classify: { _ in saves += 1; throw VaultError.server("Invented classification failure") })
        #expect(first.0?.plan.destination == plan.destination && first.0?.complete == false && first.1 != nil)
        metadata.category = "childcare"
        let edited = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "third", metadata: metadata, organize: true)
        let retry = await NativeDocumentOrganization.perform(existing: first.0, plan: edited, move: { _ in moves += 1 }, classify: { frozen in saves += 1; #expect(frozen == plan) })
        #expect(moves == 1 && saves == 2 && retry.0?.complete == true && retry.1 == nil)
        #expect(retry.0?.plan.destination == plan.destination)
    }

    @Test func failedMovesDoNotAttemptClassificationOrReportConfirmedLocations() async throws {
        let original = file(); var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.category = "medical"
        let plan = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "other", metadata: metadata, organize: true)
        var saves = 0
        let result = await NativeDocumentOrganization.perform(existing: nil, plan: plan, move: { _ in throw VaultError.server("Invented collision") }, classify: { _ in saves += 1 })
        #expect(result.0 == nil && result.1 != nil && saves == 0)
    }

    @Test func unchangedLocationsSkipMovesButSameFolderClassificationStillSaves() async throws {
        let original = file()
        let unchanged = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: NativeDocumentOrganization.metadata(original, fallbackYear: 2024), organize: false)
        var moves = 0, saves = 0
        let result = await NativeDocumentOrganization.perform(existing: nil, plan: unchanged, move: { _ in moves += 1 }, classify: { _ in saves += 1 })
        #expect(moves == 0 && saves == 0 && result.0?.complete == true)
        var metadata = NativeDocumentOrganization.metadata(original, fallbackYear: 2024); metadata.category = "software"
        let reclassified = try NativeDocumentOrganization.plan(file: original, entity: "acme", target: "acme", metadata: metadata, organize: true)
        #expect(!reclassified.movesFile && !reclassified.classification.isEmpty)
        let changed = await NativeDocumentOrganization.perform(existing: nil, plan: reclassified, move: { _ in moves += 1 }, classify: { _ in saves += 1 })
        #expect(moves == 0 && saves == 1 && changed.0?.complete == true)
    }
}
