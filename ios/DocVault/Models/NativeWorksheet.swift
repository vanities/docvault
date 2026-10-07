import Foundation

/// Source selection follows the web Solo 401(k) and FAE170 worksheets.
enum NativeWorksheet {
    static func number(_ value: VaultValue) -> Double {
        if let n = value.number, n.isFinite {
            return n
        }
        return parse(value.string) ?? 0
    }

    static func parse(_ raw: String) -> Double? {
        let stripped = raw.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: "$", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let n = Double(stripped), n.isFinite else { return nil }
        return n
    }

    static func soloEntity(_ analytics: VaultValue) -> String {
        let deposits = analytics["bankDeposits"].object
        if let best = deposits.keys.sorted().max(by: { number(deposits[$0]?["totalRevenue"] ?? .null) < number(deposits[$1]?["totalRevenue"] ?? .null) }), number(deposits[best]?["totalRevenue"] ?? .null) > 0 {
            return best
        }
        let invoices = analytics["invoices"]["byEntity"].object
        if let best = invoices.keys.sorted().max(by: { number(invoices[$0] ?? .null) < number(invoices[$1] ?? .null) }), number(invoices[best] ?? .null) > 0 {
            return best
        }
        return ""
    }

    static func soloDefaults(all: VaultValue, selected: VaultValue, entity: String, metadata: VaultValue) -> [String: Double] {
        let bank = selected["bankDeposits"][entity]
        let revenue = number(bank["totalRevenue"])
        let deposits = number(bank["totalDeposits"])
        var seen: Set<String> = []
        let k1 = all["income"]["items"].array.reduce(0.0) { total, row in
            let amount = number(row["details"]["selfEmploymentEarnings"])
            guard row["type"].string == "K-1", amount != 0, seen.insert(row["source"].string).inserted else { return total }
            return total + amount
        }
        return ["gross": revenue > 0 ? revenue : deposits > 0 ? deposits : number(selected["invoices"]["invoiceTotal"]), "expenses": number(selected["expenses"]["totalDeductible"]) + number(metadata["homeOfficeDeduction"]), "k1": k1]
    }

    static func tennesseeDefaults(files: [VaultValue], year: Int, assets: VaultValue) -> [String: Double] {
        var invoices = 0.0, deposits = 0.0, expenses = 0.0, bank = 0.0, credit = 0.0
        let rates: [String: Double] = ["meals": 0.5, "software": 1, "equipment": 1, "office-supplies": 1, "professional-services": 1, "travel": 1, "utilities": 1, "insurance": 1, "taxes-licenses": 1, "childcare": 1, "medical": 1, "education": 1, "home-improvement": 0, "feed": 1, "livestock": 1, "other": 1]
        for file in files {
            let data = file["parsedData"]
            guard !data.isEmpty else { continue }
            let name = file["name"].string.lowercased()
            let path = file["path"].string.lowercased()
            func matches(_ pattern: String) -> Bool {
                name.range(of: pattern, options: .regularExpression) != nil
            }
            let expense = path.contains("/expenses/") || matches("receipt|expense|purchase")
            // A tax form's filename takes precedence over receipt/invoice heuristics, as in the web mapper.
            let taxForm = matches("1099|w-?2|k-?1(?=[_.\\s-]|$)|schedule.?k")
            let invoice = !expense && !taxForm && matches("invoice")
            let isBank = !expense && !taxForm && !invoice && matches("bank.?statement")
            let isCredit = !expense && !taxForm && !invoice && !isBank && matches("credit.?card.?statement")
            func first(_ keys: [String]) -> Double {
                keys.lazy.map { number(data[$0]) }.first(where: { $0 != 0 }) ?? 0
            }
            if invoice {
                invoices += first(["amount", "totalAmount", "total"])
            }
            if isBank {
                deposits += number(data["totalDeposits"])
            }
            if expense && !taxForm && file["tracked"] != .bool(false) {
                var category = data["category"].string
                if category.isEmpty {
                    category = ["equipment", "software", "meals", "childcare", "medical", "travel", "home-improvement"].first(where: { path.contains("/\($0)/") }) ?? ""
                }
                // Web expense amounts must be numeric, unlike statement/invoice fallbacks.
                let amount = data["amount"].number ?? data["totalAmount"].number ?? data["total"].number ?? 0
                expenses += amount * (rates[category] ?? 0)
            }
            let december = data["endDate"].string.hasPrefix("\(year)-12") || data["periodLabel"].string.lowercased().contains("december") || name.contains("\(year)-12")
            if december {
                let balance = first(["endingBalance", "newBalance", "balanceDue", "statementBalance"])
                if isBank {
                    bank += balance
                }
                if isCredit {
                    credit += balance
                }
            }
        }
        return ["gross": deposits > 0 ? deposits : invoices, "expenses": expenses, "homeOffice": 1500, "bankBalance": max(0, bank), "creditBalance": max(0, credit), "assets": assets["assets"].array.reduce(0) { $0 + number($1["value"]) }]
    }

