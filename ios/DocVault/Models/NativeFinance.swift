import Foundation

struct NativePerformance: Equatable {
    let dollars: Double
    let percent: Double?
    static func change(current: Double, date: Date, days: Int? = nil, months: Int? = nil, snapshots: [VaultValue], key: String) -> NativePerformance? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard current.isFinite, let target = calendar.date(byAdding: days == nil ? .month : .day, value: -(days ?? months ?? 1), to: date),
              let baseline = snapshots.first(where: { $0["date"].string == NativeQuant.day(target) }).flatMap({ NativeFinance.number($0[key]) })
        else { return nil }
        let change = current - baseline
        guard change.isFinite else { return nil }
        let percent = baseline == 0 ? nil : change / abs(baseline) * 100
        return .init(dollars: change, percent: percent?.isFinite == true ? percent : nil)
    }
}

struct FinanceAccount: Identifiable, Hashable {
    let id: String
    let value: VaultValue
    var name: String {
        value["name"].string.isEmpty ? "Unnamed account" : value["name"].string
    }

    var currency: String {
        NativeFinance.currency(value["currency"].string)
    }

    var institution: String {
        value["connectionName"].string.isEmpty ? "Unknown institution" : value["connectionName"].string
    }

    var balance: Double? {
        NativeFinance.number(value["balance"])
    }
}

struct FinanceGroup: Identifiable {
    let name: String
    let accounts: [FinanceAccount]
    var id: String {
        name
    }

    var totals: FinanceTotals {
        NativeFinance.totals(accounts.map(\.balance))
    }
}

struct FinanceTotals: Equatable {
    let assets: Double?
    let debt: Double?
    let net: Double?
    let valuedCount: Int
    let totalCount: Int
    var complete: Bool {
        valuedCount == totalCount
    }
}

struct FinancePosition: Identifiable, Hashable {
    let id: String
    let accountID: String
    let accountName: String
    let value: VaultValue
    var symbol: String {
        value["ticker"].string.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    var quantity: Double? {
        NativeFinance.number(value["shares"])
    }

    var marketValue: Double? {
        NativeFinance.number(value["marketValue"])
    }

    var gainLoss: Double? {
        guard let basis = NativeFinance.number(value["costBasis"]), basis > 0 else { return nil }
        return NativeFinance.number(value["gainLoss"])
    }

    var label: String {
        value["label"].string.isEmpty ? symbol : value["label"].string
    }
}

struct FinanceHistoryPoint: Identifiable {
    let date: Date
    let value: Double
    let segment: Int
    var id: Date {
        date
    }
}

struct FinancePriceChange: Equatable {
    let amount: Double
    let percent: Double
    let baselineDate: String
}

enum NativeFinance {
    static func number(_ value: VaultValue) -> Double? {
        guard case let .number(number) = value, number.isFinite else { return nil }
        return number
    }

    static func currency(_ value: String) -> String {
        let code = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return code.utf8.count == 3 && code.utf8.allSatisfy { (65 ... 90).contains($0) } ? code : "Unspecified"
    }

    static func money(_ value: Double?, currency: String = "USD") -> String {
        guard let value, value.isFinite else { return "Unavailable" }
        return currency == "Unspecified" ? value.formatted(.number.precision(.fractionLength(2))) + " (currency unknown)" : value.formatted(.currency(code: currency))
    }

    static func accounts(_ data: VaultValue) -> [FinanceAccount] {
        data["accounts"].array.enumerated().map { index, row in
            .init(id: "\(index):" + row["id"].string, value: row)
        }
    }

    static func totals(_ values: [Double?]) -> FinanceTotals {
        let known = values.compactMap { value in value.flatMap { $0.isFinite ? $0 : nil } }
        func finiteSum(_ values: [Double]) -> Double? {
            let sum = values.reduce(0, +)
            return known.isEmpty || !sum.isFinite ? nil : sum
        }
        return .init(assets: finiteSum(known.filter { $0 >= 0 }), debt: finiteSum(known.filter { $0 < 0 }.map { -$0 }), net: finiteSum(known), valuedCount: known.count, totalCount: values.count)
    }

