import Charts
import SwiftUI

struct NativeQuantView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loading = false
    @State private var panelID = ""
    @State private var panels: [QuantPanel] = []

    var selected: QuantPanel? {
        panels.first { $0.id == panelID } ?? panels.first
    }

    var body: some View {
        List {
            VaultHero(title: resource.title, subtitle: "Dated market observations with selectable series, history windows and exact values.", symbol: "chart.xyaxis.line", color: .indigo, eyebrow: "QUANT / CHARTS").vaultStandaloneRow()
            if loading {
                ProgressView("Loading market data…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if data["stale"].boolean {
                Section { Label("Cached data is stale", systemImage: "clock.badge.exclamationmark"); Text(data["fetchError"].string).font(.caption) }
            }
            if !data["fetchedAt"].isEmpty {
                Section {
                    if let timestamp = data["fetchedAt"].number {
                        LabeledContent("Fetched", value: Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .abbreviated, time: .shortened))
                    }
                    if !data["source"].isEmpty {
                        LabeledContent("Source", value: data["source"].string)
                    }
                }
            }
            let emptySeries = data["series"].array.filter { !$0["id"].isEmpty && $0["points"].array.isEmpty }
            if !emptySeries.isEmpty {
                Section("Unavailable series") {
                    ForEach(emptySeries, id: \.self) { Text($0["label"].string + ": no observations").foregroundStyle(.secondary) }
                }
            }
            if panels.count > 1 {
                Picker("Chart", selection: $panelID) { ForEach(panels) { Text($0.title).tag($0.id) } }
                    .accessibilityIdentifier("quantChartPicker")
            }
            if let selected {
                NativeQuantTimeChart(panel: selected).id(selected.id)
            }
            if resource.id == "quant-cycle-presidential" {
                NativeCycleHeatmap(data: data)
            }
            if resource.id == "quant-tradfi-sectors-rotation" {
                NativeSectorRotation(data: data)
            }
            if resource.id == "quant-tradfi-midterm-drawdowns" {
                NativeMidtermChart(data: data)
            }
            if resource.id == "quant-btc-altcoin-season" {
                NativeAltcoinChart(data: data)
            }
            if resource.id == "quant-btc-dominance" {
                NativeDominanceChart(data: data)
            }
            if resource.id == "quant-btc-kronos", let url = NativePolitics.sourceURL(data["chartUrl"]) {
                Section("Kronos forecast") { NativeExternalChart(url: url, caption: "Upstream forecast image. Updated \(data["upstreamUpdatedAt"].string).") }
            }
            if !data["latest"].isEmpty {
                Section("Latest observations") { NativeValueSections(value: data["latest"]) }
            }
            if resource.id == "quant-btc-log-regression" {
                NavigationLink("Hodl triangle") { NativeHodlTriangle() }
            }
            NavigationLink("Source data and refresh actions") { NativeResourceView(resource: resource, scope: .init()) }
        }.vaultDashboard().tint(.indigo).task { await load() }.refreshable { await load() }
    }

    private func load() async {
        loading = true; error = nil
        do {
            let result = try await model.nativeRequest(resource.path, scope: .init())
            guard !Task.isCancelled else { return }
            if !result["error"].isEmpty {
                throw VaultError.server(result["error"].string)
            }
            let resourceID = resource.id
            let worker = Task.detached(priority: .userInitiated) { NativeQuant.panels(result, resource: resourceID) }
            let prepared = await withTaskCancellationHandler(operation: { await worker.value }, onCancel: { worker.cancel() })
            guard !Task.isCancelled else { return }
            data = result
            panels = prepared
            if !panels.contains(where: { $0.id == panelID }) {
                panelID = panels.first?.id ?? ""
            }
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
        loading = false
    }
}

