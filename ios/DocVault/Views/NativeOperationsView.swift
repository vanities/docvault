import SwiftUI

struct NativeOperationsView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    @State private var jobs: VaultValue = .null
    @State private var status: VaultValue = .null
    @State private var cache: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""
    @State private var issues = false
    @State private var section = "Overview"
    @State private var creating = false
    @State private var generation = UUID()
    private let color = Color.cyan
    private var report: NativeJobs {
        .init(value: jobs)
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: resource.id == "jobs" ? "See what your automations actually did" : "A clear view of your server", subtitle: "Review attempts, clean completions, retries and recorded diagnostics.", symbol: "waveform.path.ecg", color: color, eyebrow: "MANAGE / OPERATIONS").vaultStandaloneRow().id("operationsTop")
                if loading {
                    ProgressView("Refreshing operations…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                if !jobs.isEmpty {
                    if section == "Overview" {
                        overview
                    } else {
                        Button { issues.toggle() } label: { Label(issues ? "Show all jobs" : "Only warnings and failures", systemImage: issues ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle") }.accessibilityValue(issues ? "On" : "Off").accessibilityIdentifier("operationsIssues")
                        ForEach(report.filtered(search, issues: issues)) { job in
                            NavigationLink { NativeJobDetailView(job: job) } label: { NativeJobCard(job: job) }.vaultStandaloneRow().accessibilityIdentifier("operationsJob-" + job.value["id"].string)
                        }
                        ForEach(Array(report.invalid.enumerated()), id: \.offset) { _, row in
                            VStack(alignment: .leading, spacing: 8) {
                                Label("Invalid manifest", systemImage: "exclamationmark.triangle.fill").font(.headline).foregroundStyle(.orange)
                                Text(row["path"].string).font(.caption).textSelection(.enabled)
                                Text(row["error"].string).fixedSize(horizontal: false, vertical: true)
                            }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .orange).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("operationsCard-operationsInvalidManifest")
                        }
                        if report.filtered(search, issues: issues).isEmpty, report.invalid.isEmpty {
                            ContentUnavailableView("No matching jobs", systemImage: "gearshape.2", description: Text("Adjust your search or issue filter."))
                        }
                        Button("Create custom job", systemImage: "plus.circle") { creating = true }.accessibilityIdentifier("operationsCreate")
                    }
                }
            }.vaultDashboard(color: color).tint(color).accessibilityIdentifier("nativeOperations")
                .searchable(text: $search, prompt: "Find a job, error or tag")
                .onChange(of: search) {
                    _, text in if !text.isEmpty {
                        section = "Jobs"
                    }
                }
                .onChange(of: section) { _, _ in proxy.scrollTo("operationsTop", anchor: .top) }
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Menu { Button("Overview") { section = "Overview" }; Button("Jobs") { section = "Jobs" } } label: { Image(systemName: "chart.bar.doc.horizontal") }.accessibilityLabel("Operations, " + section).accessibilityIdentifier("operationsReview") } }
                .task(id: model.revision) { await load() }.refreshable { await load() }
                .task(id: report.running > 0) {
                    guard report.running > 0 else { return }
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(5)) } catch { return }; await load()
                    }
                }
                .sheet(isPresented: $creating) { NativeJobEditor(original: .null) { model.revision += 1 }.privacyProtected() }
        }
    }

    @ViewBuilder
    private var overview: some View {
        VaultMetricGrid(metrics: [
            .init(title: "Jobs", value: String(report.jobs.count + report.invalid.count), symbol: "gearshape.2"),
            .init(title: "Enabled", value: String(report.jobs.filter { $0.value["enabled"].boolean }.count), symbol: "power"),
            .init(title: "Running", value: String(report.running), symbol: "arrow.triangle.2.circlepath"),
            .init(title: "Needs attention", value: String(report.attention), symbol: "exclamationmark.triangle"),
            .init(title: "Recorded success", value: String(report.jobs.filter { !$0.status["lastSuccessAt"].string.isEmpty }.count), symbol: "checkmark.circle"),
            .init(title: "Invalid manifests", value: String(report.invalid.count), symbol: "doc.badge.ellipsis"),
        ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("operationsMetrics")
        Text("An enabled job has permission to run. It does not prove a successful collection or delivery. Counts include disabled jobs and each job’s latest saved status.").font(.caption).foregroundStyle(.secondary)
        VaultAmountChart(title: "Latest job outcomes", subtitle: "One current status per job", amounts: report.outcomes, color: color, identifier: "operationsOutcomeChart", cardPrefix: "operationsCard-", unit: .number("jobs")).vaultStandaloneRow()
        VaultAmountChart(title: "Job schedules", subtitle: "Configured cadence, including disabled jobs", amounts: NativeOperations.groups(report.jobs.map(\.value)) { $0["schedule"].string }, color: color, identifier: "operationsScheduleChart", cardPrefix: "operationsCard-", unit: .number("jobs")).vaultStandaloneRow()
        if resource.id != "jobs" {
            VStack(alignment: .leading, spacing: 16) {
                Label("Server access", systemImage: "server.rack").font(.headline)
                LabeledContent("Data directory", value: status["ok"].boolean && status["isDirectory"].boolean ? "Accessible" : "Unavailable")
                LabeledContent("Authenticated", value: status["authenticated"].isEmpty ? "Unavailable" : status["authenticated"].string)
                LabeledContent("Entities", value: String(status["entities"].array.count))
                if !status["error"].string.isEmpty {
                    ErrorNotice(message: status["error"].string)
                }
                Text("This checks the data directory and current session. Disk capacity and provider health are not reported by this endpoint.").font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("operationsCard-operationsServerAccess")
            VStack(alignment: .leading, spacing: 16) {
                Label("Saved balance caches", systemImage: "clock.arrow.circlepath").font(.headline)
                ForEach([("bankLastUpdated", "Banks"), ("brokerLastUpdated", "Brokerages"), ("cryptoLastUpdated", "Crypto")], id: \.0) { key, title in
                    LabeledContent(title, value: NativeOperations.timestamp(cache[key]))
                }
                Text("Timestamps describe cached data. Refresh a connection from its feature to verify the provider.").font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("operationsCard-operationsCacheStatus")
        }
        Button("Browse jobs and run history", systemImage: "clock") { section = "Jobs" }.accessibilityIdentifier("operationsBrowse")
        ForEach(["schedules", "logs", "usage"], id: \.self) { id in
            if let target = NativeCatalog.features.first(where: { $0.id == "settings" })?.resources.first(where: { $0.id == id }) {
                NavigationLink(target.title) {
                    if id == "logs" {
                        NativeLogsView()
                    } else if id == "usage" {
                        NativeUsageView()
                    } else {
                        NativeResourceView(resource: target, scope: .init())
                    }
                }
            }
        }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            async let fetchedJobs = model.nativeRequest("api/jobs", scope: .init())
            async let fetchedStatus = model.nativeRequest("api/status", scope: .init())
            async let fetchedCache = model.nativeRequest("api/cache-status", scope: .init())
            let values = try await (fetchedJobs, fetchedStatus, fetchedCache)
            guard generation == id, !Task.isCancelled else { return }; jobs = values.0; status = values.1; cache = values.2
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeJobCard: View {
    let job: NativeJob
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(job.title).font(.system(.title3, design: .rounded, weight: .bold))
            Text((job.builtIn ? "Built-in" : "Custom") + " · " + (job.value["enabled"].boolean ? "Enabled" : "Disabled") + " · " + job.value["schedule"].string).font(.caption).foregroundStyle(.secondary)
            Label(NativeOperations.outcome(job.status), systemImage: NativeOperations.attention(job.status) ? "exclamationmark.triangle" : job.status["running"].boolean ? "arrow.triangle.2.circlepath" : "clock").font(.subheadline.weight(.semibold)).foregroundStyle(NativeOperations.attention(job.status) ? .orange : .cyan)
            Text("Last attempt · " + NativeOperations.timestamp(job.status["lastRanAt"])).font(.caption).foregroundStyle(.secondary)
            if !job.status["lastError"].string.isEmpty {
                Text(job.status["lastError"].string).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            } else if !job.status["lastWarning"].string.isEmpty {
                Text(job.status["lastWarning"].string).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: NativeOperations.attention(job.status) ? .orange : .cyan)
    }
}

struct NativeJobDetailView: View {
    @Environment(VaultModel.self) private var model
    let job: NativeJob
    @State private var fresh: NativeJob?
    @State private var runs: [VaultValue] = []
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var editing = false
    @State private var confirming = false
    @State private var result: VaultValue = .null
    @State private var generation = UUID()
    private var current: NativeJob {
        fresh ?? job
    }

    var body: some View {
        List {
            NativeJobCard(job: current).vaultStandaloneRow()
            if loading {
                ProgressView("Loading run history…")
            }
            if busy {
                ProgressView("Waiting for the server result…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            VStack(alignment: .leading, spacing: 16) {
                Text("Latest saved status").font(.headline)
                ForEach([("lastRanAt", "Last attempt"), ("lastSuccessAt", "Last successful completion"), ("lastCleanSuccessAt", "Last clean success"), ("nextRetryAt", "Next retry")], id: \.0) { key, title in LabeledContent(title, value: NativeOperations.timestamp(current.status[key])).accessibilityIdentifier("operationsStatus-" + key) }
                LabeledContent("Duration", value: NativeOperations.duration(current.status["lastDurationMs"]))
                if let count = NativeOperations.number(current.status["consecutiveFailures"]) {
                    LabeledContent("Incomplete runs in a row", value: count.formatted())
                }
                NativeCollectionCounts(value: current.status["lastCollection"])
                if !current.status["lastAttemptSummary"].string.isEmpty {
                    Text(current.status["lastAttemptSummary"].string).textSelection(.enabled)
                }
                if !current.status["lastSummary"].string.isEmpty {
                    LabeledContent("Last successful summary") { Text(current.status["lastSummary"].string).textSelection(.enabled) }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .cyan).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("operationsCard-operationsLatestStatus")
            if !current.builtIn {
                Section("Custom job") {
                    LabeledContent("Script", value: current.value["script"].string)
                    if !current.value["tags"].array.isEmpty {
                        Text(current.value["tags"].array.map(\.string).joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    }
                    Button("Edit job", systemImage: "square.and.pencil") { editing = true }.disabled(busy || loading).accessibilityIdentifier("operationsEdit")
                    Button("Run job…", systemImage: "play.circle") { confirming = true }.disabled(busy || loading || current.status["running"].boolean).accessibilityIdentifier("operationsRun")
                        .confirmationDialog("Run this job on the server?", isPresented: $confirming, titleVisibility: .visible) {
                            Button("Run now") { Task { await run(dry: false) } }.accessibilityIdentifier("operationsConfirmRun")
                            Button("Request dry run") { Task { await run(dry: true) } }.accessibilityIdentifier("operationsConfirmDryRun")
                            Button("Cancel", role: .cancel) {}
                        } message: { Text("The server executes the saved script. A dry run passes flags to the script; its behavior depends on the script.") }
                }
            } else if !current.value["description"].string.isEmpty {
                Text(current.value["description"].string).foregroundStyle(.secondary)
            }
            if !result.isEmpty {
                Text("Manual attempt result").font(.headline)
                NativeRunDetails(run: result)
            }
            VaultAmountChart(title: "Recent run outcomes", subtitle: "Up to 20 recorded attempts, including dry runs", amounts: NativeOperations.groups(runs, key: NativeOperations.runOutcome), color: .cyan, identifier: "operationsHistoryChart", cardPrefix: "operationsCard-", unit: .number("runs")).vaultStandaloneRow()
            Section("Run history") {
                Text("Recorded attempts retain warnings even when a later run succeeds.").font(.caption).foregroundStyle(.secondary)
                if !loading, runs.isEmpty {
                    Text("No recorded runs yet.").foregroundStyle(.secondary)
                }
                ForEach(Array(runs.enumerated()), id: \.offset) { _, row in
                    NavigationLink { List { NativeRunDetails(run: row) }.vaultDashboard(color: .cyan).navigationTitle("Run details").navigationBarTitleDisplayMode(.inline) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(NativeOperations.runOutcome(row)).font(.headline); Text(NativeOperations.timestamp(row["startedAt"]) + " · " + NativeOperations.duration(row["durationMs"])).font(.caption).foregroundStyle(.secondary); if row["dryRun"].boolean {
                                Text("Dry run").font(.caption).foregroundStyle(.cyan)
                            }
                        }
                    }.accessibilityIdentifier("operationsRun-" + row["runId"].string)
                }
            }
        }.vaultDashboard(color: .cyan).navigationTitle(current.title).navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeJobDetail")
            .task(id: model.revision) { await load() }.refreshable { await load() }
            .task(id: busy || current.status["running"].boolean) {
                guard busy || current.status["running"].boolean else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }; await load()
                }
            }
            .sheet(isPresented: $editing) { NativeJobEditor(original: current.value) { model.revision += 1 }.privacyProtected() }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            async let list = model.nativeRequest("api/jobs", scope: .init())
            async let history = model.nativeRequest(NativeOperations.historyPath(job), scope: .init(), record: job.value)
            let values = try await (list, history)
            guard generation == id, !Task.isCancelled else { return }
            guard let updated = NativeJobs(value: values.0).jobs.first(where: { $0.id == job.id }) else { throw VaultError.server("This job is no longer available. Refresh the job list.") }
            fresh = updated; runs = values.1["runs"].array
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }

    private func run(dry: Bool) async {
        guard !current.builtIn, !busy else { return }; busy = true; error = nil; result = .null
        defer { busy = false }
        do {
            let value = try await model.nativeRequest("api/jobs/{id}/run" + (dry ? "?dryRun=true" : ""), scope: .init(), record: current.value, method: "POST")
            guard !Task.isCancelled else { return }
            guard value["ok"].boolean, !value["result"].isEmpty else { throw VaultError.server(value["error"].string.isEmpty ? "The server did not return a job result." : value["error"].string) }
            result = value["result"]; await load(); model.revision += 1
        } catch {
            if !Task.isCancelled {
                let message = error.localizedDescription
                await load()
                self.error = message
            }
        }
    }
}

struct NativeCollectionCounts: View {
    let value: VaultValue
    var body: some View {
        if !value.isEmpty {
            ForEach(["collected", "failed", "skipped"], id: \.self) { key in LabeledContent(VaultValue.label(key), value: NativeOperations.number(value[key]).map { $0.formatted() } ?? "Unavailable") }
        }
    }
}

struct NativeRunDetails: View {
    let run: VaultValue
    var body: some View {
        Section("Recorded result") {
            Text(NativeOperations.runOutcome(run)).font(.headline).foregroundStyle(run["outcome"].string == "success" ? .cyan : .orange)
            if run["dryRun"].boolean {
                Text("Dry run").font(.subheadline.weight(.semibold))
            }
            LabeledContent("Started", value: NativeOperations.timestamp(run["startedAt"]))
            LabeledContent("Finished", value: NativeOperations.timestamp(run["finishedAt"]))
            LabeledContent("Duration", value: NativeOperations.duration(run["durationMs"]))
            LabeledContent("Warning/error events", value: NativeOperations.number(run["warningCount"]).map { $0.formatted() } ?? "Unavailable")
            if !run["exitCode"].isEmpty {
                LabeledContent("Exit code", value: run["exitCode"].string)
            }
            NativeCollectionCounts(value: run["collection"])
            if !run["error"].string.isEmpty {
                ErrorNotice(message: run["error"].string)
            }
        }
        Section("Diagnostics") {
            ForEach(Array(run["diagnostics"].array.enumerated()), id: \.offset) { _, entry in NativeLogRow(entry: entry) }
            if run["diagnostics"].array.isEmpty {
                Text("No diagnostic events recorded.").foregroundStyle(.secondary)
            }
        }
        ForEach([("stderr", "Collector warnings and errors"), ("stdout", "Collector output")], id: \.0) { key, title in
            if !run[key].string.isEmpty {
                Section(title) { Text(run[key].string).font(.system(.callout, design: .monospaced)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true); ShareLink("Share " + title.lowercased(), item: run[key].string) }
            }
        }
    }
}

struct NativeJobEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let original: VaultValue
    let changed: () -> Void
    @State private var value: VaultValue
    @State private var script = ""
    @State private var tags: String
    @State private var busy = false
    @State private var error: String?
    @State private var discard = false
    @State private var saved: VaultValue = .null
    init(original: VaultValue, changed: @escaping () -> Void) {
        self.original = original; self.changed = changed
        _value = State(initialValue: original.isEmpty ? Self.blank : NativeOperations.manifest(original))
        _tags = State(initialValue: original["tags"].array.map(\.string).joined(separator: ", "))
    }

    private static var blank: VaultValue {
        .object(["id": .string(""), "label": .string(""), "kind": .string("local-script"), "schedule": .string("daily"), "script": .string("scripts/example.local.ts"), "enabled": .bool(false), "tags": .array([])])
    }

    private var bodyValue: VaultValue {
        var row = value; row.set("tags", .array(tags.split(separator: ",").map { .string($0.trimmingCharacters(in: .whitespacesAndNewlines)) }.filter { !$0.string.isEmpty }))
        if !script.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            row.set("scriptContent", .string(script))
        }; return row
    }

    private var dirty: Bool {
        bodyValue != (original.isEmpty ? Self.blank : NativeOperations.manifest(original))
    }

    private func binding(_ key: String) -> Binding<String> {
        .init(get: { value[key].string }, set: { value.set(key, .string($0)) })
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error)
                }
                if !saved.isEmpty {
                    Section("Saved on the server") {
                        Text(saved["scriptStatus"]["runnable"].boolean ? "Job saved; its script is runnable." : "Job saved; the script still needs attention.").font(.headline)
                        Text(saved["scriptStatus"]["message"].string).fixedSize(horizontal: false, vertical: true)
                        Button("Done") { dismiss() }.accessibilityIdentifier("jobSavedDone")
                    }
                }
                Section("Job") {
                    VStack(alignment: .leading) { Text("Job ID").font(.caption).foregroundStyle(.secondary); TextField("Job ID", text: binding("id")).textInputAutocapitalization(.never).autocorrectionDisabled().disabled(!original.isEmpty).accessibilityIdentifier("jobID") }
                    VStack(alignment: .leading) { Text("Name").font(.caption).foregroundStyle(.secondary); TextField("Name", text: binding("label")).accessibilityIdentifier("jobName") }
                    VStack(alignment: .leading) { Text("Schedule").font(.caption).foregroundStyle(.secondary); TextField("Schedule", text: binding("schedule")).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("jobSchedule") }
                    Text("hourly, daily or every Nh").font(.caption).foregroundStyle(.secondary)
                    Toggle("Enabled", isOn: .init(get: { value["enabled"].boolean }, set: { value.set("enabled", .bool($0)) })).accessibilityIdentifier("jobEnabled")
                    VStack(alignment: .leading) { Text("Tags").font(.caption).foregroundStyle(.secondary); TextField("Tags, separated by commas", text: $tags) }
                }.disabled(busy || !saved.isEmpty)
                Section("Server script") {
                    VStack(alignment: .leading) { Text("Script path").font(.caption).foregroundStyle(.secondary); TextField("Script path", text: binding("script")).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("jobScriptPath") }
                    Text("Use scripts/name.local.js, .local.ts or .local.sh. This path is relative to the server’s jobs directory.").font(.caption).foregroundStyle(.secondary)
                    Text("Optional replacement script").font(.caption.weight(.semibold))
                    TextEditor(text: $script).font(.system(.body, design: .monospaced)).frame(minHeight: 180).accessibilityIdentifier("jobScriptContent")
                    Text("Leave replacement content empty to keep an existing script. Enabling the job allows the server to run it automatically.").font(.caption).foregroundStyle(.secondary)
                }.disabled(busy || !saved.isEmpty)
                if busy {
                    ProgressView("Saving job…")
                }
            }.navigationTitle(original.isEmpty ? "Create custom job" : "Edit custom job").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(saved.isEmpty ? "Cancel" : "Done") {
                        if dirty, saved.isEmpty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(busy || !saved.isEmpty || NativeOperations.validateManifest(bodyValue) != nil).accessibilityIdentifier("jobSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("nativeFormKeyboardDone") }
                }
                .interactiveDismissDisabled((dirty && saved.isEmpty) || busy)
                .confirmationDialog("Discard changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() }; Button("Keep editing", role: .cancel) {} }
        }
    }

    private func save() async {
        guard !busy else { return }
        if let message = NativeOperations.validateManifest(bodyValue) {
            error = message; return
        }
        busy = true; error = nil; defer { busy = false }
        do {
            if !original.isEmpty {
                let fresh = NativeJobs(value: try await model.nativeRequest("api/jobs", scope: .init())).jobs.first { !$0.builtIn && $0.value["id"] == original["id"] }
                guard let fresh, NativeOperations.manifest(fresh.value) == NativeOperations.manifest(original) else { throw VaultError.server("This job changed on the server. Close and reload it before saving.") }
            }
            let result = try await model.nativeRequest("api/jobs" + (original.isEmpty ? "" : "?overwrite=true"), scope: .init(), method: "POST", body: bodyValue)
            guard !Task.isCancelled else { return }; guard result["ok"].boolean else { throw VaultError.server(result["error"].string) }; changed()
            if result["scriptStatus"]["runnable"] == .bool(false) {
                saved = result
            } else {
                dismiss()
            }
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}
