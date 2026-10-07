import Foundation

struct QuantBandPoint: Identifiable, Sendable {
    let id: Int
    let date: Date
    let lower: Double
    let upper: Double
    let segment: Int
}

struct QuantBand: Identifiable, Sendable {
    let id: String
    let title: String
    let lineIDs: Set<String>
    var points: [QuantBandPoint]
}

struct QuantInterval: Identifiable, Sendable {
    enum Kind: String, Sendable { case recession, inversion }
    var id: String {
        "\(kind.rawValue)-\(start.timeIntervalSince1970)-\(end.timeIntervalSince1970)"
    }

    let start: Date
    let end: Date
    let kind: Kind
}

struct QuantFact: Identifiable, Sendable {
    var id: String {
        title
    }

    let title: String
    let value: String
}

struct QuantDateWindow: Hashable, Sendable {
    let start: Date
    let end: Date

    init?(start: Date, end: Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let first = calendar.startOfDay(for: start)
        let last = calendar.startOfDay(for: end)
        guard first <= last, let next = calendar.date(byAdding: .day, value: 1, to: last) else { return nil }
        self.start = first
        // Include every observation on the selected end day, including intraday data.
        self.end = next.addingTimeInterval(-0.001)
    }

    func contains(_ date: Date) -> Bool {
        date >= start && date <= end
    }
}

struct QuantChartOptions: Hashable, Sendable {
    var months = 0
    var custom: QuantDateWindow?
    var logarithmic = false
    var hidden = Set<String>()
    var overlays = true
}

struct QuantChartInput: Hashable, Sendable {
    let revision: UUID
    let options: QuantChartOptions
}

struct QuantWindowStatistics: Identifiable, Sendable {
    let id: String
    let title: String
    let count: Int
    let first: QuantPoint
    let last: QuantPoint
    let minimum: Double
    let maximum: Double
    var change: Double {
        last.value - first.value
    }

    /// A percentage change is meaningful only for a positive price baseline.
    var priceChange: Double? {
        guard first.value > 0 else { return nil }
        let value = last.value / first.value - 1
        return value.isFinite ? value : nil
    }
}

struct QuantChartSnapshot: Sendable {
    let lines: [QuantLine]
    let bands: [QuantBand]
    let intervals: [QuantInterval]
    let events: [QuantEvent]
    let statistics: [QuantWindowStatistics]
    let xDomain: ClosedRange<Date>
    let yDomain: ClosedRange<Double>
    let omittedOnLogScale: Int

    var latest: Date? {
        lines.compactMap { $0.points.last?.date }.max()
    }

    var visibleDates: String {
        let dates = lines.flatMap { $0.points.map(\.date) }
        guard let first = dates.min(), let last = dates.max() else { return "No visible observations. Adjust the dates or enable a series." }
        return "From " + NativeQuant.day(first) + " through " + NativeQuant.day(last)
    }
}

enum NativeQuantChart {
    static func band(_ id: String, _ title: String, _ first: QuantLine, _ second: QuantLine) -> QuantBand {
        let a = Dictionary(first.points.map { ($0.date, $0) }, uniquingKeysWith: { original, _ in original })
        let b = Dictionary(second.points.map { ($0.date, $0) }, uniquingKeysWith: { original, _ in original })
        let dates = Set(a.keys).union(b.keys).sorted()
        var points: [QuantBandPoint] = [], segment = 0
        var previous: (Int, Int)?
        for (index, date) in dates.enumerated() {
            guard let x = a[date], let y = b[date] else { segment += 1; previous = nil; continue }
            guard x.value.isFinite, y.value.isFinite else { segment += 1; previous = nil; continue }
            if let previous, previous.0 != x.segment || previous.1 != y.segment {
                segment += 1
            }
            points.append(.init(id: index, date: date, lower: min(x.value, y.value), upper: max(x.value, y.value), segment: segment))
            previous = (x.segment, y.segment)
        }
        return .init(id: id, title: title, lineIDs: [first.id, second.id], points: points)
    }

