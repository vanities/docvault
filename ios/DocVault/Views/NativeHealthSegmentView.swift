import Charts
import SwiftUI

struct NativeHealthSegmentView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State private var response: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var chartID = ""
    @State private var limit = 30
    @State private var panels: [QuantPanel] = []
    @State private var rows: [VaultValue] = []
    private var segment: String {
        resource.id.replacingOccurrences(of: "health-", with: "")
    }

    private var data: VaultValue {
        response["data"]
    }

    private var scoreKey: String {
        segment == "sleep" ? "qualityScores" : "recoveryScores"
    }

    var body: some View {
        List {
            if loading {
                ProgressView("Loading health snapshot…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !data.isEmpty {
                VaultHero(title: resource.title, subtitle: "Your recorded trends, daily details and period comparisons.", symbol: healthSymbol, color: .teal, eyebrow: "HEALTH / " + resource.title.uppercased()).vaultStandaloneRow()
                Section("At a glance") {
                    VaultMetricGrid(stats: NativeHealth.stats(data, segment: segment)).vaultStandaloneRow()
                    if segment == "heart" {
                        LabeledContent("Resting heart rate trend", value: data["headline"]["restingHRTrend"].string)
                        LabeledContent("HRV trend", value: data["headline"]["hrvTrend"].string)
                    }
                    if segment == "workouts" {
                        LabeledContent("Favorite type", value: NativeHealth.workoutType(data["headline"]["favoriteType"].string))
                    }
                    let extremes = segment == "activity" ? [("mostActiveDay", "Most active day", "steps", "steps")] : segment == "sleep" ? [("longestSleep", "Longest sleep", "minutes", "min"), ("shortestSleep", "Shortest sleep", "minutes", "min")] : []
                    ForEach(extremes, id: \.0) { key, title, valueKey, unit in
                        let extreme = data["headline"][key]
                        if !extreme.isEmpty {
                            if let row = rows.first(where: { $0["date"] == extreme["date"] }) {
                                NavigationLink { NativeHealthReadingView(row: row, segment: segment, distanceUnit: data["distanceUnit"].string) } label: {
                                    LabeledContent(title, value: model.blurNumbers ? "••••" : NativeHealth.display(extreme[valueKey], unit: unit) + " · " + extreme["date"].string)
                                }
                            }
                        }
                    }
                    if segment == "body" {
                        LabeledContent("Height", value: model.blurNumbers ? "••••" : NativeHealth.display(data["heightIn"], unit: "in"))
                        if !data["headline"]["changeSincePrev"]["prevDate"].isEmpty {
                            LabeledContent("Previous reading", value: data["headline"]["changeSincePrev"]["prevDate"].string)
                        }
                    }
                }
                Section("Trends") {
                    Picker("Metric", selection: $chartID) {
                        ForEach(panels) { Text($0.title).tag($0.id) }
                    }.accessibilityIdentifier("healthMetric")
                    if let panel = panels.first(where: { $0.id == chartID }) ?? panels.first {
                        NativeHealthTimeChart(panel: panel).id(panel.id)
                    }
                }
                if let score = data[scoreKey].array.last {
                    Section {
                        VaultScoreCard(title: segment == "sleep" ? "Sleep quality" : "Recovery", score: score).vaultStandaloneRow()
                        Text("Scores and components are calculated by the server from available records.").font(.caption).foregroundStyle(.secondary)
                    }
                }

                if !data["insights"].array.isEmpty {
                    Section("Insights") {
                        ForEach(Array(data["insights"].array.enumerated()), id: \.offset) { _, insight in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(insight["label"].string).font(.headline)
                                Text(model.blurNumbers ? "••••" : insight["value"].string)
                                if !insight["caption"].string.isEmpty {
                                    Text(model.blurNumbers ? "••••" : insight["caption"].string).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if !data["periods"].array.isEmpty {
                    Section("Period comparisons") {
                        ForEach(Array(data["periods"].array.enumerated()), id: \.offset) { _, period in
                            NavigationLink(period["name"].string) { NativeHealthPeriodView(period: period) }
                                .accessibilityIdentifier("healthPeriod-" + period["name"].string)
                        }
                    }
                }
                if segment == "workouts" {
                    Section("Workout types") {
                        ForEach(Array(data["byType"].array.enumerated()), id: \.offset) { _, row in
                            NavigationLink { NativeHealthWorkoutTypeView(row: row, workouts: rows.filter { $0["type"] == row["type"] }, distanceUnit: data["distanceUnit"].string) } label: {
                                VStack(alignment: .leading) {
                                    Text(NativeHealth.workoutType(row["type"].string))
                                    Text(model.blurNumbers ? "••••" : NativeHealth.display(row["count"], unit: "workouts") + " · " + NativeHealth.display(row["totalDurationMinutes"], unit: "min")).font(.caption).foregroundStyle(.secondary)
                                }
                            }.accessibilityIdentifier("healthWorkoutType-" + row["type"].string)
                        }
                    }
                }
                Section(segment == "workouts" ? "Recent workouts" : segment == "body" ? "Weight readings" : "Daily records") {
                    ForEach(Array(rows.prefix(limit).enumerated()), id: \.offset) { _, row in
                        NavigationLink { NativeHealthReadingView(row: row, segment: segment, distanceUnit: data["distanceUnit"].string) } label: {
                            NativeHealthReadingLabel(row: row, segment: segment)
                        }.accessibilityIdentifier("healthReading-" + (row["date"].string.isEmpty ? row["start"].string : row["date"].string))
                    }
                    if rows.isEmpty {
                        Text("No recorded observations").foregroundStyle(.secondary)
                    }
                    if rows.count > limit {
                        Button("Show more records") { limit += 30 }
                    }
                }
                if segment == "body", !data["heightHistory"].array.isEmpty {
                    Section("Height readings") {
                        ForEach(Array(data["heightHistory"].array.reversed().enumerated()), id: \.offset) { _, row in
                            NavigationLink { NativeHealthReadingView(row: row, segment: "height", distanceUnit: "") } label: {
                                LabeledContent(row["date"].string, value: model.blurNumbers ? "••••" : NativeHealth.display(row["inches"], unit: "in"))
                            }
                        }
                    }
                }
                Section("Snapshot source") {
                    LabeledContent("Export", value: response["sourceFilename"].string)
                    LabeledContent("Generated", value: response["generatedAt"].string)
                    if response["stale"].boolean {
                        Label("An updated parser is available. Reparse the source export in Medical Records.", systemImage: "clock.badge.exclamationmark")
                    }
                    NavigationLink("Source data") { NativeResourceView(resource: resource, scope: scope) }
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).task { await load() }.refreshable { await load() }
    }

    private var healthSymbol: String {
        switch segment {
        case "activity": "figure.walk"
        case "heart": "waveform.path.ecg"
        case "sleep": "moon.zzz"
        case "workouts": "figure.run"
        default: "scalemass"
        }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await model.nativeRequest(resource.path, scope: scope)
            let segmentID = segment
            let worker = Task.detached(priority: .userInitiated) {
                (NativeHealth.panels(result["data"], segment: segmentID), NativeHealth.rows(result["data"], segment: segmentID))
            }
            let prepared = await withTaskCancellationHandler(operation: { await worker.value }, onCancel: { worker.cancel() })
            guard !Task.isCancelled else { return }
            response = result
            panels = prepared.0; rows = prepared.1
            if chartID.isEmpty {
                chartID = panels.first?.id ?? ""
            }
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeHealthTimeChart: View {
    @Environment(VaultModel.self) private var model
    let panel: QuantPanel
    @State private var days = 90
    @State private var selected: Date?
    @State private var hidden = Set<String>()
    private var end: Date {
        panel.lines.compactMap { $0.points.last?.date }.max() ?? Date()
    }

    private var start: Date {
        days == 0 ? .distantPast : end.addingTimeInterval(-Double(days) * 86400)
    }

    private var lines: [QuantLine] {
        panel.lines.filter { !hidden.contains($0.id) }
    }

    private func points(_ line: QuantLine) -> [QuantPoint] {
        let cutoff = start
        return line.points.filter { $0.date >= cutoff }
    }

    private var yDomain: ClosedRange<Double> {
        if panel.unit == "/100" {
            return 0 ... 100
        }
        let values = lines.flatMap { points($0).map(\.value) } + panel.reference
        guard let low = values.min(), let high = values.max() else { return 0 ... 1 }
        let pad = max((high - low) * 0.1, max(abs(high) * 0.03, 0.1))
        return (low >= 0 ? max(0, low - pad) : low - pad) ... (high + pad)
    }

    var body: some View {
        Picker("History", selection: $days) {
            Text("1M").tag(30); Text("3M").tag(90); Text("6M").tag(180); Text("1Y").tag(365); Text("All").tag(0)
        }.pickerStyle(.segmented).accessibilityIdentifier("healthHistory")
        if panel.lines.count > 1 {
            DisclosureGroup("Series") {
                ForEach(panel.lines) { line in
                    Toggle(line.title, isOn: Binding(get: { !hidden.contains(line.id) }, set: { enabled in
                        if enabled {
                            hidden.remove(line.id)
                        } else {
                            hidden.insert(line.id)
                        }
                    }))
                }
            }
        }
        if model.blurNumbers {
            Text("Health numbers are hidden").foregroundStyle(.secondary)
        } else if lines.flatMap({ points($0) }).isEmpty {
            Text("No recorded values for this metric and period").foregroundStyle(.secondary)
        } else {
            Chart {
                ForEach(lines) { line in
                    ForEach(points(line)) { point in
                        LineMark(x: .value("Date", point.date), y: .value(panel.unit, point.value), series: .value("Segment", line.id + "-\(point.segment)"))
                            .foregroundStyle(by: .value("Reading", line.title)).lineStyle(.init(lineWidth: line.id.hasPrefix("ref") ? 1.5 : 2.7, dash: line.id.hasPrefix("ref") ? [5, 4] : []))
                        PointMark(x: .value("Date", point.date), y: .value(panel.unit, point.value)).foregroundStyle(by: .value("Reading", line.title)).symbolSize(12)
                    }
                }
                ForEach(Array(panel.reference.enumerated()), id: \.offset) { _, value in
                    RuleMark(y: .value("Reference", value)).foregroundStyle(.secondary).lineStyle(.init(dash: [5, 3]))
                }
                if let selected {
                    RuleMark(x: .value("Selected", selected)).foregroundStyle(.secondary)
                }
            }.chartForegroundStyleScale(range: VaultPalette.chart).chartYScale(domain: yDomain).chartXScale(range: .plotDimension(startPadding: 8, endPadding: 28)).chartXSelection(value: $selected).chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { _ in AxisGridLine(); AxisTick(); AxisValueLabel(format: .dateTime.month(.abbreviated).day()) } }
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).frame(height: 225).accessibilityIdentifier("healthChart")
            Text(panel.unit).font(.caption).foregroundStyle(.secondary)
            Button("Inspect latest readings") { selected = end }.accessibilityIdentifier("healthInspectLatest")
            if let selected {
                Text(NativeQuant.day(selected)).font(.headline).accessibilityIdentifier("healthSelectedDate")
                ForEach(lines) { line in
                    if let point = points(line).min(by: { abs($0.date.timeIntervalSince(selected)) < abs($1.date.timeIntervalSince(selected)) }) {
                        LabeledContent(line.title, value: panel.display(point.value) + " · " + NativeQuant.day(point.date))
                    } else {
                        LabeledContent(line.title, value: "Unavailable")
                    }
                }
            }
            ForEach(panel.lines.filter { points($0).isEmpty }) { line in
                Text(line.title + ": no recorded values in this period").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct NativeHealthReadingLabel: View {
    @Environment(VaultModel.self) private var model
    let row: VaultValue
    let segment: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(segment == "workouts" ? NativeHealth.workoutType(row["type"].string) : row["date"].string).font(.headline)
            if segment == "workouts" {
                Text(row["start"].string).font(.caption).foregroundStyle(.secondary)
            }
            Text(model.blurNumbers ? "••••" : summary).font(.subheadline).foregroundStyle(.secondary)
            if !row["source"].isEmpty {
                Text(VaultValue.label(row["source"].string)).font(.caption)
            }
        }
    }

    private var summary: String {
        switch segment {
        case "activity": NativeHealth.display(row["steps"], unit: "steps")
        case "heart": NativeHealth.display(row["restingHR"], unit: "bpm resting") + " · " + NativeHealth.display(row["hrv"], unit: "ms HRV")
        case "sleep": NativeHealth.display(row["asleepMinutes"], unit: "hours asleep", multiplier: 1 / 60)
        case "workouts": NativeHealth.display(row["durationMinutes"], unit: "min")
        default: NativeHealth.display(row["lb"], unit: "lb")
        }
    }
}

struct NativeHealthReadingView: View {
    @Environment(VaultModel.self) private var model
    let row: VaultValue
    let segment: String
    let distanceUnit: String
    private var fields: [(String, String)] {
        switch segment {
        case "activity": [("steps", "steps"), ("activeEnergy", "kcal"), ("basalEnergy", "kcal"), ("exerciseMinutes", "min"), ("standHours", "hours"), ("distance", distanceUnit), ("flightsClimbed", "flights"), ("steps7dAvg", "steps/day"), ("activeEnergy7dAvg", "kcal/day"), ("exerciseMinutes7dAvg", "min/day")]
        case "heart": [("restingHR", "bpm"), ("avgHR", "bpm"), ("minHR", "bpm"), ("maxHR", "bpm"), ("hrv", "ms"), ("walkingHR", "bpm"), ("hrRecovery1min", "bpm")]
        case "sleep": [("asleepMinutes", "min"), ("inBedMinutes", "min"), ("deepMinutes", "min"), ("remMinutes", "min"), ("coreMinutes", "min"), ("awakeMinutes", "min"), ("respiratoryRate", "breaths/min"), ("wristTempDeviationC", "°C")]
        case "workouts": [("durationMinutes", "min"), ("distance", distanceUnit), ("avgHR", "bpm"), ("energy", "kcal")]
        case "height": [("cm", "cm"), ("inches", "in")]
        default: [("kg", "kg"), ("lb", "lb")]
        }
    }

    var body: some View {
        List {
            Section("Observation") {
                if segment == "workouts" {
                    Text(NativeHealth.workoutType(row["type"].string)).font(.headline); Text(row["start"].string)
                } else {
                    Text(row["date"].string).font(.headline)
                }
                if !row["source"].isEmpty {
                    LabeledContent("Source", value: VaultValue.label(row["source"].string))
                }
                ForEach(fields, id: \.0) { key, unit in
                    LabeledContent(VaultValue.label(key), value: model.blurNumbers ? "••••" : NativeHealth.display(row[key], unit: unit))
                }
            }
        }.navigationTitle(segment == "sleep" ? "Sleep night" : "Health reading")
    }
}

struct NativeHealthPeriodView: View {
    @Environment(VaultModel.self) private var model
    let period: VaultValue
    var body: some View {
        List {
            Section { Text(period["start"].string + " – " + period["end"].string) }
            ForEach(Array(period["stats"].array.enumerated()), id: \.offset) { _, stat in
                Section(stat["label"].string) {
                    LabeledContent("Current", value: model.blurNumbers ? "••••" : stat["formatted"].string)
                    LabeledContent("Previous", value: model.blurNumbers ? "••••" : NativeHealth.display(stat["prevValue"]))
                    LabeledContent("Change", value: model.blurNumbers ? "••••" : NativeHealth.display(stat["deltaPct"], unit: "%"))
                }
            }
        }.navigationTitle(period["name"].string)
    }
}

struct NativeHealthWorkoutTypeView: View {
    @Environment(VaultModel.self) private var model
    let row: VaultValue
    let workouts: [VaultValue]
    let distanceUnit: String
    var body: some View {
        List {
            Section("Type totals") {
                ForEach([("count", "workouts"), ("totalDurationMinutes", "min"), ("avgDurationMinutes", "min"), ("totalDistance", distanceUnit), ("totalEnergy", "kcal")], id: \.0) { key, unit in
                    LabeledContent(VaultValue.label(key), value: model.blurNumbers ? "••••" : NativeHealth.display(row[key], unit: unit))
                }
                LabeledContent("Last workout", value: row["lastWorkout"].string)
            }
            Section("Recent sessions") {
                ForEach(Array(workouts.enumerated()), id: \.offset) { _, workout in
                    NavigationLink { NativeHealthReadingView(row: workout, segment: "workouts", distanceUnit: distanceUnit) } label: { NativeHealthReadingLabel(row: workout, segment: "workouts") }
                }
                if workouts.isEmpty {
                    Text("No sessions in the recent-workout snapshot")
                }
            }
        }.navigationTitle(NativeHealth.workoutType(row["type"].string))
    }
}
