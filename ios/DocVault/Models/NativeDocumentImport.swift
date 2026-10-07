import Foundation

/// Native equivalents of the web document taxonomy, naming and destination rules.
enum NativeDocumentImport {
    static let types: [(String, String)] = [("w2", "W-2"), ("1099-nec", "1099-NEC"), ("1099-misc", "1099-MISC"), ("1099-r", "1099-R"), ("1099-div", "1099-DIV"), ("1099-int", "1099-INT"), ("1099-b", "1099-B"), ("1099-composite", "1099 Composite"), ("k-1", "Schedule K-1"), ("1098", "1098 (Mortgage Interest)"), ("retirement-statement", "Retirement Statement"), ("receipt", "Receipt"), ("invoice", "Invoice"), ("crypto", "Crypto Report"), ("return", "Tax Return"), ("contract", "Contract"), ("other", "Other"), ("formation", "Formation Docs"), ("ein-letter", "EIN Letter"), ("license", "License/Permit"), ("business-agreement", "Agreement/Contract"), ("operating-agreement", "Operating Agreement"), ("insurance-policy", "Insurance Policy"), ("bank-statement", "Bank Statement"), ("credit-card-statement", "Credit Card Statement"), ("statement", "Statement"), ("letter", "Letter/Correspondence"), ("certificate", "Certificate"), ("medical-record", "Medical Record"), ("appraisal", "Appraisal/Assessment")]
    static let categories: [(String, String)] = [("meals", "Meals & Entertainment"), ("software", "Software & Subscriptions"), ("equipment", "Equipment & Hardware"), ("office-supplies", "Office Supplies"), ("professional-services", "Professional Services"), ("travel", "Travel"), ("utilities", "Utilities"), ("insurance", "Insurance"), ("taxes-licenses", "Taxes & Licenses"), ("childcare", "Childcare"), ("medical", "Medical"), ("education", "Education"), ("home-improvement", "Home Improvement"), ("feed", "Feed & Livestock Supplies"), ("livestock", "Livestock Purchases"), ("other", "Other")]
    static let businessFolders = ["formation": "formation", "ein-letter": "ein", "license": "licenses", "business-agreement": "contracts", "operating-agreement": "agreements", "insurance-policy": "insurance"]
    static let categoryLabels = ["office-supplies": "office", "professional-services": "services", "taxes-licenses": "taxes", "other": "expense"]

    static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func detectedType(_ filename: String, path: String = "") -> String {
        if path.lowercased().contains("business-docs/") {
            if matches(filename, "formation|articles.*(incorporation|organization)|operating.*agreement|certificate.*formation") {
                return "formation"
            }
            if matches(filename, "ein|employer.*identification") {
                return "ein-letter"
            }
            if matches(filename, "license|permit|registration") {
                return "license"
            }
            if matches(filename, "contract|agreement|nda|w-?9") {
                return "business-agreement"
            }
        }
        let patterns = [("1099-composite", "1099[_-]?composite|consolidated.*1099|year.?end.*tax.*info|tax.*information.*package"), ("w2", "w-?2"), ("1099-nec", "1099-?nec"), ("1099-misc", "1099-?misc"), ("1099-r", "1099-?r"), ("1099-div", "1099-?div"), ("1099-int", "1099-?int"), ("1099-b", "1099-?b"), ("1099-nec", "1099"), ("k-1", "k-?1(?=[_.\\s-]|$)|schedule.?k"), ("receipt", "receipt|expense|purchase")]
        for (type, pattern) in patterns where matches(filename, pattern) {
            return type
        }
        if path.lowercased().contains("/expenses/") {
            return "receipt"
        }
        let more = [("invoice", "invoice"), ("crypto", "koinly|coinbase|kraken|crypto|8949"), ("return", "\\.tax\\d{4}$|return|final"), ("operating-agreement", "operating.?agreement"), ("contract", "contract|agreement|w-?9|nda"), ("formation", "formation|articles.*(incorporation|organization)|certificate.*formation"), ("ein-letter", "ein|employer.*identification"), ("license", "license|permit|registration"), ("insurance-policy", "insurance.?polic"), ("retirement-statement", "retirement|401k|401\\(k\\)|sep.?ira|roth.?ira|traditional.?ira|fidelity.*statement")]
        for (type, pattern) in more where matches(filename, pattern) {
            return type
        }
        if path.lowercased().contains("/retirement/") {
            return "retirement-statement"
        }
        let general = [("bank-statement", "bank.?statement"), ("credit-card-statement", "credit.?card.?statement"), ("statement", "statement"), ("medical-record", "medical.?record"), ("appraisal", "appraisal|assessment"), ("certificate", "certificate|cert\\b"), ("receipt", "software|equipment|meals|childcare|medical|travel|office|utility|subscription")]
        for (type, pattern) in general where matches(filename, pattern) {
            return type
        }
        return "other"
    }

