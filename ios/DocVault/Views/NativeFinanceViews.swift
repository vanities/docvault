import Charts
import SwiftUI

private func financeTimestamp(_ raw: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let fractional = formatter.date(from: raw)
    formatter.formatOptions = [.withInternetDateTime]
    return (fractional ?? formatter.date(from: raw))?.formatted(date: .abbreviated, time: .shortened) ?? raw
}

struct NativeFinanceView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State private var data: VaultValue = .null
    @State private var history: [VaultValue] = []
    @State private var annotations: [VaultValue] = []
    @State private var errors: [String: String] = [:]
    @State private var loading = false
    @State private var generation = UUID()
    @State private var currency = "USD"
    @State private var search = ""
    @State private var order = "Value"
    @State private var editor: NativeEditor?
    private var bank: Bool {
        resource.id == "banks"
    }

    private var accounts: [FinanceAccount] {
        NativeFinance.accounts(data)
    }

    private var currencies: [String] {
        Set(accounts.map(\.currency)).sorted()
    }

    private var bankAccounts: [FinanceAccount] {
        accounts.filter { $0.currency == currency }
    }

    private var totals: FinanceTotals {
        NativeFinance.totals(bankAccounts.map(\.balance))
    }

    private var positions: [FinancePosition] {
        NativeFinance.positions(data, search: search, order: order)
    }

    var body: some View {
        List {
            VaultHero(title: bank ? "Your banks" : "Your holdings", subtitle: bank ? "Understand balances across institutions, inspect available funds and manage account notes." : "Explore your accounts, position values and cost basis, then inspect historical price movement for each holding.", symbol: bank ? "building.columns" : "chart.line.uptrend.xyaxis", color: .blue, eyebrow: bank ? "FINANCE / BANKS" : "FINANCE / BROKERS").vaultStandaloneRow()
            if loading {
                ProgressView("Loading cached balances…")
            }
            if !errors.isEmpty {
                Section("Unavailable data") {
                    ForEach(errors.keys.sorted(), id: \.self) { key in ErrorNotice(message: key + ": " + (errors[key] ?? "")) }
                    Button("Retry") { Task { await load() } }
                }
            }
            if !data.isEmpty {
                if !data["lastUpdated"].string.isEmpty {
                    Label("Updated " + financeTimestamp(data["lastUpdated"].string), systemImage: "clock").font(.caption).foregroundStyle(.secondary)
                }
                if bank {
                    bankOverview
                } else {
                    brokerOverview
                }
                if !bank || (currencies == ["USD"]) {
                    FinanceBalanceHistory(history: history, key: bank ? "bankValue" : "brokerValue")
                } else {
                    Text("Category history is recorded in USD. It cannot show a separate history for each account or currency.").font(.caption).foregroundStyle(.secondary)
                }
                if bank {
                    institutionList
                } else {
                    brokerAccounts; holdingsList
                }
                if accounts.isEmpty, !loading {
                    ContentUnavailableView(bank ? "No cached bank accounts" : "No cached holdings", systemImage: bank ? "building.columns" : "chart.bar", description: Text("Connect an account or refresh its balances to populate this dashboard."))
                }
            }
            Section("Manage") {
                ForEach(resource.actions) { action in
                    Button(action.title) { editor = .init(action: action, record: data, resource: resource) }
                        .accessibilityIdentifier("action-" + action.id)
                }
                ForEach(bank ? ["bank-status", "annotations"] : ["broker-accounts", "broker-activities", "snaptrade"], id: \.self) { id in
                    if let section = NativeCatalog.resource(id) {
                        NavigationLink(section.title) { NativeResourceView(resource: section, scope: scope) }
                    }
                }
                NavigationLink("Source fields") { List { NativeValueSections(value: data) }.navigationTitle("Source fields") }
            }
        }.vaultDashboard(color: .blue).tint(.blue)
            .searchable(text: $search, prompt: bank ? "Find an account or institution" : "Find a holding or account")
            .accessibilityIdentifier("nativeFinance-" + resource.id)
            .task { await load() }.refreshable { await load() }
            .sheet(item: $editor) { item in NativeEditorView(editor: item, scope: scope, context: data) { Task { await load() } }.privacyProtected() }
    }

    @ViewBuilder
    private var bankOverview: some View {
        if currencies.count > 1 {
            Picker("Currency", selection: $currency) { ForEach(currencies, id: \.self) { Text($0).tag($0) } }
                .accessibilityIdentifier("bankCurrency")
            Text("Currencies are kept separate; these balances have not been converted.").font(.caption).foregroundStyle(.secondary)
        }
        VaultMetricGrid(metrics: [
            .init(title: totals.complete ? "Net balance" : "Known net balance", value: NativeFinance.money(totals.net, currency: currency), symbol: "building.columns"),
            .init(title: "Positive balances", value: NativeFinance.money(totals.assets, currency: currency), symbol: "plus.circle"),
            .init(title: "Negative balances", value: NativeFinance.money(totals.debt, currency: currency), symbol: "minus.circle"),
            .init(title: "Accounts", value: String(bankAccounts.count), symbol: "rectangle.stack"),
        ], color: .blue).vaultStandaloneRow()
        if !totals.complete {
            Text("Partial balances: \(totals.valuedCount) of \(totals.totalCount) accounts have a value. Unavailable balances are excluded from these totals.").font(.caption).foregroundStyle(.secondary)
        }
        ForEach(data["connectionErrors"].array, id: \.self) { Text($0.string).foregroundStyle(.orange) }
        if !model.blurNumbers, bankAccounts.contains(where: { $0.balance != nil }) {
            Section("Balances by institution · " + currency) {
                let groups = NativeFinance.bankGroups(accounts, currency: currency)
                Chart(groups) { group in
                    if let assets = group.totals.assets, assets > 0 {
                        BarMark(x: .value("Balance", assets), y: .value("Institution", group.name)).foregroundStyle(.blue)
                    }
                    if let debt = group.totals.debt, debt > 0 {
                        BarMark(x: .value("Balance", -debt), y: .value("Institution", group.name)).foregroundStyle(.orange)
                    }
                }.frame(height: CGFloat(max(1, groups.count)) * 48 + 45).chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
                    .accessibilityIdentifier("bankInstitutionChart")
                Text("Positive balances extend right; negative balances extend left. Missing balances are not plotted.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var brokerOverview: some View {
        VaultMetricGrid(metrics: [
            .init(title: "Portfolio value", value: NativeFinance.money(NativeFinance.number(data["totalValue"])), symbol: "chart.pie"),
            .init(title: "Recorded cost basis", value: NativeFinance.money(NativeFinance.number(data["totalCostBasis"])), symbol: "banknote"),
            .init(title: "Known position gains", value: NativeFinance.money(NativeFinance.knownPositionGains(data)), symbol: "arrow.up.arrow.down"),
            .init(title: "Accounts / positions", value: "\(accounts.count) / \(NativeFinance.positions(data).count)", symbol: "rectangle.stack"),
        ], color: .blue).vaultStandaloneRow()
        Text("Known position gains include holdings with a positive recorded cost basis. Fixed account balances and holdings without a usable basis are excluded.").font(.caption).foregroundStyle(.secondary)
    }

    private var institutionList: some View {
        ForEach(NativeFinance.bankGroups(accounts, currency: currency)) { group in
            let matches = group.accounts.filter { search.isEmpty || ($0.name + " " + group.name).localizedCaseInsensitiveContains(search) }
            if !matches.isEmpty {
                Section(group.name) {
                    ForEach(matches) { account in
                        NavigationLink {
                            NativeBankAccountView(account: account, annotation: annotations.first { $0["id"] == account.value["id"] } ?? account.value, scope: scope) { Task { await load() } }
                        } label: {
                            FinanceAccountCard(title: account.name, subtitle: account.institution, value: account.balance, currency: account.currency, detail: account.balance == nil ? "Balance unavailable" : account.balance! < 0 ? "Negative balance" : "Account balance")
                        }.vaultStandaloneRow().accessibilityIdentifier("bankAccount-" + account.value["id"].string)
                    }
                }
            }
        }
    }

    private var brokerAccounts: some View {
        Section("Brokerage accounts") {
            if !model.blurNumbers, accounts.contains(where: { (NativeFinance.number($0.value["totalValue"]) ?? 0) > 0 }) {
                Chart(accounts.filter { (NativeFinance.number($0.value["totalValue"]) ?? 0) > 0 }) { account in
                    SectorMark(angle: .value("Value", NativeFinance.number(account.value["totalValue"]) ?? 0), innerRadius: .ratio(0.68), angularInset: 3)
                        .foregroundStyle(by: .value("Account", account.name)).cornerRadius(4)
                }.frame(height: 210).accessibilityIdentifier("brokerAllocationChart")
                Text("Allocation uses positive account values. Negative and missing values remain in the account list.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(accounts.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { account in
                NavigationLink { NativeBrokerAccountView(account: account.value, scope: scope) } label: {
                    FinanceAccountCard(title: account.name, subtitle: account.value["broker"].string.capitalized, value: NativeFinance.number(account.value["totalValue"]), currency: "USD", detail: account.value["overrideValue"].isEmpty ? "\(account.value["holdings"].array.count) positions" : "Fixed account value")
                }.vaultStandaloneRow().accessibilityIdentifier("brokerAccount-" + account.value["id"].string)
            }
        }
    }

    private var holdingsList: some View {
        Section("Holdings") {
            Picker("Order", selection: $order) { ForEach(["Value", "Symbol", "Gain"], id: \.self) { Text($0) } }.accessibilityIdentifier("holdingOrder")
            ForEach(positions) { position in
                NavigationLink { NativeHoldingView(position: position) } label: { FinanceHoldingCard(position: position) }
                    .vaultStandaloneRow().accessibilityIdentifier("holding-" + position.accountID + "-" + position.symbol)
            }
            if positions.isEmpty {
                Text(search.isEmpty ? "No positions are available in the cache." : "No matching holdings.").foregroundStyle(.secondary)
            }
        }
    }

    private func load() async {
        let id = UUID(); generation = id
        loading = true; errors = [:]
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let value = try await model.nativeRequest(resource.path, scope: scope)
            guard generation == id, !Task.isCancelled else { return }
            data = value
            if !currencies.contains(currency) {
                currency = currencies.first ?? "USD"
            }
        } catch {
            if generation == id, !Task.isCancelled {
                errors["Balances"] = error.localizedDescription
            }
        }
        do {
            let value = try await model.nativeRequest("api/portfolio/snapshots", scope: scope)
            guard generation == id, !Task.isCancelled else { return }
            history = NativeFinance.history(value)
        } catch {
            if generation == id, !Task.isCancelled {
                errors["History"] = error.localizedDescription
            }
        }
        if bank {
            do {
                let value = try await model.nativeRequest("api/account-annotations/merged", scope: scope)
                guard generation == id, !Task.isCancelled else { return }
                annotations = value["accounts"].array
            } catch {
                if generation == id, !Task.isCancelled {
                    errors["Account notes"] = error.localizedDescription
                }
            }
        }
    }
}

private struct FinanceAccountCard: View {
    @Environment(VaultModel.self) private var model
    let title: String
    let subtitle: String
    let value: Double?
    let currency: String
    let detail: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(subtitle).font(.caption.weight(.medium)).foregroundStyle(.blue)
            Text(title).font(.system(.headline, design: .rounded))
            Text(model.blurNumbers ? "••••" : NativeFinance.money(value, currency: currency)).font(.system(.title2, design: .rounded, weight: .bold)).monospacedDigit()
                .foregroundStyle((value ?? 0) < 0 ? Color.orange : Color.primary)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .blue)
    }
}

