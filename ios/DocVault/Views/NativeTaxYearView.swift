import Charts
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

struct NativeTaxYearView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dynamicTypeSize) private var textSize
    let resource: NativeResource
    let scope: VaultScope
    @State private var statistics: VaultValue = .null
    @State private var summary: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var section = "Overview"
    @State private var search = ""
    @State private var editor: NativeEditor?
    @State private var searching = false
    @State private var importing = false
    @State private var scanning = false
    @State private var destination: VaultUploadDestination?
    private let sections = ["Overview", "Income", "Expenses", "Invoices", "Deposits", "Retirement", "Documents"]
    private var report: NativeTaxYear {
        .init(statistics: statistics, summary: summary, entity: scope.entity)
    }

    private var entityName: String {
        scope.entity == "all" ? "All tax entities" : model.entities.first { $0.id == scope.entity }?.name ?? scope.entity
    }

    private var filteredDocuments: [TaxYearDocument] {
        report.documents.filter { search.isEmpty || ($0.name + " " + $0.entityName + " " + $0.path).localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        NativeFilingTasksHost(entity: scope.entity) { filingTasks in
            review(filingTasks: filingTasks)
        }
    }

    private func review(filingTasks: AnyView) -> some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: "Your tax year", subtitle: "\(entityName) · \(scope.year)\nRecorded income, deductions and the documents behind them.", symbol: "doc.text.magnifyingglass", color: .orange, eyebrow: "WORK & TAXES / YEAR REVIEW").vaultStandaloneRow().id("taxReviewTop")
                if !textSize.isAccessibilitySize {
                    reviewPicker
                }
                if loading {
                    ProgressView("Loading tax records…")
                }
                if let error {
                    ErrorNotice(message: error)
                    Button("Retry") { Task { await load() } }
                }
                if !statistics.isEmpty {
                    switch section {
                    case "Income": income
                    case "Expenses": expenses
                    case "Invoices": invoices
                    case "Deposits": deposits
                    case "Retirement": retirement
                    case "Documents": documents
                    default: overview(filingTasks: filingTasks)
                    }
                } else if !summary.isEmpty {
                    documents
                }
                actions
                Section("More details") {
                    NavigationLink("All recorded tax values") {
                        List {
                            Section("Year statistics") { NativeValueSections(value: statistics) }
                            Section("Included entity summaries") {
                                NativeValueSections(value: .object(summary["summary"].object.filter { scope.entity == "all" || $0.key == scope.entity }))
                            }
                        }.vaultDashboard(color: .orange).navigationTitle("Tax details")
                    }.accessibilityIdentifier("taxAllRecordedValues")
                }
            }
            .accessibilityIdentifier("nativeTaxYear")
            .onChange(of: section) { _, _ in proxy.scrollTo("taxReviewTop", anchor: .top) }
            .vaultDashboard(color: .orange).tint(.orange)
            .searchable(text: $search, isPresented: $searching, prompt: "Find a source document")
            .scrollDismissesKeyboard(.interactively)
            .onSubmit(of: .search) {
                searching = false
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if searching {
                        Button("Done") {
                            searching = false
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        }.accessibilityIdentifier("taxDismissSearchKeyboard")
                    } else if textSize.isAccessibilitySize {
                        reviewPicker
                    }
                }
            }
            .onChange(of: search) {
                _, value in if !value.isEmpty {
                    section = "Documents"
                }
            }
            .refreshable { await load() }
            .task(id: model.revision) { await load() }
            .sheet(item: $editor) { item in
                NativeEditorView(editor: item, scope: scope, context: statistics, changed: { Task { await load() } }).privacyProtected()
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
                switch result {
                case let .success(urls): model.importFiles(urls, destination: destination)
                case let .failure(error): self.error = error.localizedDescription
                }
            }
            .sheet(isPresented: $scanning) {
                DocumentScanner(finished: { result in
                    scanning = false
                    switch result {
                    case let .success(data): var draft = UploadDraft(data: data, name: "Scanned Document.pdf", contentType: "application/pdf"); draft.destination = destination; model.draft = draft
                    case let .failure(error): self.error = error.localizedDescription
                    }
                }, cancel: { scanning = false }).ignoresSafeArea().privacyProtected()
            }
        }
    }

    @ViewBuilder private var reviewPicker: some View {
        if textSize.isAccessibilitySize {
            Menu {
                ForEach(sections, id: \.self) { name in Button(name) { section = name } }
            } label: {
                Image(systemName: "line.3.horizontal.decrease.circle")
            }.accessibilityLabel("Review, " + section).accessibilityIdentifier("taxReviewSection")
        } else {
            Picker("Review", selection: $section) {
                ForEach(sections, id: \.self) { Text($0).tag($0) }
            }.accessibilityIdentifier("taxReviewSection")
        }
    }

    @ViewBuilder
    private func overview(filingTasks: AnyView) -> some View {
        if scope.entity != "all", !scope.entity.isEmpty {
            Section("Entity & filing information") {
                NavigationLink { NativeEntityDetailsView(entityID: scope.entity) } label: { Label("Review or edit " + entityName + " details", systemImage: "building.2.crop.circle") }.accessibilityIdentifier("taxEntityDetails")
            }
        }
        filingTasks
        VaultMetricGrid(metrics: [
            metric("Recorded income", "income.totalIncome", "arrow.down.left.circle"),
            metric("Recorded deductions", "expenses.totalDeductible", "receipt"),
            .init(title: "Income less deductions", value: NativeFinance.money(report.recordedNet), symbol: "equal.circle"),
            metric("Federal withheld", "income.federalWithheld", "building.columns"),
            metric("State withheld", "income.stateWithheld", "building.columns.circle"),
            metric("Invoices issued", "invoices.invoiceTotal", "doc.text"),
        ], color: .orange).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("taxYearOverviewMetrics")
        Text("Income includes reported capital gains and sales. Invoice and deposit totals are shown separately. Income less deductions is a record summary; it does not calculate taxable income or tax owed.")
            .font(.caption).foregroundStyle(.secondary)
        VaultAmountChart(title: "Income composition", subtitle: "Recorded amounts by source, including gains and losses.", amounts: report.incomeMix, color: .orange, identifier: "taxIncomeChart").vaultStandaloneRow()
        VaultAmountChart(title: "Deductions by category", subtitle: "Deductible amounts reported by your vault, including mileage.", amounts: report.deductionMix, color: .teal, identifier: "taxDeductionChart").vaultStandaloneRow()
        coverage
        Section("Explore this year") {
            ForEach(sections.dropFirst(), id: \.self) { name in
                Button { section = name } label: {
                    HStack { Text(name); Spacer(); Image(systemName: "chevron.right").foregroundStyle(.secondary) }
                }.accessibilityIdentifier("taxExplore-" + name)
            }
        }
    }

    private var coverage: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Document coverage", systemImage: "doc.badge.clock").font(.headline)
            if summary.isEmpty {
                Text("Source documents unavailable. Retry to check parsing coverage.").foregroundStyle(.secondary)
            } else {
                HStack(spacing: 18) {
                    ZStack {
                        Circle().stroke(Color.orange.opacity(0.12), lineWidth: 8)
                        if !model.blurNumbers, !report.documents.isEmpty {
                            Circle().trim(from: 0, to: Double(report.parsedCount) / Double(report.documents.count))
                                .stroke(Color.orange.gradient, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
                        }
                        Image(systemName: "doc.text").foregroundStyle(.orange)
                    }.frame(width: 64, height: 64).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(model.blurNumbers ? "••••" : "\(report.parsedCount) of \(report.documents.count) parsed")
                            .font(.headline).monospacedDigit().accessibilityIdentifier("taxParsingCoverage")
                        Text(report.documents.isEmpty ? "No included documents for this scope and year." : "Unparsed records may be missing from the totals. Untracked documents are excluded from this source list.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button("Review documents") { section = "Documents" }.accessibilityIdentifier("taxReviewDocuments")
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .orange).vaultStandaloneRow()
    }

    @ViewBuilder
    private var income: some View {
        VaultMetricGrid(metrics: [metric("Recorded income", "income.totalIncome", "arrow.down.left.circle"), metric("Capital gains / losses", "income.capitalGainsTotal", "chart.line.uptrend.xyaxis"), metric("Federal withheld", "income.federalWithheld", "building.columns"), metric("State withheld", "income.stateWithheld", "building.columns.circle")], color: .orange).vaultStandaloneRow()
        VaultAmountChart(title: "Income composition", subtitle: "Gains are already included in recorded income.", amounts: report.incomeMix, color: .orange, identifier: "taxIncomeChart").vaultStandaloneRow()
        Section("Tax entry totals") {
            amountRow("Short-term gains / losses", report.number("income.capitalGainsShortTerm"))
            amountRow("Long-term gains / losses", report.number("income.capitalGainsLongTerm"))
            amountRow("Sales", report.number("income.salesTotal"))
        }
        Section("Income records") {
            records(statistics["income"]["items"].array, name: "source", detail: "type")
        }
        sourceSection("Income documents", rows: report.documents.filter { $0.path.lowercased().contains("/income/") })
    }

    @ViewBuilder
    private var expenses: some View {
        VaultMetricGrid(metrics: [metric("Recorded expenses", "expenses.totalExpenses", "creditcard"), metric("Recorded deductions", "expenses.totalDeductible", "receipt"), metric("Mileage deduction", "expenses.mileageDeduction", "car"), .init(title: "Recorded miles", value: report.number("expenses.mileageTotal").map { $0.formatted(.number.precision(.fractionLength(0 ... 2))) } ?? "Unavailable", symbol: "point.topleft.down.to.point.bottomright.curvepath")], color: .teal).vaultStandaloneRow()
        VaultAmountChart(title: "Deductions by category", subtitle: "Receipt deductions and mileage from the existing tax records.", amounts: report.deductionMix, color: .teal, identifier: "taxDeductionChart").vaultStandaloneRow()
        Section("Expense categories") {
            ForEach(Array(statistics["expenses"]["items"].array.enumerated()), id: \.offset) { _, row in
                NavigationLink {
                    List {
                        amountRow("Recorded expense", NativeFinance.number(row["total"]))
                        amountRow("Recorded deduction", NativeFinance.number(row["deductibleAmount"]))
                        Section("Receipts") { records(statistics["expenses"]["expenses"].array.filter { $0["category"] == row["category"] }, name: "vendor", detail: "date") }
                    }.vaultDashboard(color: .teal).navigationTitle(VaultValue.label(row["category"].string))
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(VaultValue.label(row["category"].string)).font(.headline)
                        Text(model.blurNumbers ? "••••" : "\(NativeFinance.money(NativeFinance.number(row["deductibleAmount"]))) deductible · \(row["count"].string) receipts").font(.caption).foregroundStyle(.secondary)
                    }
                }.accessibilityIdentifier("taxExpenseCategory-" + row["category"].string)
            }
            if statistics["expenses"]["items"].array.isEmpty {
                Text("No parsed expense categories.").foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var invoices: some View {
        VaultMetricGrid(metrics: [metric("Invoices issued", "invoices.invoiceTotal", "doc.text"), .init(title: "Invoice count", value: report.number("invoices.invoiceCount").map { $0.formatted() } ?? "Unavailable", symbol: "number")], color: .orange).vaultStandaloneRow()
        Text("Issued invoices do not establish payment received. They are separate from income and bank deposits.").font(.caption).foregroundStyle(.secondary)
        VaultAmountChart(title: "Invoices by customer", subtitle: "Recorded invoice totals.", amounts: statistics["invoices"]["byCustomer"].array.compactMap { row in NativeFinance.number(row["total"]).map { .init(label: row["customer"].string, amount: $0) } }, color: .orange, identifier: "taxInvoiceChart").vaultStandaloneRow()
        Section("Customers") {
            ForEach(Array(statistics["invoices"]["byCustomer"].array.enumerated()), id: \.offset) { _, row in amountRow(row["customer"].string, NativeFinance.number(row["total"])) }
        }
        sourceSection("Invoice documents", rows: report.invoiceDocuments)
    }

    @ViewBuilder
    private var deposits: some View {
        Text("Review each statement before relying on deposit totals. Revenue deposits and owner contributions follow the classifications stored in your vault.").font(.caption).foregroundStyle(.secondary)
        ForEach(statistics["bankDeposits"].object.keys.sorted().filter { scope.entity == "all" || $0 == scope.entity }, id: \.self) { entity in
            Section(model.entities.first { $0.id == entity }?.name ?? entity) {
                VaultMetricGrid(metrics: [
                    .init(title: "Parsed deposits", value: NativeFinance.money(report.parsedDepositTotal("deposits", entity: entity)), symbol: "arrow.down.circle"),
                    .init(title: "Parsed revenue", value: NativeFinance.money(report.parsedDepositTotal("revenueDeposits", entity: entity)), symbol: "chart.bar"),
                    .init(title: "Parsed owner contributions", value: NativeFinance.money(report.parsedDepositTotal("ownerContributions", entity: entity)), symbol: "person.crop.circle.badge.plus"),
                ], color: .blue).vaultStandaloneRow()
                let rows = report.deposits.filter { $0.entity == entity }
                if rows.contains(where: { !$0.verified }) {
                    Label("Partial statement coverage", systemImage: "exclamationmark.circle").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
                Text("These totals include only statements with parsed included sources. Unavailable statement amounts are excluded.").font(.caption).foregroundStyle(.secondary)
                VaultAmountChart(title: "Revenue by statement", subtitle: "Only statements with parsed source documents appear in the chart. Missing months are omitted.", amounts: rows.compactMap { row in row.revenue.map { .init(label: row.month, amount: $0) } }, color: .blue, identifier: "taxDepositChart-" + entity).vaultStandaloneRow()
                ForEach(rows) { row in
                    NavigationLink {
                        List {
                            if row.verified {
                                amountRow("Deposits", NativeFinance.number(row.value["deposits"]))
                                amountRow("Revenue deposits", row.revenue)
                                amountRow("Owner contributions", NativeFinance.number(row.value["ownerContributions"]))
                                Section("Deposit transactions") { NativeValueSections(value: row.value["sources"]) }
                            } else {
                                Text("Parsed source unavailable. Source coverage is incomplete or ambiguous, so this statement is omitted from the chart. A reported zero may represent an unparsed document.").foregroundStyle(.secondary)
                            }
                            sourceSection("Source statements", rows: row.documents)
                        }.vaultDashboard(color: .blue).navigationTitle(row.month)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(row.month).font(.headline)
                            Text(model.blurNumbers ? "••••" : row.verified ? NativeFinance.money(row.revenue) + " revenue" : "Parsed source unavailable").font(.caption).foregroundStyle(.secondary)
                        }
                    }.accessibilityIdentifier("taxDeposit-" + row.id)
                }
            }
        }
        if report.deposits.isEmpty {
            ContentUnavailableView("No bank statements", systemImage: "building.columns", description: Text("Add bank statements for the selected entity and year to review deposits."))
        }
    }

    @ViewBuilder
    private var retirement: some View {
        if statistics["retirement"].isEmpty {
            ContentUnavailableView("No recorded contributions", systemImage: "leaf", description: Text("No retirement contribution summary is available for this scope and year."))
        } else {
            VaultMetricGrid(metrics: [metric("Total contributions", "retirement.totalContributions", "leaf"), metric("Employer contributions", "retirement.employerContributions", "building.2"), metric("Employee contributions", "retirement.employeeContributions", "person.crop.circle")], color: .green).vaultStandaloneRow()
            VaultAmountChart(title: "Contributions by account", subtitle: "Recorded contributions from parsed statements.", amounts: statistics["retirement"]["byAccount"].array.compactMap { row in NativeFinance.number(row["total"]).map { .init(label: row["institution"].string + " · " + row["accountType"].string, amount: $0) } }, color: .green, identifier: "taxRetirementChart").vaultStandaloneRow()
        }
        sourceSection("Retirement documents", rows: report.retirementDocuments)
    }

    @ViewBuilder
    private var documents: some View {
        coverage; sourceSection("Included documents", rows: filteredDocuments)
    }

    private var actions: some View {
        Section("Year actions") {
            if scope.entity != "all", !scope.entity.isEmpty {
                Menu("Add documents to this tax year", systemImage: "doc.badge.plus") {
                    Button("Analyze & organize automatically") {
                        destination = .init(entity: scope.entity, folder: "\(scope.year)/inbox", organizeByType: true); importing = true
                    }.accessibilityIdentifier("taxImportAutomatic")
                    Divider()
                    ForEach(NativeTaxWorkspace.folders, id: \.1) { title, folder in
                        Menu(title) {
                            Button("Import from Files") { startImport(folder, scan: false) }.accessibilityIdentifier("taxImport-" + folder)
                            Button("Scan with camera") { startImport(folder, scan: true) }.disabled(!VNDocumentCameraViewController.isSupported).accessibilityIdentifier("taxScan-" + folder)
                            if model.demo {
                                Button("Add sample document") { addSample(folder) }.accessibilityIdentifier("taxSample-" + folder)
                            }
                        }
                    }
                }.disabled(model.importingFiles).accessibilityIdentifier("taxAddDocuments")
                if let action = NativeCatalog.resource("tax-summary")?.actions.first(where: { $0.id == "parse-all" }) {
                    Button(action.title) { editor = .init(action: action, record: .null, resource: resource) }.accessibilityIdentifier("action-parse-all")
                }
                Button("Export CPA package", systemImage: "square.and.arrow.up") { export(cpa: true) }.accessibilityIdentifier("taxExportCPA")
                Menu("Download documents") {
                    ForEach(["all", "income", "expenses", "invoices"], id: \.self) { filter in
                        Button(filter == "all" ? "All included documents" : VaultValue.label(filter)) { export(cpa: false, filter: filter) }
                    }
                }.accessibilityIdentifier("taxDownloadDocuments")
            } else {
                Text("Choose one entity above to parse documents or export a package.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func startImport(_ folder: String, scan: Bool) {
        do {
            destination = try NativeTaxWorkspace.destination(entity: scope.entity, year: String(scope.year), folder: folder); if scan {
                scanning = true
            } else {
                importing = true
            }
        } catch { self.error = error.localizedDescription }
    }

    private func addSample(_ folder: String) {
        do {
            var draft = UploadDraft(data: DemoVault.pdf(title: "Fabricated tax document"), name: "Acme_Sample.pdf", contentType: "application/pdf")
            draft.destination = try NativeTaxWorkspace.destination(entity: scope.entity, year: String(scope.year), folder: folder)
            model.draft = draft
        } catch { self.error = error.localizedDescription }
    }

    private func export(cpa: Bool, filter: String = "all") {
        let action = NativeAction(id: "tax-export", title: cpa ? "Export CPA package" : "Download \(filter) documents", path: cpa ? "api/download/cpa-package" : "api/download/zip", fields: [.init("entity", "Entity", .reference("entities"), required: true), .init("year", "Tax year", .integer, required: true)] + (cpa ? [] : [.init("filter", "Documents", .choices(["all", "income", "expenses", "invoices"]), required: true, initial: filter)]), response: "download")
        editor = .init(action: action, record: .null, resource: resource)
    }

    private func metric(_ title: String, _ path: String, _ symbol: String) -> VaultMetric {
        .init(title: title, value: NativeFinance.money(report.number(path)), symbol: symbol)
    }

    private func amountRow(_ title: String, _ value: Double?) -> some View {
        LabeledContent(title) { Text(model.blurNumbers ? "••••" : NativeFinance.money(value)).monospacedDigit().textSelection(.enabled) }
    }

    @ViewBuilder private func records(_ rows: [VaultValue], name: String, detail: String) -> some View {
        if rows.isEmpty {
            Text("No parsed records.").foregroundStyle(.secondary)
        }
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            NavigationLink {
                List {
                    Section("Recorded values") { NativeValueSections(value: row, excluded: ["filePath"]) }
                    sourceSection("Source documents", rows: report.sources(row["filePath"].string))
                }.vaultDashboard(color: .orange).navigationTitle(row[name].string)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(row[name].string.isEmpty ? "Unnamed record" : row[name].string).font(.headline)
                    Text(model.blurNumbers ? "••••" : row[detail].string + " · " + NativeFinance.money(NativeFinance.number(row["amount"]))).font(.caption).foregroundStyle(.secondary)
                }
            }.accessibilityIdentifier("taxRecord-" + row[name].string)
        }
    }

    private func sourceSection(_ title: String, rows: [TaxYearDocument]) -> some View {
        Section(title) {
            ForEach(rows) { document in
                NavigationLink { NativeTaxSourceView(document: document) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: document.parsed ? "doc.text" : "doc.badge.clock").foregroundStyle(document.parsed ? Color.orange : .secondary).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(document.name).font(.body.weight(.medium))
                            Text(document.entityName + " · " + (document.parsed ? "Parsed" : "Not parsed")).font(.caption).foregroundStyle(.secondary)
                            Text(document.path).font(.caption2).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 4)
                }.accessibilityIdentifier("taxSource-" + document.id)
            }
            if rows.isEmpty {
                Text(summary.isEmpty ? "Source documents unavailable." : "No matching included documents.").foregroundStyle(.secondary)
            }
        }
    }

    private func load() async {
        guard !scope.entity.isEmpty else { return }
        loading = true
        error = nil
        defer { loading = false }
        async let stats = model.nativeRequest("api/analytics/quick-stats/{entity}/{year}", scope: scope)
        async let sources = model.nativeRequest("api/tax-summary/{year}", scope: scope)
        var errors: [String] = []
        do { let value = try await stats; try Task.checkCancellation(); statistics = value } catch {
            if !Task.isCancelled {
                errors.append("Tax totals: " + error.localizedDescription)
            }
        }
        do { let value = try await sources; try Task.checkCancellation(); summary = value } catch {
            if !Task.isCancelled {
                errors.append("Source documents: " + error.localizedDescription)
            }
        }
        if !Task.isCancelled, !errors.isEmpty {
            error = errors.joined(separator: "\n")
        }
    }
}

private struct NativeTaxSourceView: View {
    @Environment(VaultModel.self) private var model
    let document: TaxYearDocument
    @State private var file: VaultFile?
    @State private var error: String?
    var body: some View {
        Group {
            if let file {
                DocumentDetailView(file: file, entity: document.entity)
            } else if let error {
                List { ErrorNotice(message: error); Button("Retry") { Task { await load() } } }
            } else {
                ProgressView("Loading source document…")
            }
        }.task { await load() }
    }

    private func load() async {
        error = nil
        do {
            let files = try await model.files(entity: document.entity)
            try Task.checkCancellation()
            guard let source = files.first(where: { $0.path == document.path }) else { throw VaultError.server("This source document is no longer available. Refresh the tax report.") }
            file = source
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}
