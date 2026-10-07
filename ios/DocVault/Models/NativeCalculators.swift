import Foundation

/// These mirror the web application's worksheets; changing a limit requires updating both clients.
enum NativeCalculators {
    static func solo(gross: Double, expenses: Double, k1: Double, year: Int) -> VaultValue? {
        let limits = [2024: (23000.0, 69000.0), 2025: (23500.0, 70000.0), 2026: (24500.0, 72000.0)]
        guard let (employee, cap) = limits[year] else { return nil }
        let profit = max(0, gross - expenses)
        let combined = profit + k1
        let seTax = (max(0, combined) * 0.9235).rounded() * 0.153
        let roundedTax = seTax.rounded()
        let half = (roundedTax / 2).rounded()
        let earnings = max(0, combined - half)
        let employer = min((earnings * 0.2).rounded(), cap - employee)
        let total = min(employer + employee, cap)
        return .object([
            "netProfit": .number(profit), "combinedSEIncome": .number(combined),
            "seTax": .number(roundedTax), "halfSeTax": .number(half),
            "netEarnings": .number(earnings), "employerContribution": .number(employer),
            "employeeLimit": .number(employee), "combinedCap": .number(cap),
            "totalContribution": .number(total), "remainingCapacity": .number(max(0, cap - total)),
        ])
    }

    static func tennessee(_ input: [String: Double]) -> VaultValue {
        func n(_ key: String) -> Double {
            input[key] ?? 0
        }
        let profit = max(0, n("gross") - n("expenses") - n("homeOffice"))
        let earnings = profit + (2 ... 6).reduce(0) { $0 + n("j2.\($1)") }
        let ownerDeduction = input["j2.8"] ?? max(0, earnings)
        let j1 = max(0, earnings - ownerDeduction)
        let additions = (2 ... 14).reduce(0) { $0 + n("j.\($1)") }
        let deductions = (16 ... 27).reduce(0) { $0 + n("j.\($1)") } + n("j.28a") + n("j.29")
        let j31 = j1 + additions - deductions
        let standard = j31 > 0 ? min(j31, 50000) : 0
        let j34 = j31 - standard + n("j.33")
        let apportioned = j34 * ((input["j.35"] ?? 100) / 100)
        let taxable = apportioned + n("j.37") - n("j.38")
        let excise = max(0, taxable) * 0.065
        let netWorth = max(0, n("bankBalance") - n("creditBalance") + n("assets"))
        let franchiseBase = max(0, netWorth + n("affiliatedDebt") - 500_000)
        let franchise = max(100, franchiseBase * 0.0025)
        let credits = (1 ... 9).reduce(0) { $0 + n("d.\($1)") }
        let payments = ["1", "2b", "3b", "4b", "5b", "6"].reduce(0) { $0 + n("e.\($1)") }
        let owed = max(0, excise + franchise - credits) + 300
        return .object([
            "netProfit": .number(profit), "netEarnings": .number(earnings),
            "ownerDeduction": .number(ownerDeduction), "scheduleJLine1": .number(j1),
            "additions": .number(additions), "deductions": .number(deductions),
            "exciseDeduction": .number(standard), "apportionedIncome": .number(apportioned),
            "exciseTax": .number(excise), "netWorth": .number(netWorth),
            "franchiseTax": .number(franchise), "totalCredits": .number(credits),
            "secretaryOfStateFee": .number(300), "totalOwed": .number(owed),
            "payments": .number(payments), "balanceDue": .number(max(0, owed - payments)),
            "overpayment": .number(max(0, payments - owed)),
        ])
    }

    static func tennesseeSchedules(_ input: [String: Double]) -> VaultValue {
        let totals = tennessee(input)
        func n(_ key: String) -> Double {
            input[key] ?? 0
        }
        func t(_ key: String) -> Double {
            totals[key].number ?? 0
        }
        var j: [String: VaultValue] = [:]
        for line in Array(2 ... 14) + Array(16 ... 27) + [29, 33, 37, 38] {
            j[String(line)] = .number(n("j.\(line)"))
        }
        let j31 = t("scheduleJLine1") + t("additions") - t("deductions")
        j.merge([
            "1": .number(t("scheduleJLine1")), "15": .number(t("additions")),
            "28a": .number(n("j.28a")), "28b": .number(n("j.28b")),
            "30": .number(t("deductions")), "31": .number(j31), "32": .number(t("exciseDeduction")),
            "34": .number(j31 - t("exciseDeduction") + n("j.33")), "35": .number(input["j.35"] ?? 100),
            "36": .number(t("apportionedIncome")), "39": .number(t("apportionedIncome") + n("j.37") - n("j.38")),
        ]) { _, new in new }
        var j2 = Dictionary(uniqueKeysWithValues: (2 ... 6).map { (String($0), VaultValue.number(n("j2.\($0)"))) })
        j2.merge(["1": .number(t("netProfit")), "7": .number(t("netEarnings")), "8": .number(t("ownerDeduction")), "9": .number(t("scheduleJLine1"))]) { _, new in new }
        var d = Dictionary(uniqueKeysWithValues: (1 ... 9).map { (String($0), VaultValue.number(n("d.\($0)"))) })
        d["10"] = .number(t("totalCredits"))
        var e = Dictionary(uniqueKeysWithValues: ["1", "2a", "2b", "3a", "3b", "4a", "4b", "5a", "5b", "6"].map { ($0, VaultValue.number(n("e.\($0)"))) })
        e["7"] = .number(t("payments"))
        func labeled(_ prefix: String, _ lines: [String: VaultValue]) -> VaultValue {
            .object(Dictionary(uniqueKeysWithValues: lines.map { key, value in ("Line \(key) · \(NativeWorksheet.labels["\(prefix).\(key)"] ?? "Calculated amount")", value) }))
        }
        return .object([
            "Schedule H": .object(["Line 1 · Gross receipts": .number(n("gross"))]),
            "Schedule J-2": labeled("j2", j2), "Schedule J": labeled("j", j),
            "Schedule D": labeled("d", d), "Schedule E": labeled("e", e),
            "Schedule F1": .object(["Line 1 · Net worth": .number(t("netWorth")), "Line 2 · Affiliated debt": .number(n("affiliatedDebt")), "Line 3 · Total": .number(t("netWorth") + n("affiliatedDebt")), "Line 4 · Ratio": .number(100), "Line 5 · Taxable base": .number(t("netWorth") + n("affiliatedDebt"))]),
        ])
    }
}
