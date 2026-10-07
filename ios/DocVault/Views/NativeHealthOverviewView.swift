import SwiftUI

struct NativeHealthPeopleView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    @State private var people: [VaultValue] = []
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        List {
            VaultHero(title: "Health", subtitle: "A personal view of activity, recovery and clinical history.", symbol: "heart.text.clipboard", color: .teal, eyebrow: "YOUR RECORDS").vaultStandaloneRow()
            Section("People") {
                if loading {
                    ProgressView("Loading people…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                ForEach(people, id: \.self) { person in
                    NavigationLink { NativeHealthOverviewView(person: person) } label: {
                        Label(person["name"].string, systemImage: "person.crop.circle").font(.headline).padding(.vertical, 8)
                    }
                    .accessibilityIdentifier("healthPerson-" + person["id"].string)
                }
                if people.isEmpty, !loading, error == nil {
                    Text("Add a person below, then import a Health export or set up sync.").foregroundStyle(.secondary)
                }
            }
            NavigationLink("Manage people, including archived") {
                NativeResourceView(resource: .init(id: "health-people-all", title: "People", path: "api/health/people?archived=true", collections: resource.collections), scope: .init())
            }
        }.vaultDashboard(color: .teal).tint(.teal).task { await load() }.refreshable { await load() }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await model.nativeRequest(resource.path, scope: .init())
            guard !Task.isCancelled else { return }
            people = result["people"].array.filter { $0["archivedAt"].string.isEmpty }
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeHealthOverviewView: View {
    @Environment(VaultModel.self) private var model
    let person: VaultValue
    @State private var response: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var showDismissed = false
    private var scope: VaultScope {
        .init(person: person["id"].string)
    }

    private var snapshot: VaultValue {
        response["snapshot"]
    }

    private func resource(_ id: String) -> NativeResource? {
        NativeCatalog.features.flatMap(\.resources).first { $0.id == id }
    }

    var body: some View {
        List {
            if loading {
                ProgressView("Loading health overview…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            VaultHero(title: person["name"].string, subtitle: "Explore your recorded activity, sleep, recovery and medical history.", symbol: "heart.text.clipboard", color: .teal, eyebrow: "HEALTH OVERVIEW").vaultStandaloneRow()
            Section("Health areas") {
                ForEach(["activity", "heart", "sleep", "workouts", "body"], id: \.self) { segment in
                    if let resource = resource("health-" + segment) {
                        NavigationLink { NativeHealthSegmentView(resource: resource, scope: scope) } label: {
                            HStack(spacing: 14) {
                                Image(systemName: VaultPalette.healthSymbol(segment)).font(.title3).foregroundStyle(.teal)
                                    .frame(width: 44, height: 44).background(.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(resource.title).font(.headline)
                                    if !snapshot.isEmpty, let stat = NativeHealth.stats(snapshot[segment], segment: segment).first {
                                        Text(model.blurNumbers ? "••••" : stat.title + ": " + stat.value).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }.padding(.vertical, 6)
                        }.accessibilityIdentifier("healthOverview-" + segment)
                    }
                }
                if let resource = resource("clinical") {
                    NavigationLink("Clinical records") { NativeClinicalView(resource: resource, scope: scope) }
                }
            }
            if !snapshot.isEmpty {
                ForEach([("activity", "recoveryScores", "Recovery"), ("sleep", "qualityScores", "Sleep quality")], id: \.0) { segment, key, title in
                    if let score = snapshot[segment][key].array.last {
                        Section {
                            VaultScoreCard(title: title, score: score).vaultStandaloneRow()
                        }
                    }
                }
                Section("Detected illness periods") {
                    Text("Periods flagged by the server from simultaneous changes in recorded metrics.").font(.caption).foregroundStyle(.secondary)
                    Toggle("Include dismissed periods", isOn: $showDismissed).accessibilityIdentifier("healthShowDismissed")
                    let periods = snapshot["illnessPeriods"].array.sorted { $0["startDate"].string > $1["startDate"].string }
                    let visible = periods.filter { showDismissed || !response["illnessNotes"][NativeHealth.illnessKey($0)]["dismissed"].boolean }
                    ForEach(Array(visible.enumerated()), id: \.offset) { _, period in
                        let key = NativeHealth.illnessKey(period)
                        NavigationLink {
                            NativeHealthIllnessView(period: period, scope: scope, initial: response["illnessNotes"][key]) { await load() }
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(period["startDate"].string + " – " + period["endDate"].string).font(.headline)
                                Text(period["confidence"].string + (response["illnessNotes"][key]["dismissed"].boolean ? " · dismissed" : "")).font(.caption).foregroundStyle(.secondary)
                                if !response["illnessNotes"][key]["note"].isEmpty {
                                    Text(response["illnessNotes"][key]["note"].string).font(.subheadline)
                                }
                            }
                        }.accessibilityIdentifier("healthIllness-" + key)
                    }
                    if visible.isEmpty {
                        Text("No visible detected periods").foregroundStyle(.secondary)
                    }
                }
                Section("Source") {
                    LabeledContent("Export", value: snapshot["sourceFilename"].string)
                    LabeledContent("Generated", value: snapshot["generatedAt"].string)
                    NavigationLink("Parsed export: all recorded metrics and workouts") {
                        NativeRecordView(record: .object(["filename": snapshot["sourceFilename"]]), collection: .init(id: "summary", title: "Parsed export", path: "", detailPath: "api/health/{person}/summary/{filename}"), resource: .init(id: "health-summary", title: "Parsed export", path: ""), scope: scope, changed: {})
                    }
                    if response["stale"].boolean {
                        Label("Reparse the export for updated parser results", systemImage: "clock.badge.exclamationmark")
                    }
                }
            }
            Section("Imports and sync") {
                if let resource = resource("health-exports") {
                    NavigationLink("Exports and parsing") { NativeResourceView(resource: resource, scope: scope) }
                }
                NavigationLink("Set up Health sync") { NativeHealthSyncView(scope: scope) }
                if let resource = resource("health-voice") {
                    NavigationLink("Voice profile") { NativeResourceView(resource: resource, scope: scope) }
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).navigationTitle(person["name"].string).task { await load() }.refreshable { await load() }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await model.nativeRequest("api/health/{person}/snapshot/all", scope: scope)
            guard !Task.isCancelled else { return }
            response = result
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeHealthIllnessView: View {
    @Environment(VaultModel.self) private var model
    let period: VaultValue
    let scope: VaultScope
    let initial: VaultValue
    let onSaved: () async -> Void
    @State private var note = ""
    @State private var dismissed = false
    @State private var saving = false
    @State private var saved = false
    @State private var error: String?
    var body: some View {
        Form {
            Section("Detected period") {
                Text(period["startDate"].string + " – " + period["endDate"].string)
                LabeledContent("Confidence", value: period["confidence"].string)
                LabeledContent("Duration", value: model.blurNumbers ? "••••" : NativeHealth.display(period["durationDays"], unit: "days"))
                LabeledContent("Peak simultaneous signals", value: model.blurNumbers ? "••••" : NativeHealth.display(period["peakSignals"]))
                ForEach(period["signals"].array, id: \.self) { Text($0.string) }
            }
            Section("Your note") {
                TextEditor(text: $note).frame(minHeight: 110).accessibilityIdentifier("healthIllnessNote")
                Button("Clear note") { note = "" }.disabled(note.isEmpty).accessibilityIdentifier("clearHealthIllnessNote")
                Toggle("Dismiss this period", isOn: $dismissed).accessibilityIdentifier("healthIllnessDismiss")
                Button(saving ? "Saving…" : "Save note and dismissal") { Task { await save() } }.disabled(saving).accessibilityIdentifier("saveHealthIllness")
                if saved {
                    Label("Saved", systemImage: "checkmark.circle").accessibilityIdentifier("healthIllnessSaved")
                }
                if let error {
                    ErrorNotice(message: error)
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).navigationTitle("Detected period").task { note = initial["note"].string; dismissed = initial["dismissed"].boolean }
            .onChange(of: note) { saved = false }.onChange(of: dismissed) { saved = false }
    }

    private func save() async {
        saving = true; saved = false; error = nil
        defer { saving = false }
        do {
            let record: VaultValue = .object(["key": .string(NativeHealth.illnessKey(period))])
            _ = try await model.nativeRequest("api/health/{person}/illness-notes/{key}", scope: scope, record: record, method: "PUT", body: .object(["note": .string(note), "dismissed": .bool(dismissed)]))
            guard !Task.isCancelled else { return }
            saved = true
            await onSaved()
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}
