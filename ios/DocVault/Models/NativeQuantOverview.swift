import Foundation

struct QuantSignal: Identifiable, Sendable {
    let id: String
    let title: String
    let category: String
    let resource: String
    let value: String?
    var detail = ""
    var tone = 0
}

enum NativeQuantOverview {
    static var sourceIDs: [String] {
        Array(Set(signals([:]).map(\.resource))).sorted()
    }

    static func number(_ value: VaultValue, digits: Int = 2, suffix: String = "", multiplier: Double = 1) -> String? {
        guard let n = value.number, (n * multiplier).isFinite else { return nil }
        return (n * multiplier).formatted(.number.precision(.fractionLength(digits))) + suffix
    }

    static func currency(_ value: VaultValue, divisor: Double = 1, suffix: String = "") -> String? {
        guard let n = value.number, n.isFinite else { return nil }
        return (n / divisor).formatted(.currency(code: "USD").precision(.fractionLength(divisor == 1 ? 0 : 2))) + suffix
    }

    static func riskLabel(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "" }
        return value < 0.15 ? "Deep Value" : value < 0.3 ? "Accumulation" : value < 0.45 ? "Below Fair" : value < 0.55 ? "Fair Value" : value < 0.7 ? "Above Fair" : value < 0.85 ? "Overheated" : "Euphoria"
    }

    static func signals(_ sources: [String: VaultValue]) -> [QuantSignal] {
        var result: [QuantSignal] = []
        func source(_ id: String) -> VaultValue {
            sources[id] ?? .null
        }
        func series(_ resource: String, _ id: String) -> VaultValue {
            source(resource)["series"].array.first { $0["id"].string == id } ?? .null
        }
        func add(_ id: String, _ title: String, _ category: String, _ resource: String, _ value: String?, _ detail: String = "", _ tone: Int = 0) {
            result.append(.init(id: id, title: title, category: category, resource: resource, value: value, detail: value == nil ? "" : detail, tone: value == nil ? 0 : tone))
        }
        func text(_ value: VaultValue) -> String? {
            value.string.isEmpty ? nil : value.string
        }
        func detail(_ label: String, _ value: String?) -> String {
            value.map { label + $0 } ?? ""
        }
        let btcID = "quant-btc-log-regression", btc = source(btcID)
        add("btc-price", "BTC Price", "Crypto", btcID, currency(btc["latest"]["price"]), detail("Trend residual: ", number(btc["latest"]["residualSigma"], suffix: "σ")))
        let risk = btc["risk"]["latest"]["metric"]
        add("btc-risk", "BTC Risk Metric", "Crypto", btcID, number(risk, digits: 3), riskLabel(risk.number), risk.number.map { $0 < 0.3 ? 1 : $0 < 0.7 ? 2 : 3 } ?? 0)
        add("bmsb", "BMSB State", "Crypto", btcID, text(btc["bmsb"]["latest"]["state"])?.capitalized, detail("20-week SMA: ", currency(btc["bmsb"]["latest"]["sma20w"])))
        let pi = btc["piCycle"]["latest"]
        let active: String? = if case let .bool(flag) = pi["signalActive"] {
            flag ? "TOP ACTIVE" : "Inactive"
        } else {
            nil
        }
        add("pi", "Pi Cycle", "Crypto", btcID, active, detail("Ratio: ", number(pi["ratio"])), pi["signalActive"].boolean ? 3 : 1)
        let domID = "quant-btc-dominance", dom = source(domID)
        add("dominance", "BTC Dominance", "Crypto", domID, number(dom["btcDominance"], digits: 1, suffix: "%"), detail("Stablecoin supply ratio: ", number(dom["ssr"], digits: 1, suffix: "×")))
        let derivativesID = "quant-btc-derivatives", derivatives = source(derivativesID)
        add("funding", "Funding Rate", "Crypto", derivativesID, number(derivatives["currentFundingRate"], digits: 3, suffix: "%", multiplier: 100), detail("Annualized: ", number(derivatives["annualizedFundingRate"], digits: 1, suffix: "%", multiplier: 100)))
        let altsID = "quant-btc-altcoin-season", alts = source(altsID)
        add("alts", "Altcoin Season", "Crypto", altsID, number(alts["indexValue"], digits: 0), alts["regime"].string.replacingOccurrences(of: "-", with: " ").capitalized)
        add("long-short", "Long / Short Ratio", "Crypto", derivativesID, number(derivatives["currentLongShortRatio"]), "1.0 = balanced")
        let ddID = "quant-btc-drawdown", dd = source(ddID)["latest"]
        add("drawdown", "BTC Drawdown", "Crypto", ddID, number(dd["drawdown"], digits: 1, suffix: "%", multiplier: 100), detail("All-time high: ", currency(dd["ath"])) + detail(" · Days since: ", number(dd["daysSinceAth"], digits: 0)))
        let fgID = "quant-btc-fear-greed", fg = source(fgID)["latest"]
        add("sentiment", "Fear & Greed", "Crypto", fgID, number(fg["value"], digits: 0), fg["classification"].string)
        let flipID = "quant-btc-flippening", flip = source(flipID)["latest"]
        add("flip", "Flippening", "Crypto", flipID, number(flip["progressToFlippening"], digits: 1, suffix: "%", multiplier: 100), detail("ETH / BTC: ", number(flip["ratio"], digits: 5)))
        let hashID = "quant-btc-hash-rate", hash = source(hashID)["latest"]
        let hashLabel = hash["regime"].string == "bullish" ? "Expanding" : hash["regime"].string == "bearish" ? "Capitulating" : nil
        add("hash", "Hash Ribbons", "Crypto", hashID, hashLabel, detail("Hash rate: ", number(hash["hashRate"], digits: 0, suffix: " EH/s", multiplier: 0.000001)))
        let yieldID = "quant-macro-yield-curve", yield = source(yieldID)
        add("yield", "Yield Curve (10Y − 2Y)", "Macro", yieldID, number(yield["latest"]["t10y2y"], suffix: " pp"), yield["latest"]["regime"].string.capitalized)
        let macroID = "quant-macro-dashboard", ff = series(macroID, "DFF"), cpi = series(macroID, "CPILFESL"), m2 = series(macroID, "M2SL")
        add("fed-funds", "Fed Funds Rate", "Macro", macroID, number(ff["latest"]["value"], suffix: "%"), detail("YoY change: ", number(ff["yoyChange"], digits: 1, suffix: "%")))
        add("core-cpi", "Core CPI YoY", "Macro", macroID, number(cpi["yoyChange"], suffix: "%"), "Inflation excluding food and energy")
        add("m2", "M2 Money Supply", "Macro", macroID, currency(m2["latest"]["value"], divisor: 1000, suffix: "T"), detail("YoY change: ", number(m2["yoyChange"], suffix: "%")))
        let businessID = "quant-macro-business-cycle", sahm = series(businessID, "SAHMREALTIME")["latest"]["value"], recession = series(businessID, "RECPROUSM156N")["latest"]["value"]
        let sahmLabel = sahm.number.map { $0 >= 0.5 ? "Recession signal" : $0 >= 0.3 ? "Warning" : $0 >= 0.1 ? "Elevated" : "Calm" } ?? ""
        add("sahm", "Sahm Rule", "Macro", businessID, number(sahm), sahmLabel, sahm.number.map { $0 >= 0.5 ? 3 : $0 >= 0.1 ? 2 : 1 } ?? 0)
        add("recession", "Recession Probability", "Macro", businessID, number(recession, digits: 0, suffix: "%", multiplier: 100), "Chauvet–Piger 12-month model")
        let realID = "quant-macro-real-rates", real = source(realID)["latest"]["tenYear"]["real"]
        add("real-rate", "10-Year Real Rate", "Macro", realID, number(real, suffix: "%"), real.number.map { $0 >= 2 ? "Restrictive" : $0 >= 1 ? "Tight" : $0 >= 0 ? "Neutral" : "Accommodative" } ?? "")
        let financialID = "quant-macro-financial-conditions", nfci = series(financialID, "NFCI")["latest"]["value"]
        add("nfci", "NFCI", "Macro", financialID, number(nfci), nfci.number.map { $0 >= 0.5 ? "Stressed" : $0 >= 0 ? "Tight" : "Loose" } ?? "")
        let inflationID = "quant-macro-inflation", headline = series(inflationID, "CPIAUCSL"), walcl = series(inflationID, "WALCL")
        add("headline-cpi", "Headline CPI YoY", "Macro", inflationID, number(headline["yoyChange"], suffix: "%"), "All urban consumers")
        add("balance-sheet", "Fed Balance Sheet", "Macro", inflationID, currency(walcl["latest"]["value"], divisor: 1_000_000, suffix: "T"), detail("YoY change: ", number(walcl["yoyChange"], suffix: "%")))
        let spID = "quant-tradfi-sp500-risk-metric", sp = source(spID)["latest"]
        add("sp-risk", "S&P 500 Risk Metric", "TradFi", spID, number(sp["metric"], digits: 3), detail("Observation: ", text(sp["date"])), sp["metric"].number.map { $0 < 0.3 ? 1 : $0 < 0.7 ? 2 : 3 } ?? 0)
        let shillerID = "quant-tradfi-shiller-valuation", shiller = source(shillerID)
        add("cape", "Shiller CAPE", "TradFi", shillerID, number(shiller["latest"]["cape"], digits: 1), detail("Historical percentile: ", number(shiller["capePercentile"], digits: 0)))
        let cycleID = "quant-cycle-presidential", cycle = source(cycleID)["currentYearOfCycle"]
        let labels = [1: "Post-election", 2: "Midterm", 3: "Pre-election", 4: "Election year"]
        add("cycle", "Presidential Cycle", "TradFi", cycleID, number(cycle, digits: 0).map { "Year " + $0 }, cycle.number.flatMap { $0.isFinite && (1 ... 4).contains($0) ? labels[Int($0)] : nil } ?? "")
        let sectorsID = "quant-tradfi-sectors-rotation", sectors = source(sectorsID)
        let topSector = sectors["sectors"].array.filter { $0["rsRatio"].number?.isFinite == true }.sorted { ($0["rsRatio"].number ?? 0) > ($1["rsRatio"].number ?? 0) }.first ?? .null
        add("sector", "Top Sector", "TradFi", sectorsID, text(topSector["ticker"]), topSector["name"].string + detail(" · Relative strength: ", number(topSector["rsRatio"], digits: 1)))
        let midtermID = "quant-tradfi-midterm-drawdowns", midterm = source(midtermID)["curves"].array.first { $0["isCurrent"].boolean } ?? .null
        add("midterm", "Midterm Drawdown", "TradFi", midtermID, number(midterm["points"].array.last?["drawdown"] ?? .null, suffix: "%", multiplier: 100), midterm["label"].string)
        let benchmark = sectors["benchmark"]
        add("sp-ytd", "S&P 500 YTD (SPY)", "TradFi", sectorsID, number(benchmark["returns"]["ytd"], suffix: "%"), detail("SPY price: ", currency(benchmark["price"])))
        return result
    }
}
