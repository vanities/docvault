import Foundation

struct TaxYearDocument: Identifiable, Hashable {
    let entity: String
    let entityName: String
    let value: VaultValue
    var id: String {
        entity + "/" + path
    }

    var path: String {
        value["path"].string
    }

    var name: String {
        value["name"].string
    }

    var parsed: Bool {
        !value["parsedData"].isEmpty
    }

    var documentType: String {
        let data = value["parsedData"]
        return data["_documentType"].string.isEmpty ? data["documentType"].string : data["_documentType"].string
    }
}

struct TaxYearAmount: Identifiable {
    let label: String
    let amount: Double
    var id: String {
        label
    }
}

struct TaxYearDeposit: Identifiable {
    let id: String
    let entity: String
    let month: String
    let value: VaultValue
    let documents: [TaxYearDocument]
    let statementsInMonth: Int
    /// The current API emits zero for an unparsed statement. Only chart amounts
    /// whose included source statements are present and parsed.
    var verified: Bool {
        !documents.isEmpty && documents.count == statementsInMonth && documents.allSatisfy(\.parsed)
    }

    var revenue: Double? {
        verified ? NativeFinance.number(value["revenueDeposits"]) : nil
    }
}

struct NativeTaxYear {
    let statistics: VaultValue
    let summary: VaultValue
    let entity: String

    var documents: [TaxYearDocument] {
        summary["summary"].object.keys.sorted().filter { entity == "all" || $0 == entity }.flatMap { id -> [TaxYearDocument] in
            let row = summary["summary"][id]
            let name = row["entity"]["name"].string
            return row["documents"].array.map { TaxYearDocument(entity: id, entityName: name.isEmpty ? id : name, value: $0) }
        }.sorted { $0.id.localizedStandardCompare($1.id) == .orderedAscending }
    }

    var parsedCount: Int {
        documents.filter(\.parsed).count
    }

    var recordedNet: Double? {
        guard let income = number("income.totalIncome"), let deduction = number("expenses.totalDeductible"), (income - deduction).isFinite else { return nil }
        // totalIncome already includes capital gains and sales. Invoices and
        // deposits are separate measures, never added to this calculation.
        return income - deduction
    }

    func number(_ path: String) -> Double? {
        NativeFinance.number(statistics.at(path))
    }

    var incomeMix: [TaxYearAmount] {
        [("W-2 wages", "w2Total"), ("1099 income", "income1099Total"), ("K-1 income", "k1Total"), ("Capital gains / losses", "capitalGainsTotal"), ("Sales", "salesTotal")]
            .compactMap { title, key in number("income." + key).map { TaxYearAmount(label: title, amount: $0) } }
    }

    var deductionMix: [TaxYearAmount] {
        statistics["expenses"]["items"].array.compactMap { item in
            NativeFinance.number(item["deductibleAmount"]).map { TaxYearAmount(label: VaultValue.label(item["category"].string), amount: $0) }
        } + (number("expenses.mileageDeduction").map { [TaxYearAmount(label: "Mileage", amount: $0)] } ?? [])
    }

    func sources(_ filePath: String) -> [TaxYearDocument] {
        guard !filePath.isEmpty else { return [] }
        // Quick stats omit entity IDs on individual rows. Keep all candidates
        // when two entities have the same relative path; let the user choose.
        return documents.filter { $0.path == filePath }
    }

    var deposits: [TaxYearDeposit] {
        let sourceDocuments = documents
        var rows: [TaxYearDeposit] = []
        for id in statistics["bankDeposits"].object.keys.sorted() where entity == "all" || id == entity {
            let monthly = statistics["bankDeposits"][id]["monthly"].array
            for (index, value) in monthly.enumerated() {
                let month = value["month"].string
                let sources = sourceDocuments.filter { document in
                    guard document.entity == id, document.path.lowercased().contains("/statements/bank/"),
                          let dateRange = document.name.range(of: "[0-9]{4}-[0-9]{2}", options: .regularExpression)
                    else { return false }
                    return String(document.name[dateRange]) == month
                }
                rows.append(TaxYearDeposit(id: id + ":" + month + ":" + String(index), entity: id, month: month, value: value, documents: sources, statementsInMonth: monthly.filter { $0["month"].string == month }.count))
            }
        }
        return rows.sorted { $0.month == $1.month ? $0.id < $1.id : $0.month < $1.month }
    }

    var invoiceDocuments: [TaxYearDocument] {
        documents.filter { !$0.path.lowercased().contains("/expenses/") && ($0.documentType == "invoice" || $0.name.localizedCaseInsensitiveContains("invoice")) }
    }

    func parsedDepositTotal(_ key: String, entity: String) -> Double? {
        NativeFinance.totals(deposits.filter { $0.entity == entity }.map { row in
            row.verified ? NativeFinance.number(row.value[key]) : nil
        }).net
    }

    var retirementDocuments: [TaxYearDocument] {
        documents.filter { $0.documentType == "retirement-statement" || $0.path.lowercased().contains("/retirement/") }
    }
}
