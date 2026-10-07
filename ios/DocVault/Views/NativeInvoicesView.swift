import SwiftUI

private struct NativeInvoicePreview: Identifiable {
    let url: URL
    var id: String {
        url.absoluteString
    }
}

struct NativeInvoicesView: View {
    @Environment(VaultModel.self) private var model
    @State private var store: VaultValue = .null
    @State private var loading = true
    @State private var error: String?
    @State private var query = ""
    @State private var year = ""
    @State private var client = ""
    @State private var project = ""
    @State private var status = ""
    @State private var sort = "date"
    @State private var descending = true
    @State private var creating = false
    @State private var generation = UUID()
    private let color = Color.cyan
    private var history: NativeInvoiceHistory? {
        try? .init(store)
    }

    private var rows: [NativeInvoiceRow] {
        history?.filtered(year: year, client: client, project: project, status: status, query: query, sort: sort, descending: descending) ?? []
    }

    var body: some View {
        List {
            VaultHero(title: "Work, billed with clarity", subtitle: "Review invoice history, unpaid balances and the work behind every bill.", symbol: "doc.text", color: color, eyebrow: "TIMESHEET / INVOICES").vaultStandaloneRow()
            if loading {
                ProgressView("Loading invoice history…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if history != nil {
                Section { Button("New invoice", systemImage: "plus") { creating = true }.accessibilityIdentifier("invoiceCreate") }.disabled(loading || error != nil)
                ForEach(NativeInvoiceHistory.totals(rows), id: \.self) { totals in
                    let currency = totals["currency"].string
                    Section(currency) {
                        VaultMetricGrid(metrics: [
                            .init(title: "Billed", value: money(totals["total"].number, currency), symbol: "doc.text"),
                            .init(title: "Unpaid", value: money(totals["open"].number, currency), symbol: "clock"),
                            .init(title: "Hours", value: model.blurNumbers ? "••••" : NativeBusiness.number(totals["minutes"].number.map { $0 / 60 }), symbol: "hourglass"),
                            .init(title: "Voided", value: totals["canceled"].string, symbol: "xmark.circle"),
                        ], color: color).vaultStandaloneRow()
                        VaultAmountChart(title: "Billed by issue month", subtitle: "Voided invoices are excluded. Work dates remain available in each invoice. Incomplete monthly totals are omitted.", amounts: NativeInvoiceHistory.monthly(rows, currency: currency), color: color, identifier: "invoiceMonthlyChart-" + currency, cardPrefix: "invoiceMonth-", unit: .currency(currency), preserveOrder: true).vaultStandaloneRow()
                    }
                }
                Section("Invoice history · \(rows.count)") {
                    if rows.isEmpty {
                        ContentUnavailableView("No matching invoices", systemImage: "doc.text.magnifyingglass", description: Text("Change the filters or create an invoice from open billable work."))
                    }
                    ForEach(rows) { row in
                        NavigationLink { NativeInvoiceDetailView(id: row.value["id"].string) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(row.value["number"].string.isEmpty ? "Invoice record" : row.value["number"].string).font(.headline)
                                Text(row.value["clientName"].string).font(.body)
                                Text("\(row.value["issueDate"].string) · \(row.status == "new" ? "Unpaid" : row.status.capitalized) · \(money(row.total, row.currency))").font(.caption).foregroundStyle(.secondary)
                                if !row.workPeriod.isEmpty {
                                    Text("Work \(row.workPeriod["from"].string) to \(row.workPeriod["to"].string)").font(.caption).foregroundStyle(.secondary)
                                }
                                if !row.value["sentAt"].string.isEmpty {
                                    Label("Email accepted " + String(row.value["sentAt"].string.prefix(10)), systemImage: "paperplane").font(.caption).foregroundStyle(.secondary)
                                }
                            }.padding(.vertical, 3)
                        }.accessibilityIdentifier("invoiceRow-" + row.value["id"].string)
                    }
                }
                Section { Text("Balances use each invoice’s recorded currency. Voided records remain visible and keep their entry locks until deleted.").font(.caption).foregroundStyle(.secondary) }
            }
        }.vaultDashboard(color: color).tint(color).accessibilityIdentifier("nativeInvoices")
            .searchable(text: $query, prompt: "Search invoices and saved details")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Issue year", selection: $year) { Text("All years").tag(""); ForEach(Array(Set((history?.rows ?? []).map { String($0.value["issueDate"].string.prefix(4)) })).sorted().reversed(), id: \.self) { Text($0).tag($0) } }
                        Picker("Client", selection: $client) { Text("All clients").tag(""); ForEach(store["clients"].array, id: \.self) { Text($0["name"].string + ($0["archived"].boolean ? " (archived)" : "")).tag($0["id"].string) }; ForEach(missingIDs("clientId", in: "clients"), id: \.self) { Text("Unavailable client · " + $0).tag($0) } }
                        Picker("Project", selection: $project) { Text("All projects").tag(""); ForEach(store["projects"].array, id: \.self) { Text($0["name"].string).tag($0["id"].string) }; ForEach(missingIDs("projectIds", in: "projects"), id: \.self) { Text("Unavailable project · " + $0).tag($0) } }
                        Picker("Status", selection: $status) { Text("All statuses").tag(""); Text("Unpaid").tag("new"); Text("Paid").tag("paid"); Text("Voided").tag("canceled") }
                        Picker("Sort", selection: $sort) { Text("Issue date").tag("date"); Text("Number").tag("number"); Text("Total within currency").tag("total") }
                        Toggle("Newest / largest first", isOn: $descending)
                        Button("Reset filters") { year = ""; client = ""; project = ""; status = ""; query = ""; sort = "date"; descending = true }
                    } label: { Image(systemName: "line.3.horizontal.decrease.circle") }.accessibilityLabel("Invoice filters").accessibilityIdentifier("invoiceFilters")
                }
            }.task(id: model.revision) { await load() }.refreshable { await load() }
            .sheet(isPresented: $creating) { NativeInvoiceCreateView(store: store).privacyProtected() }
    }

    private func money(_ value: Double?, _ currency: String) -> String {
        model.blurNumbers ? "••••" : NativeFinance.money(value, currency: NativeFinance.currency(currency))
    }

    private func missingIDs(_ field: String, in collection: String) -> [String] {
        let known = Set(store[collection].array.map { $0["id"].string })
        let ids = (history?.rows ?? []).flatMap { field == "projectIds" ? $0.value[field].array.map(\.string) : [$0.value[field].string] }
        return Array(Set(ids.filter { !$0.isEmpty && !known.contains($0) })).sorted()
    }

    private func load() async {
        let token = UUID(), api = model.api, demo = model.demo; generation = token; loading = true; error = nil
        do {
            let value = try await model.nativeRequest("api/timesheet", scope: .init()); try NativeInvoices.validateStore(value)
            guard generation == token, !Task.isCancelled, model.connected, model.api === api, model.demo == demo else { return }
            store = value; loading = false
        } catch {
            guard generation == token, !Task.isCancelled, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription; loading = false
        }
    }
}