    static func detectedCategory(_ path: String) -> String {
        for (category, pattern) in [("childcare", "childcare"), ("medical", "medical"), ("meals", "meal|food|restaurant"), ("software", "software|subscription"), ("equipment", "equipment|hardware"), ("travel", "travel|flight|hotel"), ("livestock", "livestock|chicken|poultry|goat|cattle|hatchery")] where matches(path, pattern) {
            return category
        }
        return "other"
    }

    static func source(_ filename: String) -> String {
        let stem = (filename as NSString).deletingPathExtension
        for pattern in ["^([A-Za-z_]+)[-_](?:Invoice|W-?2|1099|Receipt)", "^([A-Za-z_]+)\\s+Invoice", "^([A-Za-z_]+)\\s+(?:Form_)?W-?2", "from[-_]([A-Za-z_]+)"] {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive), let match = regex.firstMatch(in: stem, range: NSRange(stem.startIndex..., in: stem)), let range = Range(match.range(at: 1), in: stem) else { continue }
            return String(stem[range]).replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return ""
    }

    static func words(_ text: String, hyphenated: Bool = false) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: hyphenated ? "_" : "_-"))).filter { !$0.isEmpty }.enumerated().map { index, word in
            hyphenated && index > 0 ? word.lowercased() : word.prefix(1).uppercased() + word.dropFirst().lowercased()
        }.joined(separator: hyphenated ? "-" : "_")
    }

    static func filename(_ metadata: NativeImportMetadata, original: String) throws -> String {
        if !metadata.standardName || metadata.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return metadata.customName.isEmpty ? original : metadata.customName
        }
        let year = try metadata.validYear(), month = try metadata.validMonth(), day = try metadata.validDay()
        let ext = (original as NSString).pathExtension
        let suffix = ext.isEmpty ? "" : "." + ext
        let source = words(metadata.source), monthText = String(format: "%02d", month ?? 1)
        let annual = "\(year)", monthly = annual + "-" + monthText
        let date = day.map { monthly + "-" + String(format: "%02d", $0) } ?? annual
        let type = metadata.type
        switch type {
        case "formation": return "Articles_of_Organization" + suffix
        case "ein-letter": return "EIN_Letter" + suffix
        case "license": return "Business_License_" + annual + suffix
        case "business-agreement": return source + "_Contractor_Agreement" + suffix
        case "w2": return source + "_W2_" + annual + suffix
        case "k-1": return source + "_K-1_" + annual + suffix
        case "invoice": return source + "_Invoice_" + monthly + suffix
        case "receipt":
            let category = categoryLabels[metadata.category] ?? metadata.category
            let description = metadata.description.trimmingCharacters(in: .whitespacesAndNewlines)
            return source + "_" + category + (description.isEmpty ? "" : "_" + words(description, hyphenated: true)) + "_" + date + suffix
        case "crypto": return source + "_Crypto_" + annual + suffix
        case "return": return (suffix.contains(".tax") ? "TurboTax_" : "Return_filed_") + annual + suffix
        case "contract": return source + "_W9_" + annual + suffix
        case "retirement-statement": return source + "_Retirement_" + annual + suffix
        case "bank-statement": return source + "_Bank_Statement_" + monthly + suffix
        case "credit-card-statement": return source + "_CC_Statement_" + monthly + suffix
        default: return source + (type.hasPrefix("1099") ? "_" + type : "") + "_" + annual + suffix
        }
    }

    static func directory(type: String, category: String, year: Int, filename: String) throws -> String {
        guard types.contains(where: { $0.0 == type }), categories.contains(where: { $0.0 == category }), (1000 ... 9999).contains(year) else { throw VaultError.server("Choose a supported document type, category and four-digit year.") }
        if let folder = businessFolders[type] {
            return "business-docs/" + folder
        }
        let folder: String = switch type {
        case "w2": "income/w2"
        case "1098": "expenses/1098"
        case "retirement-statement": "retirement"
        case "k-1": "income/k-1"
        case "receipt": "expenses/" + (["childcare", "medical", "home-improvement"].contains(category) ? category : "business")
        case "bank-statement": "statements/bank"
        case "credit-card-statement": "statements/credit-card"
        case "crypto": "crypto"
        case "return": filename.contains(".tax") ? "turbotax" : "returns"
        case "medical-record": "expenses/medical"
        default: type.hasPrefix("1099") ? "income/1099" : "income/other"
        }
        return "\(year)/" + folder
    }

    static func analysisRequest(name: String, year: Int) throws -> VaultRequest {
        try VaultRequest("api/suggest-filename?filename={filename}&year={year}", scope: .init(year: year), record: .object(["filename": .string(name)]))
    }

    static func supportedAnalysis(_ filename: String) -> Bool {
        ["pdf", "png", "jpg", "jpeg", "gif", "webp"].contains((filename as NSString).pathExtension.lowercased())
    }

    static func extracted(_ value: VaultValue) throws -> VaultValue {
        guard case .object = value, !value.object.filter({ !["parsed", "parsedAt", "_documentType"].contains($0.key) }).isEmpty else { throw VaultError.server("The parser returned no extracted fields.") }
        return value
    }

    static func demoAnalysis(name: String, year: Int) -> VaultValue {
        let type = detectedType(name)
        let metadata: [String: VaultValue] = ["source": .string(source(name).isEmpty ? "Acme" : source(name)), "documentType": .string(type), "expenseCategory": .string(detectedCategory(name)), "year": .number(Double(year)), "month": .number(1)]
        let parsed: VaultValue = type == "receipt" ? .object(["vendor": .string("Acme Supplies"), "amount": .number(1234.56), "category": .string(detectedCategory(name)), "date": .string("\(year)-01-15")]) : .object(["description": .string("Invented demo analysis"), "taxYear": .number(Double(year))])
        return .object(["ok": .bool(true), "suggestion": .object(metadata), "parsedData": parsed])
    }
}

