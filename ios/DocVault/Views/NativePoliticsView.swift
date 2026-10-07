import Charts
import SwiftUI

struct NativePoliticsView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    @State private var data: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""
    @State private var direction = "all"
    @State private var window = 30
    @State private var sort = "Members"
    @State private var limit = 10
    @State private var generation = UUID()
    var isConsensus: Bool {
        resource.id == "politics-clusters"
    }

    var isPerformance: Bool {
        resource.id == "politics-backtest"
    }

    var rows: [VaultValue] {
        let source = isConsensus ? NativePolitics.clusters(data["clusters"].array, sort: sort) : data[isPerformance ? "leaderboard" : "spenders"].array
        return source.filter { search.isEmpty || $0.stringSearch.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        List {
            VaultHero(title: resource.title, subtitle: isConsensus ? "Overlapping disclosed trades by multiple members. Amounts are disclosed ranges." : isPerformance ? "Simulated mirrored stock buys using disclosed size. Options show the underlying move; contracts are not priced. Disclosures may lag trades by roughly 45 days. These are not members’ actual portfolio returns." : "Explore disclosed transactions by member. Monthly bars use the upper end of each reported dollar range, not exact spending.", symbol: "building.columns", color: .indigo, eyebrow: "POLITICS / DISCLOSURES").vaultStandaloneRow()
            if !isConsensus, !isPerformance {
                NavigationLink("All disclosed trades") { NativePoliticalArchive(kind: "trades") }
            }
            if isConsensus {
                Section("Consensus controls") {
                    Picker("Direction", selection: $direction) {
                        Text("All").tag("all"); Text("Buys").tag("buy"); Text("Sells").tag("sell")
                    }.accessibilityIdentifier("politicsDirection")
                    Picker("Window", selection: $window) { ForEach([30, 60, 90], id: \.self) { Text("\($0) days").tag($0) } }
                        .accessibilityIdentifier("politicsWindow")
                    Picker("Sort", selection: $sort) { ForEach(["Members", "Recent", "Amount", "Trades"], id: \.self) { Text($0) } }
                        .accessibilityIdentifier("politicsSort")
                }
            }
            if loading {
                ProgressView("Loading disclosures…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !loading, error == nil, rows.isEmpty {
                Text(data["note"].string.isEmpty ? "No matching disclosures." : data["note"].string).foregroundStyle(.secondary)
            }
            Section(isConsensus ? "Trade clusters" : isPerformance ? "Simulated performance" : "Members") {
                ForEach(Array(rows.prefix(limit).enumerated()), id: \.offset) { _, row in
                    NavigationLink {
                        if isConsensus {
                            NativeConsensusDetail(cluster: row)
                        } else {
                            NativePoliticianDetail(member: row, performance: isPerformance)
                        }
                    } label: {
                        HStack(alignment: .top, spacing: 14) {
                            if !isConsensus {
                                NativePoliticalPortrait(name: row["politician"].string, imagePath: row["imageUrl"].string)
                            }
                            VStack(alignment: .leading, spacing: 5) {
                                Text(row[isConsensus ? "ticker" : "politician"].string).font(.headline)
                                if isConsensus {
                                    Text("\(row["politicianCount"].string) members · \(row["tradeCount"].string) \(row["direction"].string) trades").font(.subheadline)
                                    Text("\(row["firstDate"].string) – \(row["lastDate"].string)").font(.caption).foregroundStyle(.secondary)
                                } else if isPerformance {
                                    Text("Simulated return: \(NativePolitics.percent(row["returnPct"].number))").font(.subheadline)
                                    Text("\(row["buyCount"].string) stock buys · \(row["optionBuyCount"].string) option buys").font(.caption).foregroundStyle(.secondary)
                                } else {
                                    Text("\(row["trades"].string) trades · \(row["buys"].string) buys · \(row["sells"].string) sells").font(.subheadline)
                                    Text("\(NativePolitics.currency(row["estMin"].number)) – \(NativePolitics.currency(row["estMax"].number)) disclosed").font(.caption).foregroundStyle(.secondary)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.vaultCard()
                    }.vaultStandaloneRow().accessibilityIdentifier("politicsRow-\(row[isConsensus ? "ticker" : "politician"].string)")
                }
                if rows.count > limit {
                    Button("Show more") { limit += 20 }
                }
            }
            if !data["generatedAt"].isEmpty {
                LabeledContent("Updated", value: data["generatedAt"].string)
            }
            NavigationLink("Data and refresh actions") { NativeResourceView(resource: resource, scope: .init()) }
        }
        .vaultDashboard().tint(.indigo).searchable(text: $search, prompt: isConsensus ? "Find ticker or member" : "Find a member")
        .refreshable { await load() }
        .task(id: "\(direction)-\(window)") { await load() }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        do {
            let path = isConsensus ? "api/politics/clusters?limit=500&windowDays=\(window)&direction=\(direction)" : isPerformance ? "api/politics/backtest?limit=100" : "api/politics/top-spenders?limit=200"
            let value = try await model.nativeRequest(path, scope: .init())
            guard generation == id, !Task.isCancelled else { return }
            data = value
        } catch {
            guard generation == id, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
        if generation == id {
            loading = false
        }
    }
}

struct NativePoliticianDetail: View {
    @Environment(VaultModel.self) private var model
    let member: VaultValue
    let performance: Bool
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loaded = false
    var name: String {
        member["politician"].string
    }

    var trades: [VaultValue] {
        data["trades"].array
    }

    var body: some View {
        List {
            HStack(spacing: 18) {
                NativePoliticalPortrait(name: name, imagePath: member["imageUrl"].string, size: 80)
                VStack(alignment: .leading, spacing: 6) {
                    Text(name).font(.system(.title2, design: .rounded, weight: .bold))
                    Text(performance ? "Disclosed stock buys and simulated performance" : "Disclosed transactions and reported dollar ranges").font(.subheadline).foregroundStyle(.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).vaultCard().vaultStandaloneRow()
            if !loaded {
                ProgressView("Loading trades…")
            }
            if let error {
                ErrorNotice(message: error)
            }
            if performance {
                Section("Simulation") {
                    let stats = data["performance"].isEmpty ? member : data["performance"]
                    LabeledContent("Stock return", value: NativePolitics.percent(stats["returnPct"].number))
                    LabeledContent("Stock win rate", value: NativePolitics.percent(stats["winRate"].number))
                    LabeledContent("Cost basis", value: NativePolitics.currency(stats["totalCostBasis"].number))
                    LabeledContent("Current value", value: NativePolitics.currency(stats["totalCurrentValue"].number))
                    LabeledContent("Estimated share fraction", value: NativePolitics.percent(stats["estimatedShareFraction"].number))
                    LabeledContent("Option underlying average", value: NativePolitics.percent(stats["optionUnderlyingAvgPct"].number))
                    Text("Estimated share counts use disclosed dollar ranges. Option underlying movement is a proxy, not a contract return.").font(.footnote).foregroundStyle(.secondary)
                }
            } else if !trades.isEmpty {
                Section("Monthly disclosed upper bounds") {
                    Chart(NativePolitics.monthly(trades)) { month in
                        BarMark(x: .value("Month", month.month), y: .value("Buys USD", month.buys)).foregroundStyle(Color.green.gradient).cornerRadius(4)
                        BarMark(x: .value("Month", month.month), y: .value("Sells USD", -month.sells)).foregroundStyle(Color.red.gradient).cornerRadius(4)
                    }.frame(height: 240).accessibilityIdentifier("politicsMonthlyChart")
                    Text("Buys above zero; sells below zero. Missing months remain zero.").font(.caption)
                }
            }
            Section(performance ? "Simulated buys" : "Disclosed trades") {
                if loaded, trades.isEmpty {
                    Text("No trades available.").foregroundStyle(.secondary)
                }
                ForEach(Array(trades.enumerated()), id: \.offset) { _, trade in
                    NativePoliticalTradeRow(trade: trade, simulation: performance)
                }
            }
        }.vaultDashboard().tint(.indigo).navigationTitle(name).navigationBarTitleDisplayMode(.inline)
            .task { await load() }.refreshable { await load() }
    }

    private func load() async {
        loaded = false; error = nil
        do {
            let path = performance ? "api/politics/backtest?politician={politician}" : "api/politics/trades?politician={politician}&limit=400"
            let result = try await model.nativeRequest(path, scope: .init(), record: member)
            guard !Task.isCancelled else { return }
            data = result
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
        loaded = true
    }
}

struct NativeConsensusDetail: View {
    let cluster: VaultValue
    var body: some View {
        List {
            Section("Consensus") {
                LabeledContent("Direction", value: cluster["direction"].string)
                LabeledContent("Members", value: cluster["politicianCount"].string)
                LabeledContent("Trades", value: cluster["tradeCount"].string)
                LabeledContent("Disclosed range", value: "\(NativePolitics.currency(cluster["amountMin"].number)) – \(NativePolitics.currency(cluster["amountMax"].number))")
                LabeledContent("Dates", value: "\(cluster["firstDate"].string) – \(cluster["lastDate"].string)")
            }
            Section("Member disclosures") {
                ForEach(cluster["politicianImages"].array, id: \.self) { member in
                    NavigationLink {
                        NativePoliticianDetail(member: .object(["politician": member["name"], "imageUrl": member["imageUrl"]]), performance: false)
                    } label: {
                        HStack(spacing: 14) {
                            NativePoliticalPortrait(name: member["name"].string, imagePath: member["imageUrl"].string, size: 44)
                            Text(member["name"].string).font(.headline)
                        }
                    }.accessibilityIdentifier("consensusMember-" + member["name"].string)
                }
                ForEach(Array(cluster["trades"].array.enumerated()), id: \.offset) { _, trade in NativePoliticalTradeRow(trade: trade, simulation: false) }
            }
        }.vaultDashboard().tint(.indigo).navigationTitle(cluster["ticker"].string)
    }
}

struct NativePoliticalTradeRow: View {
    let trade: VaultValue
    let simulation: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(trade["ticker"].string.isEmpty ? trade["assetName"].string : trade["ticker"].string).font(.headline)
            if !trade["politicianName"].isEmpty {
                Text(trade["politicianName"].string)
            }
            Text("\(trade["tradeDate"].string) · \(trade["category"].string.capitalized)").font(.subheadline)
            if simulation {
                Text("\(trade["isOption"].boolean ? "Option underlying move" : "Stock return"): \(NativePolitics.percent(NativePolitics.displayedReturn(trade)))")
                    .accessibilityIdentifier("politicalTradeReturn")
                Text("Entry \(NativePolitics.currency(trade["entryPrice"].number)) → Current \(NativePolitics.currency(trade["currentPrice"].number))").font(.caption)
                if trade["approximate"].boolean {
                    Text("Estimated shares").font(.caption)
                }
                if !trade["note"].isEmpty {
                    Text(trade["note"].string).font(.caption).foregroundStyle(.secondary)
                }
            } else {
                if !trade["assetName"].isEmpty {
                    Text(trade["assetName"].string).font(.caption)
                }
                Text(trade["amount"].isEmpty ? trade["amountRange"].string : trade["amount"].string).font(.caption)
                if !trade["option"].isEmpty {
                    let option = trade["option"]
                    Text("\(option["optionType"].string.capitalized) · Strike \(NativePolitics.currency(option["strike"].number)) · Expiry \(option["expiry"].string) · Contracts \(option["contracts"].string)").font(.caption)
                        .accessibilityIdentifier("politicalOption")
                }
                if let url = NativePolitics.sourceURL(trade["sourceUrl"]) {
                    Link("Source disclosure", destination: url)
                }
            }
            if !trade["ticker"].string.isEmpty,
               let url = URL(string: "https://finance.yahoo.com/quote/" + trade["ticker"].string.replacingOccurrences(of: ".", with: "-").addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)
            {
                Link("Ticker quote", destination: url).font(.caption)
            }
        }.padding(.vertical, 4)
    }
}
