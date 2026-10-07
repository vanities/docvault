import Charts
import SwiftUI
import UniformTypeIdentifiers

struct NativeWorkspaceView: View {
    @State private var search = ""
    var body: some View {
        NavigationStack {
            List {
                if search.isEmpty {
                    VaultHero(title: "Explore your vault", subtitle: "Documents, finances, health and work — connected in one workspace.", symbol: "square.grid.2x2", eyebrow: "WORKSPACE").vaultStandaloneRow()
                }
                ForEach(NativeCatalog.groups, id: \.self) { group in
                    Section(group) {
                        ForEach(
                            NativeCatalog.features.filter {
                                $0.group == group
                                    && (search.isEmpty
                                        || $0.title.localizedCaseInsensitiveContains(search))
                            }
                        ) { feature in
                            NavigationLink {
                                if ["chat", "chat-history"].contains(feature.id) {
                                    NativeChatView()
                                } else {
                                    NativeFeatureView(feature: feature)
                                }
                            } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: feature.symbol).font(.body.weight(.medium))
                                        .foregroundStyle(VaultPalette.accent(group)).frame(width: 40, height: 40)
                                        .background(VaultPalette.accent(group).opacity(0.1), in: RoundedRectangle(cornerRadius: 13))
                                    Text(feature.title).font(.body.weight(.medium))
                                }.padding(.vertical, 3)
                            }
                            .accessibilityIdentifier("feature-\(feature.id)")
                        }
                    }
                }
                Section {
                    NavigationLink("Full web interface") { WorkspaceView() }
                }
            }
            .vaultDashboard().navigationTitle("Workspace")
            .searchable(text: $search, prompt: "Find a feature")
        }
    }
}

