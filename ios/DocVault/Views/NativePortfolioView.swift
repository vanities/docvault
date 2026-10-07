import Charts
import SwiftUI

struct NativePortfolioView: View {
    @Environment(VaultModel.self) private var model
    let scope: VaultScope
    @State private var history: [VaultValue] = []
    @State private var totals: [String: Double] = [:]
    @State private var errors: [String: String] = [:]
    @State private var loading = false
    let categories = [
        ("Banks", "banks", "bankValue"), ("Brokers", "brokers", "brokerValue"),
        ("Crypto", "crypto", "cryptoValue"), ("Precious Metals", "gold", "goldValue"),
        ("Property", "property", "propertyValue"),
    ]
    var total: Double {
        totals.values.reduce(0, +)
    }

    private var plottedHistory: [(Date, Double)] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return history.compactMap { row in
            guard let date = formatter.date(from: row["date"].string),
                  let value = row["totalValue"].number else { return nil }
            return (date, value)
        }
    }

    var body: some View {
        List {
            VaultHero(title: "Your portfolio", subtitle: "A consolidated view of balances, recorded history and allocation across asset categories.", symbol: "chart.pie", color: .blue, eyebrow: "FINANCE / OVERVIEW").vaultStandaloneRow()
            Section("Net worth") {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Current balance", systemImage: "building.columns").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text(model.blurNumbers ? "••••" : totals.isEmpty ? "Unavailable" : total.formatted(.currency(code: "USD")))
                        .font(.system(.largeTitle, design: .rounded, weight: .bold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1).accessibilityIdentifier("netWorth")
                    Text("\(totals.count) of \(categories.count) categories available").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .blue).vaultStandaloneRow()
                if totals.count < categories.count {
                    Text("Partial total: some categories are unavailable.").font(.caption)
                        .foregroundStyle(.secondary)
                }
                if loading {
                    ProgressView("Updating…")
                }
                if !model.blurNumbers {
                    Chart(plottedHistory, id: \.0) { date, value in
                        LineMark(x: .value("Date", date), y: .value("Balance", value))
                            .foregroundStyle(.blue).lineStyle(.init(lineWidth: 3))
                    }.chartXScale(range: .plotDimension(startPadding: 8, endPadding: 28)).chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 4)) {
                            AxisGridLine()
                            AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                        }
                    }.environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).frame(height: 230).accessibilityLabel("Net worth history")
                }
                if let latest = NativeFinance.latestSnapshot(history) {
                    Text("Daily snapshot comparisons as of " + latest["date"].string).font(.caption).foregroundStyle(.secondary)
                }
                if totals.count == categories.count {
                    performance(current: total, key: "totalValue")
                }
                Text(
                    "Historical balance changes include account activity as well as market movement."
                ).font(.caption).foregroundStyle(.secondary)
                Button("Take snapshot") {
                    Task {
                        do {
                            _ = try await model.nativeRequest(
                                "api/portfolio/snapshot", scope: scope, method: "POST"
                            )
                            await load()
                        } catch { errors["Snapshot"] = error.localizedDescription }
                    }
                }
            }
            Section("Allocation") {
                if !model.blurNumbers, totals.values.contains(where: { $0 > 0 }) {
                    Chart(categories.filter { (totals[$0.2] ?? 0) > 0 }, id: \.1) { title, _, key in
                        SectorMark(angle: .value("Balance", totals[key] ?? 0), innerRadius: .ratio(0.7), angularInset: 3)
                            .foregroundStyle(by: .value("Category", title)).cornerRadius(5)
                    }.chartForegroundStyleScale(domain: categories.map(\.0), range: Array(VaultPalette.chart.prefix(categories.count)))
                        .chartLegend(.hidden).chartBackground { _ in
                            VStack(spacing: 4) {
                                Text("Asset mix").font(.system(.headline, design: .rounded))
                                Text("Positive balances").font(.caption).foregroundStyle(.secondary)
                            }
                        }.frame(height: 200).accessibilityLabel("Allocation of positive category balances")
                    if totals.values.contains(where: { $0 < 0 }) {
                        Text("Negative category balances are listed below and included in net worth; the ring shows positive balances.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                ForEach(categories, id: \.1) { title, featureID, key in
                    if let feature = NativeCatalog.features.first(where: { $0.id == featureID }) {
                        NavigationLink {
                            NativeFeatureView(feature: feature)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Circle().fill(VaultPalette.chart[categories.firstIndex(where: { $0.1 == featureID }) ?? 0]).frame(width: 8, height: 8).accessibilityHidden(true)
                                    Text(title).font(.headline)
                                    Spacer()
                                    Text(
                                        model.blurNumbers
                                            ? "••••"
                                            : totals[key].map {
                                                $0.formatted(.currency(code: "USD"))
                                            } ?? "Unavailable"
                                    )
                                }
                                if let value = totals[key] {
                                    performance(current: value, key: key)
                                }
                            }
                        }
                    }
                }
            }
            if !errors.isEmpty {
                Section("Unavailable data") {
                    ForEach(errors.keys.sorted(), id: \.self) {
                        ErrorNotice(message: "\($0): \(errors[$0] ?? "")")
                    }
                }
            }
        }.vaultDashboard(color: .blue).tint(.blue).refreshable { await load() }.task { await load() }
    }

    private func performance(current _: Double, key: String) -> some View {
        HStack {
            ForEach([1, 7, 30], id: \.self) { period in
                let change = NativeFinance.balanceChange(history, key: key, period: period == 30 ? "1M" : "\(period)D")
                VStack(alignment: .leading, spacing: 3) {
                    Text(period == 30 ? "1M" : "\(period)D").font(.caption).foregroundStyle(
                        .secondary
                    )
                    Text(
                        model.blurNumbers
                            ? "••••"
                            : change.map { $0.dollars.formatted(.currency(code: "USD")) } ?? "—"
                    ).font(.caption)
                    Text(
                        model.blurNumbers
                            ? "••••" : change?.percent.map { String(format: "%+.2f%%", $0) } ?? "—"
                    ).font(.caption2)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func load() async {
        loading = true
        errors = [:]
        defer { loading = false }
        do {
            let value = try await model.nativeRequest("api/portfolio/snapshots", scope: scope)
            history = (value.array.isEmpty ? value["snapshots"].array : value.array).sorted {
                $0["date"].string < $1["date"].string
            }
        } catch { errors["History"] = error.localizedDescription }
        for (label, key, path) in [
            ("Banks", "bankValue", "api/simplefin/balances?cached=1"),
            ("Brokers", "brokerValue", "api/brokers/portfolio?cached=1"),
            ("Crypto", "cryptoValue", "api/crypto/balances?cached=1"),
            ("Precious Metals", "goldValue", "api/gold"),
            ("Property", "propertyValue", "api/property"),
        ] {
            do {
                let data = try await model.nativeRequest(path, scope: scope)
                if model.demo {
                    totals[key] = history.last?[key].number ?? 0
                    continue
                }
                switch key {
                case "bankValue":
                    totals[key] = data["accounts"].array.reduce(0) {
                        $0 + ($1["balance"].number ?? 0)
                    }
                case "brokerValue": totals[key] = data["totalValue"].number ?? 0
                case "cryptoValue": totals[key] = data["totalUsdValue"].number ?? 0
                case "goldValue":
                    totals[key] = data["entries"].array.reduce(0) {
                        $0 + ($1["weightOz"].number ?? 0) * ($1["quantity"].number ?? 0)
                            * (data["spotPrices"][$1["metal"].string].number ?? 0)
                    }
                default:
                    totals[key] = data["entries"].array.reduce(0) {
                        $0 + ($1["currentValue"].number ?? 0)
                            - ($1["mortgage"]["balance"].number ?? 0)
                    }
                }
            } catch {
                totals.removeValue(forKey: key)
                errors[label] = error.localizedDescription
            }
        }
    }
}
