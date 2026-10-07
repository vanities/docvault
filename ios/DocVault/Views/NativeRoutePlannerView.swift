import SwiftUI

private enum RouteEndpoint: String, Identifiable { case from, to; var id: String {
    rawValue
} }

struct NativeRoutePlannerView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State var data: VaultValue
    let changed: () -> Void
    @State private var from: NativeRouteAddress?
    @State private var to: NativeRouteAddress?
    @State private var searching: RouteEndpoint?
    @State private var enabled = false
    @State private var checked = false
    @State private var miles: Double?
    @State private var routing = false
    @State private var requestID = UUID()
    @State private var error: String?
    @State private var trip = false
    @State private var editor: NativeEditor?
    private var addresses: [NativeRouteAddress] {
        data["savedAddresses"].array.map { .init(value: $0) }.filter(\.valid)
    }

    var body: some View {
        List {
            VaultHero(title: "A route worth recording", subtitle: "Review a driving estimate before using it in your mileage log.", symbol: "point.topleft.down.to.point.bottomright.curvepath", color: .teal, eyebrow: "ROUTE").vaultStandaloneRow()
            if let error {
                ErrorNotice(message: error)
            }
            if !checked {
                ProgressView("Checking address provider…")
            } else if !enabled {
                Text("Address search and driving routes need the server's configured address provider. You can still record trips manually.").foregroundStyle(.secondary).accessibilityIdentifier("businessRouteUnavailable")
            }
            Section("Journey") {
                endpoint("Starting address", $from, .from)
                endpoint("Destination", $to, .to)
                Button("Calculate driving route", systemImage: "arrow.triangle.turn.up.right.diamond") { Task { await calculateRoute() } }
                    .disabled(!enabled || from == nil || to == nil || routing).accessibilityIdentifier("businessCalculateRoute")
                if routing {
                    ProgressView("Calculating route…")
                }
            }
            if let miles {
                VaultMetricCard(title: "Estimated driving distance", value: model.blurNumbers ? "••••" : NativeBusiness.number(miles, suffix: "mi"), symbol: "road.lanes", color: .teal).vaultStandaloneRow().accessibilityIdentifier("businessRouteDistance")
                Text("The estimate comes from your server's routing provider. Review and adjust the distance in the trip form before saving.").font(.caption).foregroundStyle(.secondary)
                Button("Use distance in a new trip", systemImage: "plus") { trip = true }.accessibilityIdentifier("businessUseRoute")
            }
            Section("Save a selected address") {
                if let from {
                    saveButton("Save starting address", from)
                }
                if let to {
                    saveButton("Save destination", to)
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).navigationTitle("Driving route").navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .onChange(of: from) { _, _ in invalidate() }.onChange(of: to) { _, _ in invalidate() }
            .sheet(item: $searching) { side in
                NativeAddressSearchView(scope: scope, title: side == .from ? "Starting address" : "Destination") { address in
                    if side == .from {
                        from = address
                    } else {
                        to = address
                    }
                }.privacyProtected()
            }
            .sheet(isPresented: $trip) {
                NativeTripEditor(resource: resource, scope: scope, data: data, record: .null, routeMiles: miles) { changed(); model.revision += 1 }.privacyProtected()
            }
            .sheet(item: $editor) { item in
                NativeEditorView(editor: item, scope: scope, context: data) { changed(); Task { await load() } }.privacyProtected()
            }
    }

    private func endpoint(_ title: String, _ selection: Binding<NativeRouteAddress?>, _ side: RouteEndpoint) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(selection.wrappedValue?.formatted ?? "Choose an address").font(.body)
            Menu("Saved addresses") { ForEach(addresses) { address in Button(address.label) { selection.wrappedValue = address } } }
                .disabled(addresses.isEmpty).accessibilityIdentifier("businessSaved-" + side.rawValue)
            Button("Search " + title.lowercased(), systemImage: "magnifyingglass") { searching = side }.disabled(!enabled).accessibilityIdentifier("businessSearch-" + side.rawValue)
            if selection.wrappedValue != nil {
                Button("Clear " + title.lowercased()) { selection.wrappedValue = nil }.accessibilityIdentifier("businessClear-" + side.rawValue)
            }
        }
    }

    private func saveButton(_ title: String, _ address: NativeRouteAddress) -> some View {
        Button(title, systemImage: "bookmark") {
            if let collection = resource.collections.first(where: { $0.id == "savedAddresses" }) {
                var row = address.value; row.remove("id"); row.remove("label")
                editor = .init(action: .init(id: "add", title: "Save address", path: collection.createPath, fields: collection.fields), record: row, resource: resource, collection: collection)
            }
        }
    }

    private func invalidate() {
        requestID = UUID(); routing = false; miles = nil; error = nil
    }

    private func load() async {
        do {
            async let records = model.nativeRequest("api/mileage", scope: scope)
            async let status = model.nativeRequest("api/geocode/enabled", scope: scope)
            let (fresh, connection) = try await (records, status)
            guard !Task.isCancelled else { return }
            data = fresh; enabled = connection["enabled"] == .bool(true); checked = true
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription; checked = true
            }
        }
    }

    private func calculateRoute() async {
        guard let from, let to, !routing else { return }
        let id = UUID(); requestID = id; routing = true; miles = nil; error = nil
        defer {
            if requestID == id {
                routing = false
            }
        }
        do {
            let result = try await model.nativeRequest(NativeRouteAddress.routePath(from: from, to: to), scope: scope)
            guard !Task.isCancelled, requestID == id else { return }
            guard let distance = NativeFinance.number(result["miles"]), distance >= 0 else { throw VaultError.server("No driving distance returned.") }
            miles = distance
        } catch {
            if !Task.isCancelled, requestID == id {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeAddressSearchView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let scope: VaultScope
    let title: String
    let select: (NativeRouteAddress) -> Void
    @State private var query = ""
    @State private var results: [NativeRouteAddress] = []
    @State private var loading = false
    @State private var searched = false
    @State private var requestID = UUID()
    @State private var error: String?
    var body: some View {
        NavigationStack {
            List {
                BusinessTextInput(label: "Search address", text: $query, identifier: "businessAddressQuery")
                Button("Search addresses") { Task { await search() } }.disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 || loading).accessibilityIdentifier("businessSearchAddresses")
                if loading {
                    ProgressView("Searching…")
                }
                if let error {
                    ErrorNotice(message: error)
                }
                if searched, results.isEmpty, !loading, error == nil {
                    Text("No addresses returned. Try another search.").foregroundStyle(.secondary)
                }
                ForEach(results) { address in Button(address.formatted) { select(address); dismiss() }.accessibilityIdentifier("businessAddressResult-" + address.id) }
            }.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("businessKeyboardDone")
                    }
                }
                .onChange(of: query) { _, _ in requestID = UUID(); results = []; loading = false; searched = false; error = nil }
        }
    }

    private func search() async {
        let id = UUID(); requestID = id; loading = true; error = nil; searched = true
        defer {
            if requestID == id {
                loading = false
            }
        }
        do {
            var components = URLComponents(); components.path = "api/geocode/autocomplete"
            components.queryItems = [.init(name: "text", value: query.trimmingCharacters(in: .whitespacesAndNewlines))]
            let result = try await model.nativeRequest(components.string!, scope: scope)
            guard !Task.isCancelled, requestID == id else { return }
            results = result["results"].array.map { .init(value: $0) }.filter(\.valid)
        } catch {
            if !Task.isCancelled, requestID == id {
                self.error = error.localizedDescription
            }
        }
    }
}
