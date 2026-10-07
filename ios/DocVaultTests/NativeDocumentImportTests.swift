@testable import DocVault
import Foundation
import Testing

@MainActor struct NativeDocumentImportTests {
    private func metadata(_ type: String = "receipt") -> NativeImportMetadata {
        var value = NativeImportMetadata(name: "Acme_Receipt.pdf", folder: "2024/expenses/business", year: 2024, month: 3, standardName: true)
        value.type = type; value.category = "professional-services"; value.source = "acme bank"; value.day = "5"; value.description = "Client Meeting"
        return value
    }

    @Test func fullTaxonomyAndBusinessDestinationsAreAvailable() throws {
        #expect(NativeDocumentImport.types.count == 30 && Set(NativeDocumentImport.types.map(\.0)).count == 30)
        #expect(NativeDocumentImport.categories.count == 16)
        for (type, folder) in NativeDocumentImport.businessFolders {
            #expect(try NativeDocumentImport.directory(type: type, category: "other", year: 2024, filename: "Acme.pdf") == "business-docs/" + folder)
        }
        #expect(throws: VaultError.self) { try NativeDocumentImport.directory(type: "unsupported", category: "other", year: 2024, filename: "Acme.pdf") }
    }

    @Test func filenameDetectionKeepsCompositeAndExplicitPathPrecedence() {
        #expect(NativeDocumentImport.detectedType("Acme_1099-Composite_1099-INT.pdf") == "1099-composite")
        #expect(NativeDocumentImport.detectedType("Acme_Schedule_K-1.pdf") == "k-1")
        #expect(NativeDocumentImport.detectedType("Acme_Invoice.pdf", path: "2024/expenses/business/Acme_Invoice.pdf") == "receipt")
        #expect(NativeDocumentImport.detectedType("Operating_Agreement.pdf", path: "business-docs/formation/Operating_Agreement.pdf") == "formation")
        #expect(NativeDocumentImport.detectedType("Operating_Agreement.pdf") == "operating-agreement")
        #expect(NativeDocumentImport.detectedCategory("Acme_Chicken_Feed.pdf") == "livestock")
        #expect(NativeDocumentImport.detectedCategory("2024/expenses/medical/Acme.pdf") == "medical")
    }

    @Test func standardNamesMatchAnnualMonthlyReceiptAndBusinessPatterns() throws {
        for (type, name) in [("w2", "Acme_Bank_W2_2024.pdf"), ("1099-div", "Acme_Bank_1099-div_2024.pdf"), ("k-1", "Acme_Bank_K-1_2024.pdf"), ("invoice", "Acme_Bank_Invoice_2024-03.pdf"), ("receipt", "Acme_Bank_services_Client-meeting_2024-03-05.pdf"), ("bank-statement", "Acme_Bank_Bank_Statement_2024-03.pdf"), ("credit-card-statement", "Acme_Bank_CC_Statement_2024-03.pdf"), ("formation", "Articles_of_Organization.pdf"), ("business-agreement", "Acme_Bank_Contractor_Agreement.pdf"), ("return", "Return_filed_2024.pdf")] {
            #expect(try NativeDocumentImport.filename(metadata(type), original: "Acme.pdf") == name)
        }
        #expect(try NativeDocumentImport.filename(metadata("return"), original: "Acme.tax2024") == "TurboTax_2024.tax2024")
        var value = metadata(); value.day = ""; value.description = ""
        #expect(try NativeDocumentImport.filename(value, original: "Acme.png") == "Acme_Bank_services_2024.png")
    }

    @Test func manualFilenamesAndMissingSourcesRemainUnchanged() throws {
        var value = metadata(); value.standardName = false; value.customName = "Literal_Name.PDF"
        #expect(try NativeDocumentImport.filename(value, original: "original.pdf") == "Literal_Name.PDF")
        value.standardName = true; value.source = ""
        #expect(try NativeDocumentImport.filename(value, original: "original.pdf") == "Literal_Name.PDF")
        #expect(NativeDocumentImport.source("Acme_Corp_W2_2024.pdf") == "Acme Corp")
        #expect(NativeDocumentImport.source("scan.pdf").isEmpty)
        #expect(!NativeDocumentImport.supportedAnalysis("Acme.csv") && NativeDocumentImport.supportedAnalysis("Acme.PDF"))
    }

    @Test func destinationsRetainYearAndSpecialExpenseFolders() throws {
        #expect(try NativeDocumentImport.directory(type: "1099-r", category: "other", year: 2024, filename: "Acme.pdf") == "2024/income/1099")
        #expect(try NativeDocumentImport.directory(type: "1098", category: "other", year: 2024, filename: "Acme.pdf") == "2024/expenses/1098")
        for category in ["childcare", "medical", "home-improvement"] {
            #expect(try NativeDocumentImport.directory(type: "receipt", category: category, year: 2024, filename: "Acme.pdf") == "2024/expenses/" + category)
        }
        #expect(try NativeDocumentImport.directory(type: "return", category: "other", year: 2024, filename: "Acme.tax2024") == "2024/turbotax")
        #expect(NativeImportMetadata(name: "scan.pdf", folder: "2024/expenses/1098", year: 2024, month: 3, standardName: true).type == "1098")
        #expect(NativeImportMetadata(name: "scan.pdf", folder: "2024/statements/bank", year: 2024, month: 3, standardName: true).type == "bank-statement")
    }

