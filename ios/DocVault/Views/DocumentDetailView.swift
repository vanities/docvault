import QuickLook
import SwiftUI

private struct PreviewFile: Identifiable {
    let url: URL
    var id: String {
        url.absoluteString
    }
}

struct DocumentDetailView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var file: VaultFile
    let entity: String
    @State private var preview: PreviewFile?
    @State private var loading = false
    @State private var error: String?
    @State private var editing = false
    @State private var localURL: URL?
    @State private var operation: NativeEditor?
    @State private var fillingForm = false
    @State private var filledDraft: UploadDraft?
    @State private var organizing = false
    @State private var organizeByType = true
    @State private var savingTracking = false
    private var record: VaultValue {
        .object([
            "entity": .string(entity), "filePath": .string(file.path), "from": .string(file.path),
            "fromEntity": .string(entity), "fromPath": .string(file.path),
        ])
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: file.symbol).font(.system(size: 52)).foregroundStyle(.indigo)
                    Text(file.name).font(.title2.bold()).textSelection(.enabled)
                    Text(model.entities.first(where: { $0.id == entity })?.name ?? entity)
                        .foregroundStyle(.secondary)
                    Button {
                        Task {
                            loading = true
                            error = nil
                            defer { loading = false }
                            do {
                                if localURL == nil {
                                    localURL = try await model.preview(file, entity: entity)
                                }
                                if let url = localURL {
                                    preview = .init(url: url)
                                }
                            } catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        Label(
                            loading ? "Preparing preview…" : "Preview document", systemImage: "eye"
                        )
                        .frame(maxWidth: .infinity)
                    }.buttonStyle(.borderedProminent).controlSize(.large).disabled(loading)
                        .accessibilityIdentifier("previewDocument")
                    if let localURL {
                        ShareLink(item: localURL) {
                            Label("Share document", systemImage: "square.and.arrow.up")
                        }
                    }
                    if let error {
                        ErrorNotice(message: error)
                    }
                }.padding(.vertical, 12)
            }
            Section("Details") {
                LabeledContent("Document type", value: NativeDocumentImport.types.first { $0.0 == NativeDocumentOrganization.type(file) }?.1 ?? "Other")
                LabeledContent("Folder", value: file.folder.isEmpty ? "Root" : file.folder)
                LabeledContent(
                    "Size",
                    value: ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file)
                )
                LabeledContent(
                    "Modified",
                    value: file.modifiedDate.formatted(date: .abbreviated, time: .shortened)
                )
            }
            Section("Totals") {
                Toggle("Include in totals", isOn: Binding(get: { file.isTracked }, set: { saveTracking($0) }))
                    .disabled(savingTracking).accessibilityIdentifier("documentTracked")
                if savingTracking {
                    ProgressView("Saving totals setting…")
                }
                Text("Excluded documents remain in your library. The server omits them from tax totals and CPA packages.").font(.caption).foregroundStyle(.secondary)
            }
            if let tags = file.tags, !tags.isEmpty {
                Section("Tags") { Text(tags.joined(separator: " · ")).foregroundStyle(.indigo) }
            }
            Section("Notes") {
                Text(file.notes?.isEmpty == false ? file.notes! : "No notes yet.").foregroundStyle(
                    .secondary
                ).textSelection(.enabled)
            }
            if let parsed = file.parsedData {
                Section("Parsed document") { NativeValueSections(value: parsed) }
            }
        }
        .navigationTitle("Document").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("Edit notes", systemImage: "square.and.pencil") { editing = true }
            Menu {
                Button("Rename") {
                    organizeByType = false; organizing = true
                }
                Button("Move") {
                    organizeByType = true; organizing = true
                }
                Button("Move to a custom path") {
                    perform(
                        "move", "Move document", "api/move",
                        [.init("to", "Destination path", required: true, initial: file.path)]
                    )
                }
                Button("Move to another entity") {
                    perform(
                        "move-between", "Move to another entity", "api/move-between",
                        [
                            .init(
                                "toEntity", "Destination entity", .reference("entities"),
                                required: true
                            ),
                            .init("toPath", "Destination path", required: true, initial: file.path),
                        ]
                    )
                }
                Button("Parse document") {
                    perform("parse", "Parse document", "api/parse/{entity}/{filePath}", [])
                }
                Button("Fill PDF form") { fillingForm = true }
                Button("Delete document", role: .destructive) {
                    perform(
                        "delete", "Delete document", "api/file/{entity}/{filePath}", [],
                        method: "DELETE"
                    )
                }
            } label: {
                Image(systemName: "ellipsis").accessibilityLabel("Document actions")
            }
        }
        .sheet(item: $preview) { DocumentPreviewSheet(url: $0.url).privacyProtected() }
        .sheet(isPresented: $editing) {
            MetadataEditor(file: file, entity: entity) { notes, tags in
                file.notes = notes
                file.tags = tags
            }.privacyProtected()
        }
        .sheet(isPresented: $organizing) {
            NativeDocumentOrganizationView(file: file, entity: entity, organize: organizeByType) { model.revision += 1; dismiss() }.privacyProtected()
        }
        .sheet(item: $operation) { item in
            NativeEditorView(editor: item, scope: .init(entity: entity), context: record) {
                model.revision += 1
                dismiss()
            }.privacyProtected()
        }
        .sheet(
            isPresented: $fillingForm,
            onDismiss: {
                if let filledDraft {
                    model.draft = filledDraft
                    self.filledDraft = nil
                }
            }
        ) {
            NativePDFFormView(file: file, entity: entity, saved: { filledDraft = $0 })
                .privacyProtected()
        }
        .onDisappear {
            if let localURL {
                VaultModel.removePreview(localURL)
                self.localURL = nil
            }
        }
    }

    private func saveTracking(_ value: Bool) {
        guard !savingTracking else { return }
        savingTracking = true; error = nil
        Task {
            defer { savingTracking = false }
            do { try await model.saveMetadata(file: file, entity: entity, tracked: value); file.tracked = value }
            catch { self.error = error.localizedDescription }
        }
    }

    private func perform(
        _ id: String, _ title: String, _ path: String, _ fields: [NativeField],
        method: String = "POST"
    ) {
        let action = NativeAction(
            id: id, title: title, path: path, method: method, fields: fields,
            destructive: method == "DELETE"
        )
        operation = NativeEditor(
            action: action, record: record,
            resource: .init(id: "document", title: "Document", path: path)
        )
    }
}

