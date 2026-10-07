import Foundation

struct NativeDocumentLocation: Hashable, Sendable {
    let entity: String
    let path: String
}

struct NativeDocumentOrganizationPlan: Hashable, Sendable {
    let source: NativeDocumentLocation
    let destination: NativeDocumentLocation
    let originalParsed: VaultValue
    let sourceSize: Int64
    let sourceModified: Double
    let classification: [String: VaultValue]
    var movesFile: Bool {
        source != destination
    }

    var renamesFile: Bool {
        source.entity == destination.entity && (source.path as NSString).deletingLastPathComponent == (destination.path as NSString).deletingLastPathComponent
    }

    var mutationPath: String {
        renamesFile ? "api/rename" : "api/move-between"
    }

    var mutationBody: VaultValue {
        renamesFile ? .object(["entity": .string(source.entity), "filePath": .string(source.path), "newFilename": .string((destination.path as NSString).lastPathComponent)]) : moveBody
    }

    var moveBody: VaultValue {
        .object(["fromEntity": .string(source.entity), "fromPath": .string(source.path), "toEntity": .string(destination.entity), "toPath": .string(destination.path)])
    }
}

struct NativeDocumentOrganizationReceipt: Hashable, Sendable {
    let plan: NativeDocumentOrganizationPlan
    var classified = false
    var complete: Bool {
        classified || plan.classification.isEmpty
    }
}

