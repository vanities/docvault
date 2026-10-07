import Foundation

enum NativePredictions {
    static func key(_ value: VaultValue) -> String {
        value["source"].string + ":" + value["id"].string
    }

    static func probability(_ value: VaultValue) -> Double? {
        guard let n = value["probability"].number, n.isFinite, (0 ... 100).contains(n) else { return nil }
        return n
    }

    static func markets(_ data: VaultValue) -> [VaultValue] {
        var seen = Set<String>()
        return (data["finance"].array + data["politics"].array).filter { seen.insert(key($0)).inserted }
    }

    static func sorted(_ rows: [VaultValue], mode: String) -> [VaultValue] {
        func rank(_ row: VaultValue) -> Double {
            if mode == "Probability" {
                return probability(row) ?? -.infinity
            }
            let n = row[mode == "24h movement" ? "change24h" : "volumeUsd"].number
            guard let n, n.isFinite else { return -.infinity }
            return mode == "24h movement" ? abs(n) : n
        }
        return rows.sorted { a, b in
            let x = rank(a), y = rank(b)
            return x == y ? key(a) < key(b) : x > y
        }
    }

    static func movers(_ data: VaultValue) -> [VaultValue] {
        Array(sorted(markets(data).filter { guard let n = $0["change24h"].number else { return false }; return n.isFinite && abs(n) >= 1 }, mode: "24h movement").prefix(4))
    }

    static func reportedVolumes(_ rows: [VaultValue]) -> [Double] {
        rows.compactMap { row in guard let n = row["volumeUsd"].number, n.isFinite, n >= 0 else { return nil }; return n }
    }

    static func volume(_ rows: [VaultValue]) -> Double? {
        let values = reportedVolumes(rows)
        let total = values.reduce(0, +)
        return values.isEmpty || !total.isFinite ? nil : total
    }

    static func usd(_ value: Double?) -> String {
        guard let value, value.isFinite, value >= 0 else { return "Unavailable" }
        return value.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    static func change(_ value: VaultValue) -> String {
        guard let n = value["change24h"].number, n.isFinite else { return "Unavailable" }
        return (n > 0 ? "+" : "") + n.formatted(.number.precision(.fractionLength(0 ... 2))) + " pp"
    }
}
