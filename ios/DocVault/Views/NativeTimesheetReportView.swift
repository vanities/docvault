import SwiftUI

private struct NativeReportExport: Identifiable {
    let url: URL
    var id: String {
        url.absoluteString
    }
}

struct NativeTimesheetReportView: View {
    @Environment(VaultModel.self) private var model
    @State private var review: NativeReportReview?
    @State private var store: VaultValue = .null
    @State private var loading = true
    @State private var error: String?
    @State private var useToday = true
    @State private var end = Date.now
    @State private var section = "Overview"
    @State private var query = ""
    @State private var category = ""
    @State private var editing = false
    @State private var sending: NativeReportReview?
    @State private var exported: NativeReportExport?
    @State private var exporting = false
    @State private var exportTask: Task<Void, Never>?
    @State private var generation = UUID()
    private let color = Color.cyan
    private var endDay: String {
        useToday ? "" : NativeQuant.day(end)
    }

    var body: some View {
        List {
            VaultHero(title: "Work, ready to report", subtitle: "Review saved hours, categories and recipients before sharing a timesheet.", symbol: "doc.text.magnifyingglass", color: color, eyebrow: "TIMESHEET / REPORT").vaultStandaloneRow()
            Section("Report window") {
                Toggle("End on today in the server timezone", isOn: $useToday).accessibilityIdentifier("reportUseServerToday")
                if !useToday {
                    DatePicker("Ending on", selection: $end, displayedComponents: .date).environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).accessibilityIdentifier("reportEndDate")
                }
                Text("Previews use saved server settings. Save edits before previewing another scope or window length.").font(.caption).foregroundStyle(.secondary)
            }
            if loading {
                ProgressView("Preparing saved report…")
            }
            if let error {
                ErrorNotice(message: error).accessibilityIdentifier("reportLoadError"); Button("Retry preview") { Task { await load() } }
            }
            if let review {
                let report = review.preview
                Section("\(report.start) to \(report.end)") {
                    VaultMetricGrid(metrics: [
                        .init(title: "Hours", value: NativeBusiness.number(report.totalMinutes.map { $0 / 60 }), symbol: "clock"),
                        .init(title: "Entries", value: String(report.rows.count), symbol: "list.bullet.rectangle"),
                        .init(title: "Categories", value: String(report.groups.count), symbol: "square.grid.2x2"),
                        .init(title: "Report amount (USD)", value: NativeFinance.money(report.totalAmount), symbol: "creditcard"),
                    ], color: color).vaultStandaloneRow().accessibilityIdentifier("reportMetrics")
                }
                if section == "Overview" {
                    settings(review)
                    VaultAmountChart(title: "Hours by category", subtitle: "Recorded sub-clients take precedence over ordered keyword rules.", amounts: report.groups.compactMap { group in group.minutes.map { .init(label: group.name, amount: $0 / 60) } }, color: color, identifier: "reportCategoryChart", cardPrefix: "reportCard-", unit: .number("hours")).vaultStandaloneRow()
                    VaultAmountChart(title: "Hours by day", subtitle: "Dates follow the report. Duration-only entries are included without inventing clock times. Days with unavailable durations are omitted.", amounts: report.daily, color: color, identifier: "reportDailyChart", cardPrefix: "reportCard-", unit: .number("hours"), preserveOrder: true).vaultStandaloneRow()
                    Section("Explore categories") {
                        ForEach(report.groups) { group in
                            Button { category = group.name; section = "Entries" } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(group.name).font(.headline)
                                    Text("\(group.rows.count) entries · \(number(NativeTimesheetReport.hours(group.minutes))) · \(number(NativeFinance.money(group.amount)))").font(.caption).foregroundStyle(.secondary)
                                }
                            }.accessibilityIdentifier("reportCategory-" + group.name)
                        }
                    }
                } else {
                    Section(category.isEmpty ? "Reported entries" : category) {
                        let rows = report.filtered(query, category: category)
                        if rows.isEmpty {
                            ContentUnavailableView("No matching entries", systemImage: "line.3.horizontal.decrease.circle")
                        }
                        ForEach(rows) { row in
                            NavigationLink { NativeReportEntryView(row: row) } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(row.value["description"].string.isEmpty ? row.value["project"].string : row.value["description"].string).font(.body.weight(.medium)).lineLimit(3)
                                    Text(row.value["date"].string + " · " + row.category).font(.caption).foregroundStyle(.secondary)
                                    Text(number(NativeTimesheetReport.hours(row.minutes)) + " · " + number(NativeFinance.money(row.amount))).font(.caption).foregroundStyle(.secondary)
                                }
                            }.accessibilityIdentifier("reportEntry-\(row.id)")
                        }
                    }
                }
                Section("Preview and share") {
                    Text("These exports contain the complete saved preview, including entries hidden by your search or category filter.").font(.caption).foregroundStyle(.secondary)
                    Button("Export CSV", systemImage: "tablecells") { export(report, suffix: "csv") }.accessibilityIdentifier("reportExportCSV")
                    Button("Preview email HTML", systemImage: "doc.richtext") { export(report, suffix: "html") }.accessibilityIdentifier("reportPreviewHTML")
                    Button("Review & send report…", systemImage: "paperplane") { sending = review }.accessibilityIdentifier("reportReviewSend")
                    if report.rows.isEmpty {
                        Text("This window has no entries. The preview and exports remain available.").font(.caption).foregroundStyle(.secondary)
                    }
                    if exporting {
                        ProgressView("Preparing protected export…")
                    }
                }.disabled(loading || exporting || error != nil)
            }
        }.vaultDashboard(color: color).tint(color).accessibilityIdentifier("nativeTimesheetReport")
            .searchable(text: $query, prompt: "Search reported work")
            .onChange(of: query) {
                _, value in if !value.isEmpty {
                    section = "Entries"
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("View", selection: $section) { Text("Overview").tag("Overview"); Text("Entries").tag("Entries") }
                        Picker("Category", selection: $category) { Text("All categories").tag(""); ForEach(review?.preview.groups ?? []) { Text($0.name).tag($0.name) } }
                        Button("Reset filters") { query = ""; category = ""; section = "Overview" }
                    } label: { Image(systemName: "line.3.horizontal.decrease.circle") }.accessibilityLabel("Report view and filters").accessibilityIdentifier("reportFilters")
                }
            }.onChange(of: category) {
                _, value in if !value.isEmpty {
                    section = "Entries"
                }
            }
            .task(id: endDay + ":" + String(model.revision)) { await load() }.refreshable { await load() }
            .sheet(isPresented: $editing) {
                if let review {
                    NativeReportConfigEditor(config: review.config, store: store).privacyProtected()
                }
            }
            .sheet(item: $sending) { NativeReportSendView(review: $0, store: store).privacyProtected() }
            .sheet(item: $exported) { DocumentPreviewSheet(url: $0.url).privacyProtected() }
            .onDisappear {
                exportTask?.cancel(); if let exported {
                    VaultModel.removePreview(exported.url)
                }
            }
    }

    private func number(_ value: String) -> String {
        model.blurNumbers ? "••••" : value
    }

    private func settings(_ review: NativeReportReview) -> some View {
        Section("Saved delivery and scope") {
            Label(review.config["enabled"].boolean ? "Scheduled reports enabled" : "Scheduled reports disabled", systemImage: review.config["enabled"].boolean ? "clock.badge.checkmark" : "clock")
            LabeledContent("Recipient") { Text(review.recipient.isEmpty ? "Not configured" : review.recipient).textSelection(.enabled) }
            LabeledContent("Cadence", value: VaultValue.label(review.config["cadence"].string))
            LabeledContent("Send day", value: NativeTimesheetReport.days[Int(review.config["day"].number ?? 5)])
            LabeledContent("Hour", value: String(format: "%02d:00", Int(review.config["hour"].number ?? 15)))
            LabeledContent("Timezone", value: review.config["timezone"].string.isEmpty ? "Server default" : review.config["timezone"].string)
            LabeledContent("Window", value: "\(Int(review.config["windowDays"].number ?? 7)) inclusive days")
            VStack(alignment: .leading, spacing: 8) {
                Text("Client scope").font(.caption).foregroundStyle(.secondary)
                Text(NativeTimesheetReport.scope(review.config, store: store, key: "clientIds")).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("reportClientScope")
                Text("Project scope").font(.caption).foregroundStyle(.secondary)
                Text(NativeTimesheetReport.scope(review.config, store: store, key: "projectIds")).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("reportProjectScope")
                Text("Both scopes must match. All clients or all projects means no restriction for that scope.").font(.caption).foregroundStyle(.secondary)
            }
            if !review.config["lastSentWeek"].string.isEmpty {
                LabeledContent("Last accepted period", value: review.config["lastSentWeek"].string)
            }
            if !review.config["lastSentAt"].string.isEmpty {
                LabeledContent("Accepted at", value: NativeOperations.timestamp(review.config["lastSentAt"]))
            }
            Button("Edit report settings", systemImage: "slider.horizontal.3") { editing = true }.disabled(loading).accessibilityIdentifier("editReportConfig")
        }
    }

    private func load() async {
        let id = UUID(), client = model.api, wasDemo = model.demo, ending = endDay
        generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let fresh = try await model.timesheetReportReview(end: ending), references = try await model.nativeRequest("api/timesheet", scope: .init())
            guard !Task.isCancelled, generation == id, model.connected, model.api === client, model.demo == wasDemo else { return }
            review = fresh; store = references
            if !category.isEmpty, !fresh.preview.groups.contains(where: { $0.name == category }) {
                category = ""
            }
        } catch {
            if !Task.isCancelled, generation == id {
                self.error = error.localizedDescription
            }
        }
    }

    private func export(_ report: NativeReportPreview, suffix: String) {
        exporting = true; error = nil
        let folder = VaultModel.previewRoot.appendingPathComponent(UUID().uuidString)
        exportTask = Task {
            defer { exporting = false }
            let worker = Task.detached(priority: .utility) { try report.export(suffix, folder: folder) }
            do {
                let url = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                guard !Task.isCancelled else { VaultModel.removePreview(url); return }
                if let exported {
                    VaultModel.removePreview(exported.url)
                }
                exported = .init(url: url)
            } catch {
                if !Task.isCancelled {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

struct NativeReportEntryView: View {
    @Environment(VaultModel.self) private var model
    let row: NativeReportRow
    var body: some View {
        List {
            VaultHero(title: row.category, subtitle: row.value["date"].string, symbol: "clock", color: .cyan, eyebrow: "REPORTED WORK").vaultStandaloneRow()
            Section("Recorded work") {
                LabeledContent("Client", value: row.value["client"].string)
                LabeledContent("Project", value: row.value["project"].string)
                if !row.value["subClient"].string.isEmpty {
                    LabeledContent("Sub-client", value: row.value["subClient"].string)
                }
                LabeledContent("Duration", value: model.blurNumbers ? "••••" : NativeTimesheetReport.hours(row.minutes))
                LabeledContent("Recorded rate (USD)", value: model.blurNumbers ? "••••" : NativeFinance.money(NativeFinance.number(row.value["hourlyRate"])))
                LabeledContent("Recorded amount (USD)", value: model.blurNumbers ? "••••" : NativeFinance.money(row.amount))
                LabeledContent("Billable", value: row.value["billable"] == .null ? "Unreported" : row.value["billable"].boolean ? "Yes" : "No")
            }
            Section("Description") { Text(row.value["description"].string).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
            Text("Values come from the saved report preview. Opening an entry here does not change the original time record.").font(.caption).foregroundStyle(.secondary)
        }.vaultDashboard(color: .cyan).navigationTitle("Report entry").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeReportEntry")
    }
}

struct NativeReportConfigEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var config: VaultValue
    @State private var draft: NativeReportDraft
    @State private var initial: NativeReportDraft
    let store: VaultValue
    @State private var saving = false
    @State private var error: String?
    @State private var discard = false
    @State private var expand = false
    @State private var reload = false
    init(config: VaultValue, store: VaultValue) {
        self.store = store; let draft = NativeReportDraft(config)
        _config = State(initialValue: config); _draft = State(initialValue: draft); _initial = State(initialValue: draft)
    }

    private var dirty: Bool {
        draft != initial
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Schedule") {
                    Toggle("Enable scheduled reports", isOn: $draft.enabled).accessibilityIdentifier("reportConfigEnabled")
                    Picker("Cadence", selection: $draft.cadence) { ForEach(NativeTimesheetReport.cadences, id: \.self) { Text(VaultValue.label($0)).tag($0) } }
                    Picker("Send day", selection: $draft.day) { ForEach(0 ..< 7, id: \.self) { Text(NativeTimesheetReport.days[$0]).tag($0) } }
                    Picker("Send hour", selection: $draft.hour) { ForEach(0 ..< 24, id: \.self) { Text(String(format: "%02d:00", $0)).tag($0) } }
                    TextField("Timezone (server default when empty)", text: $draft.timezone).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("reportConfigTimezone")
                    TextField("Window in days (1–90)", text: $draft.windowDays).keyboardType(.numberPad).accessibilityIdentifier("reportConfigWindowDays")
                    Text("Every report includes this many calendar days, ending on its selected date. Cadence controls the schedule, separately from the window.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Recipient") {
                    TextField("To", text: $draft.to).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress).accessibilityIdentifier("reportConfigTo")
                    Text("Reports use the client CC configured in Email settings. Review all recipients before sending manually.").font(.caption).foregroundStyle(.secondary)
                }
                scope("clients", selected: $draft.clientIds)
                scope("projects", selected: $draft.projectIds)
                Section("Ordered keyword rules") {
                    Text("A recorded sub-client always wins. Otherwise, the first matching rule wins, then the project name. Keywords may include literal commas and line breaks.").font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(draft.categories.enumerated()), id: \.element.id) { index, rule in
                        VStack(alignment: .leading, spacing: 12) {
                            TextField("Category name", text: $draft.categories[index].name).accessibilityIdentifier("reportRuleName-\(index)")
                            ForEach(Array(rule.keywords.enumerated()), id: \.offset) { keyword, _ in
                                HStack(alignment: .top) {
                                    TextField("Keyword", text: $draft.categories[index].keywords[keyword], axis: .vertical).accessibilityIdentifier("reportRuleKeyword-\(index)-\(keyword)")
                                    Button { draft.categories[index].keywords.remove(at: keyword) } label: { Image(systemName: "minus.circle") }.accessibilityLabel("Remove keyword").buttonStyle(.borderless)
                                }
                            }
                            Button("Add keyword") { draft.categories[index].keywords.append("") }.buttonStyle(.borderless)
                            HStack {
                                Button("Move up") { draft.categories.swapAt(index, index - 1) }.disabled(index == 0).buttonStyle(.borderless).accessibilityIdentifier("reportRuleUp-\(index)")
                                Button("Move down") { draft.categories.swapAt(index, index + 1) }.disabled(index + 1 == draft.categories.count).buttonStyle(.borderless)
                                Spacer()
                                Button("Remove rule", role: .destructive) { draft.categories.remove(at: index) }.buttonStyle(.borderless)
                            }
                        }.padding(.vertical, 5)
                    }
                    Button("Add category rule") { draft.categories.append(.init(name: "", keywords: [""])) }.accessibilityIdentifier("reportAddRule")
                }
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("reportConfigError")
                }
                Button("Revert draft") { draft = initial; error = nil }.disabled(!dirty)
                Button("Reload saved settings") {
                    if dirty {
                        reload = true
                    } else {
                        Task { await load() }
                    }
                }.accessibilityIdentifier("reportReloadConfig")
                if saving {
                    ProgressView("Waiting for the server…")
                }
            }.disabled(saving).scrollDismissesKeyboard(.interactively).navigationTitle("Report settings").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") {
                        if dirty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(saving).accessibilityIdentifier("reportConfigCancel") }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") {
                        if NativeTimesheetReport.expandsScope(config, draft: draft) {
                            expand = true
                        } else {
                            Task { await save() }
                        }
                    }.disabled(!dirty || saving).accessibilityIdentifier("reportConfigSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { hideKeyboard() }.accessibilityIdentifier("reportConfigKeyboardDone") }
                }.interactiveDismissDisabled(dirty || saving)
                .confirmationDialog("Discard report changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() } }
                .confirmationDialog("Expand report scope?", isPresented: $expand, titleVisibility: .visible) { Button("Save expanded scope") { Task { await save() } }.accessibilityIdentifier("reportConfirmExpandedScope") } message: { Text("Clearing a scope includes all of its clients or projects. These saved selections control what the recipient can receive.") }
                .confirmationDialog("Discard draft and reload?", isPresented: $reload, titleVisibility: .visible) { Button("Discard and reload", role: .destructive) { Task { await load() } } }
        }
    }

    private func scope(_ collection: String, selected: Binding<[String]>) -> some View {
        Section(collection == "clients" ? "Client scope" : "Project scope") {
            Text(selected.wrappedValue.isEmpty ? "All \(collection) included" : "Only selected \(collection) included").font(.caption).foregroundStyle(.secondary)
            let rows = store[collection].array, saved = Array(Set(selected.wrappedValue.filter { id in !rows.contains { $0["id"].string == id } })).sorted()
            ForEach(rows, id: \.self) { row in
                Toggle(row["name"].string + (row["archived"].boolean ? " (archived)" : ""), isOn: selection(selected, id: row["id"].string)).accessibilityIdentifier("reportScope-\(collection)-" + row["id"].string)
            }
            ForEach(saved, id: \.self) { id in Toggle("Unavailable saved selection · " + id, isOn: selection(selected, id: id)).accessibilityIdentifier("reportScope-\(collection)-" + id) }
            Text("Client and project filters both apply. Saved selections remain selected even if their record is archived or unavailable.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func selection(_ ids: Binding<[String]>, id: String) -> Binding<Bool> {
        Binding(get: { ids.wrappedValue.contains(id) }, set: {
            value in if value {
                if !ids.wrappedValue.contains(id) {
                    ids.wrappedValue.append(id)
                }
            } else {
                ids.wrappedValue.removeAll { $0 == id }
            }
        })
    }

    private func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func save() async {
        hideKeyboard(); saving = true; error = nil; defer { saving = false }
        do { _ = try await model.saveTimesheetReport(original: config, draft: draft); dismiss() } catch { self.error = error.localizedDescription }
    }

    private func load() async {
        hideKeyboard(); saving = true; error = nil; defer { saving = false }
        do {
            let fresh = try NativeTimesheetReport.configuration(try await model.nativeRequest("api/timesheet/weekly-report/config", scope: .init()))
            config = fresh; draft = NativeReportDraft(fresh); initial = draft
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeReportSendView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var review: NativeReportReview
    let store: VaultValue
    @State private var busy = false
    @State private var error: String?
    @State private var result: VaultValue?
    @State private var confirm = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Reviewed report") {
                    Text(review.preview.start + " to " + review.preview.end).font(.headline)
                    LabeledContent("Entries", value: model.blurNumbers ? "••••" : String(review.preview.rows.count))
                    LabeledContent("Hours", value: model.blurNumbers ? "••••" : NativeTimesheetReport.hours(review.preview.totalMinutes))
                    LabeledContent("Clients") { Text(NativeTimesheetReport.scope(review.config, store: store, key: "clientIds")) }
                    LabeledContent("Projects") { Text(NativeTimesheetReport.scope(review.config, store: store, key: "projectIds")) }
                }
                Section("Recipients") {
                    LabeledContent("To") { Text(review.recipient.isEmpty ? "Not configured" : review.recipient).textSelection(.enabled) }.accessibilityIdentifier("reportSendTo")
                    LabeledContent("From") { Text(review.from.isEmpty ? "Server default" : review.from).textSelection(.enabled) }
                    LabeledContent("Client CC") { Text(review.cc.isEmpty ? "None configured" : review.cc).textSelection(.enabled) }.accessibilityIdentifier("reportSendCC")
                    LabeledContent("Provider", value: review.mail["provider"].string.isEmpty ? "Unreported" : review.mail["provider"].string)
                    if review.mail["enabled"] == .bool(false), !model.demo {
                        Text("Email sending is disabled in server settings.").foregroundStyle(.orange)
                    }
                    Text("This uses the saved recipient and client CC, with HTML and the complete CSV attached. Sending marks the period as sent for the scheduler.").font(.caption).foregroundStyle(.secondary)
                    if review.alreadySent {
                        Text("This ending date was already accepted. Sending again creates another mail attempt.").foregroundStyle(.orange).accessibilityIdentifier("reportAlreadySent")
                    }
                }
                if let result {
                    Section("Recorded outcome") {
                        Label(result["demo"].boolean ? "Simulated send — no email was sent" : "Accepted by the server", systemImage: "checkmark.circle").accessibilityIdentifier("reportSendResult")
                        if !result["sentTo"].string.isEmpty {
                            LabeledContent("Recorded recipient", value: result["sentTo"].string)
                        }
                        if !result["weekEnd"].string.isEmpty {
                            LabeledContent("Recorded period", value: result["weekEnd"].string)
                        }
                        Text("Server/provider acceptance does not confirm inbox delivery.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("reportSendError"); Text("Check sent-mail attempts before trying again after an uncertain response.").font(.caption).foregroundStyle(.secondary)
                }
                NavigationLink { NativeEmailLogView() } label: { Label("Sent-mail attempts", systemImage: "envelope.open") }
                if result == nil {
                    Button("Refresh review") { Task { await refresh() } }.disabled(busy).accessibilityIdentifier("reportRefreshSendReview")
                    Button(model.demo ? "Simulate report send…" : "Send report…", systemImage: "paperplane") { confirm = true }.disabled(busy || review.recipient.isEmpty || (!model.demo && review.mail["enabled"] == .bool(false))).accessibilityIdentifier("reportSend")
                }
                if busy {
                    ProgressView("Checking the saved report…")
                }
            }.navigationTitle("Review report delivery").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(busy).accessibilityIdentifier("closeReportSendReview") } }
                .interactiveDismissDisabled(busy)
                .confirmationDialog(model.demo ? "Simulate sending this report?" : review.alreadySent ? "Send this period again?" : "Send this report?", isPresented: $confirm, titleVisibility: .visible) {
                    Button(model.demo ? "Simulate send" : "Send report") { Task { await send() } }.accessibilityIdentifier("reportConfirmSend")
                } message: { Text("\(review.preview.start) to \(review.preview.end) → \(review.recipient)" + (review.cc.isEmpty ? "" : "\nCC: " + review.cc)) }
        }
    }

    private func refresh() async {
        busy = true; error = nil; defer { busy = false }
        do { review = try await model.timesheetReportReview(end: review.preview.end) } catch { self.error = error.localizedDescription }
    }

    private func send() async {
        busy = true; error = nil; defer { busy = false }
        do { result = try await model.sendTimesheetReport(review) } catch { self.error = error.localizedDescription }
    }
}
