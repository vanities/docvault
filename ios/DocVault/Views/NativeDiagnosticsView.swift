import SwiftUI

struct NativeLogRow: View {
    let entry: VaultValue
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(entry["level"].string.uppercased() + " · " + entry["namespace"].string).font(.caption.weight(.semibold)).foregroundStyle(["warn", "error"].contains(entry["level"].string) ? .orange : .cyan)
            Text(NativeOperations.timestamp(entry["ts"])).font(.caption).foregroundStyle(.secondary)
            Text(entry["message"].string).font(.system(.callout, design: .monospaced)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 5)
    }
}

struct NativeLogsView: View {
    @Environment(VaultModel.self) private var model
    @State private var value: VaultValue = .null
    @State private var dates: [String] = []
    @State private var date = ""
    @State private var level = "All"
    @State private var namespace = "All"
    @State private var limit = 200
    @State private var search = ""
    @State private var filters = false
    @State private var section = "Overview"
    @State private var loading = false
    @State private var error: String?
    @State private var generation = UUID()
    private var entries: [VaultValue] {
        value["entries"].array
    }

    private var namespaces: [String] {
        Array(Set(entries.map { $0["namespace"].string })).sorted()
    }

    private var filtered: [VaultValue] {
        entries.filter { (level == "All" || $0["level"].string == level.lowercased()) && (namespace == "All" || $0["namespace"].string == namespace) && (search.isEmpty || NativeOperations.logLine($0).localizedCaseInsensitiveContains(search)) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: "Follow the trail behind an outcome", subtitle: "Browse the current process or a saved day, then narrow the diagnostic events.", symbol: "text.alignleft", color: .cyan, eyebrow: "MANAGE / LOGS").vaultStandaloneRow().id("logsTop")
                Button("Filters · " + (date.isEmpty ? "Current process" : date), systemImage: "line.3.horizontal.decrease") { filters = true }.accessibilityIdentifier("logsFilters")
                if loading {
                    ProgressView("Loading logs…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                if !value.isEmpty {
                    Text((value["source"].string == "disk" ? "Saved day · " + value["date"].string : "Current process buffer") + " · \(entries.count) loaded · limit \(limit)").font(.caption).foregroundStyle(.secondary)
                    if section == "Overview" {
                        VaultMetricGrid(metrics: [
                            .init(title: "Loaded events", value: String(entries.count), symbol: "text.alignleft"),
                            .init(title: "Warnings", value: String(entries.filter { $0["level"].string == "warn" }.count), symbol: "exclamationmark.triangle"),
                            .init(title: "Errors", value: String(entries.filter { $0["level"].string == "error" }.count), symbol: "xmark.circle"),
                            .init(title: "Namespaces", value: String(namespaces.count), symbol: "square.stack.3d.up"),
                        ], color: .cyan).vaultStandaloneRow().accessibilityIdentifier("logsMetrics")
                        VaultAmountChart(title: "Event levels", subtitle: "Loaded events before search and filters", amounts: NativeOperations.groups(entries) { $0["level"].string.capitalized }, color: .cyan, identifier: "logsLevelChart", cardPrefix: "operationsCard-", unit: .number("events")).vaultStandaloneRow()
                        VaultAmountChart(title: "Event namespaces", subtitle: "Loaded events before search and filters", amounts: NativeOperations.groups(entries) { $0["namespace"].string }, color: .cyan, identifier: "logsNamespaceChart", cardPrefix: "operationsCard-", unit: .number("events")).vaultStandaloneRow()
                        Button("Read events", systemImage: "text.magnifyingglass") { section = "Events" }.accessibilityIdentifier("logsReadEvents")
                    } else {
                        Text("\(filtered.count) matching events").font(.caption).foregroundStyle(.secondary)
                        if !filtered.isEmpty {
                            ShareLink("Share matching logs", item: filtered.map(NativeOperations.logLine).joined(separator: "\n")).accessibilityIdentifier("logsShare")
                        }
                        ForEach(Array(filtered.enumerated()), id: \.offset) { _, entry in NativeLogRow(entry: entry) }
                        if filtered.isEmpty {
                            ContentUnavailableView("No matching events", systemImage: "text.magnifyingglass", description: Text(entries.isEmpty ? "No events were returned for this source." : "Adjust your search or filters."))
                        }
                    }
                }
            }.vaultDashboard(color: .cyan).navigationTitle("Logs").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeLogs")
                .searchable(text: $search, prompt: "Find a message or namespace")
                .onChange(of: search) {
                    _, text in if !text.isEmpty {
                        section = "Events"
                    }
                }
                .onChange(of: section) { _, _ in proxy.scrollTo("logsTop", anchor: .top) }
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Menu { Button("Overview") { section = "Overview" }; Button("Events") { section = "Events" } } label: { Image(systemName: "text.justify.leading") }.accessibilityLabel("Logs, " + section).accessibilityIdentifier("logsReview") } }
                .task(id: date + ":" + String(limit)) { await load() }.refreshable { await load() }
                .sheet(isPresented: $filters) {
                    NavigationStack {
                        Form {
                            Picker("Source", selection: $date) { Text("Current process").tag(""); ForEach(dates, id: \.self) { Text($0).tag($0) } }.pickerStyle(.navigationLink).accessibilityIdentifier("logsSource")
                            Picker("Load limit", selection: $limit) { ForEach([100, 200, 500, 1000], id: \.self) { Text(String($0)).tag($0) } }.pickerStyle(.navigationLink)
                            Picker("Level", selection: $level) { ForEach(["All", "Info", "Warn", "Error", "Debug"], id: \.self) { Text($0).tag($0) } }.pickerStyle(.navigationLink).accessibilityIdentifier("logsLevel")
                            Picker("Namespace", selection: $namespace) { Text("All").tag("All"); ForEach(namespaces, id: \.self) { Text($0).tag($0) } }.pickerStyle(.navigationLink)
                            Button("Clear event filters") { search = ""; level = "All"; namespace = "All" }
                            Text("Charts use the loaded events. A limit can omit older events; current-process logs disappear when the server restarts.").font(.caption).foregroundStyle(.secondary)
                        }.navigationTitle("Log filters").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { filters = false }.accessibilityIdentifier("logsCloseFilters") } }
                    }.privacyProtected()
                }
        }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil; value = .null
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            async let days = model.nativeRequest("api/logs?dates=1", scope: .init())
            async let events = model.nativeRequest("api/logs?limit=\(limit)" + (date.isEmpty ? "" : "&date=" + date), scope: .init())
            let values = try await (days, events)
            guard generation == id, !Task.isCancelled else { return }; value = values.1; dates = values.0["dates"].array.map(\.string).filter { $0.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil }
            if namespace != "All", !namespaces.contains(namespace) {
                namespace = "All"
            }
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeUsageView: View {
    @Environment(VaultModel.self) private var model
    @State private var value: VaultValue = .null
    @State private var error: String?
    @State private var loading = false
    @State private var search = ""
    @State private var section = "Overview"
    @State private var filter = "All"
    @State private var generation = UUID()
    private var report: NativeUsage {
        .init(value: value)
    }

    private var filtered: [VaultValue] {
        report.entries.filter { (search.isEmpty || $0.stringSearch.localizedCaseInsensitiveContains(search)) && (filter == "All" || (filter == "Failed" ? $0["ok"] == .bool(false) : NativeOperations.number($0["cost"]["total"]) == nil)) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: "Understand your assistant’s API activity", subtitle: "Separate the complete log summary from recent call details and known prices.", symbol: "sparkles", color: .cyan, eyebrow: "MANAGE / AI USAGE").vaultStandaloneRow().id("usageTop")
                if loading {
                    ProgressView("Loading usage…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                if !value.isEmpty {
                    if section == "Overview" {
                        VaultMetricGrid(metrics: [
                            .init(title: "Recorded calls", value: display(report.summary["totalCalls"]), symbol: "sparkles"),
                            .init(title: "Failed calls", value: display(report.summary["failedCalls"]), symbol: "exclamationmark.triangle"),
                            .init(title: "Input tokens", value: display(report.summary["totalInputTokens"]), symbol: "arrow.down"),
                            .init(title: "Output tokens", value: display(report.summary["totalOutputTokens"]), symbol: "arrow.up"),
                            .init(title: "Priced cost subtotal", value: NativeOperations.number(report.summary["totalCostUsd"]).map { $0.formatted(.currency(code: "USD").precision(.fractionLength(4))) } ?? "Unavailable", symbol: "dollarsign.circle"),
                            .init(title: "Recent unpriced calls", value: String(report.unpriced), symbol: "questionmark.circle"),
                        ], color: .cyan).vaultStandaloneRow().accessibilityIdentifier("usageMetrics")
                        Text("Summary covers the persisted Claude API usage log, including failed calls. Costs exclude unknown prices; this is a priced subtotal, not a provider invoice or all agent activity.").font(.caption).foregroundStyle(.secondary)
                        Section("Log coverage") {
                            LabeledContent("First recorded call", value: NativeOperations.timestamp(report.summary["firstTs"]))
                            LabeledContent("Latest recorded call", value: NativeOperations.timestamp(report.summary["lastTs"]))
                            LabeledContent("Cache write tokens", value: display(report.summary["totalCacheWriteTokens"]))
                            LabeledContent("Cache read tokens", value: display(report.summary["totalCacheReadTokens"]))
                        }
                        VaultAmountChart(title: "Calls by model", subtitle: "Complete persisted log summary", amounts: report.summaryGroups("byModel"), color: .cyan, identifier: "usageModelChart", cardPrefix: "operationsCard-", unit: .number("calls")).vaultStandaloneRow()
                        VaultAmountChart(title: "Calls by purpose", subtitle: "Complete persisted log summary", amounts: report.summaryGroups("byPurpose"), color: .cyan, identifier: "usagePurposeChart", cardPrefix: "operationsCard-", unit: .number("calls")).vaultStandaloneRow()
                        VaultAmountChart(title: "Recent daily priced costs", subtitle: "Up to 1,000 recent calls · UTC dates · unknown prices excluded", amounts: report.dailyCosts, color: .cyan, identifier: "usageDailyChart", cardPrefix: "operationsCard-", unit: .moneyPrecision(4), preserveOrder: true).vaultStandaloneRow()
                        Section("Recent call sample") {
                            LabeledContent("Loaded", value: String(report.entries.count))
                            LabeledContent("Priced subtotal", value: report.pricedSubtotal.map { $0.formatted(.currency(code: "USD").precision(.fractionLength(4))) } ?? "Unavailable")
                            LabeledContent("Unpriced calls", value: String(report.unpriced))
                            LabeledContent("Median latency", value: report.medianLatency.map { NativeOperations.duration(.number($0)) } ?? "Unavailable")
                            Button("Browse recent calls", systemImage: "clock") { section = "Calls" }.accessibilityIdentifier("usageBrowse")
                        }
                    } else {
                        Picker("Calls", selection: $filter) { ForEach(["All", "Failed", "Unpriced"], id: \.self) { Text($0) } }.pickerStyle(.menu).accessibilityIdentifier("usageFilter")
                        Text("\(filtered.count) matching calls from \(report.entries.count) loaded, newest first.").font(.caption).foregroundStyle(.secondary)
                        ForEach(Array(filtered.enumerated()), id: \.offset) { index, entry in
                            NavigationLink { List { NativeUsageDetails(entry: entry) }.vaultDashboard(color: .cyan).navigationTitle("API call").navigationBarTitleDisplayMode(.inline) } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(entry["purpose"].string).font(.headline)
                                    Text(entry["model"].string).font(.caption).foregroundStyle(.secondary)
                                    Text(NativeOperations.timestamp(entry["ts"])).font(.caption).foregroundStyle(.secondary)
                                    Text((entry["ok"] == .bool(true) ? "Succeeded" : entry["ok"] == .bool(false) ? "Failed" : "Outcome unavailable") + " · " + (NativeOperations.number(entry["cost"]["total"]).map { $0.formatted(.currency(code: "USD").precision(.fractionLength(4))) } ?? "Unpriced")).font(.subheadline).foregroundStyle(entry["ok"] == .bool(false) ? .orange : .cyan)
                                }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .cyan)
                            }.vaultStandaloneRow().accessibilityIdentifier("usageCall-\(index)")
                        }
                        if filtered.isEmpty {
                            ContentUnavailableView("No matching calls", systemImage: "sparkles", description: Text("Adjust your search or call filter."))
                        }
                    }
                }
            }.vaultDashboard(color: .cyan).navigationTitle("AI Usage").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeUsage")
                .searchable(text: $search, prompt: "Find a model, purpose or error")
                .onChange(of: search) {
                    _, text in if !text.isEmpty {
                        section = "Calls"
                    }
                }
                .onChange(of: section) { _, _ in proxy.scrollTo("usageTop", anchor: .top) }
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Menu { Button("Overview") { section = "Overview" }; Button("Calls") { section = "Calls" } } label: { Image(systemName: "sparkle.magnifyingglass") }.accessibilityLabel("Usage, " + section).accessibilityIdentifier("usageReview") } }
                .task { await load() }.refreshable { await load() }
        }
    }

    private func display(_ value: VaultValue) -> String {
        NativeOperations.number(value).map { $0.formatted(.number.precision(.fractionLength(0))) } ?? "Unavailable"
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do { let fetched = try await model.nativeRequest("api/ai-usage?limit=1000&summary=1", scope: .init()); guard generation == id, !Task.isCancelled else { return }; value = fetched }
        catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeUsageDetails: View {
    let entry: VaultValue
    var body: some View {
        Section("Call") {
            LabeledContent("Purpose", value: entry["purpose"].string)
            LabeledContent("Model", value: entry["model"].string)
            LabeledContent("Recorded", value: NativeOperations.timestamp(entry["ts"]))
            LabeledContent("Latency", value: NativeOperations.duration(entry["latencyMs"]))
            LabeledContent("Outcome", value: entry["ok"] == .bool(true) ? "Succeeded" : entry["ok"] == .bool(false) ? "Failed" : "Unavailable")
            if !entry["error"].string.isEmpty {
                ErrorNotice(message: entry["error"].string)
            }
            if !entry["stopReason"].string.isEmpty {
                LabeledContent("Stop reason", value: entry["stopReason"].string)
            }
            if !entry["requestId"].string.isEmpty {
                LabeledContent("Request ID", value: entry["requestId"].string).textSelection(.enabled)
            }
        }
        Section("Recorded tokens") {
            ForEach(entry["usage"].object.keys.sorted(), id: \.self) { key in LabeledContent(VaultValue.label(key), value: NativeOperations.number(entry["usage"][key]).map { $0.formatted() } ?? "Unavailable") }
        }
        Section("Recorded cost (USD)") {
            if entry["cost"].isEmpty {
                Text("Unpriced. The usage log does not have a price for this model.").foregroundStyle(.secondary)
            } else {
                ForEach(entry["cost"].object.keys.sorted(), id: \.self) { key in LabeledContent(VaultValue.label(key), value: NativeOperations.number(entry["cost"][key]).map { $0.formatted(.currency(code: "USD").precision(.fractionLength(6))) } ?? "Unavailable") }
            }
        }
    }
}
