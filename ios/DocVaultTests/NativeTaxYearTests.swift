@testable import DocVault
import Foundation
import Testing

@Suite("Native tax year accounting and source attribution")
struct NativeTaxYearTests {
    private func json(_ text: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
    }

    @Test func demoTaxTotalsReferToDocumentsInTheSameDemoYearAndEntity() {
        let report = NativeTaxYear(statistics: NativeTaxDemo.statistics(entity: "personal", year: "2026"), summary: NativeTaxDemo.summary(year: "2026"), entity: "personal")
        #expect(report.recordedNet == 41750)
        #expect(report.parsedCount == 2 && report.sources("2026/Income/w2/AcmeEmployer_W2_2026.pdf").count == 1)
        #expect(NativeTaxDemo.statistics(entity: "personal", year: "2025")["income"]["totalIncome"].number == 0)
    }

    @Test func netDoesNotAddGainsInvoicesOrDepositsTwice() throws {
        let stats = try json(#"{"income":{"totalIncome":1000,"capitalGainsTotal":-200,"w2Total":1200,"income1099Total":0,"k1Total":0,"salesTotal":0},"expenses":{"totalDeductible":100},"invoices":{"invoiceTotal":5000},"bankDeposits":{"demo":{"totalDeposits":3000}}}"#)
        let report = NativeTaxYear(statistics: stats, summary: .null, entity: "demo")
        #expect(report.recordedNet == 900)
        #expect(report.incomeMix.first { $0.label == "Capital gains / losses" }?.amount == -200)
        #expect(report.incomeMix.first { $0.label == "Sales" }?.amount == 0)
        #expect(NativeTaxYear(statistics: .null, summary: .null, entity: "demo").recordedNet == nil)
        #expect(NativeTaxYear(statistics: try json(#"{"income":{"totalIncome":"1000"},"expenses":{"totalDeductible":0}}"#), summary: .null, entity: "demo").recordedNet == nil)
    }

    @Test func duplicateRelativePathsRetainEntityBoundaries() throws {
        let summary = try json(#"{"summary":{"first":{"entity":{"name":"First Demo"},"documents":[{"name":"Demo.pdf","path":"2026/income/Demo.pdf","parsedData":{"wages":100}}]},"second":{"entity":{"name":"Second Demo"},"documents":[{"name":"Demo.pdf","path":"2026/income/Demo.pdf","parsedData":null}]}}}"#)
        let scoped = NativeTaxYear(statistics: .null, summary: summary, entity: "second")
        #expect(scoped.documents.count == 1 && scoped.parsedCount == 0)
        #expect(scoped.sources("2026/income/Demo.pdf").map(\.entity) == ["second"])
        let all = NativeTaxYear(statistics: .null, summary: summary, entity: "all")
        #expect(all.parsedCount == 1 && Set(all.documents.map(\.id)).count == 2)
        #expect(all.sources("2026/income/Demo.pdf").map(\.entity) == ["first", "second"])
        #expect(all.sources("").isEmpty && all.sources("2025/income/Demo.pdf").isEmpty)
    }

    @Test func unparsedDepositZerosAreUnavailableWhileParsedZerosRemainVisible() throws {
        let summary = try json(#"{"summary":{"demo":{"documents":[{"name":"Demo_2026-01.pdf","path":"2026/statements/bank/Demo_2026-01.pdf","parsedData":{"totalDeposits":0}},{"name":"Demo_2026-02.pdf","path":"2026/statements/bank/Demo_2026-02.pdf","parsedData":null}]}}}"#)
        let stats = try json(#"{"bankDeposits":{"demo":{"monthly":[{"month":"2026-01","revenueDeposits":0},{"month":"2026-02","revenueDeposits":0},{"month":"2026-03","revenueDeposits":0}]}}}"#)
        let report = NativeTaxYear(statistics: stats, summary: summary, entity: "demo")
        #expect(report.deposits.map(\.revenue) == [0, nil, nil])
        #expect(report.deposits[0].verified && !report.deposits[1].verified)
        #expect(NativeTaxYear(statistics: stats, summary: summary, entity: "other").deposits.isEmpty)
        var ambiguous = stats
        ambiguous.set("bankDeposits.demo.monthly", .array(stats["bankDeposits"]["demo"]["monthly"].array + [.object(["month": .string("2026-01"), "revenueDeposits": .number(500)])]))
        // A missing or excluded same-month statement must not be attributed to
        // the one included source merely because their month strings match.
        #expect(NativeTaxYear(statistics: ambiguous, summary: summary, entity: "demo").deposits.filter { $0.month == "2026-01" }.allSatisfy { !$0.verified && $0.revenue == nil })
    }
}
