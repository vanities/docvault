import SwiftUI

struct NativeDocumentOrganizationView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var file: VaultFile
    let entity: String
    let organize: Bool
    let changed: () -> Void
    @State private var target: String
    @State private var metadata: NativeImportMetadata
    @State private var working = false
    @State private var analyzing = false
    @State private var error: String?
    @State private var receipt: NativeDocumentOrganizationReceipt?
    @State private var confirmDiscard = false
    @State private var confirmKeepMoved = false
    @State private var analysisTask: Task<Void, Never>?
    private let initial: NativeImportMetadata

    init(file: VaultFile, entity: String, organize: Bool, changed: @escaping () -> Void) {
        self.entity = entity; self.organize = organize; self.changed = changed
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let metadata = NativeDocumentOrganization.metadata(file, fallbackYear: calendar.component(.year, from: .now))
        initial = metadata
        _file = State(initialValue: file); _target = State(initialValue: entity); _metadata = State(initialValue: metadata)
    }

    private var plan: NativeDocumentOrganizationPlan? {
        try? NativeDocumentOrganization.plan(file: file, entity: entity, target: target, metadata: metadata, organize: organize)
    }

    private var dirty: Bool {
        target != entity || metadata != initial
    }

    private var frozen: Bool {
        working || receipt != nil
    }

    private var validationError: String? {
        do { _ = try NativeDocumentOrganization.plan(file: file, entity: entity, target: target, metadata: metadata, organize: organize); return nil }
        catch { return error.localizedDescription }
    }

    var body: some View {
        NavigationStack {
            Form {
                VaultHero(title: organize ? "Organize your document" : "A clearer filename", subtitle: "Review the final destination before saving. Your notes, tags and totals setting travel with the file.", symbol: organize ? "folder.badge.gearshape" : "pencil.line", color: .indigo, eyebrow: "DOCUMENTS / REVIEW").vaultStandaloneRow()
                Section("Current document") {
                    LabeledContent("Entity", value: model.entities.first { $0.id == entity }?.name ?? entity)
                    Text(file.path).font(.footnote).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                if organize {
                    Section("Destination") {
                        Picker("Entity", selection: $target) { ForEach(model.entities) { Text($0.name).tag($0.id) } }.accessibilityIdentifier("documentOrganizationEntity")
                        if NativeDocumentImport.businessFolders[metadata.type] == nil {
                            TextField("Tax year", text: binding("year", \.year)).keyboardType(.numberPad).accessibilityIdentifier("documentOrganizationYear")
                        }
                        Picker("Document type", selection: binding("type", \.type)) { ForEach(NativeDocumentImport.types, id: \.0) { Text($0.1).tag($0.0) } }.accessibilityIdentifier("documentOrganizationType")
                        if metadata.type == "receipt" {
                            Picker("Expense category", selection: binding("category", \.category)) { ForEach(NativeDocumentImport.categories, id: \.0) { Text($0.1).tag($0.0) } }.accessibilityIdentifier("documentOrganizationCategory")
                        }
                    }.disabled(frozen)
                }
                Section("Filename") {
                    Toggle("Use standard filename", isOn: Binding(get: { metadata.standardName }, set: { metadata.standardName = $0; metadata.edited.insert("filename") })).accessibilityIdentifier("documentStandardName")
                    TextField("Filename", text: Binding(get: { (try? NativeDocumentImport.filename(metadata, original: file.name)) ?? metadata.customName }, set: { metadata.customName = $0; metadata.standardName = false; metadata.edited.insert("filename") }))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("field-newFilename")
                    Text("Keep the original .\((file.name as NSString).pathExtension) extension.").font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("Standard naming fields") {
                        TextField("Source", text: binding("source", \.source)).accessibilityIdentifier("documentNamingSource")
                        TextField("Description", text: binding("description", \.description)).accessibilityIdentifier("documentNamingDescription")
                        TextField("Year", text: binding("year", \.year)).keyboardType(.numberPad)
                        TextField("Month (optional)", text: binding("month", \.month)).keyboardType(.numberPad)
                        TextField("Day (optional)", text: binding("day", \.day)).keyboardType(.numberPad)
                    }
                    Button(analyzing ? "Preparing suggestion…" : file.parsedData == nil ? "Parse & suggest name" : "Suggest from saved extraction") { suggest() }
                        .disabled(analyzing).accessibilityIdentifier("documentSuggestName")
                    if analyzing {
                        Button("Cancel suggestion") { analysisTask?.cancel(); analyzing = false }.accessibilityIdentifier("cancelDocumentSuggestion")
                    }
                    if file.parsedData == nil {
                        Text("Parsing uses the configured provider and saves extracted fields on the server. Review the naming suggestion before moving the file.").font(.caption).foregroundStyle(.secondary)
                    }
                }.disabled(frozen)
                Section("Reviewed destination") {
                    if organize, file.parsedData == nil {
                        Text("Unparsed files keep their inferred type through the destination folder and filename. Moving a file does not parse it.").font(.caption).foregroundStyle(.secondary)
                    }
                    if let saved = receipt {
                        Label("Saved location", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        Text(model.entities.first { $0.id == saved.plan.destination.entity }?.name ?? saved.plan.destination.entity)
                        Text(saved.plan.destination.path).font(.footnote).textSelection(.enabled).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("documentConfirmedLocation")
                        if !saved.complete {
                            Text("The file is at this location. Its classification has not been saved yet; retrying will keep this location.").font(.caption).foregroundStyle(.secondary)
                        }
                    } else if let plan {
                        Text(model.entities.first { $0.id == plan.destination.entity }?.name ?? plan.destination.entity)
                        Text(plan.destination.path).font(.footnote).textSelection(.enabled).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("documentDestinationPreview")
                        if !plan.movesFile, plan.classification.isEmpty {
                            Text("No changes to save.").foregroundStyle(.secondary)
                        }
                    } else {
                        Text(validationError ?? "Enter a valid filename, date and destination.").foregroundStyle(.red).accessibilityIdentifier("documentOrganizationValidationError")
                    }
                }
                if let error {
                    ErrorNotice(message: error)
                }
                if let receipt, !receipt.complete {
                    Button("Keep moved file without classification") { confirmKeepMoved = true }.accessibilityIdentifier("keepMovedDocument")
                }
            }.navigationTitle(organize ? "Organize document" : "Rename document").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            if dirty {
                                confirmDiscard = true
                            } else {
                                dismiss()
                            }
                        }.disabled(working || receipt != nil)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(working ? "Saving…" : receipt != nil ? "Retry classification" : "Save") { save() }
                            .disabled(working || analyzing || (receipt == nil && (plan == nil || !model.entities.contains { $0.id == target } || (plan?.movesFile == false && plan?.classification.isEmpty == true))))
                            .accessibilityIdentifier("saveDocumentOrganization")
                    }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { hideKeyboard() }.accessibilityIdentifier("documentOrganizationKeyboardDone") }
                }
                .confirmationDialog("Discard document changes?", isPresented: $confirmDiscard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() } }
                .confirmationDialog("Keep the moved file?", isPresented: $confirmKeepMoved, titleVisibility: .visible) { Button("Keep moved file") { changed(); dismiss() } } message: { Text("The saved location will be kept. Classification changes that failed will remain unapplied.") }
        }.interactiveDismissDisabled(dirty || working || analyzing || receipt != nil).onDisappear { analysisTask?.cancel() }
    }

    private func binding(_ key: String, _ path: WritableKeyPath<NativeImportMetadata, String>) -> Binding<String> {
        Binding(get: { metadata[keyPath: path] }, set: { metadata[keyPath: path] = $0; metadata.edited.insert(key) })
    }

    private func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func suggest() {
        error = nil; analyzing = true; metadata.edited.remove("filename")
        let original = file, entity = entity, client = model.api, wasDemo = model.demo
        analysisTask = Task {
            defer {
                if !Task.isCancelled {
                    analyzing = false
                }
            }
            do {
                let parsed: VaultValue = if let existing = original.parsedData {
                    existing
                } else {
                    try await model.extractImportedDocument(entity: entity, path: original.path, year: metadata.validYear())
                }
                guard !Task.isCancelled, model.connected, model.api === client, model.demo == wasDemo else { return }
                file.parsedData = parsed
                try NativeDocumentOrganization.suggest(parsed, metadata: &metadata)
            } catch {
                if !Task.isCancelled {
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func save() {
        hideKeyboard(); error = nil
        do {
            let requested = try NativeDocumentOrganization.plan(file: file, entity: entity, target: target, metadata: metadata, organize: organize)
            working = true
            Task {
                defer { working = false }
                let result = await NativeDocumentOrganization.perform(existing: receipt, plan: requested, move: { try await model.moveOrganizedDocument($0, notify: false) }, classify: { try await model.classifyOrganizedDocument($0) })
                receipt = result.0; error = result.1
                if result.0?.complete == true {
                    changed(); dismiss()
                }
            }
        } catch { self.error = error.localizedDescription }
    }
}
