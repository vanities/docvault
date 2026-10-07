import Charts
import SwiftUI

struct NativeEmailLogView: View {
    @Environment(VaultModel.self) private var model
    @State private var data: VaultValue = .null
    @State private var loading = true
    @State private var error: String?
    @State private var query = ""
    @State private var purpose = ""
    @State private var outcome = ""
    @State private var days = 0
    @State private var section = "Overview"
    @State private var selectedDay: Date?
    @State private var generation = UUID()
    private let color = Color.mint
    private var rows: [VaultValue] {
        NativeMail.filtered(data["entries"].array, query: query, purpose: purpose, outcome: outcome, days: days)
    }

    private var daily: [NativeMailDay] {
        NativeMail.daily(rows)
    }

    private var inspected: Date? {
        selectedDay.map { Calendar.current.startOfDay(for: $0) } ?? daily.last?.date
    }

    var body: some View {
        List {
            VaultHero(title: "Your sending history", subtitle: "Trace each saved attempt, recipient, attachment and provider result.", symbol: "envelope.open", color: color, eyebrow: "MANAGE / SENT MAIL").vaultStandaloneRow()
            if loading {
                ProgressView("Loading mail attempts…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !data.isEmpty {
                Text("Loaded \(data["entries"].array.count) recent attempts. The server retains up to 500. Accepted means the provider accepted the request; inbox delivery is not recorded here.").font(.caption).foregroundStyle(.secondary)
                if section == "Overview" {
                    VaultMetricGrid(metrics: [
                        .init(title: "Matching attempts", value: String(rows.count), symbol: "envelope"),
                        .init(title: "Provider accepted", value: String(rows.filter { NativeMailOutcome.of($0) == .accepted }.count), symbol: "checkmark.circle"),
                        .init(title: "Failed attempts", value: String(rows.filter { NativeMailOutcome.of($0) == .failed }.count), symbol: "exclamationmark.triangle"),
                        .init(title: "Attachment records", value: String(rows.reduce(0) { $0 + $1["attachments"].array.count }), symbol: "paperclip"),
                    ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("mailMetrics")
                    VaultAmountChart(title: "Recorded request outcomes", subtitle: "Counts for the current filters", amounts: NativeMailOutcome.allCases.compactMap { state in
                        let count = rows.filter { NativeMailOutcome.of($0) == state }.count
                        return count == 0 ? nil : .init(label: state.rawValue, amount: Double(count))
                    }, color: color, identifier: "mailOutcomeChart", cardPrefix: "mailCard-", unit: .number("attempts")).vaultStandaloneRow()
                    VaultAmountChart(title: "Mail purposes", subtitle: "Newsstand, client and test attempts", amounts: NativeOperations.groups(rows, key: NativeMail.purpose), color: color, identifier: "mailPurposeChart", cardPrefix: "mailCard-", unit: .number("attempts")).vaultStandaloneRow()
                    if !daily.isEmpty {
                        dailyChart.vaultStandaloneRow()
                    }
                    if let latency = NativeMail.medianLatency(rows) {
                        LabeledContent("Median send-request duration", value: NativeOperations.duration(.number(latency)))
                    }
                    Button("Browse matching attempts", systemImage: "list.bullet.rectangle") { section = "Attempts" }.accessibilityIdentifier("mailBrowseAttempts")
                } else {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        NavigationLink { NativeEmailAttemptView(row: row) } label: {
                            VStack(alignment: .leading, spacing: 9) {
                                Text(row["subject"].string.isEmpty ? "Untitled message" : row["subject"].string).font(.headline).fixedSize(horizontal: false, vertical: true)
                                Label(NativeMailOutcome.of(row).rawValue + " · " + NativeMail.purpose(row), systemImage: NativeMailOutcome.of(row) == .failed ? "exclamationmark.triangle" : "envelope").font(.subheadline).foregroundStyle(NativeMailOutcome.of(row) == .failed ? .orange : color)
                                Text(NativeOperations.timestamp(row["at"])).font(.caption).foregroundStyle(.secondary)
                                Text(row["to"].array.map(\.string).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                                if !row["error"].string.isEmpty {
                                    Text(row["error"].string).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                                }
                            }.padding(.vertical, 5)
                        }.accessibilityIdentifier("mailAttempt-" + row["id"].string)
                    }
                }
                if rows.isEmpty {
                    ContentUnavailableView(data["entries"].array.isEmpty ? "No saved mail attempts" : "No matching attempts", systemImage: "envelope", description: Text("Adjust the filters or search. Sending settings are managed in Email."))
                }
            }
        }.vaultDashboard(color: color).tint(color).navigationTitle("Sent Mail").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeEmailLog")
            .searchable(text: $query, prompt: "Subject, recipient, context or error")
            .onChange(of: query) {
                _, value in if !value.isEmpty {
                    section = "Attempts"
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("View", selection: $section) { Text("Overview").tag("Overview"); Text("Attempts").tag("Attempts") }
                        Picker("Purpose", selection: $purpose) { Text("All purposes").tag(""); Text("Newsstand").tag("news"); Text("Client").tag("client"); Text("Test").tag("test") }
                        Picker("Outcome", selection: $outcome) { Text("All outcomes").tag(""); ForEach(NativeMailOutcome.allCases, id: \.self) { Text($0.rawValue).tag($0.rawValue) } }
                        Picker("Window", selection: $days) { Text("All loaded dates").tag(0); Text("7 calendar days").tag(7); Text("30 calendar days").tag(30); Text("90 calendar days").tag(90) }
                        Button("Reset filters") { purpose = ""; outcome = ""; days = 0; query = ""; selectedDay = nil }
                    } label: { Image(systemName: "line.3.horizontal.decrease.circle") }.accessibilityLabel("Mail view and filters").accessibilityValue(section + ", " + (purpose.isEmpty ? "all purposes" : purpose) + ", " + (outcome.isEmpty ? "all outcomes" : outcome) + ", " + (days == 0 ? "all loaded dates" : "\(days) days")).accessibilityIdentifier("mailFilters")
                }
            }.task(id: model.revision) { await load() }.refreshable { await load() }
            .onChange(of: purpose) { _, _ in selectedDay = nil }.onChange(of: outcome) { _, _ in selectedDay = nil }.onChange(of: days) { _, _ in selectedDay = nil }
    }

    private var dailyChart: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text("Attempts by day").font(.headline)
            Text("Dates use this device's timezone. Attempts with invalid timestamps remain in the list and are excluded from this plot.").font(.caption).foregroundStyle(.secondary)
            Chart {
                ForEach(daily) { point in
                    BarMark(x: .value("Day", point.date, unit: .day), y: .value("Attempts", point.count)).foregroundStyle(by: .value("Outcome", point.outcome.rawValue))
                }
                if let inspected {
                    RuleMark(x: .value("Selected day", inspected)).foregroundStyle(.secondary).accessibilityHidden(true)
                }
            }.chartForegroundStyleScale(["Accepted": Color.mint, "Failed": Color.orange, "Unreported": Color.gray]).chartXSelection(value: $selectedDay).frame(height: 220).accessibilityIdentifier("mailDailyChart")
            if let inspected {
                Text(inspected.formatted(date: .abbreviated, time: .omitted)).font(.subheadline.weight(.semibold))
                ForEach(NativeMailOutcome.allCases, id: \.self) { state in
                    LabeledContent(state.rawValue, value: String(daily.first { $0.date == inspected && $0.outcome == state }?.count ?? 0))
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: color).accessibilityElement(children: .contain).accessibilityIdentifier("mailCard-mailDailyChart")
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let fresh = try await model.nativeRequest("api/email/log?limit=500", scope: .init())
            guard generation == id, !Task.isCancelled else { return }; data = fresh
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeEmailAttemptView: View {
    let row: VaultValue
    private var state: NativeMailOutcome {
        NativeMailOutcome.of(row)
    }

    var body: some View {
        List {
            VaultHero(title: row["subject"].string.isEmpty ? "Untitled message" : row["subject"].string, subtitle: NativeMail.purpose(row) + " · " + NativeOperations.timestamp(row["at"]), symbol: "envelope.open", color: .mint, eyebrow: "SAVED MAIL ATTEMPT").vaultStandaloneRow()
            Section("Recorded outcome") {
                Label(state == .accepted ? "Accepted by provider" : state.rawValue, systemImage: state == .failed ? "exclamationmark.triangle" : "envelope").foregroundStyle(state == .failed ? .orange : .mint)
                Text("Provider acceptance does not verify inbox delivery.").font(.caption).foregroundStyle(.secondary)
                if !row["error"].string.isEmpty {
                    Text(row["error"].string).textSelection(.enabled).foregroundStyle(.orange).accessibilityIdentifier("mailAttemptError")
                }
                if !row["providerId"].string.isEmpty {
                    LabeledContent("Provider message ID") { Text(row["providerId"].string).textSelection(.enabled) }
                }
                if NativeMail.nonnegative(row["elapsedMs"]) != nil {
                    LabeledContent("Request duration", value: NativeOperations.duration(row["elapsedMs"]))
                }
                if !row["ref"].string.isEmpty {
                    LabeledContent("Context") { Text(row["ref"].string).textSelection(.enabled) }
                }
            }
            Section("Recipients") {
                LabeledContent("From") { Text(row["from"].string).textSelection(.enabled) }
                ForEach(Array(row["to"].array.enumerated()), id: \.offset) { _, address in LabeledContent("To") { Text(address.string).textSelection(.enabled) } }
                ForEach(Array(row["cc"].array.enumerated()), id: \.offset) { _, address in LabeledContent("CC") { Text(address.string).textSelection(.enabled) } }
                if row["cc"].array.isEmpty {
                    Text("No CC recipients recorded.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Attachments") {
                if row["attachments"].array.isEmpty {
                    Text("No attachments recorded.").foregroundStyle(.secondary)
                }
                ForEach(Array(row["attachments"].array.enumerated()), id: \.offset) { _, item in
                    LabeledContent(item["filename"].string) { Text(NativeMail.nonnegative(item["bytes"]).flatMap { $0 < Double(Int64.max) ? ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) : nil } ?? "Unreported size") }
                }
                Text("The log records names and sizes. Message bodies and attachment contents are not stored here.").font(.caption).foregroundStyle(.secondary)
            }
            ShareLink("Share attempt metadata", item: NativeMail.description(row)).accessibilityIdentifier("mailShareAttempt")
        }.vaultDashboard(color: .mint).navigationTitle("Mail attempt").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeEmailAttempt")
    }
}