struct NativeQuantTimeChart: View {
    let panel: QuantPanel
    @State private var months = 0
    @State private var log = false
    @State private var hidden = Set<String>()
    @State private var selection: Date?
    @State private var customStart: Date
    @State private var customEnd: Date
    @State private var customWindow: QuantDateWindow?
    @State private var overlays = true
    @State private var snapshot: QuantChartSnapshot?
    @State private var exportURL: URL?
    @State private var exporting = false
    @State private var exportError: String?
    @State private var exportTask: Task<Void, Never>?

    init(panel: QuantPanel) {
        self.panel = panel
        _log = State(initialValue: panel.logarithmic)
        let dates = panel.lines.flatMap { $0.points.map(\.date) }
        _customStart = State(initialValue: dates.min() ?? Date(timeIntervalSince1970: 0))
        _customEnd = State(initialValue: dates.max() ?? Date(timeIntervalSince1970: 0))
        _customWindow = State(initialValue: QuantDateWindow(start: dates.min() ?? Date(timeIntervalSince1970: 0), end: dates.max() ?? Date(timeIntervalSince1970: 0)))
    }

    private var options: QuantChartOptions {
        .init(months: months, custom: customWindow, logarithmic: log, hidden: hidden, overlays: overlays)
    }

    var body: some View {
        Section(panel.title) {
            if !panel.description.isEmpty {
                Text(panel.description).font(.footnote).foregroundStyle(.secondary)
            }
            Picker("History", selection: $months) {
                Text("1 year").tag(12); Text("5 years").tag(60); Text("10 years").tag(120); Text("All").tag(0); Text("Custom").tag(-1)
            }.accessibilityIdentifier("quantHistory")
            if months == -1 {
                DatePicker("From", selection: $customStart, displayedComponents: .date).accessibilityIdentifier("quantCustomStart")
                DatePicker("Through", selection: $customEnd, displayedComponents: .date).accessibilityIdentifier("quantCustomEnd")
                if QuantDateWindow(start: customStart, end: customEnd) == nil {
                    Text("The end date must be on or after the start date.").foregroundStyle(.red).accessibilityIdentifier("quantRangeError")
                }
                Button("Apply date range") { customWindow = QuantDateWindow(start: customStart, end: customEnd) }
                    .disabled(QuantDateWindow(start: customStart, end: customEnd) == nil).accessibilityIdentifier("quantApplyRange")
                if let customWindow {
                    Text("Showing \(NativeQuant.day(customWindow.start)) through \(NativeQuant.day(customWindow.end)) (UTC).")
                        .font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("quantAppliedRange")
                }
            }
            if panel.logarithmic {
                Toggle("Logarithmic price scale", isOn: $log).accessibilityIdentifier("quantLogScale")
            }
            if panel.lines.count > 1 {
                DisclosureGroup("Series") {
                    ForEach(panel.lines) { line in
                        Toggle(line.title, isOn: Binding(get: { !hidden.contains(line.id) }, set: { enabled in
                            if enabled {
                                hidden.remove(line.id)
                            } else {
                                hidden.insert(line.id)
                            }
                        })).accessibilityIdentifier("quantSeries-\(line.id)")
                    }
                }
            }
            if !panel.bands.isEmpty || !panel.intervals.isEmpty {
                Toggle("Shaded bands & periods", isOn: $overlays).accessibilityIdentifier("quantOverlays")
            }
            if let snapshot {
                observations(snapshot)
            } else {
                ProgressView("Preparing observations…")
            }
            if let exportError {
                ErrorNotice(message: exportError)
            }
            if let exportURL {
                ShareLink("Share CSV file", item: exportURL).accessibilityIdentifier("shareQuantExport")
            } else {
                Button(exporting ? "Preparing CSV…" : "Export chart observations (CSV)") { prepareExport() }
                    .disabled(exporting).accessibilityIdentifier("prepareQuantExport")
            }
        }.environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).task(id: QuantChartInput(revision: panel.revision, options: options)) {
            let payload = panel, requested = options
            snapshot = nil; selection = nil
            let worker = Task.detached(priority: .userInitiated) { NativeQuantChart.snapshot(payload, options: requested) }
            let result = await withTaskCancellationHandler(operation: { await worker.value }, onCancel: { worker.cancel() })
            guard !Task.isCancelled else { return }
            snapshot = result
        }.onDisappear {
            exportTask?.cancel()
            if let exportURL {
                VaultModel.removePreview(exportURL)
            }
            exportURL = nil
        }
    }

    @ViewBuilder private func observations(_ snapshot: QuantChartSnapshot) -> some View {
        chart(snapshot)
        Text(log ? "\(panel.unit) · logarithmic scale" : panel.percentFraction ? "Percent return" : panel.unit)
            .font(.caption).foregroundStyle(.secondary)
        if snapshot.omittedOnLogScale > 0 {
            Text("\(snapshot.omittedOnLogScale) nonpositive observations are hidden on the log scale and retained in the statistics and CSV.")
                .font(.caption).foregroundStyle(.secondary)
        }
        if snapshot.lines.allSatisfy(\.points.isEmpty) {
            Text("No observations in this view. Adjust the dates, scale or series.").foregroundStyle(.secondary).accessibilityIdentifier("quantEmptyRange")
        }
        if !snapshot.bands.isEmpty || !snapshot.intervals.isEmpty {
            DisclosureGroup("Shading legend") {
                ForEach(snapshot.bands) { band in Label(band.title, systemImage: "square.fill").foregroundStyle(bandColor(band)).font(.caption) }
                if snapshot.intervals.contains(where: { $0.kind == .recession }) {
                    Label("NBER recession (source USREC)", systemImage: "square.fill").foregroundStyle(.secondary).font(.caption)
                }
                if snapshot.intervals.contains(where: { $0.kind == .inversion }) {
                    Label("10Y − 2Y below zero", systemImage: "square.fill").foregroundStyle(.pink).font(.caption)
                }
                Text("Fills use paired observations. Missing readings break the band. Period shading is clipped to the selected window.").font(.caption).foregroundStyle(.secondary)
            }.accessibilityIdentifier("quantShadingLegend")
        }
        Button("Inspect latest values") { selection = snapshot.latest }.disabled(snapshot.latest == nil).accessibilityIdentifier("quantInspectLatest")
        if let selection {
            Text(NativeQuant.day(selection)).font(.headline).accessibilityIdentifier("quantSelectedDate")
            ForEach(snapshot.lines) { line in
                if let nearest = line.points.min(by: { abs($0.date.timeIntervalSince(selection)) < abs($1.date.timeIntervalSince(selection)) }) {
                    LabeledContent(line.title, value: panel.display(nearest.value) + (NativeQuant.day(nearest.date) == NativeQuant.day(selection) ? "" : " · " + NativeQuant.day(nearest.date)))
                        .accessibilityIdentifier("quantValue-\(line.id)")
                }
            }
            ForEach(snapshot.events.filter { NativeQuant.day($0.date) == NativeQuant.day(selection) }) { event in Label(event.title, systemImage: "flag.fill").foregroundStyle(.orange) }
        }
        if !panel.facts.isEmpty {
            VaultMetricGrid(metrics: panel.facts.map { .init(title: $0.title, value: $0.value) }, color: .indigo)
            Text("Latest source snapshot · independent of the selected history window.").font(.caption).foregroundStyle(.secondary)
        }
        if !snapshot.events.isEmpty {
            DisclosureGroup("Events · \(snapshot.events.count) in range") {
                ForEach(snapshot.events) { event in
                    Button { selection = event.date } label: { HStack { Text(event.title); Spacer(); Text(NativeQuant.day(event.date)).font(.caption).monospacedDigit() } }
                        .accessibilityIdentifier("quantEvent-\(NativeQuant.day(event.date))-\(event.title)")
                }
            }.accessibilityIdentifier("quantEvents")
        }
        if !snapshot.statistics.isEmpty {
            DisclosureGroup("Statistics for this window") {
                ForEach(snapshot.statistics) { stats in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(stats.title).font(.subheadline.weight(.semibold))
                        LabeledContent("Observations", value: stats.count.formatted())
                        LabeledContent("First · " + NativeQuant.day(stats.first.date), value: panel.display(stats.first.value))
                        LabeledContent("Last · " + NativeQuant.day(stats.last.date), value: panel.display(stats.last.value))
                        LabeledContent("Recorded range", value: panel.display(stats.minimum) + " to " + panel.display(stats.maximum))
                        if stats.change.isFinite {
                            LabeledContent("Change", value: panel.display(stats.change))
                        }
                        if panel.unit == "USD", let change = stats.priceChange {
                            LabeledContent("Price change", value: change.formatted(.percent.precision(.fractionLength(2))))
                        }
                    }.font(.footnote).accessibilityIdentifier("quantStatistics-\(stats.id)")
                }
                Text("Statistics use all recorded observations in the chosen window for enabled series, including values hidden by the log scale.").font(.caption).foregroundStyle(.secondary)
            }.accessibilityIdentifier("quantStatistics")
        }
    }

    private func prepareExport() {
        exporting = true; exportError = nil
        let payload = panel
        let folder = VaultModel.previewRoot.appendingPathComponent(UUID().uuidString)
        exportTask = Task {
            defer { exporting = false }
            let worker = Task.detached(priority: .utility) { try NativeQuant.export(payload, folder: folder) }
            do {
                let url = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                guard !Task.isCancelled else { VaultModel.removePreview(url); return }
                exportURL = url
            } catch {
                if !Task.isCancelled {
                    exportError = error.localizedDescription
                }
            }
        }
    }

    private func chart(_ snapshot: QuantChartSnapshot) -> some View {
        Chart {
            ForEach(snapshot.intervals) { interval in
                RectangleMark(xStart: .value("Start", interval.start), xEnd: .value("End", interval.end), yStart: .value("Low", snapshot.yDomain.lowerBound), yEnd: .value("High", snapshot.yDomain.upperBound))
                    .foregroundStyle(interval.kind == .recession ? Color.gray.opacity(0.18) : Color.pink.opacity(0.12))
            }
            ForEach(snapshot.bands) { band in
                ForEach(band.points) { point in
                    AreaMark(x: .value("Date", point.date), yStart: .value("Lower", log ? log10(point.lower) : point.lower), yEnd: .value("Upper", log ? log10(point.upper) : point.upper), series: .value("Band segment", band.id + "-\(point.segment)"))
                        .foregroundStyle(bandColor(band).opacity(band.id == "sigma2" ? 0.08 : 0.15))
                }
            }
            ForEach(snapshot.lines) { line in
                ForEach(line.points) { point in
                    LineMark(x: .value("Date", point.date), y: .value(panel.unit, log ? log10(point.value) : point.value), series: .value("Segment", line.id + "-\(point.segment)"))
                        .foregroundStyle(by: .value("Series", line.title))
                        .lineStyle(.init(lineWidth: 2.5))
                }
            }
            ForEach(panel.reference, id: \.self) { value in
                if !log || value > 0 {
                    RuleMark(y: .value("Reference", log ? log10(value) : value)).foregroundStyle(.secondary.opacity(0.5)).lineStyle(.init(dash: [4, 4]))
                }
            }
            ForEach(snapshot.events) { event in
                RuleMark(x: .value("Event", event.date)).foregroundStyle(.orange.opacity(0.6)).lineStyle(.init(dash: [2, 4]))
                    .annotation(position: .top) {
                        if snapshot.events.count <= 4 {
                            Text(event.title).font(.caption2)
                        }
                    }
            }
            if let selection {
                RuleMark(x: .value("Selected", selection)).foregroundStyle(.secondary)
            }
        }
        .chartXScale(domain: snapshot.xDomain)
        .chartYScale(domain: snapshot.yDomain)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine(); AxisTick()
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(log ? pow(10, number).formatted(.number.notation(.compactName)) : panel.percentFraction ? number.formatted(.percent.precision(.fractionLength(0))) : number.formatted(.number.notation(.compactName)))
                    }
                }
            }
        }
        .chartForegroundStyleScale(domain: panel.lines.map(\.title), range: VaultPalette.chart)
        .chartXSelection(value: $selection)
        .frame(height: 300)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(panel.title), \(snapshot.lines.count) series. \(snapshot.visibleDates). \(snapshot.bands.count) shaded bands, \(snapshot.intervals.count) shaded periods, \(snapshot.events.count) events. Use Inspect latest values for exact observations.")
        .accessibilityIdentifier("quantTimeChart")
    }

    private func bandColor(_ band: QuantBand) -> Color {
        if band.id == "support" {
            return .green
        }
        if band.id.hasPrefix("sigma") {
            return .purple
        }
        return band.id == "range-0" ? .cyan : .orange
    }
}

