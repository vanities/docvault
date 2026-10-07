import Foundation

struct QuantPoint: Identifiable, Hashable, Sendable {
    let id: Int
    let date: Date
    let value: Double
    let segment: Int
}

struct QuantLine: Identifiable, Sendable {
    let id: String
    let title: String
    let points: [QuantPoint]
}

struct QuantEvent: Identifiable, Sendable {
    var id: String {
        "\(date.timeIntervalSince1970)-\(title)"
    }

    let date: Date
    let title: String
}

struct QuantPanel: Identifiable, Sendable {
    // Rebuilding a source snapshot must refresh the chart even when its controls stay the same.
    let revision = UUID()
    let id: String
    let title: String
    let unit: String
    var lines: [QuantLine]
    var events: [QuantEvent] = []
    var description = ""
    var logarithmic = false
    var bounds: ClosedRange<Double>?
    var reference: [Double] = []
    var percentFraction = false
    var bands: [QuantBand] = []
    var intervals: [QuantInterval] = []
    var facts: [QuantFact] = []
    func display(_ value: Double) -> String {
        if percentFraction {
            return value.formatted(.percent.precision(.fractionLength(2)))
        }
        let number = value.formatted(.number.precision(.fractionLength(0 ... 3)))
        return unit.isEmpty ? number : "\(number) \(unit)"
    }
}

enum NativeQuant {
    private static let dayFormat = Date.ISO8601FormatStyle().year().month().day().dateSeparator(.dash)
    static func date(_ value: VaultValue) -> Date? {
        if let t = value["t"].number {
            guard t.isFinite, (-62_135_596_800_000 ... 253_402_300_799_000).contains(t) else { return nil }
            return Date(timeIntervalSince1970: t / 1000)
        }
        return date(value["date"].string)
    }

    static func date(_ value: String) -> Date? {
        let day = String(value.prefix(10))
        guard day.count == 10, let date = try? dayFormat.parse(day), dayFormat.format(date) == day else { return nil }
        return date
    }

