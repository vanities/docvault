import SwiftUI

struct NativeBusinessView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loading = false
    @State private var loadID = UUID()
    @State private var section = "Overview"
    @State private var allYears = false
    @State private var search = ""
    @State private var editor: NativeEditor?
    @State private var addRecord = false
    private var sales: Bool {
        resource.id == "sales"
    }

    private var color: Color {
        sales ? .orange : .teal
    }

    private var report: NativeBusiness {
        .init(value: data, kind: resource.id, scope: scope, allYears: allYears)
    }

    private var categories: [String] {
        sales ? ["Overview", "History", "Products"] : ["Overview", "Trips", "Vehicles", "Addresses", "Settings", "Route"]
    }

    private var period: String {
        allYears ? "All years" : String(scope.year)
    }

    private var entityName: String {
        scope.entity == "all" ? "All entities" : model.entities.first { $0.id == scope.entity }?.name ?? scope.entity
    }

    private func privateValue(_ text: String) -> String {
        model.blurNumbers ? "••••" : text
    }

    private func money(_ amount: Double?) -> String {
        privateValue(NativeFinance.money(amount))
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                VaultHero(title: sales ? "Every sale, recorded" : "The miles that matter", subtitle: entityName + " · " + period + "\n" + (sales ? "Saved transactions, customers and your shared product catalogue." : "Recorded journeys, vehicles, fuel and configured mileage estimates."), symbol: sales ? "cart.fill" : "car.side.fill", color: color, eyebrow: sales ? "SALES" : "MILEAGE").vaultStandaloneRow().id("businessTop")
                if loading {
                    ProgressView("Loading records…")
                }
                if let error {
                    ErrorNotice(message: error); Button("Retry") { Task { await load() } }
                }
                if !data.isEmpty {
                    switch section {
                    case "History", "Trips": history
                    case "Products": catalogue("products", "Products")
                    case "Vehicles": catalogue("vehicles", "Vehicles")
                    case "Addresses": catalogue("savedAddresses", "Saved addresses")
                    case "Settings": settings
                    case "Route":
                        NavigationLink {
                            NativeRoutePlannerView(resource: resource, scope: scope, data: data) { Task { await load() } }
                        } label: { Label("Plan a driving route", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                            .accessibilityIdentifier("businessPlanRoute")
                        Text("Use saved addresses or search through your server's configured address provider. Review a route distance before adding it to a trip.").font(.caption).foregroundStyle(.secondary)
                    default: overview
                    }
                }
            }.vaultDashboard(color: color).tint(color)
                .accessibilityIdentifier("nativeBusiness-" + resource.id)
                .searchable(text: $search, prompt: sales ? "Find a customer or product" : "Find a trip or vehicle")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Section("Review") { ForEach(categories, id: \.self) { name in Button(name) { section = name } } }
                            Section("Period") {
                                Button("Selected year") { allYears = false }
                                Button("All years") { allYears = true }
                            }
                            Button(sales ? "Record sale" : "Record trip") { addRecord = true }
                        } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                            .accessibilityLabel("Review, " + section).accessibilityValue(period).accessibilityIdentifier("businessReviewSection")
                    }
                }
                .onChange(of: section) { _, _ in search = ""; proxy.scrollTo("businessTop", anchor: .top) }
                .refreshable { await load() }.task(id: model.revision) { await load() }
                .sheet(isPresented: $addRecord) {
                    if sales {
                        NativeSaleEditor(resource: resource, scope: scope, data: data, record: .null) { model.revision += 1 }.privacyProtected()
                    } else {
                        NativeTripEditor(resource: resource, scope: scope, data: data, record: .null) { model.revision += 1 }.privacyProtected()
                    }
                }
                .sheet(item: $editor) { item in
                    NativeEditorView(editor: item, scope: scope, context: data) { model.revision += 1 }.privacyProtected()
                }
        }
    }

    @ViewBuilder private var overview: some View {
        VaultMetricGrid(metrics: sales ? [
            .init(title: "Known revenue · " + period, value: NativeFinance.money(report.knownTotal), symbol: "banknote"),
            .init(title: "All-time revenue", value: NativeFinance.money(report.allTimeTotal), symbol: "chart.line.uptrend.xyaxis"),
            .init(title: "Recorded sales", value: String(report.records.count), symbol: "cart"),
            .init(title: "Recorded quantity", value: NativeBusiness.number(NativeBusiness.sum(report.records.map { NativeFinance.number($0.value["quantity"]) })), symbol: "shippingbox"),
            .init(title: "Customers", value: String(Set(report.records.map { $0.value["person"].string }.filter { !$0.isEmpty }).count), symbol: "person.2"),
            .init(title: "Products", value: String(data["products"].array.count), symbol: "tag"),
        ] : [
            .init(title: "Known miles · " + period, value: NativeBusiness.number(report.knownTotal, suffix: "mi"), symbol: "road.lanes"),
            .init(title: "Estimated deduction", value: NativeFinance.money(report.deduction), symbol: "doc.text"),
            .init(title: "Recorded trips", value: String(report.records.count), symbol: "car"),
            .init(title: "Average paired MPG", value: NativeBusiness.number(report.averageMPG, suffix: "MPG"), symbol: "fuelpump"),
            .init(title: "Known fuel costs", value: NativeFinance.money(report.fuelCost), symbol: "creditcard"),
            .init(title: "All-time miles", value: NativeBusiness.number(report.allTimeTotal, suffix: "mi"), symbol: "point.topleft.down.to.point.bottomright.curvepath"),
        ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("businessMetrics")
        coverage
        Section("Current month · " + NativeBusiness.monthTitle(String(NativeQuant.day(.now).prefix(7))) + " · " + entityName) {
            VaultMetricGrid(metrics: sales ? [
                .init(title: "Known revenue this month", value: NativeFinance.money(report.currentMonthTotal), symbol: "banknote"),
                .init(title: "Sales this month", value: String(report.currentMonthRecords().count), symbol: "cart"),
            ] : [
                .init(title: "Known miles this month", value: NativeBusiness.number(report.currentMonthTotal, suffix: "mi"), symbol: "road.lanes"),
                .init(title: "Estimate this month", value: NativeFinance.money(report.currentMonthDeduction), symbol: "doc.text"),
            ], color: color).vaultStandaloneRow().accessibilityElement(children: .contain).accessibilityIdentifier("businessCurrentMonthMetrics")
        }
        Button(sales ? "Record sale" : "Record trip", systemImage: "plus") { addRecord = true }.accessibilityIdentifier("businessAddRecord")
        amountChart(sales ? "Revenue by month" : "Miles by month", report.monthlyAmounts, "businessMonthlyChart", chronological: true)
        amountChart(sales ? "Revenue by product" : "Miles by vehicle", report.categoryAmounts, "businessCategoryChart")
        if sales {
            amountChart("Revenue by customer", report.customerAmounts, "businessCustomerChart")
        }
        Section("Explore") { ForEach(categories.dropFirst(), id: \.self) { name in Button { section = name } label: { HStack { Text(name); Spacer(); Image(systemName: "chevron.right").foregroundStyle(.secondary) } } } }
    }

    private var coverage: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(report.records.count - report.missingCount) of \(report.records.count) records have a saved " + (sales ? "total." : "distance.")).font(.caption.weight(.semibold))
            Text(sales ? "Revenue uses saved sale totals. Editing a product price leaves existing sales unchanged; changing a sale's product or quantity recalculates that sale." : "Known miles and fuel costs total saved observations only. Missing distance is unavailable. Average MPG is the mean of individual trips with both positive miles and gallons.").font(.caption)
            if report.missingCount > 0 {
                Text("Partial totals: \(report.missingCount) records have no saved " + (sales ? "amount." : "distance.")).font(.caption)
            }
            if report.undatedCount > 0, !allYears {
                Text("\(report.undatedCount) records have invalid or missing dates. Review them under All years.").font(.caption)
            }
            if !sales {
                Text("Estimated deduction uses the currently configured rate of \(money(report.rate)) per mile across these records. It does not select historical rates by trip year.").font(.caption)
            }
        }.foregroundStyle(.secondary).accessibilityIdentifier("businessCoverage")
    }

    private func amountChart(_ title: String, _ amounts: [TaxYearAmount], _ id: String, chronological: Bool = false) -> some View {
        VaultAmountChart(title: title, subtitle: period + " · Known saved " + (sales ? "totals" : "distances") + "; full records are available in " + (sales ? "History." : "Trips."), amounts: amounts, color: color, identifier: id, cardPrefix: "businessCard-", unit: sales ? .money : .number("mi"), preserveOrder: chronological).vaultStandaloneRow()
    }

    @ViewBuilder private var history: some View {
        coverage
        Button(sales ? "Record sale" : "Record trip", systemImage: "plus") { addRecord = true }.accessibilityIdentifier("businessAddRecord")
        if report.records.isEmpty {
            ContentUnavailableView(sales ? "No sales in this period" : "No trips in this period", systemImage: sales ? "cart" : "car", description: Text("Choose another year or All years to review other records."))
        }
        ForEach(report.months) { group in
            Section {
                ForEach(group.records.filter { record in search.isEmpty || (record.value["person"].string + " " + record.value["purpose"].string + " " + report.lookup(record.value) + " " + record.value["date"].string).localizedCaseInsensitiveContains(search) }) { record in
                    NavigationLink {
                        NativeBusinessRecordView(resource: resource, scope: scope, data: data, record: record.value) { model.revision += 1 }
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(sales ? record.value["person"].string : record.value["purpose"].string.isEmpty ? report.lookup(record.value) : record.value["purpose"].string).font(.headline)
                            Text(report.lookup(record.value) + " · " + record.value["date"].string).font(.caption).foregroundStyle(.secondary)
                            Text(sales ? money(NativeFinance.number(record.value["total"])) : privateValue(NativeBusiness.number(NativeFinance.number(record.value["tripMiles"]), suffix: "mi"))).font(.subheadline.weight(.semibold)).foregroundStyle(color)
                        }.padding(.vertical, 3)
                    }.accessibilityIdentifier("businessRecord-" + record.value["id"].string)
                }
            } header: { Text(group.title + " · " + (sales ? money(group.amount) : privateValue(NativeBusiness.number(group.amount, suffix: "mi")))) }
        }
    }

    @ViewBuilder private func catalogue(_ id: String, _ title: String) -> some View {
        if let collection = resource.collections.first(where: { $0.id == id }) {
            Section(title) {
                Text("Shared across entities and years.").font(.caption).foregroundStyle(.secondary)
                Button("Add " + (id == "products" ? "product" : id == "vehicles" ? "vehicle" : "address"), systemImage: "plus") {
                    editor = .init(action: .init(id: "add", title: "Add " + title, path: collection.createPath, fields: collection.fields), record: .object([:]), resource: resource, collection: collection)
                }.accessibilityIdentifier("add-" + id)
                if data[id].array.isEmpty {
                    Text("No " + title.lowercased() + " yet.").foregroundStyle(.secondary)
                }
                ForEach(Array(data[id].array.enumerated()), id: \.offset) { _, row in
                    if search.isEmpty || row.title.localizedCaseInsensitiveContains(search) {
                        NavigationLink {
                            NativeRecordView(record: row, collection: collection, resource: resource, scope: scope) { model.revision += 1 }
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(row.title).font(.headline)
                                if id == "products" {
                                    Text(money(NativeFinance.number(row["price"]))).foregroundStyle(color)
                                }
                                if id == "vehicles" {
                                    Text(["year", "make", "model"].map { row[$0].string }.filter { !$0.isEmpty }.joined(separator: " ")).font(.caption).foregroundStyle(.secondary)
                                }
                                if id == "savedAddresses" {
                                    Text(row["formatted"].string).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }.accessibilityIdentifier("businessCatalogue-" + row["id"].string)
                    }
                }
            }
        }
    }

    private var settings: some View {
        Section("Mileage estimate") {
            LabeledContent("Configured per-mile rate", value: money(report.rate))
            Text("This saved rate applies to all trips in the server's mileage estimate. Review the applicable rate for the tax year before using the estimate.").font(.caption).foregroundStyle(.secondary)
            Button("Edit mileage rate", systemImage: "pencil") {
                editor = .init(action: .init(id: "rate", title: "Edit mileage rate", path: resource.editPath, method: "PUT", fields: [.init("irsRate", "Per-mile rate", .number, required: true)]), record: data, resource: resource, editing: true)
            }.accessibilityIdentifier("businessEditRate")
        }
    }

    private func load() async {
        let id = UUID(); loadID = id; loading = true; error = nil
        defer {
            if loadID == id {
                loading = false
            }
        }
        do {
            let result = try await model.nativeRequest(resource.path, scope: scope)
            guard !Task.isCancelled, id == loadID else { return }
            data = result
        } catch {
            guard !Task.isCancelled, id == loadID else { return }
            self.error = error.localizedDescription
        }
    }
}

