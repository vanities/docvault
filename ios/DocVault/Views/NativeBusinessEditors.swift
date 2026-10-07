import SwiftUI

struct BusinessTextInput: View {
    let label: String
    @Binding var text: String
    var numeric = false
    var identifier = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField(label, text: $text).keyboardType(numeric ? .decimalPad : .default)
                .textInputAutocapitalization(numeric ? .never : .sentences)
                .accessibilityIdentifier(identifier)
        }
    }
}

struct NativeSaleEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let resource: NativeResource
    let scope: VaultScope
    let data: VaultValue
    let record: VaultValue
    let changed: () -> Void
    @State private var person = ""
    @State private var productID = ""
    @State private var quantity = "1"
    @State private var date = ""
    @State private var entity = ""
    @State private var saving = false
    @State private var error: String?
    private var editing: Bool {
        !record["id"].string.isEmpty
    }

    private var repricing: Bool {
        !editing || productID != record["productId"].string || Double(quantity) != NativeFinance.number(record["quantity"])
    }

    private var total: Double? {
        if !repricing {
            return NativeFinance.number(record["total"])
        }
        guard let price = data["products"].array.first(where: { $0["id"].string == productID }).flatMap({ NativeFinance.number($0["price"]) }), let count = Double(quantity), count.isFinite, count > 0 else { return nil }
        let result = price * count
        return result.isFinite ? result : nil
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error)
                }
                BusinessTextInput(label: "Customer", text: $person, identifier: "field-person")
                let customers = NativeBusiness(value: data, kind: "sales", scope: scope).customers
                if !customers.isEmpty {
                    Menu("Known customers") { ForEach(customers, id: \.self) { name in Button(name) { person = name } } }.accessibilityIdentifier("businessKnownCustomers")
                }
                Picker("Product", selection: $productID) {
                    Text("Choose a product").tag("")
                    ForEach(Array(data["products"].array.enumerated()), id: \.offset) { _, product in Text(product["name"].string).tag(product["id"].string) }
                    if editing, !data["products"].array.contains(where: { $0["id"].string == record["productId"].string }) {
                        Text("Unavailable product").tag(record["productId"].string)
                    }
                }.accessibilityIdentifier("field-productId")
                BusinessTextInput(label: "Quantity", text: $quantity, numeric: true, identifier: "field-quantity")
                BusinessTextInput(label: "Date · YYYY-MM-DD", text: $date, identifier: "field-date")
                if !editing {
                    Picker("Entity", selection: $entity) { Text("Unassigned").tag(""); ForEach(model.entities) { Text($0.name).tag($0.id) } }.accessibilityIdentifier("field-entity")
                }
                Section(repricing ? "Preview at current price" : "Saved total") {
                    Text(model.blurNumbers ? "••••" : NativeFinance.money(total)).font(.title2.bold()).accessibilityIdentifier("businessSalePreview")
                    Text("The server calculates the sale total. Product price changes leave saved sales unchanged until their product or quantity is edited.").font(.caption).foregroundStyle(.secondary)
                }
                Button(editing ? "Save" : "Record sale") { Task { await save() } }.disabled(saving).accessibilityIdentifier("submitNativeFormInline")
            }.navigationTitle(editing ? "Edit sale" : "Record sale").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving).accessibilityIdentifier("submitNativeForm") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("businessKeyboardDone") }
                }.task {
                    person = record["person"].string; productID = editing ? record["productId"].string : data["products"].array.first?["id"].string ?? ""
                    quantity = editing ? NativeForm.display(record["quantity"], field: .init("quantity", "Quantity", .integer)) : "1"
                    date = editing ? record["date"].string : NativeBusiness.defaultDate(scope)
                    entity = scope.entity == "all" ? "" : scope.entity
                }
        }.interactiveDismissDisabled(saving)
    }

    private func save() async {
        guard !saving else { return }
        saving = true; error = nil
        defer { saving = false }
        do {
            let fields: [NativeField] = [.init("person", "Customer", .text, required: true), .init("productId", "Product", .text, required: true), .init("quantity", "Quantity", .integer, required: true), .init("date", "Date", .date, required: true)] + (editing ? [] : [.init("entity", "Entity", .text)])
            let body = try NativeForm.body(fields: fields, values: ["person": person, "productId": productID, "quantity": quantity, "date": date, "entity": entity], original: editing ? record : .object([:]), patch: editing)
            try NativeBusiness.validate(body, collection: "sales")
            if repricing, !data["products"].array.contains(where: { $0["id"].string == productID }) {
                throw VaultError.server("Choose an available product before changing product or quantity.")
            }
            _ = try await model.nativeRequest(editing ? "api/sales/{id}" : "api/sales", scope: scope, record: record, method: editing ? "PUT" : "POST", body: body)
            changed(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeTripEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let resource: NativeResource
    let scope: VaultScope
    let data: VaultValue
    let record: VaultValue
    var routeMiles: Double?
    let changed: () -> Void
    @State private var values: [String: String] = [:]
    @State private var distanceMode = "Distance"
    @State private var saving = false
    @State private var error: String?
    private var editing: Bool {
        !record["id"].string.isEmpty
    }

    private var fields: [NativeField] {
        resource.collections.first { $0.id == "entries" }!.fields.filter { !editing || $0.id != "entity" }
    }

    private func binding(_ key: String) -> Binding<String> {
        .init(get: { values[key] ?? "" }, set: { values[key] = $0 })
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error)
                }
                Picker("Vehicle", selection: binding("vehicleId")) {
                    Text("Choose a vehicle").tag("")
                    ForEach(Array(data["vehicles"].array.enumerated()), id: \.offset) { _, vehicle in Text(vehicle["name"].string).tag(vehicle["id"].string) }
                    if editing, !data["vehicles"].array.contains(where: { $0["id"] == record["vehicleId"] }) {
                        Text("Unavailable vehicle").tag(record["vehicleId"].string)
                    }
                }.accessibilityIdentifier("field-vehicleId")
                BusinessTextInput(label: "Date · YYYY-MM-DD", text: binding("date"), identifier: "field-date")
                Picker("Distance entry", selection: $distanceMode) { Text("Direct distance").tag("Distance"); Text("Odometer readings").tag("Odometer") }.accessibilityIdentifier("businessDistanceMode")
                if distanceMode == "Odometer" {
                    BusinessTextInput(label: "Odometer start", text: binding("odometerStart"), numeric: true, identifier: "field-odometerStart")
                    BusinessTextInput(label: "Odometer end", text: binding("odometerEnd"), numeric: true, identifier: "field-odometerEnd")
                    LabeledContent("Calculated miles", value: model.blurNumbers ? "••••" : NativeBusiness.number(Double(values["tripMiles"] ?? ""), suffix: "mi")).accessibilityIdentifier("businessCalculatedMiles")
                } else {
                    BusinessTextInput(label: "Trip miles", text: binding("tripMiles"), numeric: true, identifier: "field-tripMiles")
                    DisclosureGroup("Optional odometer readings") {
                        BusinessTextInput(label: "Odometer start", text: binding("odometerStart"), numeric: true, identifier: "field-odometerStart")
                        BusinessTextInput(label: "Odometer end", text: binding("odometerEnd"), numeric: true, identifier: "field-odometerEnd")
                    }
                }
                BusinessTextInput(label: "Purpose", text: binding("purpose"), identifier: "field-purpose")
                Section("Fuel · optional") {
                    BusinessTextInput(label: "Gallons", text: binding("gallons"), numeric: true, identifier: "field-gallons")
                    BusinessTextInput(label: "Total cost", text: binding("totalCost"), numeric: true, identifier: "field-totalCost")
                    Text("A fuel-only entry can leave distance blank. Clearing a field removes its saved observation.").font(.caption).foregroundStyle(.secondary)
                }
                if !editing {
                    Picker("Entity", selection: binding("entity")) { Text("Unassigned").tag(""); ForEach(model.entities) { Text($0.name).tag($0.id) } }.accessibilityIdentifier("field-entity")
                }
                if let miles = Double(values["tripMiles"] ?? ""), let rate = NativeFinance.number(data["irsRate"]) {
                    LabeledContent("Estimate at configured rate", value: model.blurNumbers ? "••••" : NativeFinance.money(miles * rate))
                }
                Button(editing ? "Save" : "Record trip") { Task { await save() } }.disabled(saving).accessibilityIdentifier("submitNativeFormInline")
            }.navigationTitle(editing ? "Edit trip" : "Record trip").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving).accessibilityIdentifier("submitNativeForm") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("businessKeyboardDone") }
                }
                .task {
                    values = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, NativeForm.display(record[$0.id], field: $0)) })
                    if !editing {
                        values["vehicleId"] = data["vehicles"].array.first?["id"].string ?? ""
                        values["date"] = NativeBusiness.defaultDate(scope)
                        values["entity"] = scope.entity == "all" ? "" : scope.entity
                        if let routeMiles {
                            values["tripMiles"] = String(routeMiles)
                        }
                    }
                    if let start = NativeFinance.number(record["odometerStart"]), let end = NativeFinance.number(record["odometerEnd"]), let miles = NativeFinance.number(record["tripMiles"]), abs(end - start - miles) < 0.000001 {
                        distanceMode = "Odometer"
                    }
                }
                .onChange(of: values["odometerStart"]) { _, _ in calculateDistance() }
                .onChange(of: values["odometerEnd"]) { _, _ in calculateDistance() }
                .onChange(of: distanceMode) { _, _ in calculateDistance() }
        }.interactiveDismissDisabled(saving)
    }

    private func calculateDistance() {
        guard distanceMode == "Odometer" else { return }
        if let start = Double(values["odometerStart"] ?? ""), let end = Double(values["odometerEnd"] ?? ""), start.isFinite, end.isFinite, start >= 0, end >= start {
            values["tripMiles"] = String(end - start)
        } else {
            values["tripMiles"] = ""
        }
    }

    private func save() async {
        guard !saving else { return }
        saving = true; error = nil
        defer { saving = false }
        do {
            if distanceMode == "Odometer" {
                calculateDistance()
                guard !(values["tripMiles"] ?? "").isEmpty else { throw VaultError.server("Enter two odometer readings with the end at or above the start.") }
            }
            var body = try NativeForm.body(fields: fields, values: values, original: editing ? record : .object([:]), patch: editing)
            try NativeBusiness.validate(body, collection: "entries")
            if !editing || body.object.keys.contains("vehicleId") {
                guard data["vehicles"].array.contains(where: { $0["id"].string == values["vehicleId"] }) else { throw VaultError.server("Choose an available vehicle.") }
            }
            if editing {
                body = NativeBusiness.mileagePatch(body)
            }
            _ = try await model.nativeRequest(editing ? "api/mileage/{id}" : "api/mileage", scope: scope, record: record, method: editing ? "PUT" : "POST", body: body)
            changed(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