    static func bands(_ panel: QuantPanel) -> [QuantBand] {
        func pair(_ id: String, _ title: String, _ a: String, _ b: String) -> QuantBand? {
            guard let first = panel.lines.first(where: { $0.id == a }), let second = panel.lines.first(where: { $0.id == b }) else { return nil }
            let value = band(id, title, first, second)
            return value.points.isEmpty ? nil : value
        }
        switch panel.id {
        case "regression":
            return [pair("sigma2", "±2 sigma", "fit.lower21.0", "fit.upper21.0"), pair("sigma1", "±1 sigma", "fit.lower11.0", "fit.upper11.0")].compactMap(\.self)
        case "bmsb":
            return [pair("support", "20-week SMA / 21-week EMA", "bmsb.sma20w1.0", "bmsb.ema21w1.0")].compactMap(\.self)
        case "moving", "corridor":
            let prefix = panel.id == "moving" ? "movingAverages.sma200d" : "corridor.sma20w"
            let lines = panel.lines.filter { $0.id.hasPrefix(prefix) }
                .sorted { (Double($0.id.dropFirst(prefix.count)) ?? 0) < (Double($1.id.dropFirst(prefix.count)) ?? 0) }
            return zip(lines, lines.dropFirst()).enumerated().map { index, pair in band("range-\(index)", pair.0.title + " to " + pair.1.title, pair.0, pair.1) }.filter { !$0.points.isEmpty }
        default: return []
        }
    }

    static func recessions(_ rows: [VaultValue]) -> [QuantInterval] {
        rows.compactMap { row -> QuantInterval? in
            guard let a = row["start"].number, let b = row["end"].number, a.isFinite, b.isFinite, a < b,
                  (-62_135_596_800_000 ... 253_402_300_799_000).contains(a), (-62_135_596_800_000 ... 253_402_300_799_000).contains(b) else { return nil }
            return .init(start: Date(timeIntervalSince1970: a / 1000), end: Date(timeIntervalSince1970: b / 1000), kind: .recession)
        }.reduce(into: [QuantInterval]()) {
            result, interval in if !result.contains(where: { $0.id == interval.id }) {
                result.append(interval)
            }
        }.sorted { $0.start < $1.start }
    }

    static func inversions(_ rows: [VaultValue]) -> [QuantInterval] {
        let sorted = rows.compactMap { row in NativeQuant.date(row).map { ($0, row["t10y2y"].number) } }.sorted { $0.0 < $1.0 }
        var start: Date?, previous: Date?, seen = Set<Date>(), result: [QuantInterval] = []
        func finish(_ end: Date?) {
            if let start, let end, start < end {
                result.append(.init(start: start, end: end, kind: .inversion))
            }
            start = nil
        }
        for (date, value) in sorted where seen.insert(date).inserted {
            guard let value, value.isFinite else { finish(previous); previous = nil; continue }
            if value < 0 {
                if start == nil {
                    start = date
                }
            } else {
                finish(date)
            }
            previous = date
        }
        finish(previous)
        return result
    }

