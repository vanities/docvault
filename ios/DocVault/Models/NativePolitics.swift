import Foundation

struct PoliticalMonth: Identifiable, Equatable {
    var id: String {
        month
    }

    let month: String
    var buys: Double = 0
    var sells: Double = 0
    var count = 0
}

enum NativePolitics {
    /// The server returns local portrait paths. Never send the session to a URL
    /// supplied by feed content, or allow a path to address another API route.
    static func portraitRequest(_ path: String) -> VaultRequest? {
        let prefix = "/api/politics/headshot/"
        guard path.hasPrefix(prefix) else { return nil }
        let id = String(path.dropFirst(prefix.count))
        guard !id.isEmpty, id.utf8.count <= 64,
              id.utf8.allSatisfy({ (48 ... 57).contains($0) || (65 ... 90).contains($0) || (97 ... 122).contains($0) })
        else { return nil }
        return try? VaultRequest("api/politics/headshot/{id}", scope: .init(), record: .object(["id": .string(id)]))
    }

    static func initials(_ name: String) -> String {
        let letters = name.split(whereSeparator: { $0.isWhitespace }).compactMap { $0.first(where: { $0.isLetter }) }
        return letters.isEmpty ? "?" : String(letters.prefix(2)).uppercased()
    }

    static func count(_ value: VaultValue) -> Int? {
        guard case let .number(number) = value, number.isFinite, number >= 0,
              number.rounded(.towardZero) == number, number < Double(Int.max)
        else { return nil }
        return Int(number)
    }

    static func researchClaims(_ data: VaultValue, kind: String = "All", search: String = "") -> [PoliticalResearchClaim] {
        var seen: Set<String> = []
        return data["links"].array.compactMap { row in
            guard !row["entryId"].string.isEmpty, !row["claimId"].string.isEmpty else { return nil }
            let claim = PoliticalResearchClaim(value: row)
            guard seen.insert(claim.id).inserted,
                  kind != "Assets" || !row["tickers"].array.isEmpty,
                  kind != "Topics" || !row["topics"].array.isEmpty,
                  search.isEmpty || row.stringSearch.localizedCaseInsensitiveContains(search)
            else { return nil }
            return claim
        }
    }

    static func researchSignals(_ data: VaultValue, kind: String = "All", search: String = "") -> [VaultValue] {
        data["briefs"].array.filter { row in
            !row["key"].string.isEmpty
                && (kind != "Assets" || row["kind"].string == "ticker")
                && (kind != "Topics" || row["kind"].string == "topic")
                && (search.isEmpty || row.stringSearch.localizedCaseInsensitiveContains(search))
        }
    }

    /// Disclosed upper bounds, matching the web explorer. Not exact spending.
    static func monthly(_ trades: [VaultValue]) -> [PoliticalMonth] {
        let months = Set(trades.map { String($0["tradeDate"].string.prefix(7)) }.filter { $0.count == 7 }).sorted()
        guard let last = months.last, let end = NativeQuant.date(last + "-01") else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let earliest = calendar.date(byAdding: .month, value: -14, to: end)!
        let start = max(earliest, months.first.flatMap { NativeQuant.date($0 + "-01") } ?? earliest)
        var result: [PoliticalMonth] = []
        var cursor = start
        while cursor <= end {
            let month = String(NativeQuant.day(cursor).prefix(7))
            let rows = trades.filter { $0["tradeDate"].string.hasPrefix(month) }
            result.append(PoliticalMonth(month: month,
                                         buys: rows.filter { $0["category"].string == "buy" }.reduce(0) { $0 + ($1["amountMax"].number ?? 0) },
                                         sells: rows.filter { $0["category"].string == "sell" }.reduce(0) { $0 + ($1["amountMax"].number ?? 0) }, count: rows.count))
            cursor = calendar.date(byAdding: .month, value: 1, to: cursor)!
        }
        return result
    }

    static func clusters(_ rows: [VaultValue], sort: String) -> [VaultValue] {
        let keys: [String] = switch sort {
        case "Recent": ["lastDate", "politicianCount"]
        case "Amount": ["amountMax", "politicianCount"]
        case "Trades": ["tradeCount", "politicianCount"]
        default: ["politicianCount", "tradeCount", "lastDate"]
        }
        return rows.sorted { lhs, rhs in
            for key in keys {
                if key == "lastDate" {
                    if lhs[key].string != rhs[key].string {
                        return lhs[key].string > rhs[key].string
                    }
                } else if (lhs[key].number ?? 0) != (rhs[key].number ?? 0) {
                    return (lhs[key].number ?? 0) > (rhs[key].number ?? 0)
                }
            }
            return lhs["ticker"].string < rhs["ticker"].string
        }
    }

    static func displayedReturn(_ trade: VaultValue) -> Double? {
        trade[trade["isOption"].boolean ? "underlyingPct" : "gainPct"].number
    }

    static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "Unavailable" }
        return value.formatted(.percent.precision(.fractionLength(1)))
    }

    static func currency(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "Unavailable" }
        return value.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    static func sourceURL(_ value: VaultValue) -> URL? {
        guard let url = URL(string: value.string), ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }
}

struct PoliticalResearchClaim: Identifiable, Hashable {
    let value: VaultValue
    var id: String {
        [value["entryId"].string, value["claimId"].string].map { "\($0.utf8.count):\($0)" }.joined()
    }
}
