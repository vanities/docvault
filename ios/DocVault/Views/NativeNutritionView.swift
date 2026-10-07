import Charts
import SwiftUI

struct NativeNutritionView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dynamicTypeSize) private var textSize
    @ScaledMetric(relativeTo: .caption) private var chartRowHeight: CGFloat = 35
    let resource: NativeResource
    let scope: VaultScope
    @State private var data: VaultValue = .null
    @State private var error: String?
    @State private var loading = false
    @State private var search = ""
    @State private var status = "all"
    @State private var category = "all"
    @State private var editor: NativeEditor?
    private var all: [NutritionProduct] {
        NativeNutrition.products(data)
    }

    private var taking: [NutritionProduct] {
        all.filter { $0.status == "active" }
    }

    private var visible: [NutritionProduct] {
        NativeNutrition.products(data, status: status, category: category, search: search)
    }

    var body: some View {
        List {
            VaultHero(title: "Your regimen", subtitle: "Keep products, label facts and research together. Review what you’re taking and what you’re considering.", symbol: "leaf", color: .teal, eyebrow: "HEALTH / NUTRITION").vaultStandaloneRow()
            if loading {
                ProgressView("Loading products…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !data.isEmpty {
                VaultMetricGrid(metrics: [
                    .init(title: "Taking", value: String(taking.count), symbol: "pills"),
                    .init(title: "Considering", value: String(all.filter { $0.status == "considering" }.count), symbol: "sparkle.magnifyingglass"),
                    .init(title: "Saved products", value: String(all.count), symbol: "square.stack"),
                    .init(title: "Label records", value: String(all.filter { !$0.parsed.isEmpty }.count), symbol: "list.bullet.rectangle"),
                ], color: .teal).vaultStandaloneRow()
                if !all.isEmpty {
                    overview
                }
                Section("Find products") {
                    Picker("Status", selection: $status) {
                        Text("All statuses").tag("all")
                        ForEach(Set(all.map(\.status)).sorted(), id: \.self) { Text(NativeNutrition.label($0)).tag($0) }
                    }.accessibilityIdentifier("nutritionStatus")
                    Picker("Category", selection: $category) {
                        Text("All categories").tag("all")
                        ForEach(Set(all.map(\.category)).sorted(), id: \.self) { Text(NativeNutrition.label($0)).tag($0) }
                    }.accessibilityIdentifier("nutritionCategory")
                }
                if status == "all" || status == "active" {
                    ForEach(NativeNutrition.times + ["unscheduled"], id: \.self) { time in
                        let products = visible.filter { $0.status == "active" && $0.time == time }
                        if !products.isEmpty {
                            Section("Taking · " + NativeNutrition.label(time)) { rows(products) }
                        }
                    }
                }
                ForEach(Set(visible.filter { $0.status != "active" }.map(\.status)).sorted(), id: \.self) { status in
                    Section(NativeNutrition.label(status)) { rows(visible.filter { $0.status == status }) }
                }
                if visible.isEmpty {
                    ContentUnavailableView(all.isEmpty ? "Start your product library" : "No matching products", systemImage: "leaf", description: Text(all.isEmpty ? "Add a product by name or import its label image. New products start in Considering." : "Try another status, category or search."))
                }
            }
            Section("Manage") {
                ForEach(resource.actions) { action in
                    Button(action.title, systemImage: action.id == "manual" ? "plus" : "photo.badge.plus") { editor = .init(action: action, record: .null, resource: resource) }
                        .accessibilityIdentifier("action-" + action.id)
                }
            }
        }.vaultDashboard(color: .teal).tint(.teal).accessibilityIdentifier("nativeNutrition")
            .searchable(text: $search, prompt: "Find a product, brand or note")
            .task { await load() }.refreshable { await load() }
            .sheet(item: $editor) { item in NativeEditorView(editor: item, scope: scope, context: data) { Task { await load() } }.privacyProtected() }
    }

    private var overview: some View {
        Section("Library overview") {
            if !model.blurNumbers {
                let counts = NativeNutrition.counts(all, key: \.status)
                Chart(counts) { item in BarMark(x: .value("Products", item.count), y: .value("Status", item.label)).foregroundStyle(.teal.gradient).cornerRadius(5) }
                    .frame(height: CGFloat(counts.count + 1) * chartRowHeight).chartXAxis { AxisMarks(values: .stride(by: 1)) }
                    .accessibilityIdentifier("nutritionStatusChart")
                DisclosureGroup("Categories · all saved products") {
                    let categories = NativeNutrition.counts(all, key: \.category)
                    Chart(categories) { item in BarMark(x: .value("Products", item.count), y: .value("Category", item.label)).foregroundStyle(.indigo.gradient).cornerRadius(4) }
                        .frame(height: CGFloat(categories.count + 1) * chartRowHeight).chartXAxis { AxisMarks(values: .stride(by: 1)) }
                        .chartYAxis {
                            if textSize.isAccessibilitySize {
                                AxisMarks(preset: .aligned, position: .leading) { value in AxisValueLabel {
                                    Text(value.as(String.self) ?? "").font(.caption).lineLimit(2)
                                        .fixedSize(horizontal: false, vertical: true).frame(maxWidth: 180, alignment: .leading)
                                } }
                            } else {
                                AxisMarks()
                            }
                        }
                        .accessibilityIdentifier("nutritionCategoryChart")
                }
            }
            if !taking.isEmpty {
                let recorded = taking.filter(\.hasDose).count
                let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout(spacing: 20))
                layout {
                    ZStack {
                        Circle().stroke(.teal.opacity(0.12), lineWidth: 8)
                        if !model.blurNumbers {
                            Circle().trim(from: 0, to: Double(recorded) / Double(taking.count)).stroke(.teal.gradient, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
                        }
                        Text(model.blurNumbers ? "••" : "\(recorded)/\(taking.count)").font(.system(.title3, design: .rounded, weight: .bold)).monospacedDigit()
                            .lineLimit(1).minimumScaleFactor(0.3).frame(width: 55)
                    }.frame(width: 75, height: 75)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(model.blurNumbers ? "Dose details hidden" : "\(recorded) of \(taking.count) taking products have dose details")
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Dose details").font(.headline)
                        Text("Taking products with a positive amount and a recorded unit.").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 8).accessibilityIdentifier("nutritionDoseCoverage")
            }
            Text("Counts describe this person’s saved library. Doses and label values are recorded instructions, not logged consumption.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func rows(_ products: [NutritionProduct]) -> some View {
        ForEach(products) { product in
            NavigationLink {
                NativeNutritionProductView(initial: product, resource: resource, scope: scope) { Task { await load() } }
            } label: {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: product.parsed.isEmpty ? "photo.badge.exclamationmark" : "pills").font(.title3).foregroundStyle(.teal)
                        .frame(width: 43, height: 43).background(.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(product.name).font(.headline)
                        Text([product.brand, NativeNutrition.label(product.category)].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        Text(model.blurNumbers ? "Dose hidden" : product.dose).font(.subheadline).foregroundStyle(.teal)
                        if !product.value["parseError"].string.isEmpty {
                            Label("Label needs review", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                        }
                    }
                    Spacer(minLength: 0)
                }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .teal, padding: 16)
            }.vaultStandaloneRow().accessibilityIdentifier("nutritionProduct-" + product.id)
        }
    }

    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let value = try await model.nativeRequest(resource.path, scope: scope)
            guard !Task.isCancelled else { return }
            data = value
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeNutritionProductView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let initial: NutritionProduct
    let resource: NativeResource
    let scope: VaultScope
    let changed: () -> Void
    @State private var value: VaultValue = .null
    @State private var tab = "Overview"
    @State private var error: String?
    @State private var loaded = false
    @State private var deleting = false
    @State private var editor: NativeEditor?
    private var product: NutritionProduct {
        value.isEmpty ? initial : .init(value: value)
    }

    private var collection: NativeCollection {
        resource.collections[0]
    }

    var body: some View {
        List {
            VaultHero(title: product.name, subtitle: [product.brand, NativeNutrition.label(product.category)].filter { !$0.isEmpty }.joined(separator: " · "), symbol: "pills", color: .teal, eyebrow: NativeNutrition.label(product.status).uppercased()).vaultStandaloneRow()
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            Picker("Details", selection: $tab) { ForEach(["Overview", "Facts", "Research"], id: \.self) { Text($0) } }
                .pickerStyle(.segmented).accessibilityIdentifier("nutritionDetailsTab")
            if tab == "Overview" {
                overview
            }
            if tab == "Facts" {
                facts
            }
            if tab == "Research" {
                research
            }
        }.vaultDashboard(color: .teal).tint(.teal).navigationTitle(product.name).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                Menu {
                    ForEach(NativeNutritionFields.groups, id: \.self) { group in
                        if group == "Nutrition facts" {
                            Menu(group) {
                                Button("Calories") { edit(group: "Calories", fields: NativeNutritionFields.edit.filter { $0.id == "parsed.macros.calories" }) }
                                ForEach(NativeNutrition.macros, id: \.self) { key in Button(VaultValue.label(key)) { edit(group: VaultValue.label(key), fields: NativeNutritionFields.edit.filter { $0.id.hasPrefix("parsed.macros." + key + ".") }) } }
                            }
                        } else {
                            Button(group) { edit(group: group, fields: NativeNutritionFields.fields(group)) }
                        }
                    }
                } label: { Label("Edit", systemImage: "pencil") }.disabled(!loaded).accessibilityIdentifier("nutritionEdit")
            }
            .task { await load() }.refreshable { await load() }
            .sheet(item: $editor) { item in NativeEditorView(editor: item, scope: scope, context: .null) { changed(); Task { await load() } }.privacyProtected() }
            .confirmationDialog("Delete this product and its label photos?", isPresented: $deleting, titleVisibility: .visible) {
                Button("Delete product", role: .destructive) {
                    Task {
                        do { try await model.nativeDelete(collection: collection, resource: resource, scope: scope, record: product.value); changed(); dismiss() }
                        catch { self.error = error.localizedDescription }
                    }
                }.accessibilityIdentifier("confirmDeleteNutrition")
            }
    }

    @ViewBuilder private var overview: some View {
        Section("Regimen") {
            Label(model.blurNumbers ? "Dose hidden" : product.dose, systemImage: "pills")
            Label(NativeNutrition.label(product.time), systemImage: "clock")
            if !product.value["notes"].string.isEmpty {
                Text(product.value["notes"].string).textSelection(.enabled)
            }
            Button("Edit regimen & notes") { edit(group: "Regimen & notes", fields: NativeNutritionFields.fields("Regimen & notes")) }.disabled(!loaded).accessibilityIdentifier("nutritionEditRegimen")
            if !product.value["dose"].isEmpty {
                Button("Clear recorded dose") {
                    Task {
                        do {
                            _ = try await model.nativeRequest(collection.updatePath, scope: scope, record: product.value, method: "PATCH", body: .object(["dose": .null]))
                            changed(); await load()
                        } catch { self.error = error.localizedDescription }
                    }
                }.disabled(!loaded).accessibilityIdentifier("nutritionClearDose")
            }
        }
        if !product.value["parseError"].string.isEmpty {
            Section("Label review") { Label("The label could not be parsed", systemImage: "exclamationmark.triangle").foregroundStyle(.orange); Text(product.value["parseError"].string).font(.caption).textSelection(.enabled) }
        }
        Section("Label photos") {
            NutritionLabelImage(product: product.value, scope: scope, slot: "primary", title: "Product photo")
            NutritionLabelImage(product: product.value, scope: scope, slot: "facts", title: "Facts label")
        }
        Section("Label tools") {
            ForEach(collection.actions) { action in Button(action.title) { editor = .init(action: action, record: product.value, resource: resource) }.disabled(!loaded).accessibilityIdentifier("nutritionAction-" + action.id) }
            Text("Reparsing uses the facts image when available. It replaces extracted label facts and keeps your regimen, notes and research.").font(.caption).foregroundStyle(.secondary)
        }
        instructions
        Section("Record") {
            LabeledContent("Updated", value: NativeNutrition.timestamp(product.value["lastUpdated"].string))
            if !product.parsed["parserVersion"].string.isEmpty {
                LabeledContent("Label parser", value: product.parsed["parserVersion"].string)
            }
            if let confidence = NativeNutrition.number(product.parsed["confidence"]), (0 ... 1).contains(confidence) {
                LabeledContent("Parser confidence", value: model.blurNumbers ? "••" : NativeNutrition.display(confidence * 100) + "%")
                Text("The parser’s extraction estimate. Review the facts against the label.").font(.caption).foregroundStyle(.secondary)
            }
            Button("Delete product", role: .destructive) { deleting = true }.disabled(!loaded).accessibilityIdentifier("nutritionDelete")
        }
    }

    @ViewBuilder private var facts: some View {
        if product.parsed.isEmpty {
            ContentUnavailableView("Label facts unavailable", systemImage: "list.bullet.rectangle", description: Text("Import or reparse a label, or enter its facts using Edit."))
        } else {
            Section("Per serving") {
                Text(model.blurNumbers ? "Serving hidden" : product.serving).font(.headline)
                if !product.parsed["servingsPerContainer"].isEmpty {
                    LabeledContent("Servings per container", value: model.blurNumbers ? "••" : product.parsed["servingsPerContainer"].string)
                }
                if let calories = NativeNutrition.number(product.parsed["macros"]["calories"]) {
                    LabeledContent("Calories", value: model.blurNumbers ? "••" : NativeNutrition.display(calories))
                }
                Text("Values are printed per label serving. Your recorded dose may differ.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(["macros", "vitamins", "minerals", "otherActive"], id: \.self) { key in
                let facts = NativeNutrition.facts(product.parsed, section: key)
                if !facts.isEmpty {
                    NutritionFactsSection(title: key == "macros" ? "Nutrition facts" : key == "otherActive" ? "Other active ingredients" : VaultValue.label(key), facts: facts)
                }
            }
            if !product.parsed["proprietaryBlends"].array.isEmpty {
                Section("Proprietary blends") {
                    ForEach(Array(product.parsed["proprietaryBlends"].array.enumerated()), id: \.offset) { index, blend in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(blend["name"].string).font(.headline)
                            if !blend["totalAmount"].isEmpty {
                                Text(model.blurNumbers ? "Amount hidden" : NutritionFact(id: String(index), name: "Total", value: blend["totalAmount"]).amount).font(.subheadline).foregroundStyle(.teal)
                            }
                            Text(blend["ingredients"].array.map(\.string).joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            instructions
            if !product.parsed["parserNotes"].string.isEmpty {
                Section("Parser notes") { Text(product.parsed["parserNotes"].string).textSelection(.enabled) }
            }
        }
    }

    @ViewBuilder private var instructions: some View {
        ForEach(["ingredients", "allergenInfo", "warnings"], id: \.self) { key in
            if !product.parsed[key].array.isEmpty {
                Section(key == "allergenInfo" ? "Allergens" : VaultValue.label(key)) { ForEach(Array(product.parsed[key].array.enumerated()), id: \.offset) { _, item in Text(item.string).textSelection(.enabled) } }
            }
        }
        if !product.parsed["directions"].string.isEmpty {
            Section("Label directions") { Text(product.parsed["directions"].string).textSelection(.enabled) }
        }
    }

    @ViewBuilder private var research: some View {
        Section("Saved research") {
            if product.value["research"].string.isEmpty {
                Text("No research saved for this product.").foregroundStyle(.secondary)
            } else {
                Text(LocalizedStringKey(product.value["research"].string)).textSelection(.enabled)
            }
        }
        Section("References") {
            if product.value["citations"].array.isEmpty {
                Text("No references saved.").foregroundStyle(.secondary)
            }
            ForEach(Array(product.value["citations"].array.enumerated()), id: \.offset) { _, citation in
                VStack(alignment: .leading, spacing: 8) {
                    Text(citation["title"].string).font(.headline)
                    Text([citation["authors"].string, NativeNutrition.number(citation["year"])?.formatted(.number.grouping(.never)) ?? citation["year"].string, citation["journal"].string].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    if !citation["findings"].string.isEmpty {
                        Text(citation["findings"].string).font(.subheadline).textSelection(.enabled)
                    }
                    if !citation["pmid"].string.isEmpty {
                        Text("PMID: " + citation["pmid"].string).font(.caption)
                    }
                    if !citation["doi"].string.isEmpty {
                        Text("DOI: " + citation["doi"].string).font(.caption)
                    }
                    if let url = NativeNutrition.citationURL(citation) {
                        Link("Open source", destination: url)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).vaultCard(color: .teal, padding: 16).vaultStandaloneRow()
            }
        }
    }

    private func edit(group: String, fields: [NativeField]) {
        editor = .init(action: .init(id: "edit", title: group, path: collection.updatePath, method: "PATCH", fields: fields), record: product.value, resource: resource, collection: collection, editing: true)
    }

    private func load() async {
        error = nil
        do {
            let response = try await model.nativeRequest(collection.detailPath, scope: scope, record: initial.value)
            guard !Task.isCancelled else { return }
            value = response["entry"]; loaded = !value.isEmpty
        } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct NutritionFactsSection: View {
    @Environment(VaultModel.self) private var model
    @ScaledMetric(relativeTo: .caption) private var chartRowHeight: CGFloat = 35
    let title: String
    let facts: [NutritionFact]
    var body: some View {
        Section(title) {
            let plotted = facts.filter { $0.dailyValue != nil }
            if !model.blurNumbers, plotted.contains(where: { ($0.dailyValue ?? 0) > 0 }) {
                Chart(plotted) { fact in BarMark(x: .value("Daily value (%)", fact.dailyValue!), y: .value("Nutrient", fact.id)).foregroundStyle(.teal.gradient).cornerRadius(4) }
                    .chartYAxis { AxisMarks { value in AxisValueLabel {
                        if let id = value.as(String.self) {
                            Text(plotted.first { $0.id == id }?.name ?? id)
                        }
                    } } }
                    .frame(height: CGFloat(plotted.count + 1) * chartRowHeight).accessibilityIdentifier("nutritionFactsChart-" + title)
                Text("Daily value (%) as printed on the label. Unlisted values are excluded; no daily intake is inferred.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(facts) { fact in
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .top) {
                        Text(fact.name).font(.subheadline.weight(.semibold)); Spacer()
                        Text(model.blurNumbers ? "••" : fact.amount).font(.subheadline).monospacedDigit().multilineTextAlignment(.trailing)
                    }
                    if let dv = fact.dailyValue {
                        Text(model.blurNumbers ? "Daily value hidden" : NativeNutrition.display(dv) + "% DV").font(.caption).foregroundStyle(.teal)
                    } else {
                        Text("Daily value not recorded").font(.caption).foregroundStyle(.secondary)
                    }
                    if !fact.value["form"].string.isEmpty {
                        Text(fact.value["form"].string).font(.caption).foregroundStyle(.secondary)
                    }
                    if !fact.value["notes"].string.isEmpty {
                        Text(fact.value["notes"].string).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }.padding(.vertical, 4)
            }
        }
    }
}

private struct NutritionLabelImage: View {
    @Environment(VaultModel.self) private var model
    let product: VaultValue
    let scope: VaultScope
    let slot: String
    let title: String
    @State private var image: UIImage?
    @State private var loading = false
    @State private var failed = false
    @State private var retry = 0
    private var present: Bool {
        !product[slot == "facts" ? "factsImagePath" : "imagePath"].string.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            if let image {
                NavigationLink {
                    ScrollView([.horizontal, .vertical]) { Image(uiImage: image).accessibilityLabel(title).padding() }.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                } label: { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: 260).clipShape(RoundedRectangle(cornerRadius: 14)).accessibilityLabel(title + " · open image") }
                    .accessibilityIdentifier("nutritionImage-" + slot)
            } else if loading {
                ProgressView("Loading image…")
            } else {
                Label(present ? "Image unavailable" : "No image saved", systemImage: "photo").foregroundStyle(.secondary)
                if failed {
                    Button("Retry image") { retry += 1 }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
            .task(id: product["lastUpdated"].string + String(retry)) {
                image = nil; failed = false
                guard present else { return }
                loading = true
                defer { loading = false }
                do {
                    let result = try await model.nutritionImage(product: product, scope: scope, slot: slot)
                    guard !Task.isCancelled else { return }
                    image = result; failed = result == nil
                } catch {
                    if !Task.isCancelled {
                        failed = true
                    }
                }
            }
    }
}