struct NativeBusinessRecordView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let resource: NativeResource
    let scope: VaultScope
    let data: VaultValue
    let record: VaultValue
    let changed: () -> Void
    @State private var editing = false
    @State private var deleting = false
    @State private var busy = false
    @State private var error: String?
    private var sales: Bool {
        resource.id == "sales"
    }

    private var report: NativeBusiness {
        .init(value: data, kind: resource.id, scope: scope)
    }

    var body: some View {
        List {
            if let error {
                ErrorNotice(message: error)
            }
            VaultMetricCard(title: sales ? "Saved sale total" : "Saved distance", value: model.blurNumbers ? "••••" : sales ? NativeFinance.money(NativeFinance.number(record["total"])) : NativeBusiness.number(NativeFinance.number(record["tripMiles"]), suffix: "mi"), symbol: sales ? "cart" : "car", color: sales ? .orange : .teal).vaultStandaloneRow()
            LabeledContent(sales ? "Product" : "Vehicle", value: report.lookup(record))
            LabeledContent("Entity", value: model.entities.first { $0.id == record["entity"].string }?.name ?? (record["entity"].string.isEmpty ? "Unassigned" : record["entity"].string))
            Button("Edit", systemImage: "pencil") { editing = true }.accessibilityIdentifier("editRecord")
            Section("Saved fields") { NativeValueSections(value: record) }
            Button("Delete", role: .destructive) { deleting = true }.disabled(busy).accessibilityIdentifier("deleteRecord")
        }.vaultDashboard(color: sales ? .orange : .teal).navigationTitle(sales ? record["person"].string : record["purpose"].string.isEmpty ? "Trip" : record["purpose"].string).navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $editing) {
                if sales {
                    NativeSaleEditor(resource: resource, scope: scope, data: data, record: record) { changed(); dismiss() }.privacyProtected()
                } else {
                    NativeTripEditor(resource: resource, scope: scope, data: data, record: record) { changed(); dismiss() }.privacyProtected()
                }
            }
            .confirmationDialog("Delete this record?", isPresented: $deleting, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    Task {
                        busy = true
                        defer { busy = false }
                        do { _ = try await model.nativeRequest(resource.path + "/{id}", scope: scope, record: record, method: "DELETE"); changed(); dismiss() }
                        catch { self.error = error.localizedDescription }
                    }
                }.accessibilityIdentifier("confirmDeleteRecord")
            }
    }
}
