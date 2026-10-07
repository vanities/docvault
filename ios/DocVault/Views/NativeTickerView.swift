import Charts
import SwiftUI

struct NativeTickerView: View {
    @Environment(VaultModel.self) private var model
    @State private var entries: [VaultValue] = []
    @State private var quotes: [VaultValue] = []
    @State private var loading = false
    @State private var error: String?
    @State private var mode = "Top picks"
    @State private var search = ""
    var rows: [NativeTicker] {
        NativeTicker.sorted(NativeTicker.aggregate(entries), mode: mode).filter { search.isEmpty || $0.symbol.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        List {
            VaultHero(title: "Research tickers", subtitle: "Follow the symbols mentioned in your library, their quoted prices and the research behind them.", symbol: "chart.line.uptrend.xyaxis", color: .indigo, eyebrow: "QUANT / RESEARCH").vaultStandaloneRow()
            Section {
                Text("Tickers tagged in your research library. Top picks combines mention frequency with a recency weight that reaches zero after one year.").font(.footnote).foregroundStyle(.secondary)
                Picker("Order", selection: $mode) { ForEach(["Top picks", "Recent", "Most mentioned", "Alphabetical"], id: \.self) { Text($0) } }
                    .accessibilityIdentifier("tickerSort")
            }
            if loading {
                ProgressView("Loading research and quotes…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !loading, rows.isEmpty {
                Text("No tagged tickers found.").foregroundStyle(.secondary)
            }
            ForEach(rows) { ticker in
                Section(ticker.symbol) {
                    let quote = quotes.first { $0["symbol"].string == ticker.symbol } ?? .null
                    if !quote["error"].isEmpty {
                        Text(quote["error"].string).font(.caption).foregroundStyle(.secondary)
                    }
                    VaultMetricGrid(metrics: [
                        .init(title: "Price", value: quote["price"].number.map { $0.formatted(.number.precision(.fractionLength(2))) + " " + quote["currency"].string } ?? "Unavailable", symbol: "dollarsign.circle"),
                        .init(title: "1 year", value: quote["oneYearChangePct"].number.map { $0.formatted(.number.precision(.fractionLength(2))) + "%" } ?? "Unavailable", symbol: "chart.line.uptrend.xyaxis"),
                        .init(title: "52-week range", value: quote["fiftyTwoWeekLow"].number != nil && quote["fiftyTwoWeekHigh"].number != nil ? "\(quote["fiftyTwoWeekLow"].string) – \(quote["fiftyTwoWeekHigh"].string)" : "Unavailable", symbol: "arrow.up.arrow.down"),
                        .init(title: "Mentions / newest", value: "\(ticker.mentions.count) · \(ticker.latestDate)", symbol: "text.book.closed"),
                    ]).vaultStandaloneRow()
                    if !quote["sparklineCloses"].array.isEmpty {
                        Chart(Array(quote["sparklineCloses"].array.enumerated()), id: \.offset) { index, value in
                            if let number = value.number {
                                LineMark(x: .value("Weekly sample", index), y: .value("Close", number))
                                    .foregroundStyle(Color.indigo.gradient).lineStyle(.init(lineWidth: 2.5))
                            }
                        }.frame(height: 100).chartXAxis(.hidden)
                        Text("Weekly close samples. Individual observation dates are not supplied.").font(.caption2)
                    }
                    DisclosureGroup("Research mentions") {
                        ForEach(ticker.mentions, id: \.self) { entry in
                            let domain = ResearchDomain(rawValue: entry["domain"].string) ?? .finance
                            if let resource = NativeCatalog.resource(domain == .finance ? "research-quant" : "research-" + domain.rawValue), let collection = resource.collections.first {
                                NavigationLink(entry.title) { NativeRecordView(record: entry, collection: collection, resource: resource, scope: .init(), changed: { Task { await load() } }) }
                                    .accessibilityIdentifier("tickerMention-\(entry["id"].string)")
                            }
                        }
                    }
                }
            }
        }.vaultDashboard().tint(.indigo).searchable(text: $search, prompt: "Find a ticker").task { await load() }.refreshable { await load() }
    }

    private func load() async {
        loading = true; error = nil
        do {
            let response = try await model.nativeRequest("api/research", scope: .init())
            guard !Task.isCancelled else { return }
            entries = response["entries"].array
            let symbols = NativeTicker.aggregate(entries).map(\.symbol).sorted()
            var results: [VaultValue] = []
            for start in stride(from: 0, to: symbols.count, by: 100) {
                let batch = Array(symbols[start ..< min(start + 100, symbols.count)]).joined(separator: ",")
                let response = try await model.nativeRequest("api/quant/tickers/prices?symbols={symbols}", scope: .init(), record: .object(["symbols": .string(batch)]))
                guard !Task.isCancelled else { return }
                results += response["quotes"].array
            }
            quotes = results
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
        loading = false
    }
}
