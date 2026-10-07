import SwiftUI

struct NativeCalculatorView: View {
    @Environment(VaultModel.self) private var model
    let kind: String
    let scope: VaultScope
    @State private var values: [String: String] = [:]
    @State private var source: VaultValue = .null
    @State private var defaults: [String: Double] = [:]
    @State private var ledger: VaultValue = .null
    @State private var sourceName = ""
    @State private var loading = false
    @State private var loaded = false
    @State private var loadID = UUID()
    private var cacheKey: String {
        kind + "|" + scope.entity + "|" + String(scope.year)
    }

    @State private var error: String?
    private var numeric: [String: Double] {
        var numbers = defaults
        for (key, raw) in values {
            numbers[key] = NativeWorksheet.parse(raw)
            if raw.isEmpty, !["j2.8", "j.35"].contains(key) {
                numbers[key] = 0
            }
        }
        return numbers
    }

    private var invalidInput: Bool {
        values.contains { !["j2.6form", "j2.6schedule"].contains($0.key) && !$0.value.isEmpty && NativeWorksheet.parse($0.value) == nil }
    }

    private var results: VaultValue {
        if invalidInput {
            return .null
        }
        return kind == "solo-calculator"
            ? NativeCalculators.solo(
                gross: numeric["gross"] ?? 0, expenses: numeric["expenses"] ?? 0,
                k1: numeric["k1"] ?? 0, year: scope.year
            ) ?? .null
            : NativeCalculators.tennessee(numeric)
    }