    static func snapshot(_ panel: QuantPanel, options: QuantChartOptions) -> QuantChartSnapshot {
        let allDates = panel.lines.flatMap { $0.points.map(\.date) }
        let last = allDates.max() ?? Date(timeIntervalSince1970: 0)
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let cutoff = options.months > 0 ? calendar.date(byAdding: .month, value: -options.months, to: last) : nil
        func included(_ date: Date) -> Bool {
            if options.months == -1, let custom = options.custom {
                return custom.contains(date)
            }
            return cutoff == nil || date >= cutoff!
        }
        var statistics: [QuantWindowStatistics] = [], omitted = 0
        let lines = panel.lines.filter { !options.hidden.contains($0.id) }.map { line in
            let raw = line.points.filter { included($0.date) && $0.value.isFinite }
            if let first = raw.first, let last = raw.last, let minimum = raw.map(\.value).min(), let maximum = raw.map(\.value).max() {
                statistics.append(.init(id: line.id, title: line.title, count: raw.count, first: first, last: last, minimum: minimum, maximum: maximum))
            }
            var segment = 0, previous: Int?
            let points: [QuantPoint] = line.points.filter { included($0.date) }.compactMap { point in
                guard point.value.isFinite else { segment += 1; previous = nil; return nil }
                guard !options.logarithmic || point.value > 0 else { omitted += 1; segment += 1; previous = nil; return nil }
                if let previous, previous != point.segment {
                    segment += 1
                }
                previous = point.segment
                return .init(id: point.id, date: point.date, value: point.value, segment: segment)
            }
            return QuantLine(id: line.id, title: line.title, points: points)
        }
        let start = options.months == -1 ? options.custom?.start ?? allDates.min() ?? last : cutoff ?? allDates.min() ?? last
        let end = options.months == -1 ? options.custom?.end ?? last : last
        let xDomain = start < end ? start ... end : start.addingTimeInterval(-43200) ... end.addingTimeInterval(43200)
        let bands: [QuantBand] = options.overlays ? panel.bands.filter { $0.lineIDs.isDisjoint(with: options.hidden) }.map { band in
            var result = band, segment = 0, previous: Int?
            result.points = band.points.filter { included($0.date) }.compactMap { point in
                guard !options.logarithmic || point.lower > 0 else { segment += 1; previous = nil; return nil }
                if let previous, previous != point.segment {
                    segment += 1
                }
                previous = point.segment
                return .init(id: point.id, date: point.date, lower: point.lower, upper: point.upper, segment: segment)
            }
            return result
        }.filter { !$0.points.isEmpty } : []
        let intervals: [QuantInterval] = options.overlays ? panel.intervals.compactMap { interval in
            let a = max(interval.start, xDomain.lowerBound), b = min(interval.end, xDomain.upperBound)
            return a < b ? .init(start: a, end: b, kind: interval.kind) : nil
        } : []
        func scaled(_ value: Double) -> Double? {
            options.logarithmic ? (value > 0 ? log10(value) : nil) : value
        }
        let values = lines.flatMap { $0.points.compactMap { scaled($0.value) } } + panel.reference.compactMap { scaled($0) }
        let low = values.min() ?? 0, high = values.max() ?? 1
        let padding = max((high / 2 - low / 2) * 0.1, abs(high) * 0.001, 0.001)
        let paddedLow = (low - padding).isFinite ? low - padding : -Double.greatestFiniteMagnitude
        let paddedHigh = (high + padding).isFinite ? high + padding : Double.greatestFiniteMagnitude
        let bounds = panel.bounds.flatMap { range -> ClosedRange<Double>? in
            guard let a = scaled(range.lowerBound), let b = scaled(range.upperBound), a < b else { return nil }
            return a ... b
        }
        let uniqueIntervals = intervals.reduce(into: [QuantInterval]()) {
            result, item in if !result.contains(where: { $0.id == item.id }) {
                result.append(item)
            }
        }
        let events = panel.events.filter { included($0.date) && xDomain.contains($0.date) }.reduce(into: [QuantEvent]()) {
            result, item in if !result.contains(where: { $0.id == item.id }) {
                result.append(item)
            }
        }.sorted { $0.date < $1.date }
        return .init(lines: lines, bands: bands, intervals: uniqueIntervals, events: events, statistics: statistics, xDomain: xDomain, yDomain: bounds ?? paddedLow ... paddedHigh, omittedOnLogScale: omitted)
    }

    static func facts(_ data: VaultValue, panel: QuantPanel, resource: String) -> [QuantFact] {
        var result: [QuantFact] = []
        func number(_ title: String, _ path: String, _ unit: String = "") {
            let value = data.at(path).number.flatMap { $0.isFinite ? $0 : nil }
            result.append(.init(title: title, value: value.map { $0.formatted(.number.precision(.fractionLength(0 ... 3))) + (unit.isEmpty ? "" : " " + unit) } ?? "Unavailable"))
        }
        func label(_ title: String, _ path: String) {
            let value = data.at(path).string
            result.append(.init(title: title, value: value.isEmpty ? "Unavailable" : VaultValue.label(value)))
        }
        if resource == "quant-btc-log-regression" {
            number("BTC price", "latest.price", "USD")
            switch panel.id {
            case "regression": number("Fitted price", "latest.fitted", "USD"); number("Residual", "latest.residualSigma", "sigma")
            case "moving": number("200-day SMA", "movingAverages.latest.sma200d", "USD"); number("200-week SMA", "movingAverages.latest.sma200w", "USD"); number("Mayer multiple", "risk.latest.components.mayerMultiple", "×")
            case "corridor": number("20-week SMA", "corridor.latest.sma20w", "USD"); number("Price / SMA", "corridor.latest.currentMultiple", "×")
            case "bmsb": number("20-week SMA", "bmsb.latest.sma20w", "USD"); number("21-week EMA", "bmsb.latest.ema21w", "USD"); label("Support-band state", "bmsb.latest.state")
            case "pi": number("Cycle ratio", "piCycle.latest.ratio", "×"); if case let .bool(active) = data["piCycle"]["latest"]["signalActive"] {
                    result.append(.init(title: "Pi signal", value: active ? "Active" : "Inactive"))
                }
            case "crosses": label("Recorded regime", "goldenDeathCrosses.currentRegime")
            case "risk": number("Composite risk", "risk.latest.metric", "0–1")
            default: result = []
            }
        } else if resource == "quant-macro-yield-curve" {
            number("10Y − 2Y", "latest.t10y2y", "pp"); number("10Y − 3M", "latest.t10y3m", "pp")
            label("Recorded regime", "latest.regime"); number("Inversion streak", "inversionStreak", "days")
        }
        return result
    }
}