    static func day(_ value: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: value)
    }

    static func line(_ id: String, _ title: String, rows: [VaultValue], key: String, aligned: [VaultValue]? = nil, multiplier: Double = 1) -> QuantLine {
        var points: [QuantPoint] = []
        var segment = 0
        var seen = Set<Date>()
        for (index, row) in rows.enumerated() {
            guard let date = date(row) else { segment += 1; continue }
            let value = aligned.map { index < $0.count ? $0[index] : .null } ?? row.at(key)
            guard let number = value.number, (number * multiplier).isFinite else { segment += 1; continue }
            guard seen.insert(date).inserted else { continue }
            points.append(.init(id: index, date: date, value: number * multiplier, segment: segment))
        }
        return .init(id: id, title: title, points: points.sorted { $0.date < $1.date })
    }

    static func panels(_ data: VaultValue, resource: String) -> [QuantPanel] {
        var result: [QuantPanel] = []
        func rowPanel(_ id: String, _ title: String, _ unit: String, rows: [VaultValue], fields: [(String, String)], fraction: Bool = false, log: Bool = false, reference: [Double] = [], bounds: ClosedRange<Double>? = nil) {
            result.append(.init(id: id, title: title, unit: unit, lines: fields.map { line($0.0, $0.1, rows: rows, key: $0.0) }, logarithmic: log, bounds: bounds, reference: reference, percentFraction: fraction))
        }
        if resource == "quant-btc-log-regression" {
            let rows = data["prices"].array
            let price = line("price", "BTC price", rows: rows, key: "price")
            func aligned(_ path: String, _ title: String, multiplier: Double = 1) -> QuantLine {
                line(path + String(multiplier), title, rows: rows, key: "", aligned: data.at(path).array, multiplier: multiplier)
            }
            result.append(.init(id: "regression", title: "Log regression", unit: "USD", lines: [price] + [("line", "Fitted"), ("upper1", "+1 sigma"), ("lower1", "−1 sigma"), ("upper2", "+2 sigma"), ("lower2", "−2 sigma")].map { aligned("fit." + $0.0, $0.1) }, logarithmic: true))
            result.append(.init(id: "moving", title: "Moving averages / Mayer bands", unit: "USD", lines: [price, aligned("movingAverages.sma200w", "200-week SMA")] + data["movingAverages"]["mayerBandMultipliers"].array.compactMap { value in
                value.number.map { aligned("movingAverages.sma200d", "200-day SMA × \($0)", multiplier: $0) }
            }, logarithmic: true))
            result.append(.init(id: "corridor", title: "Cowen corridor", unit: "USD", lines: [price] + data["corridor"]["multipliers"].array.compactMap { value in value.number.map { aligned("corridor.sma20w", "20-week SMA × \($0)", multiplier: $0) } }, logarithmic: true))
            result.append(.init(id: "bmsb", title: "Bull market support band", unit: "USD", lines: [price, aligned("bmsb.sma20w", "20-week SMA"), aligned("bmsb.ema21w", "21-week EMA")], logarithmic: true))
            result.append(.init(id: "pi", title: "Pi Cycle", unit: "USD", lines: [price, aligned("piCycle.sma111d", "111-day SMA"), aligned("piCycle.sma350dDouble", "350-day SMA × 2")], events: rows.enumerated().compactMap { index, row in
                guard index < data["piCycle"]["signal"].array.count, data["piCycle"]["signal"].array[index].boolean, let date = date(row) else { return nil }
                return .init(date: date, title: "Pi signal")
            }, logarithmic: true))
            result.append(.init(id: "crosses", title: "Golden / death crosses", unit: "USD", lines: [price, aligned("movingAverages.sma50d", "50-day SMA"), aligned("movingAverages.sma200d", "200-day SMA")], events: events(data["goldenDeathCrosses"]["events"].array), logarithmic: true))
            result.append(.init(id: "risk", title: "BTC composite risk", unit: "0–1", lines: [aligned("risk.metric", "Composite risk")] + data["risk"]["normalized"].object.keys.sorted().map { aligned("risk.normalized." + $0, VaultValue.label($0)) }, bounds: 0 ... 1, reference: [0.2, 0.8]))
            // Raw components have different units; keep separate axes/panels.
            for key in data["risk"]["components"].object.keys.sorted() {
                result.append(.init(id: "risk-" + key, title: "Risk component · " + VaultValue.label(key), unit: "", lines: [aligned("risk.components." + key, VaultValue.label(key))]))
            }
        } else if data["series"].array.contains(where: { !$0["points"].array.isEmpty }) {
            for item in data["series"].array {
                result.append(.init(id: item["id"].string, title: item["label"].string, unit: item["unit"].string, lines: [line(item["id"].string, item["label"].string, rows: item["points"].array, key: "value")], description: item["description"].string))
            }
        } else {
            switch resource {
            case "quant-macro-yield-curve":
                rowPanel("yield", "Treasury spreads", "percentage points", rows: data["points"].array, fields: [("t10y2y", "10Y − 2Y"), ("t10y3m", "10Y − 3M")], reference: [0])
            case "quant-macro-real-rates":
                result.append(.init(id: "real", title: "Real yields", unit: "%", lines: [line("ten", "10-year", rows: data["ten"].array, key: "real"), line("five", "5-year", rows: data["five"].array, key: "real")], reference: [0]))
                for key in ["ten", "five"] {
                    rowPanel(key, key == "ten" ? "10-year rate decomposition" : "5-year rate decomposition", "%", rows: data[key].array, fields: [("nominal", "Nominal"), ("breakeven", "Breakeven inflation"), ("real", "Real")], reference: [0])
                }
            case "quant-btc-drawdown":
                rowPanel("price", "BTC price and all-time high", "USD", rows: data["series"].array, fields: [("price", "BTC price"), ("ath", "All-time high")], log: true)
                rowPanel("drawdown", "Drawdown", "", rows: data["series"].array, fields: [("drawdown", "Drawdown")], fraction: true, reference: [0])
            case "quant-btc-fear-greed":
                rowPanel("sentiment", "Fear and greed", "0–100", rows: data["history"].array, fields: [("value", "Sentiment")], reference: [25, 75], bounds: 0 ... 100)
            case "quant-btc-flippening":
                rowPanel("ratio", "ETH / BTC ratio", "BTC", rows: data["series"].array, fields: [("ratio", "ETH / BTC")])
                rowPanel("btc", "BTC price", "USD", rows: data["series"].array, fields: [("btcPrice", "BTC")], log: true)
                rowPanel("eth", "ETH price", "USD", rows: data["series"].array, fields: [("ethPrice", "ETH")], log: true)
            case "quant-btc-hash-rate":
                rowPanel("hash", "Hash ribbons", "", rows: data["series"].array, fields: [("hashRate", "Hash rate"), ("sma30", "30-day SMA"), ("sma60", "60-day SMA")])
                result[0].events = events(data["events"].array)
            case "quant-btc-derivatives":
                rowPanel("funding", "Perpetual funding", "", rows: data["fundingHistory"].array, fields: [("rate", "Funding rate")], fraction: true, reference: [0])
                rowPanel("oi", "Open interest", "USD", rows: data["openInterestHistory"].array, fields: [("oiUsd", "Open interest")])
                rowPanel("ratio", "Long / short ratio", "", rows: data["longShortHistory"].array, fields: [("ratio", "Long / short")], reference: [1])
            case "quant-macro-fed-policy":
                result.append(.init(id: "fed", title: "Fed policy and SOFR", unit: "%", lines: [("effectiveRate", "Effective rate"), ("targetUpper", "Target upper"), ("targetLower", "Target lower"), ("sofr", "SOFR")].map { line($0.0, $0.1, rows: data[$0.0].array, key: "rate") }, events: events(data["rateChanges"].array)))
            case "quant-tradfi-shiller-valuation":
                rowPanel("cape", "Cyclically adjusted P/E", "", rows: data["points"].array, fields: [("cape", "CAPE")], reference: data["medians"]["cape"].number.map { [$0] } ?? [])
                rowPanel("div", "Dividend yield", "%", rows: data["points"].array, fields: [("divYield", "Dividend yield")], reference: data["medians"]["divYield"].number.map { [$0] } ?? [])
                rowPanel("spx", "S&P 500 price", "USD", rows: data["points"].array, fields: [("sp500", "S&P 500")], log: true)
            case "quant-tradfi-sp500-risk-metric":
                let rows = data["points"].array
                result.append(.init(id: "risk", title: "S&P 500 composite risk", unit: "0–1", lines: [line("metric", "Composite risk", rows: rows, key: "", aligned: data["metric"].array)] + data["normalized"].object.keys.sorted().map { line($0, VaultValue.label($0), rows: rows, key: "", aligned: data["normalized"][$0].array) }, bounds: 0 ... 1, reference: [0.2, 0.8]))
                rowPanel("price", "S&P 500 price", "USD", rows: rows, fields: [("price", "S&P 500")], log: true)
                for key in data["components"].object.keys.sorted() {
                    result.append(.init(id: key, title: VaultValue.label(key), unit: "", lines: [line(key, VaultValue.label(key), rows: rows, key: "", aligned: data["components"][key].array)]))
                }
            case "quant-running-roi":
                for asset in ["btc", "spx"] {
                    for window in data[asset]["windows"].array {
                        let label = window["label"].string
                        result.append(.init(id: asset + label, title: asset.uppercased() + " · " + label + " rolling ROI", unit: "", lines: [line(asset + label, label, rows: window["series"].array, key: "roi")], description: "\(window["count"].string) observations · Latest percentile \(NativePolitics.percent(window["latestPercentile"].number)) · Mean \(NativePolitics.percent(window["mean"].number)) · Range \(NativePolitics.percent(window["min"].number)) to \(NativePolitics.percent(window["max"].number))", reference: [0], percentFraction: true))
                    }
                }
            case "quant-snapshots":
                // Snapshot timestamps are observation dates, not array positions.
                let rows = data["snapshots"].array
                rowPanel("btc", "Daily BTC price / fitted", "USD", rows: rows, fields: [("btc.price", "BTC"), ("btc.fitted", "Fitted")], log: true)
                rowPanel("sigma", "Daily regression residual", "sigma", rows: rows, fields: [("btc.residualSigma", "Residual")], reference: [0])
            default: break
            }
        }
        for index in result.indices {
            result[index].bands = NativeQuantChart.bands(result[index])
            result[index].facts = NativeQuantChart.facts(data, panel: result[index], resource: resource)
            if resource == "quant-macro-yield-curve" {
                result[index].intervals = NativeQuantChart.recessions(data["recessions"].array) + NativeQuantChart.inversions(data["points"].array)
            }
        }
        return result.filter { $0.lines.contains { !$0.points.isEmpty } }
    }

    static func events(_ rows: [VaultValue]) -> [QuantEvent] {
        rows.compactMap { row in date(row).map { .init(date: $0, title: row["type"].string.capitalized) } }
    }

    static func visible(_ line: QuantLine, months: Int) -> [QuantPoint] {
        guard months > 0, let latest = line.points.last?.date else { return line.points }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let cutoff = calendar.date(byAdding: .month, value: -months, to: latest) ?? latest
        return line.points.filter { $0.date >= cutoff }
    }

    static func csv(_ panel: QuantPanel) -> String {
        func escaped(_ text: String) -> String {
            "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return "date,series,value,unit\n" + panel.lines.flatMap { line in line.points.map { "\(formatter.string(from: $0.date)),\(escaped(line.title)),\($0.value),\(escaped(panel.percentFraction ? "fraction" : panel.unit))" } }.joined(separator: "\n")
    }

    static func export(_ panel: QuantPanel, folder: URL) throws -> URL {
        do {
            try Task.checkCancellation()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            let contents = csv(panel)
            try Task.checkCancellation()
            let url = folder.appendingPathComponent("Chart observations.csv")
            try Data(contents.utf8).write(to: url, options: [.atomic, .completeFileProtection])
            try Task.checkCancellation()
            return url
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }
}