    var body: some View {
        Form {
            if loading {
                ProgressView("Loading worksheet sources…")
            }
            if !sourceName.isEmpty {
                Text("Defaults from \(sourceName)").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("worksheetSource")
            }
            Section("Worksheet inputs") {
                field("gross", "Gross business income")
                field("expenses", "Deductible business expenses")
                if kind == "solo-calculator" {
                    field("k1", "K-1 self-employment earnings")
                } else {
                    field("homeOffice", "Business use of home")
                    field("bankBalance", "Year-end bank balance")
                    field("creditBalance", "Year-end credit balance")
                    field("assets", "Business assets")
                    field("affiliatedDebt", "Affiliated debt")
                }
            }
            if kind == "tn-calculator" {
                DisclosureGroup("Schedule J-2") {
                    ForEach(2 ... 6, id: \.self) { field("j2.\($0)", lineLabel("j2.\($0)")) }
                    field("j2.6form", "Line 6 form", numeric: false)
                    field("j2.6schedule", "Line 6 schedule", numeric: false)
                    field("j2.8", "Line 8 owner deduction (blank = automatic)")
                }
                DisclosureGroup("Schedule J additions") {
                    ForEach(2 ... 14, id: \.self) { field("j.\($0)", lineLabel("j.\($0)")) }
                }
                DisclosureGroup("Schedule J deductions") {
                    ForEach(16 ... 27, id: \.self) { field("j.\($0)", lineLabel("j.\($0)")) }
                    field("j.28a", lineLabel("j.28a"))
                    field("j.28b", lineLabel("j.28b"))
                    field("j.29", lineLabel("j.29"))
                }
                DisclosureGroup("Schedule J computation") {
                    field("j.33", lineLabel("j.33"))
                    field("j.35", "Line 35 apportionment % (blank = 100)")
                    field("j.37", lineLabel("j.37"))
                    field("j.38", lineLabel("j.38"))
                }
                DisclosureGroup("Schedule D credits") {
                    ForEach(1 ... 9, id: \.self) { field("d.\($0)", lineLabel("d.\($0)")) }
                }
                DisclosureGroup("Schedule E payments") {
                    ForEach(["1", "2a", "2b", "3a", "3b", "4a", "4b", "5a", "5b", "6"], id: \.self) {
                        field("e.\($0)", lineLabel("e.\($0)"))
                    }
                }
                Link("Open TNTAP", destination: URL(string: "https://tntap.tn.gov")!)
            }
            if kind == "solo-calculator", !ledger.isEmpty {
                Section("Saved contributions") {
                    let rows = ledger["contributions"].array
                    let employee = rows.filter { $0["type"].string == "employee" }.reduce(0) { $0 + NativeWorksheet.number($1["amount"]) }
                    let employer = rows.filter { $0["type"].string == "employer" }.reduce(0) { $0 + NativeWorksheet.number($1["amount"]) }
                    let limit = results["totalContribution"].number ?? 0
                    LabeledContent("Employee contributed", value: amount(employee))
                    LabeledContent("Employer contributed", value: amount(employer))
                    LabeledContent("Total contributed", value: amount(employee + employer)).accessibilityElement(children: .combine).accessibilityIdentifier("contributionTotal")
                    LabeledContent("Remaining contribution", value: amount(max(0, limit - employee - employer)))
                    if limit > 0, !model.blurNumbers {
                        ProgressView(value: min(1, (employee + employer) / limit)).accessibilityLabel("Contribution progress")
                    }
                    Text("One combined ledger across all businesses.").font(.caption).foregroundStyle(.secondary)
                }
                ledgerLink(feature: "solo-401k", resource: "contributions", title: "Manage contributions")
            }
            if kind == "tn-calculator" {
                ledgerLink(feature: "tn-tax", resource: "assets", title: "Manage business assets")
            }
            if !results.isEmpty {
                Section("Calculated worksheet") { NativeValueSections(value: results) }
                if kind == "tn-calculator" {
                    DisclosureGroup("Calculated schedules") { NativeValueSections(value: NativeCalculators.tennesseeSchedules(numeric)) }
                }
            } else if invalidInput {
                Text("Correct the invalid worksheet inputs to calculate results.").foregroundStyle(.red)
            } else {
                Text("Contribution limits are not available for \(scope.year).")
            }
            if let error {
                ErrorNotice(message: error)
            }
            if !source.isEmpty {
                NavigationLink("Source financial summary") {
                    List { NativeValueSections(value: source) }.navigationTitle("Financial summary")
                }
            }
            Section {
                Button("Use source defaults") { values = [:] }.accessibilityIdentifier("resetWorksheet")
                if !results.isEmpty, !model.blurNumbers {
                    ShareLink("Share worksheet", item: worksheetText).accessibilityIdentifier("shareWorksheet")
                }
                Text("Overrides stay in this app session. Contributions and assets are saved in your vault.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .task {
            values = model.worksheetInputs[cacheKey] ?? [:]
            await load()
        }
        .onChange(of: values) { _, new in model.worksheetInputs[cacheKey] = new }
        .onAppear {
            if loaded {
                Task { await load() }
            }
        }
        .refreshable { await load() }
    }

    private var worksheetText: String {
        var lines = [kind == "solo-calculator" ? "Solo 401(k) worksheet" : "FAE170 worksheet", "Year: \(scope.year)", "Source: \(sourceName)"]
        for key in numeric.keys.sorted() {
            lines.append("\(NativeWorksheet.labels[key] ?? VaultValue.label(key)): \(numeric[key] ?? 0)")
        }
        for key in results.object.keys.sorted() {
            lines.append("\(VaultValue.label(key)): \(results[key].string)")
        }
        if kind == "tn-calculator" {
            for (schedule, value) in NativeCalculators.tennesseeSchedules(numeric).object.sorted(by: { $0.key < $1.key }) {
                lines.append(schedule)
                for (line, amount) in value.object.sorted(by: { $0.key.localizedStandardCompare($1.key) == .orderedAscending }) {
                    lines.append("\(line): \(amount.string)")
                }
            }
            for key in ["j2.6form", "j2.6schedule"] {
                if let value = values[key], !value.isEmpty {
                    lines.append("\(key): \(value)")
                }
            }
        }
        return lines.joined(separator: "\n")
    }

    @ViewBuilder private func ledgerLink(feature: String, resource: String, title: String) -> some View {
        if let resource = NativeCatalog.features.first(where: { $0.id == feature })?.resources.first(where: { $0.id == resource }) {
            NavigationLink(title) { NativeResourceView(resource: resource, scope: scope).navigationTitle(title) }
        }
    }

    private func lineLabel(_ id: String) -> String {
        "Line \(id.split(separator: ".").last ?? "") · \(NativeWorksheet.labels[id] ?? "Other business income")"
    }

    private func amount(_ value: Double) -> String {
        model.blurNumbers ? "••••" : value.formatted(.currency(code: "USD"))
    }

    private func load() async {
        let requestID = UUID()
        loadID = requestID
        loading = true
        error = nil
        defer {
            if loadID == requestID {
                loading = false
            }
        }
        do {
            if kind == "solo-calculator" {
                let all = try await model.nativeRequest("api/analytics/quick-stats/all/{year}", scope: scope)
                let entity = NativeWorksheet.soloEntity(all)
                let selected = entity.isEmpty ? all : try await model.nativeRequest("api/analytics/quick-stats/\(entity)/{year}", scope: scope)
                let config = try await model.nativeRequest("api/config", scope: scope)
                let metadata = config["entities"].array.first { $0["id"].string == entity }?["metadata"] ?? .null
                let contributions = try await model.nativeRequest("api/contributions/all/{year}", scope: scope)
                guard loadID == requestID, !Task.isCancelled else { return }
                defaults = NativeWorksheet.soloDefaults(all: all, selected: selected, entity: entity, metadata: metadata)
                source = selected
                sourceName = model.entities.first { $0.id == entity }?.name ?? "all tax entities"
                ledger = contributions
            } else {
                let files = try await model.nativeRequest("api/files/{entity}/{year}", scope: scope)
                let assets = try await model.nativeRequest("api/assets/{entity}", scope: scope)
                guard loadID == requestID, !Task.isCancelled else { return }
                defaults = NativeWorksheet.tennesseeDefaults(files: files["files"].array, year: scope.year, assets: assets)
                source = .object(["documentCount": .number(Double(files["files"].array.count)), "defaults": .object(defaults.mapValues(VaultValue.number))])
                sourceName = model.entities.first { $0.id == scope.entity }?.name ?? scope.entity
            }
            loaded = true
        } catch {
            if loadID == requestID {
                self.error = error.localizedDescription
            }
        }
    }

    private func field(_ id: String, _ title: String, numeric isNumeric: Bool = true) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField("0", text: Binding(get: { values[id] ?? defaults[id].map { String($0) } ?? "" }, set: { values[id] = $0 }))
                .keyboardType(isNumeric ? .numbersAndPunctuation : .default).accessibilityIdentifier("calculator-\(id)")
            if isNumeric, let raw = values[id], !raw.isEmpty, NativeWorksheet.parse(raw) == nil {
                Text("Enter a valid number.").font(.caption).foregroundStyle(.red)
            }
        }
    }
}
