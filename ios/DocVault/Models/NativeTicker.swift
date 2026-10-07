import Foundation

struct NativeTicker: Identifiable {
    var id: String {
        symbol
    }

    let symbol: String
    var mentions: [VaultValue]
    var score: Double
    var latestDate: String
    static func aggregate(_ entries: [VaultValue], now: Date = Date()) -> [NativeTicker] {
        var tickers: [String: NativeTicker] = [:]
        for entry in entries {
            let day = entry["reportDate"].isEmpty ? String(entry["uploadedAt"].string.prefix(10)) : entry["reportDate"].string
            let weight = NativeQuant.date(day).map { max(0, 1 - max(0, now.timeIntervalSince($0) / 86400) / 365) } ?? 0
            for symbol in Set(entry["tickers"].array.map { $0.string.uppercased() }.filter { !$0.isEmpty }) {
                var ticker = tickers[symbol] ?? .init(symbol: symbol, mentions: [], score: 0, latestDate: day)
                ticker.mentions.append(entry); ticker.score += weight; ticker.latestDate = max(day, ticker.latestDate)
                tickers[symbol] = ticker
            }
        }
        return Array(tickers.values)
    }

    static func sorted(_ rows: [NativeTicker], mode: String) -> [NativeTicker] {
        rows.sorted {
            switch mode {
            case "Recent": if $0.latestDate != $1.latestDate {
                    return $0.latestDate > $1.latestDate
                }
            case "Most mentioned": if $0.mentions.count != $1.mentions.count {
                    return $0.mentions.count > $1.mentions.count
                }
            case "Top picks": if $0.score != $1.score {
                    return $0.score > $1.score
                }
            default: break
            }
            return $0.symbol < $1.symbol
        }
    }
}
