@testable import DocVault
import Foundation
import Testing

@Suite("Consolidated snapshot valuation and year boundaries")
struct NativeFinancialSnapshotTests {
    private func json(_ text: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
    }

    @Test func fixedBrokerageAndCurrencySeparatedBalancesDoNotUseTheMixedServerTotal() throws {
        let data = try json(#"{"bankAccounts":{"accounts":[{"id":"usd","currency":"USD","balance":1000,"category":"depository"},{"id":"card","currency":"USD","balance":-200,"category":"credit-card"},{"id":"euro","currency":"EUR","balance":500,"category":"depository"},{"id":"missing","currency":"EUR","balance":null,"category":"depository"}]},"investments":{"brokerAccounts":[{"totalValue":400,"holdings":[{"marketValue":400}]},{"overrideValue":550,"holdings":[]}]},"crypto":{"sources":[],"totalUsdValue":0},"preciousMetals":{"entries":[]},"property":{"totalEquity":100},"portfolioSummary":{"manualLiabilities":-300,"totalNetWorth":999999}}"#)
        let report = NativeFinancialSnapshot(value: data, sources: .null, history: .null, year: 2026)
        #expect(report.brokerage == 950 && report.knownNetWorth == 1550)
        #expect(report.excludedBanks == 2 && report.currencies == ["EUR", "USD"] && report.unavailableComponents == 0)
        #expect(report.netMix.first { $0.label == "Bank debt · USD" }?.amount == -200)
        var missing = data; missing.set("bankAccounts.accounts", .array(data["bankAccounts"]["accounts"].array + [try json(#"{"currency":"USD","category":"depository","balance":null}"#)]))
        let partial = NativeFinancialSnapshot(value: missing, sources: .null, history: .null, year: 2026)
        #expect(partial.unavailableComponents == 1 && partial.components.first?.amount == nil)
        #expect(NativeFinancialSnapshot.completeSum([0, nil]) == nil && NativeFinancialSnapshot.completeSum([0]) == 0)
    }

    @Test func missingMetalPricesAndForeignDebtPreventFalseZeroAndRatio() throws {
        let data = try json(#"{"preciousMetals":{"entries":[{"metal":"gold","currentValue":0}],"spotPrices":{}},"portfolioSummary":{"dtiRatio":0.2},"bankAccounts":{"accounts":[{"currency":"EUR","category":"credit-card","balance":-500}]}}"#)
        let report = NativeFinancialSnapshot(value: data, sources: .null, history: .null, year: 2026)
        #expect(report.metals == nil && report.dti == nil)
        #expect(report.monthlyDebtService == nil && !report.debtServiceMix.contains { $0.label == "Banks" })
        var zero = data; zero.set("bankAccounts.accounts", .array([])); zero.set("portfolioSummary.dtiRatio", .number(0))
        #expect(NativeFinancialSnapshot(value: zero, sources: .null, history: .null, year: 2026).dti == 0)
        #expect(NativeFinancialSnapshot.accountValue(try json(#"{"holdings":[{"marketValue":100},{"marketValue":null}]}"#)) == nil)
    }

    @Test func savedContributionsAndHistoryUseSelectedYearWithoutInventingZeroBaselinePercent() throws {
        let data = try json(#"{"retirement":{"first/2026":[{"amount":200,"type":"employee"}],"second/2026":[{"amount":100,"type":"employer"}],"first/2025":[{"amount":999}]}}"#)
        let history = try json(#"[{"date":"2025-12-31","totalValue":999},{"date":"2026-01-01","totalValue":0},{"date":"2026-01-02","totalValue":null},{"date":"2026-01-03","totalValue":100}]"#)
        let report = NativeFinancialSnapshot(value: data, sources: .null, history: history, year: 2026)
        #expect(report.retirementTotal == 300 && report.retirementRows.map { $0["entity"].string } == ["first", "second"])
        #expect(report.historyPoints.count == 2 && report.historyPoints.map(\.segment) == [0, 1])
        #expect(report.historyChange?.dollars == 100 && report.historyChange?.percent == nil)
        #expect(NativeFinancialSnapshot(value: data, sources: .null, history: history, year: 2024).historyPoints.isEmpty)
    }

    @Test func unparsedStatementsMakeTheirQuarterUnavailableButParsedZeroIsKnown() throws {
        let data = try json(#"{"bankStatementDeposits":{"demo":[{"quarter":"Q1","months":[{"month":"2026-01","revenueDeposits":100},{"month":"2026-02","revenueDeposits":0}]},{"quarter":"Q2","months":[{"month":"2026-04","revenueDeposits":0}]}]}}"#)
        let sources = try json(#"{"summary":{"demo":{"documents":[{"name":"Bank_2026-01.pdf","path":"2026/statements/bank/Bank_2026-01.pdf","parsedData":{"totalDeposits":100}},{"name":"Bank_2026-02.pdf","path":"2026/statements/bank/Bank_2026-02.pdf","parsedData":null},{"name":"Bank_2026-04.pdf","path":"2026/statements/bank/Bank_2026-04.pdf","parsedData":{"totalDeposits":0}}]}}}"#)
        let report = NativeFinancialSnapshot(value: data, sources: sources, history: .null, year: 2026)
        #expect(report.deposits(entity: "demo").map(\.revenue) == [100, nil, 0])
        #expect(report.depositMix(entity: "demo").map(\.label) == ["Q2"] && report.depositMix(entity: "demo").first?.amount == 0)
        #expect(report.depositMix(entity: "other").isEmpty)
    }
}