private struct NativeInvoiceCreateView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var store: VaultValue
    @State private var draft = NativeInvoiceDraft()
    @State private var busy = false
    @State private var error: String?
    @State private var confirmation = false
    @State private var discard = false
    @State private var created: VaultValue?
    @State private var exported: NativeInvoicePreview?
    @State private var generation = UUID()
    private var selection: NativeInvoiceSelection? {
        try? .init(store: store, draft: draft)
    }

    private var dirty: Bool {
        draft != NativeInvoiceDraft()
    }

    var body: some View {
        NavigationStack {
            Form {
                if let created {
                    Section("Invoice created") {
                        Label(created["number"].string, systemImage: "checkmark.circle.fill").foregroundStyle(.green).accessibilityIdentifier("invoiceCreated")
                        Text("The selected entries are now billed and locked. Creation does not send email.")
                        Button("Preview saved PDF") { download(created: created) }.accessibilityIdentifier("invoiceCreatedPDF")
                        NavigationLink("Open invoice") { NativeInvoiceDetailView(id: created["id"].string) }
                    }
                } else {
                    Section("Billable work") {
                        Picker("Client", selection: $draft.clientId) { Text("Choose a client").tag(""); ForEach(store["clients"].array.filter { !$0["archived"].boolean || $0["id"].string == draft.clientId }, id: \.self) { Text($0["name"].string).tag($0["id"].string) } }.accessibilityIdentifier("invoiceClient")
                        Picker("Project", selection: $draft.projectId) { Text("All client projects").tag(""); ForEach(store["projects"].array.filter { $0["clientId"].string == draft.clientId }, id: \.self) { Text($0["name"].string + ($0["archived"].boolean ? " (archived)" : "")).tag($0["id"].string) } }.accessibilityIdentifier("invoiceProject")
                        invoiceField("From work date (optional)", text: $draft.from, id: "invoiceFrom")
                        invoiceField("Through work date (optional)", text: $draft.to, id: "invoiceTo")
                        Text("YYYY-MM-DD. Empty dates include all open billable work for the selected client and project.").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("Invoice details") {
                        Picker("PDF template", selection: $draft.templateId) { Text("Client default / first active").tag(""); ForEach(store["templates"].array.filter { !$0["archived"].boolean || $0["id"].string == draft.templateId }, id: \.self) { Text($0["name"].string).tag($0["id"].string) } }.accessibilityIdentifier("invoiceTemplate")
                        invoiceField("Number (optional)", text: $draft.number, id: "invoiceNumber")
                        Text("Leave the number empty for the server’s next number. Issue date and payment terms are applied by the server at creation.").font(.caption).foregroundStyle(.secondary)
                        TextField("Comment", text: $draft.comment, axis: .vertical).lineLimit(3 ... 12).accessibilityIdentifier("invoiceComment")
                    }
                    if let selection {
                        Section("Selected open work · \(selection.entries.count)") {
                            Text("\(NativeTimesheetReport.hours(selection.minutes)) · \(money(selection.amount, selection))")
                            LabeledContent("Retainer top-ups", value: money(NativeInvoices.round2(selection.deficit), selection))
                            LabeledContent("Tax", value: money(selection.tax, selection))
                            LabeledContent("Estimated total", value: money(selection.total, selection)).accessibilityIdentifier("invoiceSelectionTotal")
                            Text("Template: " + (selection.template.isEmpty ? "Server default" : selection.template["name"].string))
                            if !selection.client["autoFileEntityId"].string.isEmpty {
                                Text("Creation also attempts to file the PDF into the client’s configured entity. Filing is best effort.").font(.caption).foregroundStyle(.secondary)
                            }
                            ForEach(selection.entries, id: \.self) { entry in
                                VStack(alignment: .leading, spacing: 5) { Text(entry["description"].string).textSelection(.enabled); Text(entry["date"].string + " · " + NativeTimesheetReport.hours(entry["durationMinutes"].number)).font(.caption).foregroundStyle(.secondary) }
                            }
                            if selection.entries.isEmpty {
                                Text("No open billable entries in this selection.").foregroundStyle(.secondary)
                            }
                        }
                        if !selection.billed.isEmpty {
                            Section("Already billed — excluded") {
                                ForEach(selection.billed, id: \.self) { group in Text("\(group["number"].string.isEmpty ? "Marked invoiced" : group["number"].string) · \(group["count"].string) entries · \(group["firstDate"].string) to \(group["lastDate"].string)") }
                            }
                        }
                        Section { Button("Preview draft PDF") { download(created: nil) }.accessibilityIdentifier("invoicePreviewDraft"); Button("Review & create invoice…") { confirmation = true }.accessibilityIdentifier("invoiceConfirmCreate") }.disabled(selection.entries.isEmpty)
                    } else if !draft.clientId.isEmpty {
                        Text(validationError).foregroundStyle(.red).accessibilityIdentifier("invoiceDraftValidation")
                    }
                    Section { Button("Reload billing data (keep draft)") { Task { await reload() } }.accessibilityIdentifier("invoiceReloadSelection") }
                }
                if busy {
                    ProgressView("Working…")
                }
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("invoiceCreateError")
                }
            }.disabled(busy).navigationTitle("New invoice").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(created == nil ? "Cancel" : "Done") {
                        if dirty, created == nil {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(busy) }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("invoiceKeyboardDone") }
                }.onChange(of: draft.clientId) { _, _ in draft.projectId = "" }
                .interactiveDismissDisabled(busy || (dirty && created == nil))
                .confirmationDialog("Create and lock this work?", isPresented: $confirmation, titleVisibility: .visible) {
                    Button("Create invoice") {
                        if let selection {
                            Task { await create(selection) }
                        }
                    }
                } message: { Text("Only the reviewed \(selection?.entries.count ?? 0) open entries will be billed. Deleting the invoice releases them. No email is sent by creation.") }
                .confirmationDialog("Discard invoice draft?", isPresented: $discard, titleVisibility: .visible) { Button("Discard draft", role: .destructive) { dismiss() } }
                .sheet(item: $exported, onDismiss: cleanup) { DocumentPreviewSheet(url: $0.url).privacyProtected() }
                .onDisappear { generation = UUID(); cleanup() }
        }
    }

    private var validationError: String {
        do { _ = try NativeInvoiceSelection(store: store, draft: draft); return "" } catch { return error.localizedDescription }
    }

    private func money(_ amount: Double?, _ selection: NativeInvoiceSelection) -> String {
        model.blurNumbers ? "••••" : NativeFinance.money(amount, currency: selection.client["currency"].string.isEmpty ? "USD" : selection.client["currency"].string)
    }

    private func cleanup() {
        if let exported {
            VaultModel.removePreview(exported.url)
        }; exported = nil
    }

    private func reload() async {
        busy = true; error = nil; let token = generation, api = model.api, demo = model.demo
        defer {
            if generation == token {
                busy = false
            }
        }
        do { let value = try await model.nativeRequest("api/timesheet", scope: .init()); try NativeInvoices.validateStore(value); guard generation == token, model.connected, model.api === api, model.demo == demo else { return }; store = value }
        catch { guard generation == token, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription }
    }

    private func create(_ selection: NativeInvoiceSelection) async {
        busy = true; error = nil; let token = generation, api = model.api, demo = model.demo, draft = draft
        defer {
            if generation == token {
                busy = false
            }
        }
        do { let result = try await model.createNativeInvoice(selection: selection, draft: draft); guard generation == token, model.connected, model.api === api, model.demo == demo else { return }; created = result }
        catch { guard generation == token, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription + " If the response was interrupted, inspect invoice history before trying again." }
    }

    private func download(created: VaultValue?) {
        Task {
            busy = true; error = nil; let token = generation, api = model.api, demo = model.demo
            defer {
                if generation == token {
                    busy = false
                }
            }
            do {
                let url: URL
                if let created {
                    url = try await model.nativeDownload("api/timesheet/invoices/{id}/pdf", scope: .init(), record: created, method: "GET", body: nil, suffix: "pdf")
                } else {
                    let selection = try NativeInvoiceSelection(store: store, draft: draft); url = try await model.nativeDownload("api/timesheet/invoices/preview", scope: .init(), record: .null, method: "POST", body: selection.body, suffix: "pdf")
                }
                guard generation == token, model.connected, model.api === api, model.demo == demo else { VaultModel.removePreview(url); return }; exported = .init(url: url)
            } catch { guard generation == token, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription }
        }
    }
}