struct DocumentPreviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    let url: URL
    var body: some View {
        NavigationStack {
            Group {
                if url.pathExtension.lowercased() == "html" {
                    NativeHTMLPreview(url: url)
                } else {
                    QuickLookPreview(url: url)
                }
            }
            .navigationTitle(url.lastPathComponent).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("closeDocumentPreview")
                }
                ToolbarItem(placement: .bottomBar) {
                    ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                }
            }
        }
    }
}

struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_: QLPreviewController, context _: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in _: QLPreviewController) -> Int {
            1
        }

        func previewController(_: QLPreviewController, previewItemAt _: Int)
            -> any QLPreviewItem
        {
            url as NSURL
        }
    }
}

struct MetadataEditor: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let file: VaultFile
    let entity: String
    let saved: (String, [String]) -> Void
    @State private var notes: String
    @State private var tags: String
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDiscard = false
    init(file: VaultFile, entity: String, saved: @escaping (String, [String]) -> Void) {
        self.file = file
        self.entity = entity
        self.saved = saved
        _notes = State(initialValue: file.notes ?? "")
        _tags = State(initialValue: (file.tags ?? []).joined(separator: ", "))
    }

    private var dirty: Bool {
        notes != (file.notes ?? "") || tags != (file.tags ?? []).joined(separator: ", ")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Notes") {
                    TextEditor(text: $notes).frame(minHeight: 150).accessibilityIdentifier(
                        "documentNotes"
                    )
                }
                Section("Tags, separated by commas") {
                    TextField("Reviewed, Tax", text: $tags).accessibilityIdentifier("documentTags")
                }
                if let error {
                    ErrorNotice(message: error)
                }
            }.navigationTitle("Notes & tags").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            if dirty {
                                confirmDiscard = true
                            } else {
                                dismiss()
                            }
                        }.disabled(saving)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(saving ? "Saving…" : "Save") {
                            Task {
                                saving = true
                                defer { saving = false }
                                let values = Array(
                                    Set(
                                        tags.split(separator: ",").map {
                                            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                                        }.filter { !$0.isEmpty }
                                    )
                                ).sorted()
                                do {
                                    try await model.saveMetadata(
                                        file: file, entity: entity, notes: notes, tags: values
                                    )
                                    saved(notes, values)
                                    dismiss()
                                } catch { self.error = error.localizedDescription }
                            }
                        }.disabled(saving)
                    }
                }
        }.interactiveDismissDisabled(saving || dirty)
            .confirmationDialog("Discard notes and tags?", isPresented: $confirmDiscard, titleVisibility: .visible) { Button("Discard changes", role: .destructive) { dismiss() } }
    }
}
