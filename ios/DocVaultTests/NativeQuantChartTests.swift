@testable import DocVault
import Foundation
import Testing

@Suite("Quant date windows, filled bands and source observations")
struct NativeQuantChartTests {
    private func date(_ day: String) throws -> Date {
        try #require(NativeQuant.date(day))
    }

    private func json(_ text: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
    }

    private func line(_ id: String, _ observations: [(String, Double)], segments: [Int] = []) throws -> QuantLine {
        try .init(id: id, title: id, points: observations.enumerated().map { index, row in
            try .init(id: index, date: date(row.0), value: row.1, segment: segments.indices.contains(index) ? segments[index] : 0)
        })
    }

    @Test func fixedHistoryUsesOneUtcCutoffAcrossSparseSeries() throws {
        let current = try line("price", [("2024-11-30", 10), ("2024-12-01", 20), ("2025-12-01", 30)])
        let sparse = try line("sparse", [("2023-12-01", 1), ("2024-11-01", 2), ("2025-01-01", 3)])
        let panel = QuantPanel(id: "x", title: "Synthetic", unit: "USD", lines: [current, sparse])
        let result = NativeQuantChart.snapshot(panel, options: .init(months: 12))
        #expect(result.lines[0].points.map(\.value) == [20, 30])
        #expect(result.lines[1].points.map(\.value) == [3])
        #expect(result.xDomain.lowerBound == (try date("2024-12-01")))
        #expect(result.statistics[1].count == 1)
        #expect(result.statistics[1].change == 0)
        #expect(result.latest == (try date("2025-12-01")))
        let refreshed = QuantPanel(id: "x", title: "Synthetic", unit: "USD", lines: [current, sparse])
        #expect(QuantChartInput(revision: panel.revision, options: .init(months: 12)) != QuantChartInput(revision: refreshed.revision, options: .init(months: 12)))
    }

    @Test func customWindowIncludesTheWholeUtcEndDayAndRejectsReversal() throws {
        let start = try date("2024-02-29"), end = start.addingTimeInterval(86399)
        let window = try #require(QuantDateWindow(start: start.addingTimeInterval(43200), end: end))
        #expect(window.start == start)
        #expect(window.contains(start) && window.contains(end))
        #expect(!window.contains(start.addingTimeInterval(-1)))
        #expect(!window.contains(try date("2024-03-01")))
        #expect(QuantDateWindow(start: try date("2024-03-01"), end: start) == nil)
        #expect(NativeQuant.date("2023-02-29") == nil)
        let intraday = QuantLine(id: "x", title: "Synthetic", points: [.init(id: 0, date: start, value: 1, segment: 0), .init(id: 1, date: end, value: 2, segment: 0), .init(id: 2, date: start.addingTimeInterval(86400), value: 3, segment: 0)])
        let result = NativeQuantChart.snapshot(.init(id: "x", title: "X", unit: "", lines: [intraday]), options: .init(months: -1, custom: window))
        #expect(result.lines[0].points.map(\.value) == [1, 2])
        #expect(result.statistics[0].count == 2)
    }

    @Test func customEmptyWindowsKeepRequestedDatesWithoutInventingObservations() throws {
        let window = try #require(QuantDateWindow(start: date("2026-01-01"), end: date("2026-02-01")))
        let series = try line("x", [("2024-01-01", 4), ("2024-02-01", 5)])
        let result = NativeQuantChart.snapshot(.init(id: "x", title: "X", unit: "", lines: [series]), options: .init(months: -1, custom: window))
        #expect(result.lines[0].points.isEmpty && result.statistics.isEmpty)
        #expect(result.latest == nil)
        #expect(result.xDomain == window.start ... window.end)
        #expect(result.visibleDates.contains("No visible observations"))
        #expect(result.yDomain.lowerBound.isFinite && result.yDomain.upperBound.isFinite)
    }