struct NativeImportMetadata: Hashable, Sendable {
    var type: String
    var category: String
    var source: String
    var description = ""
    var year: String
    var month: String
    var day = ""
    var customName: String
    var standardName: Bool
    var edited = Set<String>()
    var parsedData: VaultValue?

    init(name: String, folder: String, year: Int, month: Int, standardName: Bool) {
        type = NativeDocumentImport.detectedType(name)
        // Explicit canonical folders supply a useful type when the filename has none.
        if type == "other" {
            let hints = ["income/w2": "w2", "income/1099": "1099-nec", "income/k-1": "k-1", "expenses/1098": "1098", "statements/bank": "bank-statement", "statements/credit-card": "credit-card-statement", "retirement": "retirement-statement", "crypto": "crypto", "returns": "return", "turbotax": "return"]
            type = hints.first { folder.hasSuffix("/" + $0.key) }?.value ?? (folder.contains("/expenses/") ? "receipt" : type)
        }
        category = NativeDocumentImport.detectedCategory(folder + "/" + name)
        source = NativeDocumentImport.source(name); self.year = String(year); self.month = String(month); customName = name; self.standardName = standardName
    }

    func validYear() throws -> Int {
        try integer(year, range: 1000 ... 9999, label: "four-digit year")!
    }

    func validMonth() throws -> Int? {
        try integer(month, range: 1 ... 12, label: "month", optional: true)
    }