struct NativeCycleHeatmap: View {
    let data: VaultValue
    @State private var selectedYear = 0
    @State private var selectedMonth = 0
    var matrix: [[VaultValue]] {
        data["matrix"].array.map(\.array)
    }

    var body: some View {
        if !matrix.isEmpty {
            Section("Presidential cycle · monthly historical averages") {
                ScrollView(.horizontal) {
                    Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                        GridRow { Text("Cycle"); ForEach(0 ..< 12, id: \.self) { Text(monthName($0)).font(.caption2).frame(width: 50) } }
                        ForEach(Array(matrix.enumerated()), id: \.offset) { year, months in
                            GridRow {
                                Text(yearName(year)).font(.caption).frame(width: 80)
                                ForEach(Array(months.enumerated()), id: \.offset) { month, value in
                                    Button { selectedYear = year; selectedMonth = month } label: {
                                        Text(value.number.map { $0.formatted(.number.precision(.fractionLength(2))) + "%" } ?? "—")
                                            .font(.caption2).monospacedDigit().frame(width: 50, height: 42)
                                            .background((value.number ?? 0) >= 0 ? Color.red.opacity(intensity(value)) : Color.blue.opacity(intensity(value)))
                                            .clipShape(.rect(cornerRadius: 4))
                                            .overlay {
                                                if selectedYear == year, selectedMonth == month {
                                                    RoundedRectangle(cornerRadius: 4).stroke(.primary, lineWidth: 2)
                                                }
                                            }
                                    }.buttonStyle(.plain).accessibilityIdentifier("cycleCell-\(year)-\(month)")
                                        .accessibilityLabel("\(yearName(year)), \(monthName(month)), \(value.string) percent")
                                }
                            }
                        }
                    }
                }
                let row = matrix.indices.contains(selectedYear) ? matrix[selectedYear] : []
                let countRows = data["counts"].array
                let counts = countRows.indices.contains(selectedYear) ? countRows[selectedYear].array : []
                Text("\(yearName(selectedYear)) · \(monthName(selectedMonth)): \(row.indices.contains(selectedMonth) ? row[selectedMonth].string : "Unavailable")% · \(counts.indices.contains(selectedMonth) ? counts[selectedMonth].string : "0") observations")
                    .accessibilityIdentifier("cycleObservation")
                LabeledContent("Current cycle year", value: data["currentYearOfCycle"].string)
                Text("Historical averages are not forecasts. Red is positive; blue is negative.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func monthName(_ index: Int) -> String {
        let values = data["monthLabels"].array; return values.indices.contains(index) ? values[index].string : String(index + 1)
    }

    private func yearName(_ index: Int) -> String {
        let values = data["yearLabels"].array; return values.indices.contains(index) ? values[index].string : "Year \(index + 1)"
    }

    private func intensity(_ value: VaultValue) -> Double {
        min(1, max(0.12, abs(value.number ?? 0) / 5))
    }
}

struct NativeSectorRotation: View {
    let data: VaultValue
    @State private var period = "m1"
    @State private var sort = "rsRatio"
    var rows: [VaultValue] {
        data["sectors"].array.sorted {
            let key = sort == "return" ? "returns." + period : sort
            let lhs = $0.at(key).number, rhs = $1.at(key).number
            if lhs == rhs {
                return $0["ticker"].string < $1["ticker"].string
            }
            if lhs == nil {
                return false
            }; if rhs == nil {
                return true
            }
            return lhs! > rhs!
        }
    }

    var body: some View {
        Section("Sector rotation · relative to SPY") {
            Chart {
                RuleMark(x: .value("RS", 100)).foregroundStyle(.secondary)
                RuleMark(y: .value("Momentum", 100)).foregroundStyle(.secondary)
                ForEach(rows, id: \.self) { row in
                    if let rs = row["rsRatio"].number, let momentum = row["momentum"].number {
                        PointMark(x: .value("Relative strength", rs), y: .value("Momentum", momentum))
                            .foregroundStyle(by: .value("Quadrant", row["quadrant"].string.capitalized))
                            .annotation { Text(row["ticker"].string).font(.caption2) }
                    }
                }
            }.frame(height: 280).chartXScale(domain: scatterDomain("rsRatio")).chartYScale(domain: scatterDomain("momentum"))
                .accessibilityIdentifier("sectorRotationChart")
            Text("Axes cross at 100. Leading: strength and momentum above 100; improving: strength below, momentum above; weakening: strength above, momentum below; lagging: both below.").font(.caption).foregroundStyle(.secondary)
            Picker("Return period", selection: $period) {
                Text("1 day").tag("d1"); Text("1 week").tag("w1"); Text("1 month").tag("m1"); Text("3 months").tag("m3"); Text("6 months").tag("m6"); Text("YTD").tag("ytd")
            }.accessibilityIdentifier("sectorPeriod")
            Picker("Sort", selection: $sort) { Text("Relative strength").tag("rsRatio"); Text("Momentum").tag("momentum"); Text("Return").tag("return") }
            ForEach(rows, id: \.self) { row in
                VStack(alignment: .leading) {
                    Text("\(row["ticker"].string) · \(row["name"].string)").font(.headline)
                    Text("\(row["quadrant"].string.capitalized) · Return \(row["returns"][period].number.map { $0.formatted(.number.precision(.fractionLength(2))) + "%" } ?? "Unavailable")")
                    Text("RS \(row["rsRatio"].string) · Momentum \(row["momentum"].string)").font(.caption)
                }
            }
        }
    }

    private func scatterDomain(_ key: String) -> ClosedRange<Double> {
        let values = rows.compactMap { $0[key].number } + [100]
        return ((values.min() ?? 99) - 1) ... ((values.max() ?? 101) + 1)
    }
}

struct NativeMidtermChart: View {
    let data: VaultValue
    @State private var currentOnly = false
    var curves: [VaultValue] {
        data["curves"].array.filter { !currentOnly || $0["isCurrent"].boolean }
    }

    var body: some View {
        Section("Midterm drawdowns") {
            Toggle("Current cycle and historical average", isOn: $currentOnly)
            Chart {
                ForEach(curves, id: \.self) { curve in
                    ForEach(curve["points"].array, id: \.self) { point in
                        if let x = point["offsetMonths"].number, let y = point["drawdown"].number {
                            LineMark(x: .value("Months from peak", x), y: .value("Drawdown %", y * 100), series: .value("Cycle", curve["label"].string))
                                .foregroundStyle(curve["isCurrent"].boolean ? .orange : .gray.opacity(0.3))
                        }
                    }
                }
                ForEach(data["averageCurve"].array, id: \.self) { point in
                    if let x = point["offsetMonths"].number, let y = point["drawdown"].number {
                        LineMark(x: .value("Months from peak", x), y: .value("Drawdown %", y * 100), series: .value("Cycle", "Average")).foregroundStyle(.indigo).lineStyle(.init(lineWidth: 3))
                    }
                }
            }.frame(height: 280).accessibilityIdentifier("midtermChart")
            Text("Months relative to peak · Drawdown in percent. Orange: current cycle; indigo: historical average.").font(.caption)
            ForEach(curves, id: \.self) { curve in
                LabeledContent(curve["label"].string, value: "Peak \(curve["peakDate"].string) · \(NativePolitics.currency(curve["peakClose"].number))")
            }
        }
    }
}

struct NativeAltcoinChart: View {
    let data: VaultValue
    @State private var search = ""
    @State private var winnersOnly = false
    var coins: [VaultValue] {
        data["coins"].array.filter { (!winnersOnly || $0["beatsBtc"].boolean) && (search.isEmpty || $0.stringSearch.localizedCaseInsensitiveContains(search)) }.sorted { ($0["return90d"].number ?? -.infinity) > ($1["return90d"].number ?? -.infinity) }
    }

    var body: some View {
        Section("Altcoin season · 90 days") {
            LabeledContent("Index / regime", value: "\(data["indexValue"].string) · \(data["regime"].string)")
            LabeledContent("BTC return", value: NativePolitics.percent(data["btcReturn90d"].number))
            TextField("Find a coin", text: $search).accessibilityIdentifier("altcoinSearch")
            Toggle("Only outperformers", isOn: $winnersOnly)
            Chart(Array(coins.prefix(20)), id: \.self) { coin in
                if let value = coin["return90d"].number {
                    BarMark(x: .value("Return %", value * 100), y: .value("Coin", coin["symbol"].string))
                        .foregroundStyle(coin["beatsBtc"].boolean ? .green : .gray)
                }
            }.frame(height: CGFloat(max(1, min(20, coins.count))) * 24 + 40)
            ForEach(coins, id: \.self) { coin in
                LabeledContent("\(coin["symbol"].string) · \(coin["name"].string)", value: "\(NativePolitics.percent(coin["return90d"].number)) · \(coin["outperformance"].string) pp vs BTC")
            }
        }
    }
}

struct NativeDominanceChart: View {
    let data: VaultValue
    var body: some View {
        if !data["btcDominance"].isEmpty {
            Section("Market dominance snapshot") {
                let btc = data["btcDominance"].number ?? 0
                let eth = data["ethDominance"].number ?? 0
                let stables = data["stableDominance"].number ?? 0
                let values = [("BTC", btc), ("ETH", eth), ("Stablecoins", stables), ("Other", max(0, 100 - btc - eth - stables))]
                Chart {
                    ForEach(values, id: \.0) { label, value in
                        BarMark(x: .value("Share %", value), y: .value("Asset", label)).foregroundStyle(by: .value("Asset", label))
                    }
                }.frame(height: 160).chartXScale(domain: 0 ... 100)
                ForEach(values, id: \.0) { label, value in LabeledContent(label, value: value.formatted(.number.precision(.fractionLength(2))) + "%") }
                LabeledContent("Flight to safety", value: data["flightToSafety"].string + "%")
                LabeledContent("Stablecoin supply ratio", value: data["ssr"].string)
                LabeledContent("Total market cap", value: NativePolitics.currency(data["totalMarketCapUsd"].number))
                Text("Current observation only; no historical dominance series is supplied.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct NativeExternalChart: View {
    let url: URL
    let caption: String
    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image {
                image.resizable().scaledToFit()
            } else if phase.error != nil {
                Text("Upstream image unavailable. Open the source to retry.")
            } else {
                ProgressView("Loading upstream chart…")
            }
        }
        Text(caption).font(.caption)
        Link("Open source chart", destination: url)
    }
}

struct NativeHodlTriangle: View {
    @State private var variant = "outs"
    var body: some View {
        List {
            Picker("Measure", selection: $variant) { Text("Number of outputs").tag("outs"); Text("Amount of BTC").tag("btc") }
            NativeExternalChart(url: URL(string: variant == "outs" ? "https://utxo.live/triangleOuts.png" : "https://utxo.live/triangleBtc.png")!, caption: "UTXO creation date on Y; spend date on X. Each cell measures outputs created then and spent later. Hosted by utxo.live.").id(variant)
        }.navigationTitle("Hodl triangle")
    }
}