struct NativeFeatureView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dynamicTypeSize) private var textSize
    let feature: NativeFeature
    @State private var scope = VaultScope()
    @State private var resourceID = ""
    @State private var people: [VaultValue] = []
    @State private var chooseSection = false
    @State private var chooseScope = false
    init(feature: NativeFeature, initialScope: VaultScope = .init()) {
        self.feature = feature
        _scope = State(initialValue: initialScope)
    }

    private var globalSnapshot: Bool {
        ["financial-snapshot", "debt-snapshot", "retirement-snapshot", "federal-snapshot"].contains(resource.id)
    }

    private var hasEntityScope: Bool {
        feature.entityScoped && !globalSnapshot
    }

    var resource: NativeResource {
        feature.resources.first { $0.id == resourceID } ?? feature.resources[0]
    }

    var body: some View {
        VStack(spacing: 0) {
            if hasEntityScope || feature.yearScoped || feature.personScoped
                || (feature.resources.count > 1 && !toolbarSection)
            {
                if compactScope {
                    Button { chooseScope = true } label: {
                        Label("Options", systemImage: "slider.horizontal.3")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.bordered).accessibilityLabel("View options").accessibilityValue(scopeDescription)
                        .accessibilityIdentifier("featureScope").padding(.horizontal).padding(.vertical, 8)
                } else {
                    let scopeLayout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout())
                    scopeLayout { scopePickers() }.pickerStyle(.menu).padding(.horizontal).padding(.vertical, 8)
                }
            }
            if feature.personScoped, scope.person.isEmpty {
                ContentUnavailableView(
                    "Add a person", systemImage: "person.badge.plus",
                    description: Text("Manage people in Health to start tracking records.")
                )
            } else if feature.id == "portfolio" {
                NativePortfolioView(scope: scope)
            } else if resource.id == "health-people" {
                NativeHealthPeopleView(resource: resource)
            } else if ["banks", "broker-portfolio"].contains(resource.id) {
                NativeFinanceView(resource: resource, scope: scope).id(resource.id)
            } else if ["health-activity", "health-heart", "health-sleep", "health-workouts", "health-body"].contains(resource.id) {
                NativeHealthSegmentView(resource: resource, scope: scope).id(resource.id + scope.person)
            } else if resource.id == "nutrition" {
                NativeNutritionView(resource: resource, scope: scope).id(scope.person)
            } else if ["tax-summary", "tax-analytics"].contains(resource.id) {
                NativeTaxYearView(resource: resource, scope: scope).id(resource.id + scope.entity + String(scope.year))
            } else if globalSnapshot {
                NativeFinancialSnapshotView(resource: resource, scope: scope).id(resource.id + String(scope.year))
            } else if ["sales", "mileage"].contains(resource.id) {
                NativeBusinessView(resource: resource, scope: scope).id(resource.id + scope.entity + String(scope.year))
            } else if ResearchDomain.resource(resource) != nil {
                NativeResearchInboxView(resource: resource, scope: scope).id(resource.id)
            } else if ["deep-research", "daily-news"].contains(resource.id) {
                NativeKnowledgeJobsView(kind: resource.id == "deep-research" ? .research : .news).id(resource.id)
            } else if resource.id == "clinical" {
                NativeClinicalView(resource: resource, scope: scope).id(scope.person)
            } else if resource.id == "health-sync" {
                NativeHealthSyncView(scope: scope).id(scope.person)
            } else if resource.id == "codex-login" {
                NativeCodexLoginView()
            } else if feature.id == "settings", ["jobs", "status", "cache"].contains(resource.id) {
                NativeOperationsView(resource: resource).id(resource.id)
            } else if feature.id == "settings", resource.id == "logs" {
                NativeLogsView()
            } else if feature.id == "settings", resource.id == "usage" {
                NativeUsageView()
            } else if feature.id == "settings", resource.id == "brain" {
                NativeBrainView()
            } else if feature.id == "settings", resource.id == "skills" {
                NativeSkillsView()
            } else if feature.id == "settings", resource.id == "email-log" {
                NativeEmailLogView()
            } else if feature.id == "settings", NativeProviderSettings.resourceIDs.contains(resource.id) {
                NativeProviderSettingsView(resource: resource).id(resource.id)
            } else if resource.id == "external-sources" {
                NativeExternalSourcesView()
            } else if resource.id == "politics-feed" {
                NativePoliticalFeed(resource: resource)
            } else if resource.id == "politics-research-links" {
                NativePoliticalResearchView()
            } else if resource.id == "politics-filings" {
                NativePoliticalArchive(kind: "filings")
            } else if resource.id == "quant-tickers" {
                NativeTickerView()
            } else if resource.id == "quant-overview" {
                NativeQuantOverviewView()
            } else if resource.id == "quant-macro-calendar" {
                NativeMacroCalendarView()
            } else if ["quant-predictions", "predictions"].contains(resource.id) {
                NativePredictionsView(resource: resource)
            } else if ["politics-trades", "politics-top-spenders", "politics-clusters", "politics-backtest"].contains(resource.id) {
                NativePoliticsView(resource: resource).id(resource.id)
            } else if feature.id == "quant", !["quant-research", "quant-predictions", "quant-macro-calendar"].contains(resource.id) {
                NativeQuantView(resource: resource).id(resource.id)
            } else if resource.id == "time-analytics" {
                NativeTimesheetAnalytics()
            } else if resource.id == "weekly-report" {
                NativeTimesheetReportView()
            } else if resource.id == "billing-invoices" {
                NativeInvoicesView()
            } else if resource.id == "calendar-month" {
                NativeCalendarView()
            } else if ["all-files", "business-docs"].contains(resource.id) {
                NativeFileListView(resource: resource, scope: scope).id(resource.id + scope.entity)
            } else if ["solo-calculator", "tn-calculator"].contains(resource.id) {
                NativeCalculatorView(kind: resource.id, scope: scope).id(
                    resource.id + scope.entity + String(scope.year)
                )
            } else {
                NativeResourceView(resource: resource, scope: scope)
                    .id(
                        resource.id + "-" + scope.entity + "-" + scope.person + "-"
                            + String(scope.year)
                    )
            }
        }
        .vaultDashboard(color: VaultPalette.accent(feature.group)).tint(VaultPalette.accent(feature.group))
        .navigationTitle(feature.title).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if toolbarSection {
                ToolbarItem(placement: .topBarTrailing) {
                    if feature.resources.count > 12 {
                        Button { chooseSection = true } label: { Image(systemName: "square.grid.2x2") }
                            .accessibilityLabel("Section, " + resource.title).accessibilityIdentifier("featureSection")
                    } else {
                        Menu {
                            Picker("Section", selection: $resourceID) {
                                ForEach(feature.resources) { Text($0.title).tag($0.id) }
                            }
                        } label: { Image(systemName: "square.grid.2x2") }
                            .accessibilityLabel("Section, " + resource.title).accessibilityIdentifier("featureSection")
                    }
                }
            }
        }
        .sheet(isPresented: $chooseSection) {
            NativeSectionChooser(resources: feature.resources, selection: $resourceID).privacyProtected()
        }
        .sheet(isPresented: $chooseScope) {
            NavigationStack {
                Form { scopePickers(inSheet: true) }.pickerStyle(.menu)
                    .navigationTitle("View options").navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { chooseScope = false }.accessibilityIdentifier("closeFeatureScope")
                        }
                    }
            }.privacyProtected()
        }
        .task {
            if scope.entity.isEmpty {
                scope.entity = model.entities.first(where: { feature.id != "tax-year" || $0.isTax })?.id ?? ""
            }
            if resourceID.isEmpty {
                resourceID = feature.resources.first?.id ?? ""
            }
            if feature.personScoped {
                do {
                    let data = try await model.nativeRequest("api/health/people", scope: scope)
                    guard !Task.isCancelled else { return }
                    people = data["people"].array.filter { $0["archivedAt"].string.isEmpty }
                    if !people.contains(where: { $0["id"].string == scope.person }) {
                        scope.person = people.first?["id"].string ?? ""
                    }
                } catch {
                    if !Task.isCancelled {
                        model.error = error.localizedDescription
                    }
                }
            }
        }
    }

    private var compactScope: Bool {
        let count = [hasEntityScope, feature.yearScoped, feature.personScoped, feature.resources.count > 1].filter(\.self).count
        return textSize.isAccessibilitySize && (count > 2 || globalSnapshot || ["sales", "mileage"].contains(feature.id))
    }

    private var toolbarSection: Bool {
        textSize.isAccessibilitySize && ["deep-research", "daily-news", "settings"].contains(feature.id) && feature.resources.count > 1
    }

    private var scopeDescription: String {
        let entityName = scope.entity == "all" ? "All tax entities" : model.entities.first { $0.id == scope.entity }?.name ?? scope.entity
        return [globalSnapshot ? "Whole vault" : hasEntityScope ? entityName : "",
                feature.yearScoped ? String(scope.year) : "",
                feature.personScoped ? people.first { $0["id"].string == scope.person }?["name"].string ?? "" : "",
                resource.title].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    @ViewBuilder private func scopePickers(inSheet: Bool = false) -> some View {
        if hasEntityScope {
            Picker("Entity", selection: $scope.entity) {
                if feature.id == "tax-year" {
                    Text("All tax entities").tag("all")
                } else if ["sales", "mileage"].contains(feature.id) {
                    Text("All entities").tag("all")
                }
                ForEach(model.entities.filter { feature.id != "tax-year" || $0.isTax }) { Text($0.name).tag($0.id) }
            }.accessibilityIdentifier("featureEntity")
        }
        if feature.yearScoped {
            Picker("Year", selection: $scope.year) {
                ForEach((2000 ... (Calendar.current.component(.year, from: Date()) + 1)).reversed(), id: \.self) {
                    Text(String($0)).tag($0)
                }
            }.accessibilityIdentifier("featureYear")
        }
        if feature.personScoped {
            Picker("Person", selection: $scope.person) {
                ForEach(people, id: \.self) { Text($0["name"].string).tag($0["id"].string) }
            }.accessibilityIdentifier("featurePerson")
        }
        if feature.resources.count > 1, !toolbarSection || inSheet {
            if feature.resources.count > 12, !inSheet {
                Button { chooseSection = true } label: {
                    HStack { Text(resource.title).lineLimit(1); Image(systemName: "chevron.down") }
                }.accessibilityLabel("Section, " + resource.title).accessibilityIdentifier("featureSection")
            } else {
                Picker("Section", selection: $resourceID) {
                    ForEach(feature.resources) { Text($0.title).tag($0.id) }
                }.accessibilityIdentifier("featureSection")
            }
        }
    }
}