    func validDay() throws -> Int? {
        let day = try integer(day, range: 1 ... 31, label: "day", optional: true)
        if let day {
            let text = String(format: "%04d-%02d-%02d", try validYear(), try validMonth() ?? 1, day)
            guard NativeFilingTasks.date(text) != nil else { throw VaultError.server("Use a valid document date.") }
        }
        return day
    }

    private func integer(_ text: String, range: ClosedRange<Int>, label: String, optional: Bool = false) throws -> Int? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if optional, value.isEmpty {
            return nil
        }
        guard value.range(of: "^[0-9]+$", options: .regularExpression) != nil, let number = Int(value), range.contains(number) else { throw VaultError.server("Enter a valid \(label).") }
        return number
    }

    mutating func apply(_ result: VaultValue) throws {
        guard result["ok"] == .bool(true), case .object = result["suggestion"], !result["suggestion"].isEmpty else { throw VaultError.server(result["error"].string.isEmpty ? "The analysis returned no naming suggestion." : result["error"].string) }
        let suggestion = result["suggestion"]
        if !edited.contains("type"), NativeDocumentImport.types.contains(where: { $0.0 == suggestion["documentType"].string }) {
            type = suggestion["documentType"].string
        }
        if !edited.contains("category"), suggestion["expenseCategory"].string != "other", NativeDocumentImport.categories.contains(where: { $0.0 == suggestion["expenseCategory"].string }) {
            category = suggestion["expenseCategory"].string
        }
        if !edited.contains("source"), !suggestion["source"].string.isEmpty {
            source = suggestion["source"].string
        }
        if !edited.contains("description"), !suggestion["description"].string.isEmpty {
            description = suggestion["description"].string
        }
        for key in ["year", "month", "day"] where !edited.contains(key) {
            guard let value = suggestion[key].number, value.isFinite, value.rounded() == value, value >= (key == "year" ? 1000 : 1), value <= (key == "year" ? 9999 : key == "month" ? 12 : 31) else { continue }
            if key == "year" {
                year = String(Int(value))
            }; if key == "month" {
                month = String(Int(value))
            }; if key == "day" {
                day = String(Int(value))
            }
        }
        if case .object = result["parsedData"], !result["parsedData"].isEmpty {
            parsedData = result["parsedData"]
        }
    }

    var reviewedParsedData: VaultValue? {
        guard var data = parsedData else { return nil }
        data.set("_documentType", .string(type))
        if type == "receipt" {
            data.set("category", .string(category))
        }
        return data
    }
}

struct NativeUploadReceipt: Hashable, Sendable {
    let entity: String
    let path: String
    let requiresParsing: Bool
    var parsed = false
    var keptUnparsed = false
    var complete: Bool {
        !requiresParsing || parsed || keptUnparsed
    }
}

struct NativeImportOutcome: Sendable {
    let receipt: NativeUploadReceipt?
    let error: String?
}

enum NativeImportPipeline {
    /// Retain confirmed upload identity even if the separate parse/save request fails.
    @MainActor static func perform(existing: NativeUploadReceipt?, entity: String, parse: Bool, extracted: VaultValue?, upload: () async throws -> String, persist: (String, String, VaultValue?) async throws -> Void) async -> NativeImportOutcome {
        var receipt = existing
        do {
            if receipt == nil {
                receipt = .init(entity: entity, path: try await upload(), requiresParsing: parse)
            }
            if var saved = receipt, !saved.complete {
                try await persist(saved.entity, saved.path, extracted)
                saved.parsed = true; receipt = saved
            }
            return .init(receipt: receipt, error: nil)
        } catch {
            return .init(receipt: receipt, error: receipt == nil ? error.localizedDescription : "The document is saved, but parsed data was not confirmed: " + error.localizedDescription)
        }
    }
}