    static func bankGroups(_ accounts: [FinanceAccount], currency: String) -> [FinanceGroup] {
        Dictionary(grouping: accounts.filter { $0.currency == currency }, by: \.institution)
            .map { .init(name: $0.key, accounts: $0.value) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    static func positions(_ data: VaultValue, search: String = "", order: String = "Value") -> [FinancePosition] {
        let rows = data["accounts"].array.enumerated().flatMap { accountIndex, account in
            account["holdings"].array.enumerated().map { index, holding in
                FinancePosition(id: "\(accountIndex):\(index):" + account["id"].string, accountID: account["id"].string, accountName: account["name"].string, value: holding)
            }
        }.filter { search.isEmpty || ($0.label + " " + $0.symbol + " " + $0.accountName).localizedCaseInsensitiveContains(search) }
        return rows.sorted {
            if order == "Symbol", $0.symbol != $1.symbol {
                return $0.symbol < $1.symbol
            }
            if order == "Gain", number($0.value["gainLoss"]) != number($1.value["gainLoss"]) {
                return (number($0.value["gainLoss"]) ?? -.infinity) > (number($1.value["gainLoss"]) ?? -.infinity)
            }
            if $0.marketValue != $1.marketValue {
                return ($0.marketValue ?? -.infinity) > ($1.marketValue ?? -.infinity)
            }
            return $0.id < $1.id
        }
    }

    static func performanceSymbol(_ value: String) -> String? {
        let symbol = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard symbol.range(of: "^[A-Z0-9.^=-]{1,16}$", options: .regularExpression) != nil,
              !["USD", "CASH"].contains(symbol), symbol.range(of: "^[A-Z0-9]{8}[0-9]$", options: .regularExpression) == nil
        else { return nil }
        return symbol
    }

    static func knownPositionGains(_ data: VaultValue) -> Double? {
        let gains = positions(data).compactMap(\.gainLoss)
        let sum = gains.reduce(0, +)
        return gains.isEmpty || !sum.isFinite ? nil : sum
    }

    static func priceChange(_ quote: VaultValue, quantity: Double?, period: String) -> FinancePriceChange? {
        let value = quote["performance"]["changes"][period]
        guard quote["currency"].string == "USD", let quantity, quantity.isFinite, quantity >= 0,
              let amount = number(value["amount"]), let percent = number(value["percent"]), NativeQuant.date(value["baselineDate"].string) != nil,
              (amount * quantity).isFinite
        else { return nil }
        return .init(amount: amount * quantity, percent: percent, baselineDate: value["baselineDate"].string)
    }

    static func history(_ data: VaultValue) -> [VaultValue] {
        (data.array.isEmpty ? data["snapshots"].array : data.array).sorted { $0["date"].string < $1["date"].string }
    }

    static func latestSnapshot(_ history: [VaultValue], now: Date = Date()) -> VaultValue? {
        history.filter { row in row["date"].string.count == 10 && NativeQuant.date(row["date"].string).map { $0 <= now } == true }
            .max { $0["date"].string < $1["date"].string }
    }

    static func balanceChange(_ history: [VaultValue], key: String, period: String, now: Date = Date()) -> NativePerformance? {
        guard ["1D", "7D", "1M"].contains(period), let latest = latestSnapshot(history, now: now),
              let date = NativeQuant.date(latest["date"].string), let value = number(latest[key])
        else { return nil }
        return NativePerformance.change(current: value, date: date, days: period == "1M" ? nil : period == "1D" ? 1 : 7, months: period == "1M" ? 1 : nil, snapshots: history, key: key)
    }

    static func points(_ history: [VaultValue], key: String, days: Int = 90, now: Date = Date()) -> [FinanceHistoryPoint] {
        let start = now.addingTimeInterval(-Double(days) * 86400)
        var seen: Set<Date> = []
        let values: [(Date, Double)] = history.compactMap { row in
            guard let date = NativeQuant.date(row["date"].string), date >= start, date <= now, let value = number(row[key]), seen.insert(date).inserted else { return nil }
            return (date, value)
        }.sorted { $0.0 < $1.0 }
        var segment = 0
        var previous: Date?
        return values.map { date, value in
            if let previous, date.timeIntervalSince(previous) > 86401 {
                segment += 1
            }
            previous = date
            return .init(date: date, value: value, segment: segment)
        }
    }
}
