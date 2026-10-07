@testable import DocVault
import Foundation
import Testing

@Suite("Native market charts and political disclosures")
struct NativeMarketTests {
    @Test func politicalPortraitPathsCannotAddressOtherRoutesOrOrigins() throws {
        let request = try #require(NativePolitics.portraitRequest("/api/politics/headshot/D000001"))
        #expect(request.path == ["api", "politics", "headshot", "D000001"])
        #expect(try ServerAddress("https://vault.example.com/proxy").endpoint(request.path).absoluteString == "https://vault.example.com/proxy/api/politics/headshot/D000001")
        for path in ["https://evil.example/api/politics/headshot/D000001", "//evil.example/api/politics/headshot/D000001", "/api/politics/headshot/../settings", "/api/politics/headshot/%2fsettings", "/api/politics/headshot/A?token=x", "/api/politics/headshot/A#x", "/api/politics/headshot/", "/api/politics/headshot/☃", "/api/politics/headshot/" + String(repeating: "a", count: 65)] {
            #expect(NativePolitics.portraitRequest(path) == nil)
        }
        #expect(NativePolitics.initials(" Demo Member ") == "DM")
        #expect(NativePolitics.initials("  ") == "?")
    }

    @Test func researchIdentityFiltersAndCountSemanticsPreserveDistinctSources() throws {
        let data = try json(##"{"links":[{"entryId":"a","claimId":"same","claimText":"Asset thesis","tickers":["DEMO"],"topics":["chips"],"matchedTrades":[{"politicianName":"Demo Member"}]},{"entryId":"b","claimId":"same","claimText":"Rates thesis","tickers":[],"topics":["rates"]},{"entryId":"a","claimId":"same"},{"claimId":"invalid"}],"briefs":[{"key":"ticker:DEMO","kind":"ticker","label":"DEMO"},{"key":"topic:rates","kind":"topic","label":"#rates"}]}"##)
        let claims = NativePolitics.researchClaims(data)
        #expect(claims.count == 2 && Set(claims.map(\.id)).count == 2)
        #expect(NativePolitics.researchClaims(data, kind: "Assets").count == 1)
        #expect(NativePolitics.researchClaims(data, kind: "Topics").count == 2)
        #expect(NativePolitics.researchClaims(data, search: "demo member").first?.value["entryId"].string == "a")
        #expect(NativePolitics.researchSignals(data, kind: "Topics", search: "rates").first?["key"].string == "topic:rates")
        #expect(NativePolitics.count(.number(0)) == 0)
        for value: VaultValue in [.null, .string("3"), .number(-1), .number(1.2), .number(.infinity), .number(Double(Int.max))] {
            #expect(NativePolitics.count(value) == nil)
        }
    }

    private func json(_ text: String) throws -> VaultValue {
        try JSONDecoder().decode(VaultValue.self, from: Data(text.utf8))
    }

    @Test func publishedReleaseCalendarUsesEasternDaysAndDoesNotExtrapolate() throws {
        let schedule = try NativeMacroSchedule.load()
        let formatter = ISO8601DateFormatter()
        let now = try #require(formatter.date(from: "2026-10-06T18:00:00Z"))
        let next = try #require(schedule.upcoming(now: now).first)
        #expect(next.date == "2026-10-14" && next.type == "cpi")
        #expect(NativeMacroSchedule.daysAway(next, now: now) == 8)
        let easternEvening = try #require(formatter.date(from: "2026-01-10T02:00:00Z"))
        let sameDay = try #require(schedule.upcoming(now: easternEvening).first)
        #expect(sameDay.date == "2026-01-09" && sameDay.type == "nfp")
        #expect(NativeMacroSchedule.daysAway(sameDay, now: easternEvening) == 0)
        #expect(schedule.upcoming(now: try #require(formatter.date(from: "2030-01-01T18:00:00Z"))).isEmpty)
        #expect(schedule.upcoming(now: now, type: "CPI").allSatisfy { $0.type == "cpi" })
    }

    @Test func overviewKeepsZeroValuesMissingStatesAndDifferentPercentageUnits() throws {
        let btc = try json(#"{"risk":{"latest":{"metric":0}},"piCycle":{"latest":{"signalActive":false}}}"#)
        let macro = try json(#"{"series":[{"id":"DFF","latest":{"value":4.25}},{"id":"M2SL","latest":{"value":22000}}]}"#)
        let derivatives = try json(#"{"currentFundingRate":0.0001}"#)
        let business = try json(#"{"series":[{"id":"SAHMREALTIME","latest":{"value":0}},{"id":"RECPROUSM156N","latest":{"value":0.12}}]}"#)
        let signals = NativeQuantOverview.signals(["quant-btc-log-regression": btc, "quant-macro-dashboard": macro, "quant-btc-derivatives": derivatives, "quant-macro-business-cycle": business])
        func signal(_ id: String) throws -> QuantSignal {
            try #require(signals.first { $0.id == id })
        }
        #expect(try signal("btc-risk").value == "0.000")
        #expect(try signal("btc-risk").detail == "Deep Value")
        #expect(try signal("pi").value == "Inactive")
        #expect(try signal("bmsb").value == nil)
        #expect(try signal("fed-funds").value == "4.25%")
        #expect(try signal("funding").value == "0.010%")
        #expect(try signal("recession").value == "12%")
        #expect(try signal("sahm").value == "0.00")
        #expect(try signal("sahm").detail == "Calm")
        #expect(try signal("m2").value?.contains("22.00") == true)
        #expect(NativeQuantOverview.signals([:]).allSatisfy { $0.value == nil })
        #expect(NativeQuantOverview.number(.number(.infinity)) == nil)
        #expect(NativeQuantOverview.signals(["quant-cycle-presidential": .object(["currentYearOfCycle": .number(.infinity)])]).first { $0.id == "cycle" }?.value == nil)
    }

    @Test func predictionIdentitySortingAndUnitsPreserveMissingValues() throws {
        let data = try json(#"{"finance":[{"id":"same","source":"kalshi","probability":65,"change24h":2,"volumeUsd":100},{"id":"missing","source":"kalshi","probability":null,"change24h":null,"volumeUsd":null}],"politics":[{"id":"same","source":"polymarket","probability":40,"change24h":-4,"volumeUsd":200},{"id":"same","source":"kalshi","probability":65}]}"#)
        let rows = NativePredictions.markets(data)
        #expect(rows.count == 3)
        #expect(NativePredictions.sorted(rows, mode: "Probability").first?["source"].string == "kalshi")
        #expect(NativePredictions.sorted(rows, mode: "24h movement").last?["id"].string == "missing")
        #expect(NativePredictions.movers(data).map { $0["source"].string } == ["polymarket", "kalshi"])
        #expect(NativePredictions.change(rows[0]) == "+2 pp")
        #expect(NativePredictions.probability(rows[0]) == 65)
        #expect(NativePredictions.probability(.object(["probability": .number(101)])) == nil)
        #expect(NativePredictions.volume(rows) == 300)
        #expect(NativePredictions.volume([rows[1]]) == nil)
        #expect(NativePredictions.volume([.object(["volumeUsd": .number(0)])]) == 0)
        #expect(NativePredictions.usd(nil) == "Unavailable")
        #expect(NativePredictions.usd(0).contains("0"))
    }

    @Test func tickerAggregationDeduplicatesWithinEntriesAndRanksRecency() throws {
        let entries = try json(#"[{"id":"a","reportDate":"2026-10-01","tickers":["DEMO","demo"]},{"id":"b","reportDate":"2024-01-01","tickers":["OLD"]},{"id":"c","uploadedAt":"2026-09-01T12:00:00Z","tickers":["DEMO","NEW"]}]"#).array
        let tickers = NativeTicker.aggregate(entries, now: try #require(NativeQuant.date("2026-10-06")))
        #expect(tickers.first { $0.symbol == "DEMO" }?.mentions.count == 2)
        #expect(tickers.first { $0.symbol == "OLD" }?.score == 0)
        #expect(NativeTicker.sorted(tickers, mode: "Top picks").first?.symbol == "DEMO")
        #expect(NativeTicker.sorted(tickers, mode: "Recent").first?.symbol == "DEMO")
        #expect(NativeTicker.sorted(tickers, mode: "Alphabetical").map(\.symbol) == ["DEMO", "NEW", "OLD"])
    }

    @Test func largeChartExportPreservesEveryObservationAndCancelsCleanly() async throws {
        let points = (0 ..< 10001).map { QuantPoint(id: $0, date: Date(timeIntervalSince1970: 1_704_067_200 + Double($0) * 86400), value: Double($0), segment: 0) }
        let panel = QuantPanel(id: "x", title: "Synthetic long history", unit: "USD", lines: [.init(id: "price", title: "Price", points: points)])
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("SyntheticExport-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = try await Task.detached { try NativeQuant.export(panel, folder: folder) }.value
        let contents = try String(contentsOf: url, encoding: .utf8)
        #expect(contents.split(separator: "\n").count == 10002)
        #expect(contents.contains("2024-01-01,\"Price\",0.0,\"USD\""))
        #expect(contents.hasSuffix(",10000.0,\"USD\""))
        #expect(panel.lines.first?.points.count == 10001)
        let cancelledFolder = folder.appendingPathComponent("cancelled")
        let worker = Task.detached {
            withUnsafeCurrentTask { $0?.cancel() }
            return try NativeQuant.export(panel, folder: cancelledFolder)
        }
        await #expect(throws: CancellationError.self) { try await worker.value }
        #expect(!FileManager.default.fileExists(atPath: cancelledFolder.path))
    }

    @Test func alignedIndicatorsKeepDatesAndMissingValuesBreakLines() throws {
        let rows = try json(#"[{"t":1704067200000,"price":100},{"t":1706745600000,"price":110},{"t":1709251200000,"price":120},{"t":1711929600000,"price":130}]"#).array
        let line = NativeQuant.line("sma", "SMA", rows: rows, key: "", aligned: [.null, .number(20), .null, .number(40)], multiplier: 2)
        #expect(line.points.map(\.value) == [40, 80])
        #expect(line.points.map { NativeQuant.day($0.date) } == ["2024-02-01", "2024-04-01"])
        #expect(line.points[0].segment != line.points[1].segment)
        #expect(line.points.map(\.id) == [1, 3])
    }

    @Test func duplicateDatesDoNotShiftAlignedValuesAndNonfiniteValuesAreDropped() throws {
        let rows = try json(#"[{"t":1704067200000},{"t":1704067200000},{"t":1706745600000},{"t":1709251200000}]"#).array
        let line = NativeQuant.line("x", "X", rows: rows, key: "", aligned: [.number(10), .number(20), .number(30), .number(.infinity)])
        #expect(line.points.map(\.value) == [10, 30])
        #expect(NativeQuant.date(.object(["t": .number(.infinity)])) == nil)
    }

    @Test func macroUnitsUseSeparatePanelsAndRoiUsesFractionPercent() throws {
        let macro = try json(#"{"series":[{"id":"rates","label":"Rates","unit":"%","points":[{"date":"2026-01-01","value":4}]},{"id":"level","label":"Level","unit":"index","points":[{"date":"2026-01-01","value":123}]}]}"#)
        let panels = NativeQuant.panels(macro, resource: "quant-macro-dashboard")
        #expect(panels.count == 2)
        #expect(panels.map(\.unit) == ["%", "index"])
        #expect(panels[0].display(4).contains("4 %"))
        var empty = macro["series"].array[0]
        empty.set("points", .array([]))
        var partial = macro
        partial.set("series", .array([empty, macro["series"].array[1]]))
        #expect(NativeQuant.panels(partial, resource: "quant-macro-dashboard").map(\.id) == ["level"])

        let roi = try json(#"{"btc":{"windows":[{"label":"1y","series":[{"date":"2026-01-01","roi":0.25}]}]}}"#)
        let chart = try #require(NativeQuant.panels(roi, resource: "quant-running-roi").first)
        #expect(chart.display(0.25).contains("25"))
        #expect(chart.percentFraction)
        #expect(NativeQuant.csv(chart).contains("0.25,\"fraction\""))
    }

    @Test func btcViewsDeriveBandsFromOriginalAlignedArrays() throws {
        let data = try json(#"{"prices":[{"date":"2026-01-01","price":100},{"date":"2026-02-01","price":200}],"movingAverages":{"sma200d":[null,150],"sma200w":[null,100],"mayerBandMultipliers":[0.8,2.4]},"corridor":{"sma20w":[null,160],"multipliers":[1,2]},"bmsb":{"sma20w":[null,160],"ema21w":[null,170]},"piCycle":{"sma111d":[null,180],"sma350dDouble":[null,360],"signal":[false,true]},"risk":{"metric":[null,0.8],"normalized":{"rsi14":[null,0.75]}}}"#)
        let panels = NativeQuant.panels(data, resource: "quant-btc-log-regression")
        #expect(Set(panels.map(\.id)).isSuperset(of: ["regression", "moving", "corridor", "bmsb", "pi", "crosses", "risk"]))
        let moving = try #require(panels.first { $0.id == "moving" })
        #expect(moving.lines.last?.points.first?.value == 360)
        #expect(moving.lines.last?.points.first.map { NativeQuant.day($0.date) } == "2026-02-01")
        let risk = try #require(panels.first { $0.id == "risk" })
        #expect(risk.bounds == 0 ... 1)
        #expect(risk.lines.count == 2)
        #expect(panels.first { $0.id == "pi" }?.events.first?.title == "Pi signal")
    }

    @Test func nullableReturnsStayUnavailableAndOptionsUseUnderlying() throws {
        let option = try json(#"{"isOption":true,"gainPct":9.99,"underlyingPct":0.05}"#)
        #expect(NativePolitics.displayedReturn(option) == 0.05)
        #expect(NativePolitics.percent(NativePolitics.displayedReturn(option)).contains("5"))
        #expect(NativePolitics.displayedReturn(.object(["isOption": .bool(true), "gainPct": .number(1)])) == nil)
        #expect(NativePolitics.percent(nil) == "Unavailable")
        #expect(NativePolitics.displayedReturn(.object(["isOption": .bool(false), "gainPct": .number(0)])) == 0)
    }

    @Test func politicalMonthlyChartFillsGapsAndUsesDisclosedUpperBounds() throws {
        let trades = try json(#"[{"tradeDate":"2026-01-01","category":"buy","amountMin":1001,"amountMax":5000},{"tradeDate":"2026-03-01","category":"sell","amountMax":15000},{"tradeDate":"2026-03-02","category":"buy","amountMax":null}]"#).array
        let result = NativePolitics.monthly(trades)
        #expect(result.map(\.month) == ["2026-01", "2026-02", "2026-03"])
        #expect(result[0].buys == 5000)
        #expect(result[1].buys == 0 && result[1].sells == 0)
        #expect(result[2].sells == 15000 && result[2].count == 2)
    }

    @Test func consensusSortUsesRequestedKeyAndStableTieBreaks() throws {
        let rows = try json(#"[{"ticker":"A","politicianCount":3,"tradeCount":4,"amountMax":100,"lastDate":"2026-01-01"},{"ticker":"B","politicianCount":2,"tradeCount":5,"amountMax":200,"lastDate":"2026-02-01"}]"#).array
        #expect(NativePolitics.clusters(rows, sort: "Members").first?["ticker"] == .string("A"))
        for sort in ["Recent", "Amount", "Trades"] {
            #expect(NativePolitics.clusters(rows, sort: sort).first?["ticker"] == .string("B"))
        }
    }

    @Test func chartCsvQuotesSeriesNamesAndUsesObservationDates() throws {
        let rows = try json(#"[{"date":"2024-02-29","value":12.5}]"#).array
        let panel = QuantPanel(id: "x", title: "X", unit: "%", lines: [NativeQuant.line("x", "A, \"B\"", rows: rows, key: "value")])
        #expect(NativeQuant.csv(panel) == "date,series,value,unit\n2024-02-29,\"A, \"\"B\"\"\",12.5,\"%\"")
    }
}