private struct FinanceHoldingCard: View {
    @Environment(VaultModel.self) private var model
    let position: FinancePosition
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(position.symbol.isEmpty ? "Unlabeled holding" : position.symbol).font(.system(.headline, design: .rounded)).foregroundStyle(.blue)
            Text(position.label).font(.subheadline)
            Text(position.accountName).font(.caption).foregroundStyle(.secondary)
            HStack {
                Text(model.blurNumbers ? "••••" : NativeFinance.money(position.marketValue)).font(.system(.title3, design: .rounded, weight: .bold)).monospacedDigit()
                Spacer()
                Text(model.blurNumbers ? "••••" : position.quantity.map { $0.formatted() + " units" } ?? "Quantity unavailable").font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .blue)
    }
}

struct FinanceBalanceHistory: View {
    @Environment(VaultModel.self) private var model
    let history: [VaultValue]
    let key: String
    @State private var days = 90
    var body: some View {
        Section("Recorded category balance · USD") {
            Picker("History", selection: $days) { Text("30 days").tag(30); Text("90 days").tag(90); Text("1 year").tag(365) }.accessibilityIdentifier("financeHistoryWindow")
            let points = NativeFinance.points(history, key: key, days: days)
            if !model.blurNumbers, !points.isEmpty {
                Chart(points) { point in
                    LineMark(x: .value("Date", point.date), y: .value("Balance", point.value), series: .value("Observations", point.segment)).foregroundStyle(.blue).lineStyle(.init(lineWidth: 2.5))
                    PointMark(x: .value("Date", point.date), y: .value("Balance", point.value)).foregroundStyle(.blue).symbolSize(12)
                }.frame(height: 210).chartXScale(range: .plotDimension(startPadding: 8, endPadding: 28)).chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) { AxisGridLine(); AxisValueLabel(format: .dateTime.month(.abbreviated).day()) } }
                    .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).accessibilityIdentifier("financeBalanceChart")
            } else if points.isEmpty {
                Text("No recorded balances for this period.").foregroundStyle(.secondary)
            }
            if let latest = NativeFinance.latestSnapshot(history) {
                Text("Daily snapshot comparisons as of " + latest["date"].string).font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .top, spacing: 12) {
                ForEach(["1D", "7D", "1M"], id: \.self) { period in
                    let change = NativeFinance.balanceChange(history, key: key, period: period)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(period).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        Text(model.blurNumbers ? "••••" : change.map { NativeFinance.money($0.dollars) } ?? "—").font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text(model.blurNumbers ? "••••" : change?.percent.map { String(format: "%+.2f%%", $0) } ?? "—").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Text("Balance changes include deposits, withdrawals and market movement. Gaps in recorded days break the line. Comparisons require the exact recorded day; 1M uses the previous calendar month. Account histories are not recorded separately.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct NativeBankAccountView: View {
    @Environment(VaultModel.self) private var model
    let account: FinanceAccount
    let annotation: VaultValue
    let scope: VaultScope
    let changed: () -> Void
    var body: some View {
        List {
            VaultHero(title: account.name, subtitle: account.institution, symbol: "building.columns", color: .blue, eyebrow: "BANK ACCOUNT").vaultStandaloneRow()
            VaultMetricGrid(metrics: [
                .init(title: "Balance", value: NativeFinance.money(account.balance, currency: account.currency), symbol: "banknote"),
                .init(title: "Available balance", value: NativeFinance.money(NativeFinance.number(account.value["availableBalance"]), currency: account.currency), symbol: "creditcard"),
            ], color: .blue).vaultStandaloneRow()
            Section("Account details") {
                LabeledContent("Currency", value: account.currency)
                if let seconds = NativeFinance.number(account.value["balanceDate"]) {
                    LabeledContent("Balance date", value: Date(timeIntervalSince1970: seconds).formatted(date: .abbreviated, time: .shortened))
                }
                if !annotation["annotation"]["type"].string.isEmpty {
                    LabeledContent("Category", value: annotation["annotation"]["type"].string.replacingOccurrences(of: "-", with: " ").capitalized)
                }
                if !annotation["annotation"]["notes"].string.isEmpty {
                    Text(annotation["annotation"]["notes"].string).textSelection(.enabled)
                }
            }
            if let resource = NativeCatalog.resource("annotations"), let collection = resource.collections.first {
                NavigationLink("Edit account category and notes") { NativeRecordView(record: annotation, collection: collection, resource: resource, scope: scope, changed: changed) }.accessibilityIdentifier("bankEditAnnotation")
            }
            Section("Source fields") { NativeValueSections(value: account.value) }
        }.vaultDashboard(color: .blue).tint(.blue).navigationTitle("Account").navigationBarTitleDisplayMode(.inline)
    }
}

struct NativeBrokerAccountView: View {
    let account: VaultValue
    let scope: VaultScope
    var body: some View {
        List {
            VaultHero(title: account["name"].string, subtitle: account["broker"].string.capitalized, symbol: "chart.line.uptrend.xyaxis", color: .blue, eyebrow: "BROKERAGE ACCOUNT").vaultStandaloneRow()
            VaultMetricGrid(metrics: [
                .init(title: "Market value", value: NativeFinance.money(NativeFinance.number(account["totalValue"])), symbol: "chart.pie"),
                .init(title: "Recorded cost basis", value: NativeFinance.money(account["overrideValue"].isEmpty ? NativeFinance.number(account["totalCostBasis"]) : nil), symbol: "banknote"),
                .init(title: "Known position gains", value: NativeFinance.money(NativeFinance.knownPositionGains(.object(["accounts": .array([account])]))), symbol: "arrow.up.arrow.down"),
            ], color: .blue).vaultStandaloneRow()
            Section("Positions") {
                ForEach(NativeFinance.positions(.object(["accounts": .array([account])]))) { position in
                    NavigationLink { NativeHoldingView(position: position) } label: { FinanceHoldingCard(position: position) }.vaultStandaloneRow()
                }
                if account["holdings"].array.isEmpty {
                    Text("No positions are recorded. A fixed account value may be used instead.").foregroundStyle(.secondary)
                }
            }
            if account["snaptradeAccountId"].isEmpty, let resource = NativeCatalog.resource("broker-accounts") {
                NavigationLink("Manage manual accounts") { NativeResourceView(resource: resource, scope: scope) }
            } else if let resource = NativeCatalog.resource("snaptrade") {
                NavigationLink("Broker connections") { NativeResourceView(resource: resource, scope: scope) }
            }
            Section("Source fields") { NativeValueSections(value: account) }
        }.vaultDashboard(color: .blue).tint(.blue).navigationTitle("Brokerage account").navigationBarTitleDisplayMode(.inline)
    }
}

struct NativeHoldingView: View {
    @Environment(VaultModel.self) private var model
    let position: FinancePosition
    @State private var quote: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    var body: some View {
        List {
            VaultHero(title: position.symbol.isEmpty ? position.label : position.symbol, subtitle: position.label + " · " + position.accountName, symbol: "chart.line.uptrend.xyaxis", color: .blue, eyebrow: "HOLDING").vaultStandaloneRow()
            VaultMetricGrid(metrics: [
                .init(title: "Market value", value: NativeFinance.money(position.marketValue), symbol: "chart.pie"),
                .init(title: "Quantity", value: position.quantity.map { $0.formatted() } ?? "Unavailable", symbol: "number"),
                .init(title: "Cost basis", value: NativeFinance.money(NativeFinance.number(position.value["costBasis"])), symbol: "banknote"),
                .init(title: "Gain / loss", value: NativeFinance.money(position.gainLoss), symbol: "arrow.up.arrow.down"),
            ], color: .blue).vaultStandaloneRow()
            Section("Historical USD price movement") {
                if loading {
                    ProgressView("Loading historical quote…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                let samples = quote["sparklineCloses"].array.enumerated().compactMap { index, value in NativeFinance.number(value).map { (index, $0) } }
                if !model.blurNumbers, quote["currency"].string == "USD", !samples.isEmpty {
                    Chart(samples, id: \.0) { index, value in LineMark(x: .value("Sample", index), y: .value("Price", value)).foregroundStyle(.blue).lineStyle(.init(lineWidth: 2.5)) }.frame(height: 160).chartXAxis(.hidden).accessibilityIdentifier("holdingPriceChart")
                    Text("Weekly close samples; individual dates are not supplied.").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(["1D", "7D", "1M"], id: \.self) { period in
                    let change = NativeFinance.priceChange(quote, quantity: position.quantity, period: period)
                    VStack(alignment: .leading, spacing: 5) {
                        LabeledContent(period, value: model.blurNumbers ? "••••" : change.map { NativeFinance.money($0.amount) + " · " + String(format: "%+.2f%%", $0.percent) } ?? "Unavailable")
                        if let change {
                            Text("Baseline " + change.baselineDate).font(.caption).foregroundStyle(.secondary)
                        }
                    }.accessibilityElement(children: .combine).accessibilityIdentifier("holdingChange-" + period)
                }
                if !quote["performance"]["asOf"].string.isEmpty {
                    Text("Quote as of " + financeTimestamp(quote["performance"]["asOf"].string)).font(.caption).foregroundStyle(.secondary)
                }
                Text("Dollar changes use today's quantity and historical per-unit prices. They exclude dividends, deposits, withdrawals and changes in your position. 1D uses the previous close; 7D and 1M use the close on or before the comparison date.").font(.caption).foregroundStyle(.secondary)
                if NativeFinance.performanceSymbol(position.symbol) == nil {
                    Text("Cash, CUSIPs and unsupported symbols do not have ticker price history.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Position source fields") { NativeValueSections(value: position.value) }
        }.vaultDashboard(color: .blue).tint(.blue).navigationTitle("Holding").navigationBarTitleDisplayMode(.inline).task { await load() }
    }

    private func load() async {
        guard let symbol = NativeFinance.performanceSymbol(position.symbol) else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let value = try await model.nativeRequest("api/quant/tickers/prices?symbols={symbols}", scope: .init(), record: .object(["symbols": .string(symbol)]))
            guard !Task.isCancelled else { return }
            quote = value["quotes"].array.first { $0["symbol"].string == symbol } ?? .null
            if !quote["error"].string.isEmpty {
                error = quote["error"].string
            }
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}
