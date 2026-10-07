import Foundation

struct SnapshotComponent: Identifiable {
    let id: String
    let title: String
    let amount: Double?
    let path: String
    let feature: String
}

/// Presents the existing consolidated response without treating unvalued or
/// foreign-currency accounts as USD. Property already includes its mortgage.
struct NativeFinancialSnapshot {
    let value: VaultValue
    let sources: VaultValue
    let history: VaultValue
    let year: Int

    func number(_ path: String) -> Double? {
        NativeFinance.number(value.at(path))
    }

    var banks: [FinanceAccount] {
        NativeFinance.accounts(value["bankAccounts"])
    }

    var currencies: [String] {
        Array(Set(banks.map(\.currency))).sorted()
    }

    var usdBanks: [FinanceAccount] {
        banks.filter { $0.currency == "USD" }
    }

    var excludedBanks: Int {
        banks.count - usdBanks.count
    }

    static func completeSum(_ values: [Double?]) -> Double? {
        guard values.allSatisfy({ $0 != nil }) else { return nil }
        let sum = values.compactMap(\.self).reduce(0, +)
        return sum.isFinite ? sum : nil
    }

    static func accountValue(_ account: VaultValue) -> Double? {
        if let total = NativeFinance.number(account["totalValue"]) {
            return total
        }
        if let fixed = NativeFinance.number(account["overrideValue"]) {
            return fixed
        }
        guard case .array = account["holdings"] else { return nil }
        return completeSum(account["holdings"].array.map { NativeFinance.number($0["marketValue"]) })
    }

    var brokerage: Double? {
        guard case .array = value["investments"]["brokerAccounts"] else { return nil }
        return Self.completeSum(value["investments"]["brokerAccounts"].array.map(Self.accountValue))
    }

    private func bankTotal(depository: Bool) -> Double? {
        guard case .array = value["bankAccounts"]["accounts"] else { return nil }
        return Self.completeSum(usdBanks.filter { ($0.value["category"].string == "depository") == depository }.map(\.balance))
    }

    var metals: Double? {
        guard case .array = value["preciousMetals"]["entries"] else { return nil }
        let entries = value["preciousMetals"]["entries"].array
        if entries.isEmpty {
            return 0
        }
        // The server emits zero when spot prices cannot be fetched. Such a
        // holding is not established to have zero value.
        guard entries.allSatisfy({ row in
            let price = NativeFinance.number(value["preciousMetals"]["spotPrices"][row["metal"].string])
            return price.map { $0 > 0 } == true
        }) else { return nil }
        return Self.completeSum(entries.map { NativeFinance.number($0["currentValue"]) })
    }

    var crypto: Double? {
        if let total = number("crypto.totalUsdValue") {
            return total
        }
        guard case .array = value["crypto"]["sources"] else { return nil }
        return Self.completeSum(value["crypto"]["sources"].array.map { NativeFinance.number($0["totalUsdValue"]) })
    }

    var components: [SnapshotComponent] {
        [
            .init(id: "cash", title: "Cash · USD", amount: bankTotal(depository: true), path: "bankAccounts", feature: "banks"),
            .init(id: "brokerage", title: "Brokerage", amount: brokerage, path: "investments", feature: "brokers"),
            .init(id: "crypto", title: "Crypto", amount: crypto, path: "crypto", feature: "crypto"),
            .init(id: "metals", title: "Precious metals", amount: metals, path: "preciousMetals", feature: "gold"),
            .init(id: "property", title: "Property equity", amount: number("property.totalEquity"), path: "property", feature: "property"),
            .init(id: "bankDebt", title: "Bank debt · USD", amount: bankTotal(depository: false), path: "bankAccounts", feature: "banks"),
            .init(id: "manualDebt", title: "Manual liabilities", amount: number("portfolioSummary.manualLiabilities"), path: "portfolioSummary", feature: "debts"),
        ]
    }

    var knownNetWorth: Double? {
        let known = components.compactMap(\.amount)
        return known.isEmpty ? nil : Self.completeSum(known.map(Optional.some))
    }

    var unavailableComponents: Int {
        components.filter { $0.amount == nil }.count
    }