struct NativeSectionChooser: View {
    @Environment(\.dismiss) private var dismiss
    let resources: [NativeResource]
    @Binding var selection: String
    @State private var search = ""
    var body: some View {
        NavigationStack {
            List(resources.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { resource in
                Button { selection = resource.id; dismiss() } label: {
                    HStack {
                        Text(resource.title)
                        Spacer()
                        if selection == resource.id {
                            Image(systemName: "checkmark")
                        }
                    }.contentShape(.rect)
                }.accessibilityIdentifier("section-" + resource.id)
            }
            .searchable(
                text: $search,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Find a section"
            )
            .navigationTitle("Sections")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct NativeResourceView: View {
    @Environment(VaultModel.self) private var model
    let resource: NativeResource
    let scope: VaultScope
    @State private var data: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var editor: NativeEditor?
    @State private var search = ""
    @State private var recordVoice = false
    var body: some View {
        List {
            if loading {
                ProgressView("Loading…")
            }
            if let error {
                ErrorNotice(message: error)
                Button("Retry") { Task { await load() } }
            }
            if resource.id == "health-voice" {
                Button("Record voice sample", systemImage: "mic") { recordVoice = true }
            }
            if !resource.actions.isEmpty {
                Section("Actions") {
                    ForEach(resource.actions) { action in
                        Button(action.title) {
                            editor = .init(action: action, record: data, resource: resource)
                        }
                        .accessibilityIdentifier("action-\(action.id)")
                    }
                }
            }
            if !resource.editFields.isEmpty {
                Button("Edit \(resource.title)", systemImage: "pencil") {
                    editor = .init(
                        action: .init(
                            id: "edit", title: "Edit \(resource.title)",
                            path: resource.editPath.isEmpty ? resource.path : resource.editPath,
                            method: resource.editMethod, fields: resource.editFields
                        ),
                        record: data.at(resource.dataPath), resource: resource, editing: true
                    )
                }.accessibilityIdentifier("editResource")
            }
            ForEach(resource.collections) { collection in
                Section {
                    let records = data.at(collection.path).array.map { item -> VaultValue in
                        var row = item
                        for (key, value) in item["manifest"].object {
                            row.set(key, value)
                        }
                        return row
                    }
                    if records.isEmpty, !loading {
                        Text("No \(collection.title.lowercased()) yet.").foregroundStyle(.secondary)
                    }
                    ForEach(Array(records.enumerated()), id: \.offset) { _, record in
                        if search.isEmpty || record.title.localizedCaseInsensitiveContains(search) {
                            NavigationLink {
                                NativeRecordView(
                                    record: record, collection: collection, resource: resource,
                                    scope: scope, changed: { Task { await load() } }
                                )
                            } label: {
                                NativeRecordRow(record: record)
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text(collection.title)
                        Spacer()
                        if !collection.createPath.isEmpty {
                            Button("Add", systemImage: "plus") {
                                editor = .init(
                                    action: .init(
                                        id: "add", title: "Add \(collection.title)",
                                        path: collection.createPath, fields: collection.fields
                                    ),
                                    record: .object([:]), resource: resource, collection: collection
                                )
                            }.accessibilityIdentifier("add-\(collection.id)")
                        }
                    }
                }
            }
            if !data.isEmpty {
                let excluded = Set(
                    resource.collections.map {
                        $0.path.split(separator: ".").first.map(String.init) ?? ""
                    }
                )
                NativeValueSections(value: data, excluded: excluded)
            } else if !loading, error == nil {
                ContentUnavailableView("No records yet", systemImage: "tray")
            }
        }
        .vaultDashboard(color: VaultPalette.resourceAccent(resource.id))
        .accessibilityIdentifier("nativeResource-\(resource.id)")
        .searchable(text: $search, prompt: "Filter records")
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $recordVoice) {
            NativeVoiceRecorder(person: scope.person).privacyProtected()
        }
        .sheet(item: $editor) { item in
            NativeEditorView(editor: item, scope: scope, context: data) { Task { await load() } }
                .privacyProtected()
        }
    }

    private func load() async {
        loading = true
        error = nil
        defer { loading = false }
        do { data = try await model.nativeRequest(resource.path, scope: scope) } catch {
            if !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

struct NativeRecordRow: View {
    let record: VaultValue
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(record.title).font(.headline).lineLimit(2)
            let subtitles = [
                "date", "status", "symbol", "type", "kind", "frequency", "source", "updatedAt",
            ].compactMap { key -> String? in
                let value = record[key].string
                return value.isEmpty || value == record.title ? nil : value
            }
            if !subtitles.isEmpty {
                Text(subtitles.prefix(3).joined(separator: " · ")).font(.caption).foregroundStyle(
                    .secondary
                )
            }
        }.padding(.vertical, 3)
    }
}

struct NativeRecordView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let record: VaultValue
    let collection: NativeCollection
    let resource: NativeResource
    let scope: VaultScope
    let changed: () -> Void
    @State private var detail: VaultValue = .null
    @State private var editor: NativeEditor?
    @State private var deleting = false
    @State private var error: String?
    private var editableRecord: VaultValue {
        var value = record
        let candidate =
            resource.id == "annotations"
                ? record["annotation"] : !detail["entry"].isEmpty ? detail["entry"] : detail
        for (key, field) in candidate.object {
            value.set(key, field)
        }
        value.set("id", record["id"])
        return value
    }

    var body: some View {
        if collection.detailPath == "api/research/{id}", ResearchDomain.resource(resource) != nil {
            NativeResearchEntryView(record: record, resource: resource, scope: scope, changed: changed)
        } else {
            genericBody
        }
    }

    private var genericBody: some View {
        List {
            if let error {
                ErrorNotice(message: error)
            }
            if resource.id == "liabilities" {
                NavigationLink("Loan payoff calculator") { NativeLoanView(loan: record) }
            }
            if resource.id == "property", !record["mortgage"].isEmpty {
                NavigationLink("Mortgage payoff calculator") {
                    NativeLoanView(loan: record["mortgage"])
                }
            }
            if resource.id == "external-sources" {
                NavigationLink("Browse repository files") {
                    NativeSourceFilesView(repository: record)
                }
            }
            if collection.detailPath == "api/research/{id}", !editableRecord["text"].isEmpty {
                NavigationLink("Read source text") {
                    ScrollView { Text(editableRecord["text"].string).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding() }
                        .navigationTitle(record.title).navigationBarTitleDisplayMode(.inline)
                }.accessibilityIdentifier("readResearchText")
            }
            if !collection.updatePath.isEmpty {
                Button("Edit", systemImage: "pencil") {
                    editor = .init(
                        action: .init(
                            id: "edit", title: "Edit \(record.title)", path: collection.updatePath,
                            method: collection.updateMethod, fields: collection.fields
                        ),
                        record: editableRecord, resource: resource, collection: collection,
                        editing: true
                    )
                }.accessibilityIdentifier("editRecord").disabled(
                    !collection.detailPath.isEmpty && detail.isEmpty
                )
            }
            ForEach(collection.actions) { action in
                Button(action.title) {
                    editor = .init(
                        action: action, record: record, resource: resource
                    )
                }
            }
            NativeValueSections(value: detail.isEmpty ? record : detail)
            if !collection.deletePath.isEmpty {
                Button(collection.deleteTitle, role: .destructive) { deleting = true }.accessibilityIdentifier(
                    "deleteRecord"
                )
            }
        }
        .navigationTitle(record.title).navigationBarTitleDisplayMode(.inline)
        .task {
            if !collection.detailPath.isEmpty {
                do {
                    repeat {
                        detail = try await model.nativeRequest(
                            collection.detailPath, scope: scope, record: record
                        )
                        if !["running", "queued", "processing"].contains(detail["status"].string) {
                            break
                        }
                        try await Task.sleep(for: .seconds(2))
                    } while !Task.isCancelled
                } catch { self.error = error.localizedDescription }
            }
        }
        .confirmationDialog(
            collection.deleteTitle + " this record?", isPresented: $deleting, titleVisibility: .visible
        ) {
            Button(collection.deleteTitle, role: .destructive) {
                Task {
                    do {
                        try await model.nativeDelete(
                            collection: collection, resource: resource, scope: scope, record: record
                        )
                        changed()
                        dismiss()
                    } catch { self.error = error.localizedDescription }
                }
            }.accessibilityIdentifier("confirmDeleteRecord")
        }
        .sheet(item: $editor) { item in
            NativeEditorView(editor: item, scope: scope, context: .null) {
                changed()
                dismiss()
            }.privacyProtected()
        }
    }
}

struct NativeValueSections: View {
    @Environment(VaultModel.self) private var model
    let value: VaultValue
    var excluded: Set<String> = []
    var body: some View {
        ForEach(
            value.object.keys.sorted().filter {
                !excluded.contains($0) && !VaultValue.isSecret($0) && $0 != "ok"
            }, id: \.self
        ) { key in
            NativeValueRow(label: VaultValue.label(key), value: value[key])
        }
        if case let .array(values) = value {
            ForEach(Array(values.enumerated()), id: \.offset) { _, item in
                NavigationLink(item.title) {
                    List { NativeValueSections(value: item) }.navigationTitle(item.title)
                }
            }
        }
        if case let .string(text) = value {
            Text(.init(text)).textSelection(.enabled)
        }
    }
}

struct NativeValueRow: View {
    @Environment(VaultModel.self) private var model
    let label: String
    let value: VaultValue
    var body: some View {
        switch value {
        case .object:
            if !value.isEmpty {
                NavigationLink(label) {
                    List { NativeValueSections(value: value) }.navigationTitle(label)
                }
            }
        case let .array(values):
            NavigationLink {
                List {
                    NativeSeriesChart(values: values)
                    ForEach(Array(values.enumerated()), id: \.offset) { _, item in
                        if item.object.isEmpty {
                            Text(item.string).textSelection(.enabled)
                        } else {
                            NavigationLink {
                                List { NativeValueSections(value: item) }.navigationTitle(
                                    item.title
                                )
                            } label: {
                                NativeRecordRow(record: item)
                            }
                        }
                    }
                }.navigationTitle(label)
            } label: {
                LabeledContent(label, value: "\(values.count)")
            }
        case let .string(text):
            if text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<!doctype")
                || text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<html")
                || (label == "Html" && text.contains("<"))
            {
                NavigationLink("Open formatted report") {
                    NativeHTMLPreview(html: text).navigationTitle("Report")
                }
            } else if let url = URL(string: text), ["https", "http"].contains(url.scheme ?? "") {
                Link(label, destination: url)
            } else if text.count > 120 || text.contains("\n") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(label).font(.caption).foregroundStyle(.secondary)
                    Text(.init(text)).textSelection(.enabled)
                }
            } else if !text.isEmpty {
                LabeledContent(label, value: text).textSelection(.enabled)
            }
        case let .number(number):
            LabeledContent(
                label,
                value: model.blurNumbers
                    ? "••••" : number.formatted(.number.precision(.fractionLength(0 ... 4)))
            )
        case let .bool(value): LabeledContent(label, value: value ? "Yes" : "No")
        case .null: EmptyView()
        }
    }
}

struct NativeSeriesChart: View {
    @Environment(VaultModel.self) private var model
    let values: [VaultValue]
    @State private var selected = ""
    var numericKeys: [String] {
        let keys = Set(
            values.prefix(50).flatMap {
                $0.object.filter { $0.value.number != nil && !["id", "year"].contains($0.key) }.keys
            }
        )
        return keys.sorted()
    }

    var body: some View {
        let key = numericKeys.contains(selected) ? selected : (numericKeys.first ?? "")
        if values.count > 1, !key.isEmpty, !model.blurNumbers {
            Section("Trend") {
                Picker("Metric", selection: $selected) {
                    ForEach(numericKeys, id: \.self) { Text(VaultValue.label($0)).tag($0) }
                }.pickerStyle(.menu)
                Chart(Array(values.suffix(365).enumerated()), id: \.offset) { index, value in
                    if let amount = value[key].number {
                        LineMark(
                            x: .value("Period", index), y: .value(VaultValue.label(key), amount)
                        ).foregroundStyle(.indigo)
                    }
                }.frame(height: 190).accessibilityLabel("\(VaultValue.label(key)) trend")
            }
        }
    }
}

struct NativeEditor: Identifiable {
    let id = UUID()
    let action: NativeAction
    let record: VaultValue
    let resource: NativeResource
    var collection: NativeCollection?
    var editing = false
}

struct NativeEditorView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editor: NativeEditor
    let scope: VaultScope
    let context: VaultValue
    let changed: () -> Void
    @State private var values: [String: String] = [:]
    @State private var references: [String: [VaultValue]] = [:]
    @State private var saving = false
    @State private var error: String?
    @State private var result: VaultValue = .null
    @State private var preview: URL?
    @State private var filePicker = false
    @State private var upload: UploadDraft?
    @State private var staging = false
    @State private var importTask: Task<Void, Never>?
    @State private var filename = ""
    @State private var confirmAction = false
    @State private var imageField: String?
    @State private var imagePicker = false
    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error)
                }
                ForEach(editor.action.fields.filter { $0.id != "domain" || ResearchDomain.resource(editor.resource) == nil }) { field in
                    fieldView(field).accessibilityIdentifier("field-\(field.id)")
                }
                if editor.action.response == "upload" {
                    Button(filename.isEmpty ? "Choose file" : filename) { filePicker = true }
                        .disabled(saving || staging).accessibilityIdentifier("chooseImportFile")
                    if let upload {
                        Text(ByteCountFormatter.string(fromByteCount: upload.size, countStyle: .file)).font(.caption).foregroundStyle(.secondary)
                    }
                    if staging {
                        ProgressView("Preparing file…")
                    }
                }
                if saving {
                    ProgressView("Working…")
                }
                if !result.isEmpty {
                    Section("Result") { NativeValueSections(value: result) }
                }
                Button(editor.editing ? "Save" : editor.action.title) { submitOrConfirm() }
                    .disabled(saving || staging || (editor.action.response == "upload" && upload == nil))
                    .accessibilityIdentifier("submitNativeFormInline")
            }
            .navigationTitle(editor.action.title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(saving || staging) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editor.editing ? "Save" : editor.collection == nil ? "Run" : "Add") { submitOrConfirm() }
                        .disabled(saving || staging || (editor.action.response == "upload" && upload == nil))
                        .accessibilityIdentifier("submitNativeForm")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("nativeFormKeyboardDone")
                }
            }
            .confirmationDialog(
                editor.action.title + "?", isPresented: $confirmAction, titleVisibility: .visible
            ) { Button(editor.action.title, role: .destructive) { Task { await submit() } } }
            .task {
                for field in editor.action.fields {
                    values[field.id] = NativeForm.display(editor.record.at(field.id), field: field)
                    if values[field.id]?.isEmpty == true {
                        if ["entity", "entityId"].contains(field.id), !scope.entity.isEmpty, scope.entity != "all", !editor.editing {
                            values[field.id] = scope.entity
                        }
                        if field.id == "year" {
                            values[field.id] = String(scope.year)
                        }
                    }
                    let source: String? = switch field.kind {
                    case let .reference(name), let .references(name): name
                    default: nil
                    }
                    if let source {
                        if source == "entities" {
                            references[source] = model.entities.map {
                                .object(["id": .string($0.id), "name": .string($0.name)])
                            }
                        } else if source == "subClients" {
                            var data = context
                            if context["projects"].isEmpty {
                                data = (try? await model.nativeRequest("api/timesheet", scope: scope)) ?? .null
                            }
                            references["projects"] = data["projects"].array
                            references[source] = data["projects"].array.flatMap {
                                $0["subClients"].array
                            }
                        } else if !context[source].array.isEmpty {
                            references[source] = context[source].array
                        } else {
                            do {
                                let data = try await model.nativeRequest(
                                    ["exchanges", "wallets", "manualHoldings"].contains(source)
                                        ? "api/crypto/settings"
                                        : source == "people"
                                        ? "api/health/people"
                                        : ["products", "sales"].contains(source)
                                        ? "api/sales"
                                        : ["vehicles", "savedAddresses"].contains(source)
                                        ? "api/mileage" : "api/timesheet",
                                    scope: scope
                                )
                                references[source] = data[source].array
                            } catch { self.error = error.localizedDescription }
                        }
                    }
                }
            }
            .fileImporter(
                isPresented: $imagePicker, allowedContentTypes: [.png, .jpeg, .gif, .webP],
                allowsMultipleSelection: true
            ) { selection in
                do {
                    let urls = try selection.get()
                    guard urls.count <= 8 else { throw VaultError.server("Choose up to eight images.") }
                    var items: [VaultValue] = []
                    for url in urls {
                        let access = url.startAccessingSecurityScopedResource()
                        defer {
                            if access {
                                url.stopAccessingSecurityScopedResource()
                            }
                        }
                        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        guard size <= 10 * 1024 * 1024 else { throw VaultError.server("Choose images up to 10 MB each.") }
                        let data = try Data(contentsOf: url)
                        let mime =
                            UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                                ?? "image/jpeg"
                        items.append(
                            .object([
                                "mimeType": .string(mime),
                                "dataUrl": .string(
                                    "data:\(mime);base64,\(data.base64EncodedString())"
                                ),
                            ])
                        )
                    }
                    if let imageField {
                        values[imageField] = try String(
                            decoding: JSONEncoder().encode(items), as: UTF8.self
                        )
                    }
                } catch { self.error = error.localizedDescription }
            }
            .fileImporter(isPresented: $filePicker, allowedContentTypes: editor.resource.id == "nutrition" ? [.png, .jpeg, .gif, .webP] : [.data]) { selection in
                do {
                    let url = try selection.get()
                    staging = true
                    error = nil
                    importTask = Task {
                        defer { staging = false }
                        do {
                            let limit: Int64 = editor.resource.id == "nutrition" ? 10 * 1024 * 1024 : editor.action.path.contains("/voice/clips") ? 50 * 1024 * 1024 : VaultAPI.maxImportBytes
                            let draft = try await UploadDraft.stageAsync(url, maximumSize: limit)
                            upload?.removeStagedFiles()
                            upload = draft
                            filename = draft.name
                            result = .null
                        } catch is CancellationError {} catch { self.error = error.localizedDescription }
                    }
                } catch { self.error = error.localizedDescription }
            }
            .sheet(
                item: Binding(
                    get: { preview.map { PreviewItem(url: $0) } }, set: { preview = $0?.url }
                )
            ) { item in
                DocumentPreviewSheet(url: item.url).privacyProtected()
            }
            .onDisappear {
                importTask?.cancel()
                upload?.removeStagedFiles()
                if let preview {
                    VaultModel.removePreview(preview)
                }
            }
            .interactiveDismissDisabled(saving || staging)
        }
    }

    @ViewBuilder private func fieldView(_ field: NativeField) -> some View {
        let binding = Binding(
            get: { values[field.id] ?? field.initial }, set: { values[field.id] = $0 }
        )
        switch field.kind {
        case .boolean:
            Toggle(
                field.label,
                isOn: Binding(
                    get: { binding.wrappedValue == "true" },
                    set: { binding.wrappedValue = $0 ? "true" : "false" }
                )
            )
        case let .choices(options):
            Picker(field.label, selection: binding) {
                if !field.required {
                    Text("None").tag("")
                }
                ForEach(options, id: \.self) { Text(editor.resource.id == "nutrition" ? NativeNutrition.label($0) : VaultValue.label($0)).tag($0) }
            }
        case let .reference(source):
            Picker(field.label, selection: binding) {
                Text("Choose…").tag("")
                ForEach(referenceOptions(source), id: \.self) {
                    Text($0.title).tag($0["id"].string)
                }
            }
        case let .references(source):
            DisclosureGroup(field.label) {
                ForEach(referenceOptions(source), id: \.self) { row in
                    Toggle(
                        row.title,
                        isOn: Binding(
                            get: {
                                binding.wrappedValue.split(separator: "\n").map(String.init)
                                    .contains(row["id"].string)
                            },
                            set: { selected in
                                var ids = binding.wrappedValue.split(separator: "\n").map(
                                    String.init
                                )
                                ids.removeAll { $0 == row["id"].string }
                                if selected {
                                    ids.append(row["id"].string)
                                }
                                binding.wrappedValue = ids.joined(separator: "\n")
                            }
                        )
                    )
                }
            }
        case .images:
            VStack(alignment: .leading) {
                Button("Attach images") {
                    imageField = field.id
                    imagePicker = true
                }
                let count =
                    (try? JSONDecoder().decode(
                        [VaultValue].self, from: Data(binding.wrappedValue.utf8)
                    ))?.count ?? 0
                if count > 0 {
                    Text("\(count) image(s)")
                    Button("Remove images") { binding.wrappedValue = "[]" }
                }
            }
        case let .records(fields):
            NavigationLink(field.label) {
                NativeArrayEditor(title: field.label, fields: fields, text: binding)
            }
        case .secret:
            VStack(alignment: .leading, spacing: 7) {
                Text(field.label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                SecureField(field.label, text: binding).textInputAutocapitalization(.never)
                    .autocorrectionDisabled().accessibilityIdentifier("field-" + field.id)
            }
        case .multiline, .strings:
            VStack(alignment: .leading) {
                Text(field.label).font(.caption).foregroundStyle(.secondary)
                TextEditor(text: binding).frame(minHeight: 110)
            }
        case .number, .integer, .percentage:
            VStack(alignment: .leading, spacing: 7) {
                Text(field.label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                TextField(field.label, text: binding).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("field-" + field.id)
            }
        default:
            VStack(alignment: .leading, spacing: 7) {
                Text(field.label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                TextField(field.label, text: binding).textInputAutocapitalization(.never)
                    .autocorrectionDisabled().accessibilityIdentifier("field-" + field.id)
            }
        }
    }

    private func referenceOptions(_ source: String) -> [VaultValue] {
        if source == "subClients" {
            let project = values["projectId"] ?? editor.record["projectId"].string
            return (references["projects"] ?? []).first { $0["id"].string == project }?[
                "subClients"
            ].array ?? []
        }
        if source == "projects", let client = values["clientId"], !client.isEmpty {
            return (references[source] ?? []).filter { $0["clientId"].string == client }
        }
        return references[source] ?? []
    }

    private func submitOrConfirm() {
        if editor.action.destructive {
            confirmAction = true
        } else {
            Task { await submit() }
        }
    }

    private func submit() async {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
        )
        saving = true
        error = nil
        defer { saving = false }
        do {
            var body = try NativeForm.body(
                fields: editor.action.fields, values: values,
                original: editor.editing ? editor.record : .object([:]),
                patch: editor.editing && editor.collection?.wholeList != true
                    && editor.resource.id != "federal-tax"
                    && editor.resource.id != "weekly-report"
                    && editor.resource.id != "estimated-tax"
                    && editor.resource.id != "schedules"
                    && editor.resource.id != "jobs"
            )
            if let domain = ResearchDomain.resource(editor.resource),
               ["api/research/text", "api/research/youtube"].contains(editor.action.path)
            {
                body.set("domain", .string(domain.rawValue))
            }
            if editor.resource.id == "federal-tax", body["filedDate"] == .null {
                body.remove("filedDate")
            }
            if ["sales", "mileage"].contains(editor.resource.id) {
                if editor.collection?.id == "savedAddresses" {
                    var merged = editor.record
                    for (key, value) in body.object {
                        merged.set(key, value)
                    }
                    try NativeBusiness.validate(merged, collection: "savedAddresses")
                } else {
                    try NativeBusiness.validate(body, collection: editor.collection?.id ?? "")
                }
                if editor.editing, editor.resource.id == "mileage" {
                    body = NativeBusiness.mileagePatch(body)
                }
            }
            if editor.resource.id == "nutrition", editor.editing,
               editor.record["parsed"].isEmpty, !body["parsed"].isEmpty
            {
                body.set("parsed.schemaVersion", .number(1))
                body.set("parsed.parserVersion", .string("1.0.0+manual"))
            }
            if editor.resource.id == "nutrition", editor.editing, let collection = editor.collection {
                let current = try await model.nativeRequest(collection.detailPath, scope: scope, record: editor.record)["entry"]
                try NativeNutrition.validateRevision(patch: body, original: editor.record, current: current)
            }
            if editor.resource.id == "document" {
                for (key, value) in editor.record.object {
                    body.set(key, value)
                }
            }
            if let collection = editor.collection, collection.wholeList {
                try await model.nativeSaveList(
                    collection: collection, resource: editor.resource, scope: scope,
                    original: editor.record, updated: body, editing: editor.editing
                )
                changed()
                dismiss()
                return
            }
            if editor.collection?.id == "entries", editor.resource.id == "timesheet" {
                let timed = !(values["start"] ?? "").isEmpty || !(values["end"] ?? "").isEmpty
                if timed {
                    guard !(values["start"] ?? "").isEmpty, !(values["end"] ?? "").isEmpty else {
                        throw VaultError.server("Enter both start and end times.")
                    }
                    body.set("durationMinutes", .null)
                } else {
                    body.set("start", .null)
                    body.set("end", .null)
                }
            }
            if editor.action.response == "upload", let upload {
                guard let fileURL = upload.fileURL else { throw VaultError.emptyUpload }
                var record = editor.record
                for (key, value) in body.object {
                    record.set(key, value)
                }
                record.set("filename", .string(filename))
                if editor.action.path == "api/restore" {
                    result = try await model.nativeRestore(
                        fileURL: fileURL, password: body["password"].string
                    )
                } else {
                    result = try await model.nativeUpload(
                        editor.action.path, scope: scope, record: record, fileURL: fileURL,
                        method: editor.action.method
                    )
                }
                changed()
            } else if ["pdf", "download", "html", "audio"].contains(editor.action.response) {
                preview = try await model.nativeDownload(
                    editor.action.path, scope: scope, record: editor.record,
                    method: editor.action.method, body: editor.action.fields.isEmpty ? nil : body,
                    suffix: editor.action.response == "pdf"
                        ? "pdf"
                        : editor.action.response == "html"
                        ? "html"
                        : editor.action.response == "audio"
                        ? "mp3" : editor.resource.id == "backup" ? "enc" : "zip"
                )
            } else {
                var record = editor.record
                for (key, value) in body.object {
                    record.set(key, value)
                }
                result = try await model.nativeRequest(
                    editor.action.path, scope: scope, record: record,
                    method: editor.action.method, body: editor.action.method == "GET" ? nil : body
                )
                // These create routes accept only the identity fields. Apply optional settings
                // through their update route after the server has assigned an id.
                if !editor.editing, let collection = editor.collection,
                   (editor.resource.id == "timesheet"
                       && ["clients", "projects"].contains(collection.id))
                   || editor.resource.id == "broker-accounts"
                {
                    let row = result[
                        editor.resource.id == "broker-accounts"
                            ? "account" : collection.id == "clients" ? "client" : "project"
                    ]
                    if !row["id"].isEmpty {
                        result = try await model.nativeRequest(
                            collection.updatePath, scope: scope, record: row,
                            method: collection.updateMethod, body: body
                        )
                    }
                }
                changed()
                if editor.editing || editor.collection != nil
                    || (editor.resource.id == "nutrition" && editor.action.id == "manual")
                    || (ResearchDomain.resource(editor.resource) != nil && ["text", "youtube"].contains(editor.action.id))
                {
                    dismiss()
                }
            }
        } catch { self.error = error.localizedDescription }
    }
}

private struct PreviewItem: Identifiable {
    var id: URL {
        url
    }

    let url: URL
}