    @Test func invalidDatesAndUnboundedAiNumbersCannotCreateNames() throws {
        var value = metadata(); value.month = "2"; value.day = "30"
        #expect(throws: VaultError.self) { try NativeDocumentImport.filename(value, original: "Acme.pdf") }
        value.day = "29"; #expect(try value.validDay() == 29)
        value.year = "2023"; #expect(throws: VaultError.self) { try value.validDay() }
        value.year = "24"; #expect(throws: VaultError.self) { try value.validYear() }
        value = metadata()
        try value.apply(.object(["ok": .bool(true), "suggestion": .object(["year": .number(1e308), "month": .number(99), "day": .number(-1)])]))
        #expect(value.year == "2024" && value.month == "3" && value.day == "5")
    }

    @Test func lateAnalysisKeepsEveryUserEditedFieldAndExactExtractedZero() throws {
        var value = metadata(); value.customName = "Literal_Acme.pdf"; value.standardName = false
        value.edited = ["type", "category", "source", "description", "year", "month", "day", "filename"]
        try value.apply(.object(["ok": .bool(true), "suggestion": .object(["documentType": .string("invoice"), "expenseCategory": .string("medical"), "source": .string("Another invented source"), "description": .string("Another invented description"), "year": .number(2025), "month": .number(7), "day": .number(12)]), "parsedData": .object(["amount": .number(0), "items": .array([.object(["description": .string("Literal invented item")])])])]))
        #expect(value.type == "receipt" && value.category == "professional-services" && value.source == "acme bank")
        #expect(value.description == "Client Meeting" && value.year == "2024" && value.month == "3" && value.day == "5")
        #expect(try NativeDocumentImport.filename(value, original: "Acme.pdf") == "Literal_Acme.pdf")
        let parsed = try #require(value.reviewedParsedData)
        #expect(parsed["amount"] == .number(0) && parsed["category"].string == "professional-services" && parsed["_documentType"].string == "receipt")
        #expect(parsed["items"].array.first?["description"].string == "Literal invented item")
    }

    @Test func analysisRequiresAnActualSuggestionAndExtractionRequiresFields() throws {
        var value = metadata()
        for response: VaultValue in [.object(["ok": .bool(false)]), .object(["ok": .bool(true), "suggestion": .null]), .object(["ok": .bool(true), "suggestion": .object([:])])] {
            #expect(throws: VaultError.self) { try value.apply(response) }
        }
        #expect(value.reviewedParsedData == nil)
        #expect(throws: VaultError.self) { try NativeDocumentImport.extracted(.object(["parsed": .bool(true), "parsedAt": .string("2024-03-05")])) }
        #expect(try NativeDocumentImport.extracted(.object(["amount": .number(0)]))["amount"] == .number(0))
    }

    @Test func analysisQueriesEncodeLiteralFilenamesAndReviewYear() throws {
        let filename = "Acme #1 + 50% & scan.pdf"
        let request = try NativeDocumentImport.analysisRequest(name: filename, year: 2024)
        #expect(request.path == ["api", "suggest-filename"])
        #expect(request.query["filename"] == filename && request.query["year"] == "2024")
        #expect(NativeDocumentImport.demoAnalysis(name: "Acme_Receipt.pdf", year: 2024)["parsedData"]["amount"] == .number(1234.56))
    }

    @Test func parseFailureRetainsCollisionPathAndRetryNeverUploadsAgain() async throws {
        var uploads = 0, attempts = 0
        let failed = await NativeImportPipeline.perform(existing: nil, entity: "acme", parse: true, extracted: .object(["amount": .number(0)]), upload: { uploads += 1; return "2024/expenses/business/Acme_Receipt_2.pdf" }, persist: { entity, path, _ in
            attempts += 1; #expect(entity == "acme" && path.hasSuffix("_2.pdf")); throw VaultError.server("Invented save failure")
        })
        let receipt = try #require(failed.receipt)
        #expect(!receipt.complete && receipt.path.hasSuffix("_2.pdf") && failed.error?.contains("document is saved") == true)
        let retried = await NativeImportPipeline.perform(existing: receipt, entity: "personal", parse: true, extracted: .object(["amount": .number(0)]), upload: { uploads += 1; return "wrong.pdf" }, persist: { entity, path, _ in
            attempts += 1; #expect(entity == "acme" && path == receipt.path)
        })
        #expect(uploads == 1 && attempts == 2 && retried.receipt?.parsed == true && retried.error == nil)
    }

    @Test func failedUploadNeverParsesAndRawUploadsNeedNoExtraction() async {
        var attempts = 0
        let failed = await NativeImportPipeline.perform(existing: nil, entity: "acme", parse: true, extracted: nil, upload: { throw VaultError.server("Invented upload failure") }, persist: { _, _, _ in attempts += 1 })
        #expect(failed.receipt == nil && failed.error == "Invented upload failure" && attempts == 0)
        let raw = await NativeImportPipeline.perform(existing: nil, entity: "acme", parse: false, extracted: nil, upload: { "2024/inbox/Acme.pdf" }, persist: { _, _, _ in attempts += 1 })
        #expect(raw.receipt?.complete == true && raw.receipt?.parsed == false && attempts == 0)
    }

    @Test func keepingAnUnparsedDocumentIsAnExplicitCompletionChoice() async {
        var receipt = NativeUploadReceipt(entity: "acme", path: "2024/inbox/Acme.pdf", requiresParsing: true)
        #expect(!receipt.complete); receipt.keptUnparsed = true; #expect(receipt.complete && !receipt.parsed)
        var uploads = 0, parses = 0
        let result = await NativeImportPipeline.perform(existing: receipt, entity: "acme", parse: true, extracted: nil, upload: { uploads += 1; return "wrong.pdf" }, persist: { _, _, _ in parses += 1 })
        #expect(result.receipt == receipt && uploads == 0 && parses == 0)
    }
}