    var netMix: [TaxYearAmount] {
        components.compactMap { component in component.amount.map { .init(label: component.title, amount: $0) } }
    }

    var debtServiceMix: [TaxYearAmount] {
        [("Banks", "bankMonthlyDebtService"), ("Manual liabilities", "manualLiabilityMonthlyPayment"), ("Property mortgages", "mortgageMonthlyPayment")].compactMap { label, key in
            (key == "bankMonthlyDebtService" && hasForeignDebt ? nil : number("portfolioSummary." + key)).map { .init(label: label, amount: $0) }
        }
    }

    var dti: Double? {
        // No exchange-rate conversion is supplied for foreign debt payments.
        guard !hasForeignDebt else { return nil }
        return number("portfolioSummary.dtiRatio").map { $0 * 100 }
    }

    var hasForeignDebt: Bool {
        banks.contains { $0.currency != "USD" && $0.value["category"].string != "depository" }
    }

    var monthlyDebtService: Double? {
        hasForeignDebt ? nil : number("portfolioSummary.monthlyDebtService")
    }

    var retirementRows: [VaultValue] {
        value["retirement"].object.keys.sorted().filter { $0.hasSuffix("/\(year)") }.flatMap { key in
            value["retirement"][key].array.map { row in
                var entry = row; entry.set("entity", .string(String(key.dropLast(5)))); return entry
            }
        }
    }

    var retirementTotal: Double? {
        guard case .object = value["retirement"] else { return nil }
        return Self.completeSum(retirementRows.map { NativeFinance.number($0["amount"]) })
    }

    var retirementMix: [TaxYearAmount] {
        Dictionary(grouping: retirementRows, by: { $0["type"].string }).compactMap { type, rows in
            Self.completeSum(rows.map { NativeFinance.number($0["amount"]) }).map { .init(label: VaultValue.label(type.isEmpty ? "Unspecified" : type), amount: $0) }
        }
    }

    func entityName(_ id: String) -> String {
        let name = value["entities"][id]["entity"]["name"].string
        return name.isEmpty ? id : name
    }

    var entityIDs: [String] {
        value["entities"].object.keys.sorted()
    }

    var entityIncome: [TaxYearAmount] {
        entityAmounts("income", "amount")
    }

    var entityExpenses: [TaxYearAmount] {
        entityAmounts("expenses", "amount")
    }

    private func entityAmounts(_ key: String, _ amount: String) -> [TaxYearAmount] {
        entityIDs.compactMap { id in
            Self.completeSum(value["entities"][id][key].array.map { NativeFinance.number($0[amount]) }).map {
                let name = entityName(id)
                let label = entityIDs.filter { entityName($0) == name }.count > 1 ? name + " (" + id + ")" : name
                return .init(label: label, amount: $0)
            }
        }
    }

    func deposits(entity: String) -> [TaxYearDeposit] {
        let monthly = value["bankStatementDeposits"][entity].array.flatMap { $0["months"].array }
        let statistics = VaultValue.object(["bankDeposits": .object([entity: .object(["monthly": .array(monthly)])])])
        return NativeTaxYear(statistics: statistics, summary: sources, entity: entity).deposits
    }

    func depositMix(entity: String) -> [TaxYearAmount] {
        value["bankStatementDeposits"][entity].array.compactMap { quarter in
            let months = Set(quarter["months"].array.map { $0["month"].string })
            let rows = deposits(entity: entity).filter { months.contains($0.month) }
            guard !rows.isEmpty, let amount = Self.completeSum(rows.map(\.revenue)) else { return nil }
            return .init(label: quarter["quarter"].string, amount: amount)
        }
    }

    var historyRows: [VaultValue] {
        NativeFinance.history(history).filter { $0["date"].string.hasPrefix("\(year)-") }
    }

    var historyPoints: [FinanceHistoryPoint] {
        NativeFinance.points(historyRows, key: "totalValue", days: 100_000)
    }

    var historyChange: NativePerformance? {
        guard let first = historyPoints.first, let last = historyPoints.last, first.date != last.date else { return nil }
        let delta = last.value - first.value
        return .init(dollars: delta, percent: first.value == 0 ? nil : delta / abs(first.value) * 100)
    }
}
