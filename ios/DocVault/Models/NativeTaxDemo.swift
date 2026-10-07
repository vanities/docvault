import Foundation

/// Fabricated demo totals derived from the same demo documents the user can open.
enum NativeTaxDemo {
    static func summary(year: String) -> VaultValue {
        var entities: [String: VaultValue] = [:]
        for entity in DemoVault.entities where entity.isTax {
            let rows = DemoVault.files(entity: entity.id).filter { $0.path.hasPrefix(year + "/") }.map { file in
                VaultValue.object(["name": .string(file.name), "path": .string(file.path), "type": .string(file.type), "parsedData": file.parsedData ?? .null])
            }
            entities[entity.id] = .object(["entity": .object(["id": .string(entity.id), "name": .string(entity.name)]), "documents": .array(rows)])
        }
        return .object(["year": .string(year), "summary": .object(entities)])
    }

    static func statistics(entity: String, year: String, sourceSummary: VaultValue? = nil) -> VaultValue {
        let docs = NativeTaxYear(statistics: .null, summary: sourceSummary ?? summary(year: year), entity: entity).documents
        let wages = docs.filter { $0.documentType == "w2" }
        let receipts = docs.filter { $0.documentType == "receipt" }
        let invoices = docs.filter { $0.documentType == "invoice" }
        func sum(_ documents: [TaxYearDocument], _ key: String) -> Double {
            documents.reduce(0) { $0 + (NativeFinance.number($1.value["parsedData"][key]) ?? 0) }
        }
        let expenses = sum(receipts, "amount")
        let invoiceTotal = sum(invoices, "amount")
        func category(_ document: TaxYearDocument) -> String {
            let recorded = document.value["parsedData"]["category"].string
            return NativeDocumentImport.categories.contains { $0.0 == recorded } ? recorded : NativeDocumentImport.detectedCategory(document.path)
        }
        let categories = Dictionary(grouping: receipts, by: category)
        return .object([
            "entityId": .string(entity), "year": .string(year), "documentCount": .number(Double(docs.count)),
            "income": .object([
                "totalIncome": .number(sum(wages, "wages")), "w2Total": .number(sum(wages, "wages")),
                "income1099Total": .number(0), "k1Total": .number(0), "salesTotal": .number(0),
                "capitalGainsTotal": .number(0), "capitalGainsShortTerm": .number(0), "capitalGainsLongTerm": .number(0),
                "federalWithheld": .number(sum(wages, "federalWithheld")), "stateWithheld": .number(sum(wages, "stateWithheld")),
                "items": .array(wages.map { .object(["source": $0.value["parsedData"]["employerName"], "amount": $0.value["parsedData"]["wages"], "type": .string("W-2"), "filePath": .string($0.path)]) }),
            ]),
            "expenses": .object([
                "totalExpenses": .number(expenses), "totalDeductible": .number(expenses), "mileageDeduction": .number(0), "mileageTotal": .number(0),
                "items": .array(categories.keys.sorted().map { key in .object(["category": .string(key), "total": .number(sum(categories[key] ?? [], "amount")), "deductibleAmount": .number(sum(categories[key] ?? [], "amount")), "count": .number(Double(categories[key]?.count ?? 0))]) }),
                "expenses": .array(receipts.map { .object(["vendor": $0.value["parsedData"]["vendor"], "amount": $0.value["parsedData"]["amount"], "category": .string(category($0)), "filePath": .string($0.path)]) }),
            ]),
            "invoices": .object(["invoiceTotal": .number(invoiceTotal), "invoiceCount": .number(Double(invoices.count)), "byCustomer": .array(invoices.isEmpty ? [] : [.object(["customer": .string("Acme Client"), "total": .number(invoiceTotal)])])]),
            "bankDeposits": .object([:]), "retirement": .null,
        ])
    }
}
