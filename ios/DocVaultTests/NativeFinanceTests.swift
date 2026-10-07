@testable import DocVault
import Foundation
import Testing

@Suite("Native financial balances and holding price movement")
struct NativeFinanceTests {
    private func json(_ text: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
    }

    @Test func currenciesMissingBalancesAndDebtsAreNotMixed() throws {
        let data = try json(#"{"accounts":[{"id":"a","connectionName":"Acme Bank","currency":"usd","balance":100},{"id":"b","connectionName":"Acme Bank","currency":"USD","balance":-40},{"id":"c","currency":"EUR","balance":200},{"id":"d","currency":"EUR","balance":null},{"id":"z","currency":"USD","balance":0},{"id":"u","currency":"","balance":5}]}"#)
        let accounts = NativeFinance.accounts(data)
        let usd = NativeFinance.totals(accounts.filter { $0.currency == "USD" }.map(\.balance))
        #expect(usd == .init(assets: 100, debt: 40, net: 60, valuedCount: 3, totalCount: 3))
        let euro = NativeFinance.totals(accounts.filter { $0.currency == "EUR" }.map(\.balance))
        #expect(euro.net == 200 && !euro.complete && euro.valuedCount == 1)
        #expect(NativeFinance.bankGroups(accounts, currency: "USD").first { $0.name == "Acme Bank" }?.accounts.count == 2)
        #expect(accounts.last?.currency == "Unspecified")
        #expect(NativeFinance.totals([nil, .infinity]).net == nil)
        #expect(NativeFinance.totals([0]).net == 0)
        #expect(NativeFinance.number(.string("1")) == nil)
        #expect(NativeFinance.money(nil) == "Unavailable")
    }

    @Test func duplicatedSymbolsRemainSeparatePositionsAndCanBeFiltered() throws {
        let data = try json(#"{"accounts":[{"id":"a","name":"Acme First","holdings":[{"ticker":"DEMO","shares":0,"marketValue":0},{"ticker":"OTHER","marketValue":100}]},{"id":"b","name":"Acme Second","holdings":[{"ticker":"DEMO","shares":4,"marketValue":40,"gainLoss":5}]}]}"#)
        let rows = NativeFinance.positions(data)
        #expect(rows.count == 3 && Set(rows.map(\.id)).count == 3)
        #expect(rows.first?.symbol == "OTHER")
        #expect(NativeFinance.positions(data, search: "second").first?.quantity == 4)
        #expect(NativeFinance.positions(data, search: "DEMO", order: "Gain").first?.accountID == "b")
        #expect(NativeFinance.positions(data).last?.quantity == 0)
        #expect(NativeFinance.knownPositionGains(data) == nil)
        let withBasis = try json(#"{"accounts":[{"overrideValue":1000,"holdings":[]},{"holdings":[{"costBasis":100,"gainLoss":20},{"costBasis":200,"gainLoss":-5},{"costBasis":0,"gainLoss":999}]}]}"#)
        #expect(NativeFinance.knownPositionGains(withBasis) == 15)
    }

    @Test func priceMovementUsesCurrentQuantityAndRejectsUnavailableCurrenciesAndSymbols() throws {
        let quote = try json(#"{"currency":"USD","performance":{"changes":{"1D":{"amount":2,"percent":2.04,"baselineDate":"2026-10-05"},"1M":null}}}"#)
        #expect(NativeFinance.priceChange(quote, quantity: 4, period: "1D") == .init(amount: 8, percent: 2.04, baselineDate: "2026-10-05"))
        #expect(NativeFinance.priceChange(quote, quantity: 0, period: "1D")?.amount == 0)
        for quantity: Double? in [nil, -1, .infinity] {
            #expect(NativeFinance.priceChange(quote, quantity: quantity, period: "1D") == nil)
        }
        #expect(NativeFinance.priceChange(quote, quantity: 4, period: "1M") == nil)
        var euro = quote; euro.set("currency", .string("EUR"))
        #expect(NativeFinance.priceChange(euro, quantity: 4, period: "1D") == nil)
        for symbol in ["CASH", "USD", "123456789", "BAD SYMBOL", "https://example.com", ""] {
            #expect(NativeFinance.performanceSymbol(symbol) == nil)
        }
        #expect(NativeFinance.performanceSymbol(" demo ") == "DEMO")
    }

    @Test func balanceHistoryPreservesZerosBreaksMissingDaysAndIgnoresInvalidAndFutureRows() throws {
        let now = try #require(NativeQuant.date("2026-10-06"))
        let rows = try json(#"[{"date":"2026-10-01","bankValue":0},{"date":"2026-10-02","bankValue":null},{"date":"2026-10-03","bankValue":10},{"date":"2026-10-04","bankValue":20},{"date":"2026-10-07","bankValue":30},{"date":"bad","bankValue":40}]"#).array
        let points = NativeFinance.points(rows, key: "bankValue", days: 30, now: now)
        #expect(points.map(\.value) == [0, 10, 20])
        #expect(points.map(\.segment) == [0, 1, 1])
        #expect(NativeFinance.points(rows, key: "brokerValue", now: now).isEmpty)
        #expect(NativePerformance.change(current: .infinity, date: now, snapshots: rows, key: "bankValue") == nil)
        #expect(NativeFinance.latestSnapshot(rows, now: now)?["date"].string == "2026-10-04")
        #expect(NativeFinance.balanceChange(rows, key: "bankValue", period: "1D", now: now) == .init(dollars: 10, percent: 100))
        #expect(NativeFinance.balanceChange(rows, key: "bankValue", period: "7D", now: now) == nil)
        let missingCurrent = rows + [.object(["date": .string("2026-10-05"), "bankValue": .null])]
        #expect(NativeFinance.balanceChange(missingCurrent, key: "bankValue", period: "1D", now: now) == nil)
    }
}
