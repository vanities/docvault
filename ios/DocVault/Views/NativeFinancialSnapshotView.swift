import Charts
import SwiftUI

struct NativeFinancialSnapshotView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dynamicTypeSize) private var textSize
    let resource: NativeResource
    let scope: VaultScope
    @State private var data: VaultValue = .null
    @State private var sources: VaultValue = .null
    @State private var history: VaultValue = .null
    @State private var loading = false
    @State private var loadID = UUID()
    @State private var errors: [String] = []
    @State private var section: String
    private let sections = ["Overview", "Assets", "Debt service", "Tax projection", "Business", "Retirement", "Reminders"]

    init(resource: NativeResource, scope: VaultScope) {
        self.resource = resource; self.scope = scope
        _section = State(initialValue: ["debt-snapshot": "Debt service", "retirement-snapshot": "Retirement", "federal-snapshot": "Tax projection"][resource.id] ?? "Overview")
    }

    private var report: NativeFinancialSnapshot {
        .init(value: data, sources: sources, history: history, year: scope.year)
    }

    private func money(_ value: Double?) -> String {
        model.blurNumbers ? "••••" : NativeFinance.money(value)
    }

    private func metric(_ title: String, _ path: String, _ symbol: String) -> VaultMetric {
        .init(title: title, value: NativeFinance.money(report.number(path)), symbol: symbol)
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: "Your financial picture", subtitle: "Whole vault · \(scope.year) tax and business records\nCurrent cached assets and debts alongside the selected year's activity.", symbol: "chart.bar.doc.horizontal", color: .blue, eyebrow: "FINANCE / CONSOLIDATED").vaultStandaloneRow().id("financialTop")
                if loading {
                    ProgressView("Loading financial records…")
                }
                ForEach(errors, id: \.self) { ErrorNotice(message: $0) }
                if !errors.isEmpty {
                    Button("Retry") { Task { await load() } }
                }
                if !data.isEmpty {
                    switch section {
                    case "Assets": assets
                    case "Debt service": debt
                    case "Tax projection": tax
                    case "Business": business
                    case "Retirement": retirement
                    case "Reminders": reminders
                    default: overview
                    }
                    Section("Snapshot details") {
                        Text("Generated " + data["generatedAt"].string).font(.caption).foregroundStyle(.secondary)
                        detailLink("All server snapshot fields", value: data, id: "financialAllValues")
                    }
                }
            }.accessibilityIdentifier("nativeFinancialSnapshot")
                .vaultDashboard(color: .blue).tint(.blue)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            ForEach(sections, id: \.self) { name in Button(name) { section = name } }
                        } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                            .accessibilityLabel("Review, " + section).accessibilityIdentifier("financialReviewSection")
                    }
                }
                .onChange(of: section) { _, _ in proxy.scrollTo("financialTop", anchor: .top) }
                .refreshable { await load() }.task(id: model.revision) { await load() }
        }
    }

    @ViewBuilder
    private var overview: some View {
        VaultMetricGrid(metrics: [
            .init(title: "Known USD net worth", value: NativeFinance.money(report.knownNetWorth), symbol: "building.columns"),
            .init(title: "Monthly debt service", value: NativeFinance.money(report.monthlyDebtService), symbol: "creditcard"),
            metric("Projected AGI", "taxSummary.estimatedAGI", "doc.text"),
            metric("Projected federal tax", "taxSummary.estimatedTotalTax", "building.columns.circle"),
            metric("Recorded sales", "sales.totalRevenue", "cart"),
            .init(title: "Recorded contributions", value: NativeFinance.money(report.retirementTotal), symbol: "banknote"),
        ], color: .blue).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("financialMetrics")
        valuationNote
        amountChart("Net worth components", "Known USD values. Bank debt and manual liabilities remain negative; property is equity after its mortgage.", report.netMix, "financialAssetsChart")
        historyCard
        Section("Explore your finances") {
            ForEach(sections.dropFirst(), id: \.self) { name in
                Button { section = name } label: { HStack { Text(name); Spacer(); Image(systemName: "chevron.right").foregroundStyle(.secondary) } }
                    .accessibilityIdentifier("financialExplore-" + name)
            }
        }
    }

    private var valuationNote: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(report.components.count - report.unavailableComponents) of \(report.components.count) categories valued").font(.caption.weight(.semibold))
            Text("Uses USD bank accounts and USD-valued asset records. Fixed brokerage accounts are included. Other bank currencies are listed separately without conversion.").font(.caption)
            if report.unavailableComponents > 0 {
                Text("Partial total: one or more categories lack a value. Unknown metal spot prices and missing account balances are unavailable.").font(.caption)
            }
            if report.excludedBanks > 0 {
                Text("\(report.excludedBanks) bank accounts have another or unspecified currency and are excluded from the USD total.").font(.caption)
            }
        }.foregroundStyle(.secondary).accessibilityIdentifier("financialValuationNote")
    }

    @ViewBuilder
    private var assets: some View {
        valuationNote
        amountChart("Net worth components", "Known balances and equity, with debt shown below zero.", report.netMix, "financialAssetsChart")
        Section("Asset and liability categories") {
            ForEach(report.components) { component in
                NavigationLink {
                    List {
                        VaultMetricCard(title: component.title, value: money(component.amount), symbol: "building.columns", color: .blue).vaultStandaloneRow()
                        featureLink(component.feature, "Open " + component.title)
                        Section("Cached snapshot records") { NativeValueSections(value: data.at(component.path)) }
                    }.vaultDashboard(color: .blue).navigationTitle(component.title)
                } label: {
                    LabeledContent(component.title) { Text(money(component.amount)).monospacedDigit() }
                }.accessibilityIdentifier("financialComponent-" + component.id)
            }
        }
        ForEach(report.currencies, id: \.self) { currency in
            Section("Bank accounts · " + currency) {
                ForEach(report.banks.filter { $0.currency == currency }) { account in
                    NavigationLink {
                        List {
                            VaultMetricCard(title: account.name, value: model.blurNumbers ? "••••" : NativeFinance.money(account.balance, currency: currency), symbol: "building.columns", color: .blue).vaultStandaloneRow()
                            featureLink("banks", "Open Banks to edit this account")
                            NativeValueSections(value: account.value)
                        }.vaultDashboard(color: .blue).navigationTitle(account.name)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            LabeledContent(account.name) { Text(model.blurNumbers ? "••••" : NativeFinance.money(account.balance, currency: currency)).monospacedDigit() }
                            Text(account.institution).font(.caption).foregroundStyle(.secondary)
                        }
                    }.accessibilityIdentifier("financialBank-" + account.value["id"].string)
                }
            }
        }
        Section("Brokerage accounts") {
            ForEach(Array(data["investments"]["brokerAccounts"].array.enumerated()), id: \.offset) { _, account in
                NavigationLink {
                    List {
                        featureLink("brokers", "Open Brokers to manage this account")
                        NativeValueSections(value: account)
                    }.vaultDashboard(color: .blue).navigationTitle(account["name"].string)
                } label: { LabeledContent(account["name"].string) { Text(money(NativeFinancialSnapshot.accountValue(account))).monospacedDigit() } }
                    .accessibilityIdentifier("financialBroker-" + account["id"].string)
            }
            Text("Cached at " + data["investments"]["brokerLastUpdated"].string).font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var debt: some View {
        VaultMetricGrid(metrics: [
            .init(title: "Monthly debt service", value: NativeFinance.money(report.monthlyDebtService), symbol: "creditcard"),
            metric("Qualifying monthly income", "portfolioSummary.qualifyingMonthlyIncome", "dollarsign.circle"),
            .init(title: "Debt-to-income ratio", value: report.dti.map { $0.formatted(.number.precision(.fractionLength(1))) + "%" } ?? "Unavailable", symbol: "percent"),
        ], color: .pink).vaultStandaloneRow()
        Text("The server combines bank payments, manual-liability payments and property mortgage payments. Qualifying income uses configured frequencies and the server's non-taxable income adjustment.").font(.caption).foregroundStyle(.secondary)
        if report.hasForeignDebt {
            Text("Bank payment totals and the combined ratio are unavailable because foreign-currency debts lack a USD conversion.").font(.caption).foregroundStyle(.secondary)
        }
        amountChart("Monthly payments", "Payment components reported by the server, in USD.", report.debtServiceMix, "financialDebtChart", color: .pink)
        Section("Debt and income details") {
            detailLink("Debt service calculation", value: data["portfolioSummary"], id: "financialDebtDetails")
            detailLink("Configured income sources", value: data["additionalIncome"], id: "financialIncomeSources")
            featureLink("debts", "Manage liabilities")
            featureLink("income", "Manage income sources")
            featureLink("property", "Review property mortgages")
        }
    }

    @ViewBuilder
    private var tax: some View {
        VaultMetricGrid(metrics: [
            metric("Projected total income", "taxSummary.estimatedTotalIncome", "arrow.down.left.circle"),
            metric("Projected AGI", "taxSummary.estimatedAGI", "doc.text"),
            metric("Projected taxable income", "taxSummary.estimatedTaxableIncome", "doc.text.magnifyingglass"),
            metric("Projected federal tax", "taxSummary.estimatedTotalTax", "building.columns"),
            metric("Federal withheld", "taxSummary.federalWithheld", "banknote"),
            metric("Self-employment tax", "taxSummary.seTax", "briefcase"),
        ], color: .orange).vaultStandaloneRow()
        Text("These are the server's projected values from recorded documents and adjustments. Withholding is shown separately; estimated payments and filed returns are available below.").font(.caption).foregroundStyle(.secondary)
        amountChart("Projected taxes and withholding", "Withholding is a payment. It is not added to projected tax.", amounts([("Income tax", "taxSummary.estimatedIncomeTax"), ("Self-employment", "taxSummary.seTax"), ("Investment income tax", "taxSummary.niit"), ("Federal withheld", "taxSummary.federalWithheld")]), "financialTaxChart", color: .orange)
        Section("Projection and payment records") {
            detailLink("Complete tax calculation", value: data["taxSummary"], id: "financialTaxDetails")
            featureLink("federal-tax", "Compare with filed federal returns")
            featureLink("estimated-tax", "Review estimated tax payments")
            featureLink("tax-year", "Review year documents")
        }
        Section("Reported installment dates") {
            ForEach(Array(data["taxSummary"]["estimatedPayments"]["quarterly"].array.enumerated()), id: \.offset) { _, row in LabeledContent(row["label"].string, value: row["due"].string) }
            Text(data["taxSummary"]["estimatedPayments"]["note"].string).font(.caption).foregroundStyle(.secondary)
        }
        Section("Annualized bank income periods") {
            ForEach(data["form2210Periods"].object.keys.sorted(), id: \.self) { id in detailLink(report.entityName(id), value: data["form2210Periods"][id], id: "financial2210-" + id) }
        }
    }

    @ViewBuilder
    private var business: some View {
        VaultMetricGrid(metrics: [
            metric("Recorded sales", "sales.totalRevenue", "cart"),
            .init(title: "Business miles", value: NativeHealth.display(data["mileage"]["totalMiles"]), symbol: "car"),
            metric("Mileage deduction", "mileage.totalDeduction", "road.lanes"),
        ], color: .orange).vaultStandaloneRow()
        amountChart("Recorded income by entity", "Reported income items; sales and deposits are reviewed separately.", report.entityIncome, "financialBusinessIncomeChart", color: .orange)
        amountChart("Recorded expenses by entity", "Receipt amounts in the snapshot. Deductible amounts are available in Tax Year.", report.entityExpenses, "financialBusinessExpenseChart", color: .teal)
        amountChart("Sales by quarter", "Recorded sales for \(scope.year).", data["sales"]["byQuarter"].array.compactMap { row in NativeFinance.number(row["total"]).map { .init(label: row["quarter"].string, amount: $0) } }, "financialSalesChart", color: .orange)
        Section("Business records") {
            ForEach(report.entityIDs, id: \.self) { id in
                NavigationLink {
                    List {
                        featureLink("tax-year", "Open Tax Year", entity: id)
                        Section("Income and expenses") { NativeValueSections(value: data["entities"][id]) }
                    }.vaultDashboard(color: .orange).navigationTitle(report.entityName(id))
                } label: { Text(report.entityName(id)) }.accessibilityIdentifier("financialEntity-" + id)
            }
            detailLink("Sales and products", value: data["sales"], id: "financialSalesDetails")
            detailLink("Trips and vehicles", value: data["mileage"], id: "financialMileageDetails")
            featureLink("sales", "Manage sales")
            featureLink("mileage", "Manage mileage")
        }
        ForEach(data["bankStatementDeposits"].object.keys.sorted(), id: \.self) { id in
            let deposits = report.deposits(entity: id)
            amountChart(report.entityName(id) + " · Revenue deposits", "Only quarters with fully parsed included statement sources are charted. Missing statements do not establish zero revenue.", report.depositMix(entity: id), "financialDepositsChart-" + id, color: .teal)
            Section("Statement coverage · " + report.entityName(id)) {
                Text("\(deposits.filter(\.verified).count) of \(deposits.count) statement rows verified").font(.caption).foregroundStyle(.secondary)
                ForEach(deposits) { row in
                    NavigationLink {
                        List {
                            Text(row.verified ? "Included source statements are parsed." : "Parsed source unavailable. The server's recorded zero does not establish zero deposits.").font(.caption).foregroundStyle(.secondary)
                            LabeledContent("Revenue deposits", value: money(row.revenue))
                            featureLink("tax-year", "Review statement documents in Tax Year", entity: id)
                            Section("Server statement fields") { NativeValueSections(value: row.value) }
                        }.vaultDashboard(color: .teal).navigationTitle(row.month)
                    } label: { LabeledContent(row.month, value: money(row.revenue)) }.accessibilityIdentifier("financialDeposit-" + row.id)
                }
            }
        }
    }

    @ViewBuilder
    private var retirement: some View {
        VaultMetricGrid(metrics: [
            .init(title: "Recorded contributions", value: NativeFinance.money(report.retirementTotal), symbol: "banknote"),
            metric("Projected retirement deduction", "taxSummary.retirementDeduction", "doc.text"),
        ], color: .purple).vaultStandaloneRow()
        Text("Contributions are combined across entities for the selected year. The projected deduction is the server's calculation and is shown separately.").font(.caption).foregroundStyle(.secondary)
        amountChart("Contributions by type", "Saved contribution records for \(scope.year).", report.retirementMix, "financialRetirementChart", color: .purple)
        Section("Contribution records") {
            if report.retirementRows.isEmpty {
                Text("No saved contributions for this year.").foregroundStyle(.secondary)
            }
            ForEach(Array(report.retirementRows.enumerated()), id: \.offset) { index, row in
                detailLink(report.entityName(row["entity"].string) + " · " + row["date"].string, value: row, id: "financialContribution-\(index)")
            }
            featureLink("solo-401k", "Manage contributions and limits")
        }
    }

    private var reminders: some View {
        Section("Year and filing-season reminders") {
            if data["reminders"].array.isEmpty {
                Text("No reminders recorded for this period.").foregroundStyle(.secondary)
            }
            ForEach(Array(data["reminders"].array.enumerated()), id: \.offset) { index, row in
                NavigationLink {
                    List { NativeValueSections(value: row); featureLink("calendar", "Open Calendar to manage reminders") }.vaultDashboard(color: .blue).navigationTitle(row["title"].string)
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(row["title"].string).font(.headline)
                        Text(row["dueDate"].string + " · " + VaultValue.label(row["status"].string)).font(.caption).foregroundStyle(.secondary)
                    }
                }.accessibilityIdentifier("financialReminder-\(index)")
            }
            featureLink("calendar", "Open Calendar")
        }
    }

    private var historyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Recorded balance history", systemImage: "chart.xyaxis.line").font(.headline)
            Text("Selected year · \(report.historyPoints.count) valued daily observations. Balance movement includes account activity; historical server totals may use different coverage from today's USD total.").font(.caption).foregroundStyle(.secondary)
            if model.blurNumbers {
                Text("Chart hidden while numbers are private").font(.caption).foregroundStyle(.secondary)
            } else if report.historyPoints.isEmpty {
                Text("No recorded balance history for this year.").foregroundStyle(.secondary)
            } else {
                Chart(report.historyPoints) { point in
                    LineMark(x: .value("Date", point.date), y: .value("Recorded balance", point.value), series: .value("Segment", point.segment)).foregroundStyle(.blue).lineStyle(.init(lineWidth: 3))
                        .accessibilityLabel(NativeQuant.day(point.date)).accessibilityValue(NativeFinance.money(point.value))
                }.chartLegend(.hidden).chartXScale(range: .plotDimension(startPadding: 8, endPadding: 28))
                    .chartXAxis {
                        if textSize.isAccessibilitySize {
                            AxisMarks(values: historyTicks) { value in
                                AxisGridLine()
                                if let date = value.as(Date.self) {
                                    AxisValueLabel(anchor: date == historyTicks.first ? .topLeading : .topTrailing) {
                                        VStack(spacing: 0) {
                                            Text(date, format: .dateTime.month(.abbreviated))
                                            Text(date, format: .dateTime.day())
                                        }.font(.caption2).fixedSize()
                                    }
                                }
                            }
                        } else {
                            AxisMarks(values: .automatic(desiredCount: 3)) { AxisGridLine(); AxisValueLabel(format: .dateTime.month(.abbreviated).day()) }
                        }
                    }
                    .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).frame(height: 230).accessibilityIdentifier("financialHistoryChart")
                if let first = report.historyPoints.first, let last = report.historyPoints.last {
                    LabeledContent("First recorded · " + NativeQuant.day(first.date), value: money(first.value))
                    LabeledContent("Last recorded · " + NativeQuant.day(last.date), value: money(last.value))
                }
                if let change = report.historyChange {
                    LabeledContent("Recorded balance change", value: money(change.dollars))
                }
            }
            NavigationLink {
                List {
                    ForEach(Array(report.historyRows.enumerated()), id: \.offset) { index, row in detailLink(observationTitle(row), value: row, id: "financialHistoryRow-\(index)") }
                }.vaultDashboard(color: .blue).navigationTitle("Recorded balances")
            } label: { Text("All daily observations") }.accessibilityIdentifier("financialHistoryDetails")
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .blue).vaultStandaloneRow()
    }

    private var historyTicks: [Date] {
        guard let first = report.historyPoints.first?.date, let last = report.historyPoints.last?.date else { return [] }
        return first == last ? [first] : [first, last]
    }

    private func observationTitle(_ row: VaultValue) -> String {
        let raw = row["date"].string
        guard textSize.isAccessibilitySize, let date = NativeQuant.date(raw) else { return raw }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: TimeZone(secondsFromGMT: 0)!))
    }

    private func amounts(_ paths: [(String, String)]) -> [TaxYearAmount] {
        paths.compactMap { label, path in report.number(path).map { .init(label: label, amount: $0) } }
    }

    private func amountChart(_ title: String, _ subtitle: String, _ amounts: [TaxYearAmount], _ id: String, color: Color = .blue) -> some View {
        VaultAmountChart(title: title, subtitle: subtitle, amounts: amounts, color: color, identifier: id, cardPrefix: "financialCard-").vaultStandaloneRow()
    }

    private func detailLink(_ title: String, value: VaultValue, id: String) -> some View {
        NavigationLink {
            List { NativeValueSections(value: value) }.vaultDashboard(color: .blue).navigationTitle(title)
        } label: { Text(title) }.accessibilityIdentifier(id)
    }

    @ViewBuilder private func featureLink(_ id: String, _ title: String, entity: String? = nil) -> some View {
        if let feature = NativeCatalog.features.first(where: { $0.id == id }) {
            NavigationLink {
                NativeFeatureView(feature: feature, initialScope: .init(entity: entity ?? scope.entity, year: scope.year))
            } label: { Label(title, systemImage: feature.symbol) }.accessibilityIdentifier("financialFeature-" + id)
        }
    }

    private func load() async {
        let id = UUID()
        loadID = id
        loading = true
        errors = []
        defer {
            if loadID == id {
                loading = false
            }
        }
        async let snapshot = model.nativeRequest("api/financial-snapshot/{year}?format=json", scope: scope)
        async let documents = model.nativeRequest("api/tax-summary/{year}", scope: scope)
        async let balances = model.nativeRequest("api/portfolio/snapshots?year={year}", scope: scope)
        do {
            let result = try await snapshot
            try Task.checkCancellation()
            guard loadID == id else { return }
            data = result
        } catch {
            if !Task.isCancelled, loadID == id {
                errors.append("Financial summary: " + error.localizedDescription)
            }
        }
        do {
            let result = try await documents
            try Task.checkCancellation()
            guard loadID == id else { return }
            sources = result
        } catch {
            if !Task.isCancelled, loadID == id {
                sources = .null
                errors.append("Statement sources: " + error.localizedDescription)
            }
        }
        do {
            let result = try await balances
            try Task.checkCancellation()
            guard loadID == id else { return }
            history = result
        } catch {
            if !Task.isCancelled, loadID == id {
                history = .null
                errors.append("Balance history: " + error.localizedDescription)
            }
        }
    }
}