    static let labels: [String: String] = [
        "j2.1": "Business Income from Schedule C",
        "j2.2": "Business Income from Schedule D",
        "j2.3": "Business Income from Schedule E",
        "j2.4": "Business Income from Schedule F",
        "j2.5": "Business Income from Form 4797",
        "j2.6": "Other business income",
        "j2.7": "Total (Lines 1 through 6)",
        "j2.8": "Owner compensation deduction",
        "j2.9": "Net Earnings → Schedule J, Line 1",
        "j.1": "Federal income or loss (from Schedule J-2)",
        "j.2": "Intangible expenses to affiliated entity",
        "j.3": "Depreciation (TN decoupled bonus, assets ≤ 12/31/2022)",
        "j.4": "Gain on sale of asset within 12mo of distribution",
        "j.5": "TN excise tax expense (federal)",
        "j.6": "Gross premiums tax deducted federally",
        "j.7": "Interest on state/local obligations",
        "j.8": "Depletion not based on cost recovery",
        "j.9": "Excess FMV over book value of donated property",
        "j.10": "Excess rent to/from affiliate",
        "j.11": "Net loss/expense from pass-through entity",
        "j.12": "5% of IRC §951A GILTI deducted on Line 27",
        "j.13": "Business interest expense deducted",
        "j.14": "R&E expenditures deducted (IRC §174)",
        "j.15": "Total additions (Lines 2–14)",
        "j.16": "Depreciation (TN decoupled, permitted)",
        "j.17": "Excess gain/loss from TN basis difference",
        "j.18": "Dividends from 80%+ owned corporations",
        "j.19": "Donations to qualified school/nonprofit groups",
        "j.20": "Expenses not deducted federally (credit taken)",
        "j.21": "Safe harbor lease adjustments",
        "j.22": "Nonbusiness earnings (Schedule M, Line 8)",
        "j.23": "Intangible expenses to affiliated entity",
        "j.24": "Intangible income from affiliate (not deducted)",
        "j.25": "Net gain/income from pass-through entity",
        "j.26": "Deductible grants from governmental units",
        "j.27": "IRC §951A GILTI",
        "j.28a": "Business interest expense currently deductible",
        "j.28b": "Business interest carryforward (future years)",
        "j.29": "R&E expenditures currently deductible",
        "j.30": "Total deductions (Lines 16–29, excl. 28b)",
        "j.31": "Total business income (loss)",
        "j.32": "Excise tax standard deduction",
        "j.33": "Optional deduction addback",
        "j.34": "Adjusted total business income",
        "j.35": "Apportionment ratio",
        "j.36": "Apportioned business income",
        "j.37": "Nonbusiness earnings allocated to TN",
        "j.38": "Loss carryover from prior years",
        "j.39": "Subject to excise tax → Schedule B, Line 4",
        "d.1": "Gross Premiums Tax Credit",
        "d.2": "Green Energy Tax Credit",
        "d.3": "Brownfield Property Credits",
        "d.4": "Broadband Internet Access Tax Credit",
        "d.5": "Industrial Machinery Credit (Schedule T)",
        "d.6": "Job Tax Credit (Schedule X)",
        "d.7": "Additional Annual Job Tax Credit (Schedule X, Line 38)",
        "d.8": "Qualified Production Credit",
        "d.9": "Employer Credit for Paid Family & Medical Leave",
        "d.10": "Total Credit → Schedule C, Line 9",
        "e.1": "Overpayment from previous year",
        "e.2a": "Q1 required installment",
        "e.2b": "Q1 amount paid",
        "e.3a": "Q2 required installment",
        "e.3b": "Q2 amount paid",
        "e.4a": "Q3 required installment",
        "e.4b": "Q3 amount paid",
        "e.5a": "Q4 required installment",
        "e.5b": "Q4 amount paid",
        "e.6": "Extension payment",
        "e.7": "Total payments → Schedule C, Line 11",
    ]
}
