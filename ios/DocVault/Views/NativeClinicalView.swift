import SwiftUI

struct NativeClinicalView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State private var response: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var kind = "labsByTest"
    @State private var search = ""
    @State private var filter = "All"
    @State private var limit = 50
    private var data: VaultValue {
        response["clinical"]
    }

    private let tabs = [("labsByTest", "Labs"), ("vitals", "Vitals"), ("conditions", "Conditions"), ("medications", "Medications"), ("immunizations", "Immunizations"), ("allergies", "Allergies"), ("procedures", "Procedures"), ("documents", "Documents")]
    private var rows: [VaultValue] {
        NativeHealth.clinicalRows(data, kind: kind, search: search, filter: filter)
    }

    private var filters: [String] {
        if kind == "labsByTest" {
            return ["All", "Out of range"]
        }
        if kind == "procedures" {
            return ["All", "Procedures / other"]
        }
        if kind == "conditions" {
            return ["All", "Active", "Chronic / other"]
        }
        if ["medications", "allergies"].contains(kind) {
            return ["All", "Active"]
        }
        return ["All"]
    }

    var body: some View {
        List {
            if loading {
                ProgressView("Loading clinical records…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !data.isEmpty {
                VaultHero(title: "Clinical records", subtitle: "Results and histories from your imported medical records, with their original units and reference ranges.", symbol: "cross.case", color: .teal, eyebrow: "HEALTH / CLINICAL").vaultStandaloneRow()
                Section {
                    Picker("Records", selection: $kind) { ForEach(tabs, id: \.0) { key, title in Text(title + " (\(data[key].array.count))").tag(key) } }
                        .accessibilityIdentifier("clinicalTab")
                    if filters.count > 1 {
                        Picker("Filter", selection: $filter) { ForEach(filters, id: \.self) { Text($0).tag($0) } }.accessibilityIdentifier("clinicalFilter")
                    }
                    Text("\(rows.count) matching records").font(.caption).foregroundStyle(.secondary)
                    if response["stale"].boolean {
                        Label("Cached clinical schema is older. Reparse the export to update records.", systemImage: "clock.badge.exclamationmark")
                    }
                }
                Section(tabs.first { $0.0 == kind }?.1 ?? "Records") {
                    ForEach(Array(rows.prefix(limit).enumerated()), id: \.offset) { _, row in
                        NavigationLink {
                            if kind == "labsByTest" {
                                NativeClinicalTrendView(trend: row)
                            } else if kind == "vitals" {
                                let history = data["vitals"].array.filter { row["loinc"].isEmpty ? $0["name"] == row["name"] : $0["loinc"] == row["loinc"] }
                                NativeClinicalTrendView(trend: .object(["name": row["name"], "points": .array(history), "latest": history.sorted { (NativeHealth.date($0) ?? .distantPast) < (NativeHealth.date($1) ?? .distantPast) }.last ?? row]))
                            } else {
                                NativeClinicalRecordView(row: row, kind: kind, history: data[kind].array.filter { row["icd10"].isEmpty ? $0["name"] == row["name"] : $0["icd10"] == row["icd10"] })
                            }
                        } label: { NativeClinicalRecordLabel(row: row, kind: kind) }
                            .accessibilityIdentifier("clinicalRecord-" + (row["id"].string.isEmpty ? row["name"].string : row["id"].string))
                    }
                    if rows.isEmpty {
                        Text(search.isEmpty && filter == "All" ? "No records in this export" : "No matching records").foregroundStyle(.secondary)
                    }
                    if rows.count > limit {
                        Button("Show more records") { limit += 50 }
                    }
                }
                if kind == "labsByTest", search.isEmpty, filter == "All" {
                    Section("Lab panels") {
                        ForEach(Array(data["labPanels"].array.enumerated()), id: \.offset) { _, panel in
                            NavigationLink { NativeClinicalPanelView(panel: panel, tests: data["labsByTest"].array) } label: {
                                VStack(alignment: .leading) { Text(panel["name"].string); Text(panel["date"].string).font(.caption).foregroundStyle(.secondary) }
                            }.accessibilityIdentifier("clinicalPanel-" + panel["id"].string)
                        }
                    }
                }
                Section("Clinical source") {
                    LabeledContent("Export", value: response["sourceFilename"].string)
                    LabeledContent("Generated", value: data["generatedAt"].string)
                    LabeledContent("Date range", value: data["dateRange"]["start"].string + " – " + data["dateRange"]["end"].string)
                    NavigationLink("Source data") { NativeResourceView(resource: resource, scope: scope) }
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find clinical records")
            .onChange(of: kind) { filter = "All"; limit = 50; search = "" }
            .onChange(of: filter) { limit = 50 }.onChange(of: search) { limit = 50 }
            .task { await load() }.refreshable { await load() }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await model.nativeRequest(resource.path, scope: scope)
            guard !Task.isCancelled else { return }
            response = result
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeClinicalRecordLabel: View {
    @Environment(VaultModel.self) private var model
    let row: VaultValue
    let kind: String
    private var result: VaultValue {
        kind == "labsByTest" ? row["latest"] : row
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(row["name"].string).font(.headline)
            if ["labsByTest", "vitals", "lab"].contains(kind) {
                Text(model.blurNumbers ? "••••" : NativeHealth.labValue(result)).font(.system(.title3, design: .rounded, weight: .semibold)).monospacedDigit()
                let flag = kind == "labsByTest" ? row["latestFlag"].string : result["derivedFlag"].string
                if ["high", "low"].contains(flag) {
                    Label(VaultValue.label(flag) + " · outside supplied reference range", systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.orange)
                }
                Text(result["effectiveAt"].string.isEmpty ? result["date"].string : result["effectiveAt"].string).font(.caption).foregroundStyle(.secondary)
            } else {
                let status = row["clinicalStatus"].isEmpty ? row["status"].string : row["clinicalStatus"].string
                if !status.isEmpty {
                    Text(status).font(.subheadline).foregroundStyle(.secondary)
                }
                if !row["dosageText"].isEmpty {
                    Text(model.blurNumbers ? "••••" : row["dosageText"].string).font(.subheadline)
                }
                let date = ["date", "startDate", "onsetDate", "recordedDate", "authoredOn"].map { row[$0].string }.first { !$0.isEmpty }
                if let date {
                    Text(date).font(.caption).foregroundStyle(.secondary)
                }
            }
        }.padding(.vertical, 6)
    }
}

struct NativeClinicalTrendView: View {
    @Environment(VaultModel.self) private var model
    let trend: VaultValue
    private var rows: [VaultValue] {
        trend["points"].array.sorted { (NativeHealth.date($0) ?? .distantPast) > (NativeHealth.date($1) ?? .distantPast) }
    }

    var body: some View {
        List {
            Section("Latest recorded result") {
                let latest = trend["latest"].isEmpty ? rows.first ?? .null : trend["latest"]
                NativeClinicalObservation(row: latest)
            }
            ForEach(NativeHealth.clinicalPanels(rows)) { panel in
                Section(panel.unit.isEmpty ? "Trend" : "Trend · " + panel.unit) {
                    NativeHealthTimeChart(panel: panel)
                }
            }
            Section("Result history") {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    NavigationLink { NativeClinicalRecordView(row: row, kind: "lab") } label: { NativeClinicalRecordLabel(row: row, kind: "lab") }
                        .accessibilityIdentifier("clinicalResult-" + row["id"].string)
                }
                if rows.isEmpty {
                    Text("No recorded results")
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).navigationTitle(trend["name"].string)
    }
}

struct NativeClinicalObservation: View {
    @Environment(VaultModel.self) private var model
    let row: VaultValue
    var body: some View {
        Text(row["name"].string).font(.headline)
        LabeledContent("Result", value: model.blurNumbers ? "••••" : NativeHealth.labValue(row))
        LabeledContent("Reference", value: model.blurNumbers ? "••••" : NativeHealth.reference(row))
        ForEach(["date", "effectiveAt", "loinc", "status", "interpretation", "derivedFlag"], id: \.self) { key in
            if !row[key].isEmpty {
                LabeledContent(VaultValue.label(key), value: row[key].string)
            }
        }
        ForEach(Array(row["components"].array.enumerated()), id: \.offset) { _, component in
            LabeledContent(component["name"].string, value: model.blurNumbers ? "••••" : NativeHealth.display(component["value"], unit: NativeHealth.unit(component["unit"].string, loinc: component["loinc"].string)))
        }
    }
}

struct NativeClinicalRecordView: View {
    @Environment(VaultModel.self) private var model
    let row: VaultValue
    let kind: String
    var history: [VaultValue] = []
    private var keys: [String] {
        switch kind {
        case "conditions": ["icd10", "clinicalStatus", "verificationStatus", "category", "onsetDate", "recordedDate", "abatementDate"]
        case "medications": ["status", "authoredOn", "dosageText", "route", "startDate", "endDate"]
        case "immunizations": ["cvx", "status", "date", "primarySource"]
        case "allergies": ["clinicalStatus", "recordedDate"]
        case "procedures": ["cpt", "status", "date", "category"]
        default: ["category", "date", "description"]
        }
    }

    var body: some View {
        List {
            Section("Record") {
                if kind == "lab" {
                    NativeClinicalObservation(row: row)
                } else {
                    Text(row["name"].string).font(.headline)
                    ForEach(keys, id: \.self) { key in
                        let value = row[key]
                        if value == .null {
                            LabeledContent(VaultValue.label(key), value: "Unavailable")
                        } else if ["dosageText", "description"].contains(key) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(VaultValue.label(key)).font(.caption).foregroundStyle(.secondary)
                                Text(model.blurNumbers && key == "dosageText" ? "••••" : value.string).textSelection(.enabled)
                            }
                        } else {
                            LabeledContent(VaultValue.label(key), value: value.string)
                        }
                    }
                    if kind == "allergies" {
                        if row["reactions"].array.isEmpty {
                            Text("No reactions recorded")
                        }
                        ForEach(Array(row["reactions"].array.enumerated()), id: \.offset) { _, reaction in Text(reaction.string) }
                    }
                }
            }
            if kind == "conditions", history.count > 1 {
                Section("Related condition records") {
                    ForEach(Array(history.enumerated()), id: \.offset) { _, related in
                        NavigationLink { NativeClinicalRecordView(row: related, kind: kind) } label: { NativeClinicalRecordLabel(row: related, kind: kind) }
                    }
                }
            }
            NavigationLink("All source fields") { List { NativeValueSections(value: row) }.navigationTitle("Source record") }
        }.vaultDashboard(color: .teal).tint(.teal).navigationTitle(row["name"].string)
    }
}

struct NativeClinicalPanelView: View {
    let panel: VaultValue
    let tests: [VaultValue]
    private var results: [VaultValue] {
        let ids = Set(panel["resultIds"].array.map(\.string))
        return tests.flatMap { $0["points"].array }.filter { ids.contains($0["id"].string) }
    }

    var body: some View {
        List {
            Section("Panel") { NativeValueSections(value: panel, excluded: ["resultIds"]) }
            Section("Linked results") {
                ForEach(Array(results.enumerated()), id: \.offset) { _, row in
                    NavigationLink { NativeClinicalRecordView(row: row, kind: "lab") } label: { NativeClinicalRecordLabel(row: row, kind: "lab") }
                        .accessibilityIdentifier("clinicalPanelResult-" + row["id"].string)
                }
                let missing = panel["resultIds"].array.count - results.count
                if missing > 0 {
                    Text("\(missing) linked results are unavailable in the parsed tests.").foregroundStyle(.secondary)
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).navigationTitle(panel["name"].string)
    }
}