enum NativeDocumentOrganization {
    static func validatePath(_ value: String) throws {
        guard !value.hasPrefix("/"), !value.contains("\\"), !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw VaultError.invalidPath }
    }

    static func validateName(_ value: String) throws {
        try validatePath(value)
        guard !value.contains("/"), value.utf8.count <= 255 else { throw VaultError.invalidPath }
    }

    static func type(_ file: VaultFile) -> String {
        let parsed = file.parsedData ?? .null
        for key in ["_documentType", "documentType"] where NativeDocumentImport.types.contains(where: { $0.0 == parsed[key].string }) {
            return parsed[key].string
        }
        let folder = file.folder.lowercased()
        if let business = NativeDocumentImport.businessFolders.first(where: { folder.hasSuffix("business-docs/" + $0.value) }) {
            return business.key
        }
        let folders = ["income/w2": "w2", "income/k-1": "k-1", "expenses/1098": "1098", "statements/bank": "bank-statement", "statements/credit-card": "credit-card-statement", "retirement": "retirement-statement", "crypto": "crypto", "returns": "return", "turbotax": "return"]
        if let hint = folders.first(where: { folder.hasSuffix("/" + $0.key) }) {
            return hint.value
        }
        if folder.contains("/expenses/") {
            return "receipt"
        }
        return NativeDocumentImport.detectedType(file.name, path: file.path)
    }

    static func metadata(_ file: VaultFile, fallbackYear: Int) -> NativeImportMetadata {
        let pathYear = file.path.split(separator: "/").first.flatMap { Int($0) }.flatMap { (1000 ... 9999).contains($0) ? $0 : nil }
        let parsed = file.parsedData ?? .null
        let parsedYear = parsed["taxYear"].number.flatMap { $0.isFinite && $0.rounded() == $0 && (1000 ... 9999).contains($0) ? Int($0) : nil }
        var value = NativeImportMetadata(name: file.name, folder: file.folder, year: pathYear ?? parsedYear ?? fallbackYear, month: 1, standardName: false)
        value.month = ""; value.type = type(file); value.parsedData = file.parsedData
        if NativeDocumentImport.categories.contains(where: { $0.0 == parsed["category"].string }) {
            value.category = parsed["category"].string
        }
        value.description = parsed["description"].string
        if let source = parsedSource(parsed) {
            value.source = source
        }
        if let day = NativeQuant.date(parsed["date"].string) {
            let parts = NativeQuant.day(day).split(separator: "-")
            value.month = String(Int(parts[1])!); value.day = String(Int(parts[2])!)
        }
        return value
    }

    static func parsedSource(_ parsed: VaultValue) -> String? {
        for key in ["employerName", "employer", "payerName", "payer", "vendor", "institution", "lenderName", "lender", "recipientName", "billTo", "customerName", "source"] {
            guard case let .string(value) = parsed[key], !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            return value
        }
        return nil
    }

    static func suggest(_ parsed: VaultValue, metadata: inout NativeImportMetadata) throws {
        let parsed = try NativeDocumentImport.extracted(parsed)
        guard let source = parsedSource(parsed) else { throw VaultError.server("The parsed document has no source name. Enter a source manually.") }
        var suggestion: [String: VaultValue] = ["source": .string(source), "description": parsed["description"], "expenseCategory": parsed["category"], "documentType": .string(metadata.type)]
        if let date = NativeQuant.date(parsed["date"].string) {
            let parts = NativeQuant.day(date).split(separator: "-")
            suggestion["month"] = .number(Double(parts[1])!); suggestion["day"] = .number(Double(parts[2])!)
        }
        try metadata.apply(.object(["ok": .bool(true), "suggestion": .object(suggestion), "parsedData": parsed]))
        if !metadata.edited.contains("filename") {
            metadata.standardName = true
        }
    }

    static func plan(file: VaultFile, entity: String, target: String, metadata: NativeImportMetadata, organize: Bool) throws -> NativeDocumentOrganizationPlan {
        try validatePath(file.path); try validateName(entity); try validateName(target)
        let name = try NativeDocumentImport.filename(metadata, original: file.name)
        try validateName(name)
        let oldExtension = (file.name as NSString).pathExtension
        guard (name as NSString).pathExtension.lowercased() == oldExtension.lowercased() else { throw VaultError.server("Keep the original file extension when renaming.") }
        let folder = organize ? try NativeDocumentImport.directory(type: metadata.type, category: metadata.category, year: metadata.validYear(), filename: name) : file.folder
        let path = folder.isEmpty ? name : folder + "/" + name
        try validatePath(path)
        if organize, (try? NativeDocumentImport.extracted(file.parsedData ?? .null)) == nil {
            let destination = VaultFile(name: name, path: path, size: file.size, lastModified: file.lastModified, type: file.type)
            guard type(destination) == metadata.type else { throw VaultError.server("This unparsed document’s name and folder imply another type. Use a standard filename or parse it before changing its type.") }
        }
        var classification: [String: VaultValue] = [:]
        if organize {
            if metadata.type != type(file) {
                classification["_documentType"] = .string(metadata.type)
            }
            let oldCategory = self.metadata(file, fallbackYear: try metadata.validYear()).category
            if metadata.type == "receipt", metadata.type != type(file) || metadata.category != oldCategory {
                classification["category"] = .string(metadata.category)
            }
        }
        return .init(source: .init(entity: entity, path: file.path), destination: .init(entity: target, path: path), originalParsed: file.parsedData ?? .null, sourceSize: file.size, sourceModified: file.lastModified, classification: classification)
    }

    static func classified(_ plan: NativeDocumentOrganizationPlan, current: VaultValue) throws -> VaultValue? {
        guard !plan.classification.isEmpty else { return nil }
        // An unparsed document must stay unparsed; canonical folders record its classification.
        guard let extracted = try? NativeDocumentImport.extracted(current) else {
            guard (try? NativeDocumentImport.extracted(plan.originalParsed)) == nil else { throw VaultError.server("This document’s extracted data changed. Reload before saving classification.") }
            return nil
        }
        var result = extracted
        for (key, value) in plan.classification {
            guard current[key] == plan.originalParsed[key] || current[key] == value else { throw VaultError.server("This document’s classification changed. Reload before saving.") }
            result.set(key, value)
        }
        return result
    }

    static func metadataBody(file: VaultFile, entity: String, notes: String? = nil, tags: [String]? = nil, tracked: Bool? = nil) throws -> VaultValue {
        try validateName(entity); try validatePath(file.path)
        guard notes != nil || tags != nil || tracked != nil else { throw VaultError.server("Choose a metadata change.") }
        var body: VaultValue = .object(["entity": .string(entity), "filePath": .string(file.path)])
        if let notes {
            body.set("notes", .string(notes))
        }
        if let tags {
            body.set("tags", .array(tags.map(VaultValue.string)))
        }
        if let tracked {
            body.set("tracked", .bool(tracked))
        }
        return body
    }

    @MainActor static func perform(existing: NativeDocumentOrganizationReceipt?, plan: NativeDocumentOrganizationPlan, move: (NativeDocumentOrganizationPlan) async throws -> Void, classify: (NativeDocumentOrganizationPlan) async throws -> Void) async -> (NativeDocumentOrganizationReceipt?, String?) {
        var receipt = existing
        do {
            if receipt == nil {
                if plan.movesFile {
                    try await move(plan)
                }
                receipt = .init(plan: plan)
            }
            if let saved = receipt, !saved.complete {
                try await classify(saved.plan)
                receipt?.classified = true
            }
            return (receipt, nil)
        } catch { return (receipt, error.localizedDescription) }
    }
}
