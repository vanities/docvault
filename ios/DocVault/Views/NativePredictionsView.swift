import SwiftUI

struct NativePredictionsView: View {
    @Environment(VaultModel.self) private var model
    var resource: NativeResource?
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loading = false
    @State private var search = ""
    @State private var domain = "All"
    @State private var provider = "All"
    @State private var sort = "Volume"
    @State private var limit = 20
    private var rows: [VaultValue] {
        NativePredictions.sorted(NativePredictions.markets(data).filter {
            (domain == "All" || $0["domain"].string == domain.lowercased()) && (provider == "All" || $0["source"].string == provider.lowercased()) && (search.isEmpty || ($0["question"].string + " " + $0["topic"].string).localizedCaseInsensitiveContains(search))
        }, mode: sort)
    }

    var body: some View {
        List {
            VaultHero(title: "Prediction markets", subtitle: "Probabilities and 24-hour movement from Kalshi and Polymarket. Odds reflect traders' positions and can change.", symbol: "chart.bar.xaxis", color: .indigo, eyebrow: "MARKET EXPECTATIONS").vaultStandaloneRow()
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Button("Refresh markets", systemImage: "arrow.clockwise") { Task { await load() } }
                            .disabled(loading).accessibilityIdentifier("refreshPredictions")
                        Spacer()
                        if loading {
                            ProgressView().accessibilityLabel("Loading markets")
                        }
                    }
                    if let error {
                        ErrorNotice(message: error)
                    }
                    if data["stale"].boolean {
                        Label("Cached data is stale", systemImage: "clock.badge.exclamationmark").font(.caption)
                    }
                    if !data["fetchError"].isEmpty {
                        Text(data["fetchError"].string).font(.caption).foregroundStyle(.orange)
                    }
                    if !data.isEmpty {
                        HStack(alignment: .top, spacing: 18) {
                            ForEach(["kalshi", "polymarket"], id: \.self) { source in
                                Label(source.capitalized + (data["sources"][source].boolean ? ": available" : ": unavailable"), systemImage: data["sources"][source].boolean ? "checkmark.circle" : "exclamationmark.triangle")
                                    .font(.caption).foregroundStyle(data["sources"][source].boolean ? Color.secondary : Color.orange)
                            }
                        }
                        ForEach(data["errors"].array, id: \.self) { Text($0.string).font(.caption).foregroundStyle(.orange) }
                    }
                    if !data["fetchedAt"].isEmpty {
                        let instant = try? Date.ISO8601FormatStyle().parse(data["fetchedAt"].string)
                        Text("Updated " + (instant?.formatted(date: .abbreviated, time: .shortened) ?? data["fetchedAt"].string)).font(.caption2).foregroundStyle(.secondary)
                    }
                    if data["cached"].boolean {
                        Text("Cached response").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 8)
            }
            let movers = NativePredictions.movers(data)
            if !movers.isEmpty {
                Section("Biggest 24-hour moves") {
                    ForEach(movers, id: \.self) { market in
                        NavigationLink { NativePredictionDetail(market: market) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(market["question"].string)
                                Label(NativePredictions.change(market), systemImage: (market["change24h"].number ?? 0) >= 0 ? "arrow.up.right" : "arrow.down.right")
                                    .font(.subheadline.bold())
                                Text(market["source"].string.capitalized).font(.caption).foregroundStyle(.secondary)
                            }
                        }.accessibilityIdentifier("predictionMover-" + NativePredictions.key(market))
                    }
                }
            }
            Section("Explore markets") {
                Picker("Category", selection: $domain) { ForEach(["All", "Finance", "Politics"], id: \.self) { Text($0).tag($0) } }.accessibilityIdentifier("predictionDomain")
                Picker("Source", selection: $provider) { ForEach(["All", "Kalshi", "Polymarket"], id: \.self) { Text($0).tag($0) } }.accessibilityIdentifier("predictionProvider")
                Picker("Sort", selection: $sort) { ForEach(["Volume", "Probability", "24h movement"], id: \.self) { Text($0).tag($0) } }.accessibilityIdentifier("predictionSort")
                LabeledContent("Matching markets", value: "\(rows.count)").accessibilityIdentifier("predictionCount")
                LabeledContent("Reported approximate USD volume", value: NativePredictions.usd(NativePredictions.volume(rows)))
                if NativePredictions.reportedVolumes(rows).count < rows.count {
                    Text("Volume available for \(NativePredictions.reportedVolumes(rows).count) of \(rows.count) markets.").font(.caption).foregroundStyle(.secondary)
                }
                Text("Provider volumes use different measures; Kalshi volume is a contracts × price estimate.").font(.caption).foregroundStyle(.secondary)
            }
            Section(domain == "All" ? "All markets" : domain) {
                ForEach(Array(rows.prefix(limit)), id: \.self) { market in
                    NavigationLink { NativePredictionDetail(market: market) } label: { NativePredictionRow(market: market) }
                        .vaultStandaloneRow()
                        .accessibilityIdentifier("predictionMarket-" + NativePredictions.key(market))
                }
                if rows.count > limit {
                    Button("Show \(min(20, rows.count - limit)) more markets") { limit += 20 }
                }
                if rows.isEmpty, !loading, !data.isEmpty {
                    Text("No markets match these filters.").foregroundStyle(.secondary)
                }
            }
            if let resource, !resource.actions.isEmpty {
                NavigationLink("Source data and refresh actions") { NativeResourceView(resource: resource, scope: .init()) }
            }
        }
        .vaultDashboard().tint(.indigo).searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a market")
        .task { await load() }.refreshable { await load() }
        .onChange(of: domain) { limit = 20 }.onChange(of: provider) { limit = 20 }.onChange(of: search) { limit = 20 }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await model.nativeRequest("api/quant/predictions?_={nonce}", scope: .init(), record: .object(["nonce": .string(UUID().uuidString)]))
            guard !Task.isCancelled else { return }
            if !result["error"].isEmpty {
                throw VaultError.server(result["error"].string)
            }
            data = result
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativePredictionRow: View {
    let market: VaultValue
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(market["source"].string.capitalized + " · " + market["topic"].string).font(.caption).foregroundStyle(.secondary)
            Text(market["question"].string).font(.headline)
            if let probability = NativePredictions.probability(market) {
                Text(probability.formatted(.number.precision(.fractionLength(0 ... 1))) + "%").font(.system(.title, design: .rounded, weight: .bold)).monospacedDigit().foregroundStyle(.indigo)
                ProgressView(value: probability, total: 100).accessibilityLabel("Probability").accessibilityValue("\(probability)%")
            } else {
                Text("Probability unavailable").foregroundStyle(.secondary)
            }
            Text(NativePredictions.usd(market["volumeUsd"].number) + " volume · " + NativePredictions.change(market) + " over 24 hours")
                .font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard()
    }
}

struct NativePredictionDetail: View {
    let market: VaultValue
    var body: some View {
        List {
            Section { NativePredictionRow(market: market).vaultStandaloneRow() }
            Section("Market details") {
                LabeledContent("Category", value: market["domain"].string.capitalized)
                LabeledContent("Liquidity", value: NativePredictions.usd(market["liquidityUsd"].number))
                LabeledContent("Closes", value: market["closeTime"].isEmpty ? "Unspecified" : market["closeTime"].string)
                LabeledContent("Market ID", value: market["id"].string).textSelection(.enabled)
                if let url = NativePolitics.sourceURL(market["url"]) {
                    Link("Open source market", destination: url).accessibilityIdentifier("predictionSource")
                }
            }
        }.vaultDashboard().tint(.indigo).navigationTitle("Market details").navigationBarTitleDisplayMode(.inline)
    }
}
