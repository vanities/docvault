import SwiftUI

struct NativeEntityDetailsView: View {
    @Environment(VaultModel.self) private var model
    let entityID: String
    @State private var entity: VaultValue = .null
    @State private var loading = false
    @State private var error: String?
    @State private var edit: VaultValue?
    @State private var revealed = Set<String>()
    @State private var copied: String?
    @State private var generation = UUID()

    var body: some View {
        List {
            VaultHero(title: entity["name"].string.isEmpty ? "Entity details" : entity["name"].string, subtitle: "Identity, filing information and the custom fields saved with this entity.", symbol: "building.2.crop.circle", color: .orange, eyebrow: "WORK & TAXES / ENTITY").vaultStandaloneRow()
            if loading {
                ProgressView("Loading entity details…")
            }
            if let error {
                ErrorNotice(message: error); Button("Retry") { Task { await load() } }
            }
            if !entity.isEmpty {
                let fields = NativeEntityDetails.editable(entity["metadata"])
                VaultMetricGrid(metrics: [.init(title: "Saved text fields", value: String(fields.count), symbol: "text.alignleft"), .init(title: "Protected fields", value: String(fields.keys.filter { NativeEntityDetails.sensitive.contains($0) }.count), symbol: "eye.slash")], color: .orange).vaultStandaloneRow().accessibilityIdentifier("entityDetailsMetrics")
                Section("Entity") {
                    LabeledContent("Name", value: entity["name"].string)
                    LabeledContent("Entity ID", value: entityID)
                    LabeledContent("Organization", value: entity["type"].string == "docs" ? "Documents" : "Tax records")
                    if !entity["description"].string.isEmpty {
                        Text(entity["description"].string).textSelection(.enabled)
                    }
                    Button("Edit entity details", systemImage: "square.and.pencil") { edit = entity }.disabled(loading).accessibilityIdentifier("entityDetailsEdit")
                }
                Section("Saved information") {
                    if fields.isEmpty {
                        Text("No text fields saved. Add filing information or custom fields in the editor.").foregroundStyle(.secondary)
                    }
                    ForEach(fields.keys.sorted(), id: \.self) { key in
                        let value = fields[key] ?? .null
                        let hidden = model.blurNumbers || NativeEntityDetails.sensitive.contains(key) && !revealed.contains(key)
                        VStack(alignment: .leading, spacing: 9) {
                            Text(NativeEntityDetails.label(key)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            if hidden {
                                Text(NativeEntityDetails.masked(value)).font(.body).accessibilityIdentifier("entityMetadata-" + key)
                            } else {
                                Text(NativeEntityDetails.text(value).isEmpty ? "Empty" : NativeEntityDetails.text(value)).font(.body).fixedSize(horizontal: false, vertical: true).textSelection(.enabled).accessibilityIdentifier("entityMetadata-" + key)
                            }
                            HStack {
                                if NativeEntityDetails.sensitive.contains(key) {
                                    Button(revealed.contains(key) ? "Hide" : "Reveal", systemImage: revealed.contains(key) ? "eye.slash" : "eye") {
                                        if revealed.contains(key) {
                                            revealed.remove(key)
                                        } else {
                                            revealed.insert(key)
                                        }
                                    }.disabled(model.blurNumbers).accessibilityIdentifier("entityReveal-" + key)
                                }
                                Button(copied == key ? "Copied" : "Copy value", systemImage: copied == key ? "checkmark" : "doc.on.doc") { UIPasteboard.general.string = NativeEntityDetails.text(value); copied = key }.accessibilityIdentifier("entityCopy-" + key)
                            }.buttonStyle(.borderless)
                        }.padding(.vertical, 5)
                    }
                }
                let structured = entity["metadata"].object.filter { fields[$0.key] == nil }
                if !structured.isEmpty {
                    Section("Additional recorded values") { NativeValueSections(value: .object(structured)); Text("Structured values are preserved when editing text fields.").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }.vaultDashboard(color: .orange).tint(.orange).navigationTitle("Entity details").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("nativeEntityDetails")
            .task(id: model.revision) { await load() }.refreshable { await load() }
            .sheet(isPresented: Binding(get: { edit != nil }, set: {
                if !$0 {
                    edit = nil
                }
            })) {
                if let edit {
                    NativeEntityDetailsEditor(original: edit).privacyProtected()
                }
            }
            .onChange(of: model.blurNumbers) { _, _ in revealed = [] }
            .onDisappear { revealed = []; copied = nil }
    }

    private func load() async {
        let id = UUID(); generation = id; loading = true; error = nil
        defer {
            if generation == id {
                loading = false
            }
        }
        do {
            let data = try await model.nativeRequest("api/entities", scope: .init())
            guard generation == id, !Task.isCancelled else { return }
            guard let selected = data["entities"].array.first(where: { $0["id"].string == entityID }) else { throw VaultError.server("This entity is no longer available.") }
            entity = selected; revealed = []; copied = nil
        } catch {
            if generation == id, !Task.isCancelled {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct NativeEntityDetailsEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let original: VaultValue
    @State private var identity: [String: String]
    @State private var metadata: [String: VaultValue]
    @State private var newKey = ""
    @State private var newValue = ""
    @State private var newKind = "Text"
    @State private var removing: String?
    @State private var discard = false
    @State private var saving = false
    @State private var error: String?
    private var initialIdentity: [String: String] {
        Dictionary(uniqueKeysWithValues: NativeEntityDetails.identityFields.map { ($0, original[$0].string) })
    }

    private var dirty: Bool {
        identity != initialIdentity || metadata != NativeEntityDetails.editable(original["metadata"]) || !newKey.isEmpty || !newValue.isEmpty
    }

    init(original: VaultValue) {
        self.original = original
        _identity = State(initialValue: Dictionary(uniqueKeysWithValues: NativeEntityDetails.identityFields.map { ($0, original[$0].string) }))
        _metadata = State(initialValue: NativeEntityDetails.editable(original["metadata"]))
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    ErrorNotice(message: error).accessibilityIdentifier("entityEditorError")
                }
                Section("Entity") {
                    ForEach(NativeEntityDetails.identityFields, id: \.self) { key in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(NativeEntityDetails.label(key)).font(.caption).foregroundStyle(.secondary)
                            TextField(NativeEntityDetails.label(key), text: Binding(get: { identity[key] ?? "" }, set: { identity[key] = $0 })).accessibilityIdentifier("entityIdentity-" + key)
                        }
                    }
                }
                Section("Custom information") {
                    ForEach(metadata.keys.sorted(), id: \.self) { key in
                        VStack(alignment: .leading, spacing: 9) {
                            Text(NativeEntityDetails.label(key)).font(.headline)
                            let value = metadata[key] ?? .null
                            let binding = Binding(get: { NativeEntityDetails.text(metadata[key] ?? .null) }, set: { text in metadata[key] = NativeEntityDetails.edited(text, template: value) })
                            TextField("Value", text: binding, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("entityEditField-" + key)
                            if case .array = value {
                                Text("List values stay separate. Use one item per line.").font(.caption).foregroundStyle(.secondary)
                            }
                            Button("Remove field…", role: .destructive) { removing = key }.accessibilityIdentifier("entityRemoveField-" + key)
                        }.padding(.vertical, 5)
                    }
                }
                Section("Add a field") {
                    TextField("Field name", text: $newKey).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("entityNewKey")
                    Picker("Value type", selection: $newKind) { Text("Text").tag("Text"); Text("List").tag("List") }
                    TextField(newKind == "List" ? "One value per line" : "Value", text: $newValue, axis: .vertical).accessibilityIdentifier("entityNewValue")
                    Button("Add to draft", systemImage: "plus") { addField() }.disabled(newKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("entityAddField")
                }
                Text("Only changed fields are saved. Removing a field here takes effect when you save. Other recorded values remain preserved.").font(.caption).foregroundStyle(.secondary)
                if saving {
                    ProgressView("Saving entity details…")
                }
            }.disabled(saving).scrollDismissesKeyboard(.interactively).accessibilityIdentifier("nativeEntityEditor")
                .navigationTitle("Edit entity details").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") {
                        if dirty {
                            discard = true
                        } else {
                            dismiss()
                        }
                    }.disabled(saving).accessibilityIdentifier("entityEditorCancel") }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(saving || !dirty).accessibilityIdentifier("entityEditorSave") }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }.accessibilityIdentifier("entityEditorKeyboardDone") }
                }
                .interactiveDismissDisabled(dirty || saving)
                .confirmationDialog("Discard entity changes?", isPresented: $discard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() }.accessibilityIdentifier("entityEditorDiscard"); Button("Keep editing", role: .cancel) {} }
                .confirmationDialog("Remove \(removing.map(NativeEntityDetails.label) ?? "field") from the draft?", isPresented: Binding(get: { removing != nil }, set: {
                    if !$0 {
                        removing = nil
                    }
                }), titleVisibility: .visible) {
                    if let removing {
                        Button("Remove field", role: .destructive) { metadata.removeValue(forKey: removing); self.removing = nil }.accessibilityIdentifier("entityConfirmRemove")
                    }; Button("Keep field", role: .cancel) { removing = nil }
                }
        }
    }

    private func addField() {
        error = nil
        do {
            let key = try NativeEntityDetails.newKey(newKey)
            guard metadata[key] == nil, original["metadata"][key] == .null else { throw VaultError.server("This field name already exists. Edit its saved row instead.") }
            metadata[key] = newKind == "List" ? .array(newValue.components(separatedBy: "\n").map(VaultValue.string)) : .string(newValue)
            newKey = ""; newValue = ""
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        saving = true; error = nil
        defer { saving = false }
        do {
            guard newKey.isEmpty, newValue.isEmpty else { throw VaultError.server("Add the new field to your draft or clear its inputs before saving.") }
            let current = try await model.nativeRequest("api/entities", scope: .init())["entities"].array.first { $0["id"] == original["id"] }
            guard let current else { throw VaultError.server("This entity is no longer available.") }
            let patch = try NativeEntityDetails.patch(original: original, current: current, identity: identity, metadata: metadata)
            guard !patch.isEmpty else { dismiss(); return }
            let result = try await model.nativeRequest("api/entities/{id}", scope: .init(), record: original, method: "PUT", body: patch)
            try NativeProviderSettings.requireSaved(result)
            await model.refreshEntities(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