    @Test func pairedBandsUseExactDatesBreakGapsAndOrderCrossingBoundaries() throws {
        let a = try line("a", [("2024-01-01", 4), ("2024-02-01", 2), ("2024-03-01", 8), ("2024-04-01", 7), ("2024-05-01", 6)])
        let b = try line("b", [("2024-01-01", 2), ("2024-02-01", 4), ("2024-04-01", 5), ("2024-05-01", 8)], segments: [0, 0, 1, 2])
        let band = NativeQuantChart.band("support", "Support", a, b)
        #expect(band.points.map(\.lower) == [2, 2, 5, 6])
        #expect(band.points.map(\.upper) == [4, 4, 7, 8])
        #expect(band.points[0].segment == band.points[1].segment)
        #expect(band.points[1].segment != band.points[2].segment)
        #expect(band.points[2].segment != band.points[3].segment)
        #expect(band.lineIDs == ["a", "b"])
        #expect(band.points.map { NativeQuant.day($0.date) } == ["2024-01-01", "2024-02-01", "2024-04-01", "2024-05-01"])
    }

    @Test func btcBandsRetainAlignedArraysAndMultiplierOrder() throws {
        let data = try json(#"{"prices":[{"date":"2024-01-01","price":100},{"date":"2024-02-01","price":200},{"date":"2024-03-01","price":300}],"fit":{"lower1":[80,null,240],"upper1":[120,null,360],"lower2":[60,120,180],"upper2":[140,280,420]},"bmsb":{"sma20w":[90,null,250],"ema21w":[95,180,240]},"movingAverages":{"sma200d":[80,null,200],"mayerBandMultipliers":[2.4,0.8,1]},"corridor":{"sma20w":[90,180,270],"multipliers":[2,0.5,1]}}"#)
        let panels = NativeQuant.panels(data, resource: "quant-btc-log-regression")
        let regression = try #require(panels.first { $0.id == "regression" })
        #expect(regression.bands.map(\.id) == ["sigma2", "sigma1"])
        #expect(regression.bands[1].points.map(\.lower) == [80, 240])
        #expect(regression.bands[1].points[0].segment != regression.bands[1].points[1].segment)
        let support = try #require(panels.first { $0.id == "bmsb" }?.bands.first)
        #expect(support.points.map(\.lower) == [90, 240])
        #expect(support.points.map(\.upper) == [95, 250])
        let moving = try #require(panels.first { $0.id == "moving" })
        #expect(moving.bands.count == 2)
        #expect(moving.bands[0].points.last?.lower == 160)
        #expect(moving.bands[0].points.last?.upper == 200)
        #expect(moving.bands[1].points.last?.upper == 480)
        #expect(panels.first { $0.id == "corridor" }?.bands.count == 2)
    }

    @Test func recordedRecessionsValidateDeduplicateAndClipToTheChosenWindow() throws {
        let rows = try json(#"[{"start":1704067200000,"end":1714521600000},{"start":1704067200000,"end":1714521600000},{"start":2,"end":1},{"start":0,"end":0},{"start":0}]"#).array + [.object(["start": .number(.infinity), "end": .number(1)])]
        let intervals = NativeQuantChart.recessions(rows)
        #expect(intervals.count == 1 && intervals[0].kind == .recession)
        let window = try #require(QuantDateWindow(start: date("2024-02-01"), end: date("2024-03-01")))
        var panel = QuantPanel(id: "x", title: "X", unit: "", lines: [try line("x", [("2024-02-01", 1), ("2024-03-01", 2)])])
        panel.intervals = intervals
        let result = NativeQuantChart.snapshot(panel, options: .init(months: -1, custom: window))
        #expect(result.intervals[0].start == window.start && result.intervals[0].end == window.end)
        #expect(result.lines[0].points.count == 2)
        #expect(NativeQuantChart.snapshot(panel, options: .init(overlays: false)).intervals.isEmpty)
        #expect(NativeQuantChart.recessions([.object(["start": .number(-Double.greatestFiniteMagnitude), "end": .number(Double.greatestFiniteMagnitude)])]).isEmpty)
    }

    @Test func inversionsStopAtZeroAndUnknownValuesBreakTheRun() throws {
        let rows = try json(#"[{"date":"2024-01-01","t10y2y":-1},{"date":"2024-02-01","t10y2y":-0.5},{"date":"2024-03-01","t10y2y":null},{"date":"2024-04-01","t10y2y":-0.1},{"date":"2024-05-01","t10y2y":0},{"date":"2024-06-01","t10y2y":-1},{"date":"2024-07-01","t10y2y":-2}]"#).array
        let intervals = NativeQuantChart.inversions(rows)
        #expect(intervals.map { NativeQuant.day($0.start) } == ["2024-01-01", "2024-04-01", "2024-06-01"])
        #expect(intervals.map { NativeQuant.day($0.end) } == ["2024-02-01", "2024-05-01", "2024-07-01"])
        #expect(intervals.allSatisfy { $0.kind == .inversion })
        let data = VaultValue.object(["points": .array(rows), "recessions": .array([])])
        let panel = try #require(NativeQuant.panels(data, resource: "quant-macro-yield-curve").first)
        #expect(panel.intervals.count == 3)
        #expect(panel.lines[0].points.contains { $0.value == 0 })
        #expect(NativeQuantChart.inversions([.object(["date": .string("2024-01-01"), "t10y2y": .number(-1)])]).isEmpty)
    }

    @Test func logScaleBreaksZeroNegativeAndSourceGapsButStatisticsRetainThem() throws {
        let series = try line("price", [("2024-01-01", 10), ("2024-02-01", 0), ("2024-03-01", 20), ("2024-04-01", -5), ("2024-05-01", 30), ("2024-06-01", 40)], segments: [0, 0, 0, 0, 0, 1])
        let result = NativeQuantChart.snapshot(.init(id: "x", title: "X", unit: "USD", lines: [series]), options: .init(logarithmic: true))
        #expect(result.lines[0].points.map(\.value) == [10, 20, 30, 40])
        #expect(Set(result.lines[0].points.map(\.segment)).count == 4)
        #expect(result.omittedOnLogScale == 2)
        #expect(result.statistics[0].count == 6)
        #expect(result.statistics[0].minimum == -5 && result.statistics[0].maximum == 40)
        #expect(result.statistics[0].priceChange == 3)
        #expect(result.yDomain.contains(log10(40)))
        #expect(NativeQuant.csv(.init(id: "x", title: "X", unit: "USD", lines: [series])).contains("0.0"))
    }

    @Test func sourceBoundsTransformToLogSpaceAndEmptyDomainsStayFinite() throws {
        let series = try line("x", [("2024-01-01", 10), ("2024-02-01", 100)])
        let panel = QuantPanel(id: "x", title: "X", unit: "USD", lines: [series], bounds: 1 ... 1000)
        #expect(NativeQuantChart.snapshot(panel, options: .init(logarithmic: true)).yDomain == 0 ... 3)
        let empty = NativeQuantChart.snapshot(panel, options: .init(hidden: ["x"]))
        #expect(empty.lines.isEmpty && empty.statistics.isEmpty && empty.latest == nil)
        #expect(empty.yDomain.lowerBound.isFinite && empty.xDomain.lowerBound < empty.xDomain.upperBound)
        let single = try line("x", [("2024-01-01", 0)])
        let result = NativeQuantChart.snapshot(.init(id: "x", title: "X", unit: "", lines: [single]), options: .init(logarithmic: true))
        #expect(result.lines[0].points.isEmpty && result.statistics[0].count == 1)
        #expect(result.omittedOnLogScale == 1 && result.latest == nil)
    }

    @Test func hiddenBoundariesSuppressTheirBandsAndEventsStayInsideTheWindow() throws {
        let a = try line("a", [("2024-01-01", 10), ("2024-02-01", 0), ("2024-03-01", 20)])
        let b = try line("b", [("2024-01-01", 12), ("2024-02-01", 15), ("2024-03-01", 25)])
        var panel = QuantPanel(id: "x", title: "X", unit: "", lines: [a, b])
        panel.bands = [NativeQuantChart.band("support", "Support", a, b)]
        panel.events = [try .init(date: date("2024-01-01"), title: "Golden"), try .init(date: date("2024-03-01"), title: "Death"), try .init(date: date("2024-03-01"), title: "Death")]
        let log = NativeQuantChart.snapshot(panel, options: .init(logarithmic: true))
        #expect(log.bands[0].points.count == 2)
        #expect(log.bands[0].points[0].segment != log.bands[0].points[1].segment)
        #expect(NativeQuantChart.snapshot(panel, options: .init(hidden: ["b"])).bands.isEmpty)
        #expect(NativeQuantChart.snapshot(panel, options: .init(overlays: false)).bands.isEmpty)
        let window = try #require(QuantDateWindow(start: date("2024-02-01"), end: date("2024-03-01")))
        let result = NativeQuantChart.snapshot(panel, options: .init(months: -1, custom: window))
        #expect(result.events.count == 1 && result.events[0].title == "Death")
        #expect(result.statistics[0].first.value == 0 && result.statistics[0].priceChange == nil)
    }

    @Test func statisticsPreserveZeroNegativeBaselinesAndRejectNonfiniteValues() throws {
        let series = try line("x", [("2024-01-01", -2), ("2024-02-01", .infinity), ("2024-03-01", 0)])
        let result = NativeQuantChart.snapshot(.init(id: "x", title: "X", unit: "", lines: [series]), options: .init())
        #expect(result.statistics[0].count == 2 && result.statistics[0].change == 2)
        #expect(result.statistics[0].priceChange == nil)
        #expect(result.lines[0].points[0].segment != result.lines[0].points[1].segment)
        let extremes = try line("x", [("2024-01-01", -Double.greatestFiniteMagnitude), ("2024-02-01", Double.greatestFiniteMagnitude)])
        let extremeResult = NativeQuantChart.snapshot(.init(id: "x", title: "X", unit: "", lines: [extremes]), options: .init())
        #expect(extremeResult.yDomain.lowerBound.isFinite && extremeResult.yDomain.upperBound.isFinite)
    }

    @Test func latestSourceFactsKeepZerosUnknownSignalsAndInvalidDatesDistinct() throws {
        let data = try json(#"{"latest":{"price":0,"fitted":0,"residualSigma":0,"t10y2y":0,"t10y3m":null,"regime":"normal"},"piCycle":{"latest":{"ratio":0}},"inversionStreak":0}"#)
        let regression = QuantPanel(id: "regression", title: "X", unit: "USD", lines: [])
        let facts = NativeQuantChart.facts(data, panel: regression, resource: "quant-btc-log-regression")
        #expect(facts.map(\.value) == ["0 USD", "0 USD", "0 sigma"])
        let pi = QuantPanel(id: "pi", title: "X", unit: "USD", lines: [])
        #expect(!NativeQuantChart.facts(data, panel: pi, resource: "quant-btc-log-regression").contains { $0.title == "Pi signal" })
        var known = data; known.set("piCycle.latest.signalActive", .bool(false))
        #expect(NativeQuantChart.facts(known, panel: pi, resource: "quant-btc-log-regression").last?.value == "Inactive")
        let yield = NativeQuantChart.facts(data, panel: regression, resource: "quant-macro-yield-curve")
        #expect(yield.map(\.value) == ["0 pp", "Unavailable", "Normal", "0 days"])
        #expect(NativeQuant.date(.object(["t": .number(0)])) == (try date("1970-01-01")))
        #expect(NativeQuant.date(.object(["t": .number(Double.greatestFiniteMagnitude)])) == nil)
        #expect(NativeQuant.date(.object(["t": .number(.nan)])) == nil)
    }
}