private struct NativeInvoiceDetailView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var invoice: VaultValue?
    @State private var error: String?
    @State private var busy = false
    @State private var editing = false
    @State private var sending = false
    @State private var filing = false
    @State private var deleting = false
    @State private var exported: NativeInvoicePreview?
    @State private var generation = UUID()
    var body: some View {
        List {
            if busy {
                ProgressView("Loading…")
            }
            if let error {
                ErrorNotice(message: error); Button("Reload invoice") { Task { await load() } }
            }
            if let invoice {
                let currency = NativeFinance.currency(invoice["currency"].string), row = NativeInvoiceRow(id: 0, value: invoice)
                VaultHero(title: invoice["number"].string, subtitle: invoice["clientName"].string, symbol: "doc.text", color: .cyan, eyebrow: "INVOICE / \(invoice["status"].string.uppercased())").vaultStandaloneRow()
                Section("Saved invoice") {
                    LabeledContent("Total", value: money(invoice["total"].number, currency))
                    LabeledContent("Subtotal", value: money(invoice["subtotal"].number, currency))
                    LabeledContent("Tax", value: money(invoice["tax"].number, currency))
                    LabeledContent("Hours", value: model.blurNumbers ? "••••" : NativeTimesheetReport.hours(invoice["totalMinutes"].number))
                    LabeledContent("Issued", value: invoice["issueDate"].string); LabeledContent("Due", value: invoice["dueDate"].string)
                    if !row.workPeriod.isEmpty {
                        LabeledContent("Work period", value: row.workPeriod["from"].string + " to " + row.workPeriod["to"].string)
                    }
                    if !invoice["paymentDate"].string.isEmpty {
                        LabeledContent("Paid", value: invoice["paymentDate"].string)
                    }
                    if !invoice["comment"].string.isEmpty {
                        Text(invoice["comment"].string).textSelection(.enabled)
                    }
                }
                Section("Billed lines") {
                    if invoice["lines"].array.isEmpty {
                        Text("Imported summary: no line details are recorded.").foregroundStyle(.secondary)
                    }
                    ForEach(Array(invoice["lines"].array.enumerated()), id: \.offset) { _, line in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(line["description"].string).font(.body).textSelection(.enabled)
                            Text(line["date"].string + " · " + line["projectName"].string).font(.caption).foregroundStyle(.secondary)
                            Text((line["minutes"].number == 0 ? "Adjustment" : NativeTimesheetReport.hours(line["minutes"].number)) + " · " + money(line["amount"].number, currency)).font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 3)
                    }
                }
                Section("Delivery and filing") {
                    if !invoice["sentAt"].string.isEmpty {
                        LabeledContent("Email accepted", value: invoice["sentAt"].string); Text(invoice["sentTo"].string).textSelection(.enabled)
                    }
                    if !invoice["filedPath"].string.isEmpty {
                        LabeledContent("Automatic filing", value: invoice["filedPath"].string).textSelection(.enabled)
                    }
                    Button("Preview PDF", systemImage: "doc") { download(invoice) }.accessibilityIdentifier("invoiceDetailPDF")
                    Button("Compose email…", systemImage: "paperplane") { sending = true }.accessibilityIdentifier("invoiceCompose")
                    Button("File PDF to entity…", systemImage: "folder.badge.plus") { filing = true }.accessibilityIdentifier("invoiceFile")
                    Text("Email acceptance is recorded by the provider; inbox delivery requires separate verification. Manual filing shows its final path here in the filing review.").font(.caption).foregroundStyle(.secondary)
                }.disabled(busy || error != nil)
                Section("Manage record") {
                    Button("Edit status and comment", systemImage: "pencil") { editing = true }.accessibilityIdentifier("invoiceEdit")
                    Button("Delete invoice and release entries…", role: .destructive) { deleting = true }.accessibilityIdentifier("invoiceDelete")
                    Text("Voiding keeps the billing lock. Deleting releases \(invoice["entryIds"].array.count) linked entries; it does not retract email or remove filed documents.").font(.caption).foregroundStyle(.secondary)
                }.disabled(busy || error != nil)
            }
        }.vaultDashboard(color: .cyan).navigationTitle("Invoice").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeInvoiceDetail")
            .task(id: model.revision) {
                if !busy || invoice == nil {
                    await load()
                }
            }.refreshable { await load() }
            .sheet(isPresented: $editing) {
                if let invoice {
                    NativeInvoiceEditView(invoice: invoice).privacyProtected()
                }
            }
            .sheet(isPresented: $sending) { NativeInvoiceComposeView(id: id).privacyProtected() }
            .sheet(isPresented: $filing) {
                if let invoice {
                    NativeInvoiceFileView(invoice: invoice).privacyProtected()
                }
            }
            .sheet(item: $exported, onDismiss: cleanup) { DocumentPreviewSheet(url: $0.url).privacyProtected() }
            .confirmationDialog("Delete this invoice?", isPresented: $deleting, titleVisibility: .visible) { Button("Delete and release entries", role: .destructive) {
                if let invoice {
                    Task { await remove(invoice) }
                }
            } } message: { Text("The invoice record will be removed and its entries released to open work. Sent mail and filed PDFs remain.") }
            .onDisappear { generation = UUID(); cleanup() }
    }

    private func money(_ value: Double?, _ currency: String) -> String {
        model.blurNumbers ? "••••" : NativeFinance.money(value, currency: currency)
    }

    private func cleanup() {
        if let exported {
            VaultModel.removePreview(exported.url)
        }; exported = nil
    }

    private func load() async {
        let token = UUID(), api = model.api, demo = model.demo; generation = token; busy = true; error = nil
        do { let value = try NativeInvoices.invoice(await model.nativeRequest("api/timesheet", scope: .init()), id: id); guard generation == token, !Task.isCancelled, model.connected, model.api === api, model.demo == demo else { return }; invoice = value; busy = false }
        catch { guard generation == token, !Task.isCancelled, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription; busy = false }
    }

    private func remove(_ invoice: VaultValue) async {
        busy = true; error = nil; let token = generation, api = model.api, demo = model.demo
        defer {
            if generation == token {
                busy = false
            }
        }
        do { _ = try await model.changeNativeInvoice(invoice, body: nil); guard generation == token, model.connected, model.api === api, model.demo == demo else { return }; dismiss() }
        catch { guard model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription }
    }

    private func download(_ invoice: VaultValue) {
        Task {
            busy = true; error = nil; let token = generation, api = model.api, demo = model.demo
            defer {
                if generation == token {
                    busy = false
                }
            }
            do { let url = try await model.nativeDownload("api/timesheet/invoices/{id}/pdf", scope: .init(), record: invoice, method: "GET", body: nil, suffix: "pdf"); guard generation == token, model.connected, model.api === api, model.demo == demo else { VaultModel.removePreview(url); return }; exported = .init(url: url) }
            catch { guard generation == token, model.api === api, model.demo == demo else { return }; self.error = error.localizedDescription }
        }
    }
}

@MainActor private func invoiceField(_ title: String, text: Binding<String>, id: String) -> some View {
    VStack(alignment: .leading, spacing: 5) { Text(title).font(.caption).foregroundStyle(.secondary); TextField(title, text: text).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier(id) }
}
